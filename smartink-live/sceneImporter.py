#!/usr/bin/env python3
"""
Blender scene builder for Smart Ink RenderContract (UV ink layer + registry IDs).

Usage (headless render):
  blender --background --python sceneImporter.py -- /path/to/contract.json

Place contract.json, ink.png, and body mesh assets in the same folder.
"""

from __future__ import annotations

import json
import math
import os
import sys
from mathutils import Euler, Matrix, Vector
from typing import Any, Dict, List, Optional, Tuple

import bpy

# ---------------------------------------------------------------------------
# Registry (mirrors src/render/registry.ts)
# ---------------------------------------------------------------------------

BODY_MESH_ASSETS: Dict[str, Dict[str, str]] = {
    "body_full": {"preview": "FinalBaseMesh.obj", "blend": "body_full.blend"},
    "forearm": {"preview": "monk.glb", "blend": "forearm.blend"},
    "human": {"preview": "human.obj", "blend": "human.blend"},
}

SKIN_TONES: Dict[str, Tuple[float, float, float]] = {
    "tone_01": (0.945, 0.788, 0.647),  # #f1c9a5
    "tone_03": (0.831, 0.647, 0.455),  # #d4a574
    "tone_05": (0.663, 0.467, 0.294),  # #a9774b
    "tone_07": (0.420, 0.263, 0.153),  # #6b4327
}

# skinToneId -> material name in skins.blend (mirrors registry.ts serverShader)
SKIN_SHADERS: Dict[str, str] = {
    "tone_01": "skin_fair",
    "tone_03": "skin_medium",
    "tone_05": "skin_tan",
    "tone_07": "skin_deep",
}

# lookId -> preview background + lighting preset name (matches Three.js presets)
LOOK_WORLDS: Dict[str, Dict[str, Any]] = {
    "studio_softbox": {"bg": "#ffffff", "lighting": "studio"},
    "window_daylight": {"bg": "#888888", "lighting": "softboxLeft"},
    "dramatic_rim": {"bg": "#181818", "lighting": "dramatic"},
}

OUTPUT_TIERS: Dict[str, Dict[str, int]] = {
    "preview": {"samples": 16, "max_dim": 512},
    "final": {"samples": 256, "max_dim": 2048},
}

# Tuned for Cycles preview to approximate the browser Lambert shader (not final Blender truth).
BLENDER_BASE_ENERGY = {
    "directional": 4.0,
    "point": 80,
    "ambient": 1.0,
}
# Mirrors src/config/lightingPresets.ts threeIntensityScale (fallback when contract omits intensityScale).
THREE_INTENSITY_SCALE: Dict[str, float] = {
    "studio": 1.1,
    "softboxLeft": 1.4,
    "softboxRight": 1.4,
    "backlight": 1.6,
    "dramatic": 2.0,
    "sunset": 1.2,
}
# Hard sun angle — browser shader uses parallel rays (no softbox falloff).
SUN_ANGLE_RAD = math.radians(2.0)

# Canonical lights per preset (relative intensities, Three.js Y-up positions; mirrors lightingPresets.ts)
LIGHTING_PRESETS: Dict[str, List[Dict[str, Any]]] = {
    "studio": [
        {"type": "ambient", "position": [0, 0, 0], "intensity": 0.136, "color": "#ffffff", "castShadow": False},
        {"type": "directional", "position": [8, 6, 8], "target": [0, 0, 0], "intensity": 1.0, "color": "#ffffff", "castShadow": True},
        {"type": "directional", "position": [-6, 2, 4], "target": [0, 0, 0], "intensity": 0.455, "color": "#aaffee", "castShadow": False},
        {"type": "directional", "position": [0, 8, -8], "target": [0, 0, 0], "intensity": 0.636, "color": "#ffbbaa", "castShadow": False},
    ],
    "softboxLeft": [
        {"type": "ambient", "position": [0, 0, 0], "intensity": 0.086, "color": "#ffffff", "castShadow": False},
        {"type": "directional", "position": [-10, 8, 5], "target": [0, 0, 0], "intensity": 1.0, "color": "#ffffff", "castShadow": True},
        {"type": "directional", "position": [8, 2, 8], "target": [0, 0, 0], "intensity": 0.214, "color": "#aaffee", "castShadow": False},
    ],
    "dramatic": [
        {"type": "ambient", "position": [0, 0, 0], "intensity": 0.025, "color": "#ffffff", "castShadow": False},
        {"type": "spot", "position": [0, 10, 0], "target": [0, 0, 0], "intensity": 1.0, "color": "#ffffff", "castShadow": True, "angle": 0.3, "penumbra": 0.7},
        {"type": "directional", "position": [-6, 2, 4], "target": [0, 0, 0], "intensity": 0.15, "color": "#3344ff", "castShadow": False},
    ],
}


# ---------------------------------------------------------------------------
# Coordinate conversion: Three.js (Y-up) -> Blender (Z-up)
# ---------------------------------------------------------------------------

def three_to_blender_position(pos: Any) -> Vector:
    if isinstance(pos, dict):
        x, y, z = pos.get("x", 0), pos.get("y", 0), pos.get("z", 0)
    else:
        x, y, z = pos[0], pos[1], pos[2]
    return Vector((x, -z, y))


def three_to_blender_rotation_euler(rot: Dict[str, Any], order: str = "XYZ") -> Euler:
    if isinstance(rot, dict):
        rx, ry, rz = rot.get("x", 0), rot.get("y", 0), rot.get("z", 0)
    else:
        rx, ry, rz = rot[0], rot[1], rot[2]
    e = Euler((rx, ry, rz), order)
    mat = e.to_matrix().to_4x4()
    conv = Matrix.Rotation(-math.pi / 2, 4, "X")
    return (conv @ mat).to_euler("XYZ")


def fov_degrees_to_focal_length_mm(fov_degrees: float, sensor_height_mm: float = 24.0) -> float:
    """Three.js PerspectiveCamera.fov is vertical; match with Blender sensor_fit=VERTICAL."""
    fov_rad = math.radians(fov_degrees)
    return sensor_height_mm / (2.0 * math.tan(fov_rad / 2.0))


def center_body_at_origin(body: bpy.types.Object) -> None:
    """Match ModelWithUVTattoo: subtract bounding-box center so mesh sits at origin."""
    bpy.context.view_layer.update()
    world_corners = [body.matrix_world @ Vector(corner) for corner in body.bound_box]
    center = sum(world_corners, Vector()) / len(world_corners)
    body.location -= center


def hex_to_rgb(hex_str: str) -> Tuple[float, float, float]:
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 6:
        return (
            int(hex_str[0:2], 16) / 255.0,
            int(hex_str[2:4], 16) / 255.0,
            int(hex_str[4:6], 16) / 255.0,
        )
    return (1.0, 1.0, 1.0)


def is_render_contract(data: Dict[str, Any]) -> bool:
    return data.get("schemaVersion") is not None and "bodyMeshId" in data and "output" in data


# ---------------------------------------------------------------------------
# Scene build pipeline
# ---------------------------------------------------------------------------

def clear_scene(use_empty: bool = False) -> None:
    # Data-level removal works from timers/handlers (no operator context needed),
    # so it is safe in the live GUI watcher as well as in headless renders.
    # The `use_empty` arg is kept for signature compatibility but no longer
    # triggers read_factory_settings (which wiped the viewport context).
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    if not bpy.context.scene.world:
        bpy.context.scene.world = bpy.data.worlds.new("World")


def _resolve_asset(contract_dir: str, filename: str) -> Optional[str]:
    candidate = os.path.join(contract_dir, filename)
    if os.path.exists(candidate):
        return candidate
    script_dir = os.path.dirname(os.path.abspath(__file__))
    for base in (os.path.join(script_dir, ".."), os.path.join(script_dir, "..", "..", "public")):
        candidate = os.path.join(base, filename)
        if os.path.exists(candidate):
            return candidate
    return None


def _operator_ctx() -> Optional[Dict[str, Any]]:
    """A window/area/region context valid for file-import operators.

    Returns None in headless mode (no windows), where operators run fine
    without an override.
    """
    wm = bpy.context.window_manager
    if not wm:
        return None
    for win in wm.windows:
        screen = win.screen
        if not screen:
            continue
        for area in screen.areas:
            if area.type == "VIEW_3D":
                region = next((r for r in area.regions if r.type == "WINDOW"), None)
                if region:
                    return {"window": win, "area": area, "region": region}
    return None


def _pick_imported_body(preferred: Tuple[str, ...] = ("Genesis9",)) -> Optional[bpy.types.Object]:
    """When an OBJ/GLB import yields multiple objects, keep the main body mesh."""
    selected = list(bpy.context.selected_objects)
    if not selected:
        return None
    for name in preferred:
        match = next((o for o in selected if o.name == name or o.name.startswith(name)), None)
        if match:
            for obj in selected:
                if obj != match:
                    bpy.data.objects.remove(obj, do_unlink=True)
            return match
    body = selected[0]
    for obj in selected[1:]:
        bpy.data.objects.remove(obj, do_unlink=True)
    return body


def load_body_mesh(body_mesh_id: str, contract_dir: str) -> Optional[bpy.types.Object]:
    assets = BODY_MESH_ASSETS.get(body_mesh_id, {})
    ctx = _operator_ctx()
    for name in (assets.get("blend"), assets.get("preview")):
        if not name:
            continue
        path = _resolve_asset(contract_dir, name)
        if not path:
            continue
        ext = os.path.splitext(path)[1].lower()

        if ext == ".blend":
            # library load is not an operator -> no context override required
            with bpy.data.libraries.load(path, link=False) as (data_from, data_to):
                data_to.objects = data_from.objects
            for obj in data_to.objects:
                if obj:
                    bpy.context.collection.objects.link(obj)
        elif ext in (".glb", ".gltf", ".obj"):
            def _do_import():
                if ext in (".glb", ".gltf"):
                    bpy.ops.import_scene.gltf(filepath=path)
                elif hasattr(bpy.ops.wm, "obj_import"):
                    bpy.ops.wm.obj_import(filepath=path)   # Blender 4.x/5.x
                else:
                    bpy.ops.import_scene.obj(filepath=path)  # legacy
            if ctx:
                with bpy.context.temp_override(**ctx):
                    _do_import()
            else:
                _do_import()
        else:
            continue

        obj = _pick_imported_body()
        if obj:
            obj.name = "Body"
            return obj

    print(f"Body mesh not found for '{body_mesh_id}'. Using fallback cube.")
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
    return bpy.context.active_object


def _mesh_has_usable_uvs(mesh: bpy.types.Mesh) -> bool:
    if not mesh.uv_layers:
        return False
    for loop in mesh.uv_layers.active.data:
        if loop.uv.x > 1e-6 or loop.uv.y > 1e-6:
            return True
    return False


def ensure_box_projection_uvs(obj: bpy.types.Object) -> None:
    """Match Three.js ModelWithUVTattoo.ensureUVs().

    FinalBaseMesh.obj has no vt lines; the browser generates box-projection UVs
    from vertex XY. Without the same UVs in Blender, ink.png samples at the
    wrong places and the tattoo is invisible or scattered.
    """
    mesh = obj.data
    if not isinstance(mesh, bpy.types.Mesh):
        return
    if _mesh_has_usable_uvs(mesh):
        return

    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    mesh.uv_layers.active = mesh.uv_layers[0]

    coords = [v.co for v in mesh.vertices]
    min_x = min(c.x for c in coords)
    min_y = min(c.y for c in coords)
    size_x = (max(c.x for c in coords) - min_x) or 1.0
    size_y = (max(c.y for c in coords) - min_y) or 1.0

    uv_data = mesh.uv_layers.active.data
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vi = mesh.loops[loop_idx].vertex_index
            co = mesh.vertices[vi].co
            u = (co.x - min_x) / size_x
            v = 1.0 - (co.y - min_y) / size_y
            uv_data[loop_idx].uv = (u, v)


def _resolve_skins_blend(contract_dir: str) -> Optional[str]:
    """Find skins.blend: <contract_dir>/assets, <contract_dir>, or script-relative assets."""
    candidates = []
    if contract_dir:
        candidates.append(os.path.join(contract_dir, "assets", "skins.blend"))
        candidates.append(os.path.join(contract_dir, "skins.blend"))
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates.append(os.path.join(script_dir, "assets", "skins.blend"))
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    return None


def _load_skin_material(skin_tone_id: str, contract_dir: str) -> Optional[bpy.types.Material]:
    """Append the skin material for a tone from skins.blend. Returns it, or None to fall back."""
    mat_name = SKIN_SHADERS.get(skin_tone_id, SKIN_SHADERS["tone_03"])
    blend_path = _resolve_skins_blend(contract_dir)
    if not blend_path:
        print(f"skins.blend not found; procedural skin for {skin_tone_id}.")
        return None
    before = set(bpy.data.materials.keys())
    try:
        with bpy.data.libraries.load(blend_path, link=False) as (src, dst):
            if mat_name not in src.materials:
                print(f"Material '{mat_name}' not in {blend_path}. Found: {list(src.materials)}")
                return None
            dst.materials = [mat_name]
    except Exception as exc:
        print(f"Failed to load {blend_path}: {exc}")
        return None
    new_names = set(bpy.data.materials.keys()) - before
    mat = bpy.data.materials[next(iter(new_names))] if new_names else bpy.data.materials.get(mat_name)
    if mat:
        print(f"Loaded skin material '{mat_name}' from {blend_path}")
    return mat


def apply_skin(body: bpy.types.Object, skin_tone_id: str, contract_dir: str = "") -> None:
    """Prefer a material authored in skins.blend; fall back to the procedural shader."""
    mat = _load_skin_material(skin_tone_id, contract_dir)
    if mat is None:
        _apply_skin_procedural(body, skin_tone_id)
        return
    if body.data.materials:
        body.data.materials[0] = mat
    else:
        body.data.materials.append(mat)


def _apply_skin_procedural(body: bpy.types.Object, skin_tone_id: str) -> None:
    """Fallback: build a flat PBR skin shader from the SKIN_TONES table (previous behavior)."""
    rgb = SKIN_TONES.get(skin_tone_id, SKIN_TONES["tone_03"])
    mat = bpy.data.materials.new(name="Skin")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    output = nodes.new(type="ShaderNodeOutputMaterial")
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Subsurface Weight"].default_value = 0.3
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.2, 0.1)
    bsdf.inputs["Roughness"].default_value = 0.62
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.22
    if "Diffuse Roughness" in bsdf.inputs:
        bsdf.inputs["Diffuse Roughness"].default_value = 0.28
    if body.data.materials:
        body.data.materials[0] = mat
    else:
        body.data.materials.append(mat)


def apply_pose(pose_id: str, body: bpy.types.Object) -> None:
    # Pose library not bundled locally; server resolves serverPose assets.
    _ = pose_id, body


def apply_world(
    look_id: str,
    lights_override: Optional[List[Dict[str, Any]]] = None,
    intensity_scale: Optional[float] = None,
    preset_name: Optional[str] = None,
) -> None:
    world_def = LOOK_WORLDS.get(look_id, LOOK_WORLDS["studio_softbox"])
    preset = preset_name or world_def.get("lighting", "studio")
    scale = intensity_scale if intensity_scale is not None else THREE_INTENSITY_SCALE.get(preset, 1.0)
    world = bpy.context.scene.world
    if not world:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    bg = nodes.new(type="ShaderNodeBackground")
    output = nodes.new(type="ShaderNodeOutputWorld")
    color = hex_to_rgb(world_def["bg"])
    bg.inputs["Color"].default_value = (*color, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    links.new(bg.outputs["Background"], output.inputs["Surface"])
    if lights_override:
        setup_lights_from_list(lights_override, scale)
    else:
        setup_lights(preset, scale)


def _ambient_add_to_world(rel_intensity: float, color_hex: str, intensity_scale: float = 1.0) -> None:
    rgb = hex_to_rgb(color_hex)
    add = rel_intensity * intensity_scale * BLENDER_BASE_ENERGY["ambient"]
    world = bpy.context.scene.world
    if world and world.use_nodes and world.node_tree:
        for node in world.node_tree.nodes:
            if node.type == "BACKGROUND":
                cur = node.inputs["Color"].default_value
                mix = min(1.0, add * 0.35)
                node.inputs["Color"].default_value = (
                    cur[0] * (1.0 - mix) + rgb[0] * mix,
                    cur[1] * (1.0 - mix) + rgb[1] * mix,
                    cur[2] * (1.0 - mix) + rgb[2] * mix,
                    1.0,
                )
                node.inputs["Strength"].default_value += add
                return


def setup_lights(preset_name: str, intensity_scale: float = 1.0) -> None:
    setup_lights_from_list(
        LIGHTING_PRESETS.get(preset_name, LIGHTING_PRESETS["studio"]),
        intensity_scale,
    )


def setup_lights_from_list(lights: List[Dict[str, Any]], intensity_scale: float = 1.0) -> None:
    for light in lights:
        ltype = light.get("type", "point")
        pos = light.get("position", [0, 0, 0])
        rel_intensity = float(light.get("intensity", 0.5)) * intensity_scale
        color_hex = light.get("color", "#ffffff")
        rgb = hex_to_rgb(color_hex)
        cast_shadow = light.get("castShadow", True)

        if ltype == "ambient":
            _ambient_add_to_world(float(light.get("intensity", 0.5)), color_hex, intensity_scale)
            continue

        # Browser preview shader treats directional + spot as parallel rays (no area/spot falloff).
        if ltype in ("directional", "spot"):
            bpy.ops.object.light_add(type="SUN")
            light_obj = bpy.context.active_object
            light_obj.data.angle = SUN_ANGLE_RAD
            base = BLENDER_BASE_ENERGY["directional"]
        else:
            bpy.ops.object.light_add(type="POINT")
            light_obj = bpy.context.active_object
            base = BLENDER_BASE_ENERGY["point"]

        light_obj.location = three_to_blender_position(pos)
        light_obj.data.energy = rel_intensity * base
        light_obj.data.color = rgb
        light_obj.data.use_shadow = cast_shadow

        target = light.get("target", [0, 0, 0])
        target_loc = three_to_blender_position(target)
        direction = target_loc - light_obj.location
        if direction.length > 0.001:
            rot_quat = direction.to_track_quat("-Z", "Y")
            light_obj.rotation_euler = rot_quat.to_euler()


def apply_uv_ink_layer(body: bpy.types.Object, ink_path: str) -> None:
    if not os.path.exists(ink_path):
        print(f"Ink layer not found: {ink_path}")
        return
    if not body.data.materials:
        apply_skin(body, "tone_03")
    mat = body.data.materials[0]
    if not mat.use_nodes:
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return

    ink_tex = nodes.new(type="ShaderNodeTexImage")
    ink_tex.label = "InkLayer"
    ink_tex.image = bpy.data.images.load(os.path.abspath(ink_path))
    ink_tex.image.alpha_mode = "STRAIGHT"
    ink_tex.image.colorspace_settings.name = "sRGB"

    if body.data.uv_layers:
        uv_node = nodes.new(type="ShaderNodeUVMap")
        uv_node.uv_map = body.data.uv_layers.active.name
        links.new(uv_node.outputs["UV"], ink_tex.inputs["Vector"])

    mix = nodes.new(type="ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MIX"
    mix.inputs["Factor"].default_value = 1.0

    base_color_socket = bsdf.inputs["Base Color"]
    if base_color_socket.is_linked:
        from_socket = base_color_socket.links[0].from_socket
        links.remove(base_color_socket.links[0])
        links.new(from_socket, mix.inputs["A"])
    else:
        mix.inputs["A"].default_value = base_color_socket.default_value

    links.new(ink_tex.outputs["Color"], mix.inputs["B"])
    links.new(ink_tex.outputs["Alpha"], mix.inputs["Factor"])
    links.new(mix.outputs["Result"], base_color_socket)


def setup_camera(cam_data: Dict[str, Any]) -> bpy.types.Object:
    """Recreate the browser orbit camera: Y-up position/target, vertical FOV, look-at rotation."""
    pos = cam_data.get("position", [0, 1.5, 2.5])
    target = cam_data.get("target", [0, 0, 0])
    fov_deg = float(cam_data.get("fov", 40))

    bpy.ops.object.camera_add()
    cam_obj = bpy.context.active_object
    cam_obj.name = "Camera"
    cam_loc = three_to_blender_position(pos)
    target_loc = three_to_blender_position(target)
    cam_obj.location = cam_loc

    direction = target_loc - cam_loc
    if direction.length > 0.001:
        cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    cam = cam_obj.data
    cam.type = "PERSP"
    cam.sensor_width = 36.0
    cam.sensor_height = 24.0
    cam.sensor_fit = "VERTICAL"
    cam.lens = fov_degrees_to_focal_length_mm(fov_deg, sensor_height_mm=cam.sensor_height)
    bpy.context.scene.camera = cam_obj
    return cam_obj


def focus_viewport_on_camera() -> None:
    """In GUI mode, switch the 3D viewport to the scene camera (matches browser framing)."""
    if bpy.app.background:
        return
    if not bpy.context.scene.camera:
        return
    wm = bpy.context.window_manager
    if not wm:
        return
    for win in wm.windows:
        screen = win.screen
        if not screen:
            continue
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            space = area.spaces.active
            if space.type != "VIEW_3D":
                continue
            region = next((r for r in area.regions if r.type == "WINDOW"), None)
            if not region:
                continue
            space.region_3d.view_perspective = "CAMERA"
            with bpy.context.temp_override(window=win, area=area, region=region, space_data=space):
                try:
                    bpy.ops.view3d.view_camera()
                except RuntimeError:
                    pass
            return


def setup_output(output: Dict[str, Any], contract_dir: str) -> str:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    # Headless CLI often has no GPU context on macOS; CPU is reliable for local renders.
    scene.cycles.device = "CPU" if bpy.app.background else "GPU"
    tier_id = output.get("qualityTier", "final")
    tier = OUTPUT_TIERS.get(tier_id, OUTPUT_TIERS["final"])
    scene.cycles.samples = tier["samples"]
    scene.cycles.use_denoising = tier_id != "preview"

    width = int(output.get("width", tier["max_dim"]))
    height = int(output.get("height", tier["max_dim"]))
    if output.get("qualityTier") == "preview":
        max_dim = tier["max_dim"]
        if width > max_dim or height > max_dim:
            scale = max_dim / max(width, height)
            width = max(1, int(width * scale))
            height = max(1, int(height * scale))

    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"

    out_dir = os.path.join(contract_dir, "renders")
    os.makedirs(out_dir, exist_ok=True)
    output_path = os.path.join(out_dir, "output.png")
    scene.render.filepath = output_path
    return output_path


def build_scene(contract_path: str) -> str:
    """Load contract.json + sibling ink.png and build the Blender scene. Returns output PNG path."""
    contract_path = os.path.abspath(contract_path)
    contract_dir = os.path.dirname(contract_path)
    with open(contract_path) as f:
        contract = json.load(f)

    if not is_render_contract(contract):
        raise ValueError("Expected RenderContract JSON (schemaVersion, bodyMeshId, output)")

    clear_scene()
    body = load_body_mesh(contract["bodyMeshId"], contract_dir)
    if body is None:
        raise RuntimeError(f"Could not load body mesh: {contract['bodyMeshId']}")

    center_body_at_origin(body)
    ensure_box_projection_uvs(body)
    apply_skin(body, contract.get("skinToneId", "tone_03"), contract_dir)
    apply_pose(contract.get("poseId", "neutral"), body)
    lighting = contract.get("lighting") or {}
    apply_world(
        contract.get("lookId", "studio_softbox"),
        lighting.get("lights"),
        lighting.get("intensityScale"),
        lighting.get("presetName"),
    )

    ink_name = contract.get("inkTextureUrl", "ink.png")
    if ink_name.startswith("data:"):
        ink_name = "ink.png"
    ink_path = ink_name if os.path.isabs(ink_name) else os.path.join(contract_dir, os.path.basename(ink_name))
    apply_uv_ink_layer(body, ink_path)
    setup_camera(contract.get("camera", {}))
    focus_viewport_on_camera()
    return setup_output(contract.get("output", {}), contract_dir)


def _parse_script_args() -> List[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return [a for a in sys.argv[1:] if not a.endswith(".py")]


if __name__ == "__main__":
    argv = _parse_script_args()
    if not argv:
        print("Usage: blender --background --python sceneImporter.py -- contract.json")
        sys.exit(1)
    contract_file = argv[0]
    if not os.path.exists(contract_file):
        print(f"Error: contract not found: {contract_file}")
        sys.exit(1)
    try:
        output_path = build_scene(contract_file)
        if bpy.app.background:
            print(f"Rendering to {output_path}")
            bpy.ops.render.render(write_still=True)
            print("Render completed!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
