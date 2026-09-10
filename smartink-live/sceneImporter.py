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

import bmesh
import bpy

# ---------------------------------------------------------------------------
# Registry (mirrors src/render/registry.ts)
# ---------------------------------------------------------------------------

BODY_MESH_ASSETS: Dict[str, Dict[str, str]] = {
    "body_full": {"preview": "body_male_realistic.glb", "blend": "body_full.blend"},
    "body_full_female": {
        "preview": "body_female_realistic.glb",
        "blend": "body_full_female.blend",
    },
}

# Region boundaries on the full figure; mirrors src/render/bodyRegions.ts.
# Measured off body_male_realistic.glb: between h 0.42 and 0.68 the hanging arm
# is cleanly separated from the trunk and each entry sits midway across that
# gap; above 0.68 the upper arm merges into the deltoid, so the boundary holds.
TORSO_HALF_WIDTH = (
    (0.00, 0.55), (0.40, 0.55), (0.42, 0.69), (0.46, 0.66),
    (0.50, 0.60), (0.54, 0.56), (0.58, 0.50), (0.62, 0.47),
    (0.66, 0.43), (0.68, 0.42), (0.82, 0.42), (0.87, 0.42), (1.00, 0.42),
)
REGION_HEAD_FROM = 0.87
REGION_LEG_TO = 0.46
REGION_ARM_FROM = 0.42
BODY_REGION_IDS = ("head", "torso", "armLeft", "armRight", "legLeft", "legRight")

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

# Bounds of the final-quality slider; mirrors FINAL_SAMPLES in src/render/registry.ts.
FINAL_SAMPLES_MIN = 64
FINAL_SAMPLES_MAX = 1024

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


def srgb_to_linear(c: float) -> float:
    """Blender colour sockets are linear; CSS hex and swatch tables are sRGB.

    Feeding an sRGB value straight into a linear socket lifts the midtones and
    washes the saturation out, which on a skin tone is the difference between
    tan and porcelain.
    """
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_rgb(hex_str: str) -> Tuple[float, float, float]:
    """Parse an sRGB hex string into the linear triple Blender expects."""
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 6:
        return tuple(  # type: ignore[return-value]
            srgb_to_linear(int(hex_str[i : i + 2], 16) / 255.0) for i in (0, 2, 4)
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
    for base in (
        # The script's own directory holds the body meshes. Without this the
        # only way to find them was for the contract to sit beside them, which
        # forced every request through one shared directory.
        script_dir,
        os.path.join(script_dir, ".."),
        os.path.join(script_dir, "..", "..", "public", "models"),
        os.path.join(script_dir, "..", "models"),
    ):
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
            linked = []
            for obj in data_to.objects:
                if obj:
                    bpy.context.collection.objects.link(obj)
                    linked.append(obj)
            # _pick_imported_body() reads the selection, which an import operator
            # would have set for us. Linking does not select, so without this the
            # .blend branch always returned None and fell through to the OBJ.
            for obj in bpy.context.selected_objects:
                obj.select_set(False)
            for obj in linked:
                obj.select_set(True)
            if linked:
                bpy.context.view_layer.objects.active = linked[0]
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
    rgb = tuple(srgb_to_linear(c) for c in SKIN_TONES.get(skin_tone_id, SKIN_TONES["tone_03"]))
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


# ---------------------------------------------------------------------------
# Body shape (mirrors src/render/bodyShape.ts; keep BODY_SHAPE_TUNING in sync)
# ---------------------------------------------------------------------------

BODY_SHAPE_KEYS = (
    "height", "build", "shoulders", "chest", "waist", "belly",
    "hips", "arms", "legs", "legLength", "head",
)
BODY_SHAPE_TUNING: Dict[str, Any] = {
    "height": 0.12,
    "build": 0.03,
    "shoulders": {"scale": 0.14, "c": 0.82, "hw": 0.08},
    "chest": {"amp": 0.03, "c": 0.74, "hw": 0.09},
    "waist": {"amp": 0.035, "c": 0.60, "hw": 0.07},
    "belly": {"amp": 0.055, "c": 0.62, "hw": 0.10},
    "hips": {"scale": 0.10, "c": 0.50, "hw": 0.08},
    "arms": {"amp": 0.025, "c": 0.66, "hw": 0.22},
    "legs": {"amp": 0.03, "c": 0.26, "hw": 0.24},
    "legLength": {"stretch": 0.12, "hip": 0.5},
    "head": {"scale": 0.18, "c": 0.93, "hw": 0.10},
    "armMask": {"from": 0.42, "to": 0.62},
}


def _band(h: float, c: float, hw: float) -> float:
    """Raised-cosine window: 1 at the centre, 0 beyond +/-hw."""
    t = min(1.0, abs(h - c) / hw)
    return 0.5 * (1.0 + math.cos(math.pi * t))


def _smoothstep(e0: float, e1: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def _effective_shape(shape: Optional[Dict[str, Any]]) -> Dict[str, float]:
    out = {k: 0.0 for k in BODY_SHAPE_KEYS}
    for key, value in (shape or {}).items():
        if key not in out:
            continue
        try:
            out[key] = max(-1.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            pass
    return out


def _dominant_axis(v: Vector) -> Vector:
    """Snap a direction to the nearest signed coordinate axis."""
    comps = [abs(v.x), abs(v.y), abs(v.z)]
    i = comps.index(max(comps))
    out = Vector((0.0, 0.0, 0.0))
    out[i] = 1.0 if v[i] >= 0 else -1.0
    return out


def _body_axes(mesh: bpy.types.Mesh, body: bpy.types.Object) -> Tuple[Vector, Vector]:
    """Local up and front directions of a body mesh.

    Importers disagree: the OBJ importer keeps mesh data Y-up and rotates the
    object; the glTF importer, for rigged meshes, keeps Y-up data with an
    identity transform. A full figure is always tallest along its up axis, so
    that wins; the object transform only decides ambiguous cases. Front is
    +Z for Y-up assets (glTF/three.js convention) and -Y for Blender-native
    Z-up ones.
    """
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for v in mesh.vertices:
        for i in range(3):
            c = v.co[i]
            if c < lo[i]:
                lo[i] = c
            if c > hi[i]:
                hi[i] = c
    ext = [hi[i] - lo[i] for i in range(3)]
    order = sorted(range(3), key=lambda i: -ext[i])
    if ext[order[1]] <= 0 or ext[order[0]] > 1.15 * ext[order[1]]:
        up = Vector((0.0, 0.0, 0.0))
        up[order[0]] = 1.0
    else:
        inv = body.matrix_world.inverted().to_3x3()
        up = _dominant_axis(inv @ Vector((0.0, 0.0, 1.0)))
    if up.z > 0.5:
        front = Vector((0.0, -1.0, 0.0))
    elif up.y > 0.5:
        front = Vector((0.0, 0.0, 1.0))
    else:  # X-up would be odd; keep a valid orthogonal frame
        front = Vector((0.0, 0.0, 1.0))
    return up, front


def apply_body_shape(body: bpy.types.Object, shape: Optional[Dict[str, Any]]) -> None:
    """Vertex deformation matching the browser preview (src/render/bodyShape.ts).

    Importers disagree about axes: the OBJ importer keeps mesh data Y-up and
    rotates the object, the glTF importer bakes Z-up into the vertices. The
    up and front directions are therefore read back from the object's world
    matrix (world +Z is up, the model faces world -Y) and the maths runs in
    that (side, up, front) basis. Run after UVs are generated and before the
    body is centred.
    """
    s = _effective_shape(shape)
    if all(abs(v) < 1e-4 for v in s.values()):
        return
    mesh = body.data
    if not isinstance(mesh, bpy.types.Mesh) or len(mesh.vertices) == 0:
        return

    up, front = _body_axes(mesh, body)
    # up x front points to the figure's own left (+X for a Y-up, +Z-facing
    # mesh), which is the sign convention src/render/bodyRegions.ts uses.
    side = up.cross(front)

    T = BODY_SHAPE_TUNING
    coords = [v.co.copy() for v in mesh.vertices]
    try:
        normals = [n.vector.copy() for n in mesh.vertex_normals]
    except AttributeError:  # Blender < 3.1
        normals = [v.normal.copy() for v in mesh.vertices]

    # Local (side, up, front) coordinates of every vertex.
    xs = [c.dot(side) for c in coords]
    ys = [c.dot(up) for c in coords]
    zs = [c.dot(front) for c in coords]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)
    height = max_y - min_y
    if height <= 0:
        return
    half_w = max(1e-6, (max_x - min_x) / 2.0)
    cx = (min_x + max_x) / 2.0
    cz = (min_z + max_z) / 2.0
    hip_y = min_y + T["legLength"]["hip"] * height
    head_y = min_y + T["head"]["c"] * height
    amp = {
        "build": T["build"] * height,
        "chest": T["chest"]["amp"] * height,
        "waist": T["waist"]["amp"] * height,
        "belly": T["belly"]["amp"] * height,
        "arms": T["arms"]["amp"] * height,
        "legs": T["legs"]["amp"] * height,
    }
    height_k = 1.0 + T["height"] * s["height"]
    leg_k = 1.0 + T["legLength"]["stretch"] * s["legLength"]

    for i, n in enumerate(normals):
        x0, y0, z0 = xs[i], ys[i], zs[i]
        nx, ny, nz = n.dot(side), n.dot(up), n.dot(front)
        h = (y0 - min_y) / height
        u = abs(x0 - cx) / half_w
        front_w = max(0.0, nz)
        arm_mask = _smoothstep(T["armMask"]["from"], T["armMask"]["to"], u)
        torso_mask = 1.0 - arm_mask

        off = (
            s["build"] * amp["build"]
            + s["chest"] * amp["chest"] * _band(h, T["chest"]["c"], T["chest"]["hw"]) * torso_mask
            + s["waist"] * amp["waist"] * _band(h, T["waist"]["c"], T["waist"]["hw"]) * torso_mask
            + s["belly"] * amp["belly"] * _band(h, T["belly"]["c"], T["belly"]["hw"]) * torso_mask * front_w
            + s["arms"] * amp["arms"] * _band(h, T["arms"]["c"], T["arms"]["hw"]) * arm_mask
            + s["legs"] * amp["legs"] * _band(h, T["legs"]["c"], T["legs"]["hw"]) * torso_mask
        )
        x = x0 + nx * off
        y = y0 + ny * off
        z = z0 + nz * off

        lateral = (1.0 + T["shoulders"]["scale"] * s["shoulders"] * _band(h, T["shoulders"]["c"], T["shoulders"]["hw"])) * (
            1.0 + T["hips"]["scale"] * s["hips"] * _band(h, T["hips"]["c"], T["hips"]["hw"])
        )
        x = cx + (x - cx) * lateral

        if s["head"]:
            k = 1.0 + T["head"]["scale"] * s["head"] * _band(h, T["head"]["c"], T["head"]["hw"])
            x = cx + (x - cx) * k
            y = head_y + (y - head_y) * k
            z = cz + (z - cz) * k

        if y < hip_y:
            y = hip_y - (hip_y - y) * leg_k

        x = cx + (x - cx) * height_k
        y = min_y + (y - min_y) * height_k
        z = cz + (z - cz) * height_k
        mesh.vertices[i].co = side * x + up * y + front * z

    mesh.update()
    active = ", ".join(f"{k}={v:+.2f}" for k, v in s.items() if abs(v) >= 1e-4)
    print(f"[smartink] Applied body shape ({active}); up={tuple(up)} front={tuple(front)}")


def _torso_half_width(h: float) -> float:
    pts = TORSO_HALF_WIDTH
    if h <= pts[0][0]:
        return pts[0][1]
    for i in range(1, len(pts)):
        if h <= pts[i][0]:
            h0, w0 = pts[i - 1]
            h1, w1 = pts[i]
            return w0 + (w1 - w0) * ((h - h0) / (h1 - h0))
    return pts[-1][1]


def classify_region(h: float, u: float) -> str:
    """h is 0 at the feet and 1 at the crown; u is -1..1, positive to the figure's left."""
    if h >= REGION_HEAD_FROM:
        return "head"
    if h >= REGION_ARM_FROM and abs(u) > _torso_half_width(h):
        return "armLeft" if u >= 0 else "armRight"
    if h < REGION_LEG_TO:
        return "legLeft" if u >= 0 else "legRight"
    return "torso"


def isolate_body_region(body: bpy.types.Object, region_id: Optional[str]) -> None:
    """Delete everything outside one region, matching the editor's cut-out.

    The browser rejects fragments outside the region, so its cut lands exactly
    on the boundary; deleting vertices here cuts on the nearest edge loop
    instead, which trims a fraction wider. Run last, after the body has been
    centred, so the contract's camera still frames the same place.
    """
    if not region_id or region_id not in BODY_REGION_IDS:
        return
    mesh = body.data
    if not isinstance(mesh, bpy.types.Mesh) or len(mesh.vertices) == 0:
        return

    up, front = _body_axes(mesh, body)
    # up x front points to the figure's own left (+X for a Y-up, +Z-facing
    # mesh), which is the sign convention src/render/bodyRegions.ts uses.
    side = up.cross(front)
    xs = [v.co.dot(side) for v in mesh.vertices]
    ys = [v.co.dot(up) for v in mesh.vertices]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    height = max_y - min_y
    if height <= 0:
        return
    half_w = max(1e-6, (max_x - min_x) / 2.0)
    cx = (min_x + max_x) / 2.0

    bm = bmesh.new()
    bm.from_mesh(mesh)
    doomed = [
        v for v in bm.verts
        if classify_region((v.co.dot(up) - min_y) / height, (v.co.dot(side) - cx) / half_w) != region_id
    ]
    kept = len(bm.verts) - len(doomed)
    if kept == 0:
        bm.free()
        print(f"[smartink] Region '{region_id}' selected nothing; keeping the whole figure.")
        return
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    print(f"[smartink] Cut out '{region_id}': kept {kept} of {kept + len(doomed)} verts.")


# ---------------------------------------------------------------------------
# Eyes and hair
#
# The base mesh is a closed sculpt with shut eyelids and no hair of any kind.
# At full-body distance that reads as a shop mannequin no matter how good the
# skin is: the eye is a dark slit with nothing behind it, and a hairless scalp
# has no silhouette. These two additions do more for "is that a person" than
# anything left in the shading.
#
# Nothing here is hardcoded to one mesh. The landmarks are detected from the
# geometry, so the female body, the shape sliders and any future sculpt all
# place their own eyes rather than inheriting the male figure's coordinates.
# ---------------------------------------------------------------------------

EYE_DIAMETER_M = 0.024      # an adult eyeball is 24 mm, near enough to constant
IRIS_RADIUS_FRACTION = 0.50  # iris spans about half the eyeball's silhouette
PUPIL_RADIUS_FRACTION = 0.17
DEFAULT_IRIS_COLOUR = "#5b3a1e"


def _mesh_world_coords(body: bpy.types.Object):
    """Base-mesh vertices in world space, plus the bmesh they came from."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    matrix = body.matrix_world
    return bm, {v.index: matrix @ v.co for v in bm.verts}


def _concavity(bm_vert, coords, normal_matrix) -> float:
    """How much a vertex's neighbours sit in front of its own normal."""
    edges = bm_vert.link_edges
    if not edges:
        return 0.0
    normal = (normal_matrix @ bm_vert.normal).normalized()
    here = coords[bm_vert.index]
    total = 0.0
    for edge in edges:
        offset = coords[edge.other_vert(bm_vert).index] - here
        if offset.length > 1e-9:
            total += offset.normalized().dot(normal)
    return total / len(edges)


def detect_head_landmarks(body: bpy.types.Object) -> Optional[Dict[str, Any]]:
    """Find which way the face points, and where the eyes sit, from geometry.

    Facing comes from the nostrils: they are the deepest concavity anywhere on
    the midline of a head, which is true of any human sculpt and does not care
    how the asset happens to be oriented. Everything else is measured against
    the nose tip and the crown, so the same code fits a different body.
    """
    bm, coords = _mesh_world_coords(body)
    try:
        normal_matrix = body.matrix_world.to_3x3()
        zs = [c.z for c in coords.values()]
        z_min, z_max = min(zs), max(zs)
        height = z_max - z_min
        if height <= 0:
            return None

        head = [v for v in bm.verts if (coords[v.index].z - z_min) / height > REGION_HEAD_FROM]
        if len(head) < 200:
            return None  # the head was cut away by isolate_body_region
        centre = sum((coords[v.index] for v in head), Vector()) / len(head)
        half_width = max(abs(coords[v.index].x - centre.x) for v in head)

        # Nostrils: deepest concavity on the midline. Their side is the face.
        midline = [v for v in head if abs(coords[v.index].x - centre.x) < 0.25 * half_width]
        if not midline:
            return None
        nostril = max(midline, key=lambda v: _concavity(v, coords, normal_matrix))
        facing = -1.0 if coords[nostril.index].y < centre.y else 1.0

        # Nose tip: the furthest point along the facing axis, near the midline.
        nose = max(midline, key=lambda v: facing * (coords[v.index].y - centre.y))
        nose_z = coords[nose.index].z
        crown_z = z_max
        if crown_z - nose_z <= 0:
            return None

        # The eyelid crease sits above the nose tip and off the midline.
        low = nose_z + 0.05 * (crown_z - nose_z)
        high = nose_z + 0.35 * (crown_z - nose_z)
        candidates = []
        for v in head:
            here = coords[v.index]
            offset_x = abs(here.x - centre.x)
            if not (low < here.z < high):
                continue
            if not (0.10 * half_width < offset_x < 0.80 * half_width):
                continue
            if facing * (here.y - centre.y) <= 0:
                continue  # on the back of the skull
            normal = (normal_matrix @ v.normal).normalized()
            if facing * normal.y < 0.1:
                continue  # not facing forward
            score = _concavity(v, coords, normal_matrix)
            if score > 0.15:
                candidates.append((score, here))
        if len(candidates) < 8:
            return None

        eyes = []
        for sign in (-1.0, 1.0):
            side = [(s, p) for s, p in candidates if sign * (p.x - centre.x) > 0]
            if len(side) < 4:
                return None
            weight = sum(s for s, _ in side)
            position = sum(((p * s) for s, p in side), Vector()) / weight
            eyes.append(position)

        return {
            "facing": Vector((0.0, facing, 0.0)),
            "centre": centre,
            "half_width": half_width,
            "nose_z": nose_z,
            "crown_z": crown_z,
            "body_height": height,
            "eyes": eyes,
        }
    finally:
        bm.free()


def _eye_socket_depth(
    body: bpy.types.Object,
    point: Vector,
    facing: Vector,
    radius: float,
) -> Optional[Vector]:
    """Find the closed lid surface in front of a socket.

    A single ray is not enough: the lids meet in a slit that is genuinely open
    on this sculpt, so a ray aimed at the middle of the eye drops straight
    through it and reports the back of the socket instead -- about 6 cm too far
    in, which buries the eyeball inside the skull. Sampling a disc and keeping
    the frontmost hit ignores the slit and finds the lid itself.
    """
    inverse = body.matrix_world.inverted()
    direction = (inverse.to_3x3() @ (facing * -1.0)).normalized()

    # Two axes spanning the plane the lid sits in.
    up = Vector((0.0, 0.0, 1.0))
    across = facing.cross(up).normalized()

    best = None
    steps = (-0.7, -0.35, 0.0, 0.35, 0.7)
    for u in steps:
        for v in steps:
            offset = across * (u * radius) + up * (v * radius)
            origin = point + offset + facing * 1.0
            hit, location, _, _ = body.ray_cast(inverse @ origin, direction)
            if not hit:
                continue
            world = body.matrix_world @ location
            forwardness = facing.dot(world - point)
            if best is None or forwardness > best[0]:
                best = (forwardness, world)
    if best is None:
        return None
    # Keep the sampled x/z, but take the depth from the frontmost lid hit.
    return Vector((point.x, best[1].y, point.z))


def _build_eye_material(name: str, iris_hex: str) -> bpy.types.Material:
    """Sclera, limbus, iris and pupil as radial bands, plus a wet cornea.

    The bands are driven by object-space radius, so one material fits either
    eye and the sphere can be rotated to aim the gaze without the texture
    sliding around on it.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (600, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (320, 0)
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    coords = nodes.new("ShaderNodeTexCoord")
    coords.location = (-1000, 0)
    separate = nodes.new("ShaderNodeSeparateXYZ")
    separate.location = (-820, 0)
    links.new(coords.outputs["Object"], separate.inputs["Vector"])

    # Distance from the gaze axis (local -Y), which is what the bands ride on.
    flat = nodes.new("ShaderNodeCombineXYZ")
    flat.location = (-640, -80)
    links.new(separate.outputs["X"], flat.inputs["X"])
    links.new(separate.outputs["Z"], flat.inputs["Z"])

    radius = nodes.new("ShaderNodeVectorMath")
    radius.operation = "LENGTH"
    radius.location = (-460, -80)
    links.new(flat.outputs["Vector"], radius.inputs[0])

    # The back hemisphere shares every radius with the front, so without this
    # there would be a second pupil looking into the inside of the skull.
    front = nodes.new("ShaderNodeMath")
    front.operation = "LESS_THAN"
    front.location = (-640, 160)
    front.inputs[1].default_value = 0.0
    links.new(separate.outputs["Y"], front.inputs[0])

    banded = nodes.new("ShaderNodeMix")
    banded.data_type = "FLOAT"
    banded.location = (-260, 0)
    banded.inputs["A"].default_value = 1.0  # back of the eye is all sclera
    links.new(front.outputs["Value"], banded.inputs["Factor"])
    links.new(radius.outputs["Value"], banded.inputs["B"])

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.label = "Eye bands"
    ramp.location = (-60, 0)
    ramp.color_ramp.interpolation = "B_SPLINE"
    iris_rgb = hex_to_rgb(iris_hex)
    elements = ramp.color_ramp.elements
    elements[0].position = 0.0
    elements[0].color = (0.008, 0.008, 0.010, 1.0)          # pupil
    elements[1].position = PUPIL_RADIUS_FRACTION
    elements[1].color = (*iris_rgb, 1.0)                     # iris
    limbus = elements.new(IRIS_RADIUS_FRACTION - 0.02)
    limbus.color = (*[c * 0.35 for c in iris_rgb], 1.0)      # dark outer ring
    sclera = elements.new(IRIS_RADIUS_FRACTION + 0.04)
    # Not white. A white sclera is one of the loudest CG tells there is.
    sclera.color = (0.62, 0.58, 0.55, 1.0)
    links.new(banded.outputs["Result"], ramp.inputs["Fac"])

    # Fibres in the iris and vessels in the sclera, from one noise.
    veins = nodes.new("ShaderNodeTexNoise")
    veins.location = (-260, -300)
    veins.inputs["Scale"].default_value = 90.0
    veins.inputs["Detail"].default_value = 6.0
    links.new(coords.outputs["Object"], veins.inputs["Vector"])

    tint = nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.location = (140, 0)
    tint.inputs["Factor"].default_value = 0.22
    tint.inputs["B"].default_value = (0.75, 0.42, 0.38, 1.0)
    links.new(ramp.outputs["Color"], tint.inputs["A"])
    links.new(tint.outputs["Result"], bsdf.inputs["Base Color"])

    bsdf.inputs["Roughness"].default_value = 0.12
    bsdf.inputs["IOR"].default_value = 1.38
    # The cornea is a wet lens over the iris; its highlight is the single
    # strongest cue that an eye is alive rather than painted on.
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.9
        bsdf.inputs["Coat Roughness"].default_value = 0.02
        bsdf.inputs["Coat IOR"].default_value = 1.38
    return mat


def _place_socket_spheres(
    body: bpy.types.Object,
    landmarks: Dict[str, Any],
    material: bpy.types.Material,
    name: str,
) -> List[bpy.types.Object]:
    """Seat a sphere in each eye socket, sized from the figure's own scale."""
    radius = EYE_DIAMETER_M * 0.5 * _world_scale(body)
    facing = landmarks["facing"]

    created = []
    for index, socket in enumerate(landmarks["eyes"]):
        surface = _eye_socket_depth(body, socket, facing, radius)
        if surface is None:
            surface = socket
        # The lid drapes over the ball, so the ball's front pole sits just
        # inside the lid surface -- far enough not to poke through, close
        # enough that the open slit shows the sphere rather than shadow.
        centre = surface - facing * (radius * 1.12)

        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=radius, segments=48, ring_count=24, location=centre
        )
        sphere = bpy.context.active_object
        sphere.name = f"{name}_{index}"
        sphere.rotation_euler = facing.to_track_quat("-Y", "Z").to_euler()
        for polygon in sphere.data.polygons:
            polygon.use_smooth = True
        sphere.data.materials.append(material)
        created.append(sphere)

    print(f"Placed {len(created)} {name} spheres, radius {radius:.4f} u")
    return created


def _build_socket_fill_material(name: str) -> bpy.types.Material:
    """A plain dark surface to close off the socket.

    Without an eyeball the open lid slit renders as a hole straight through the
    head, which reads worse than a closed eye. This is not an eye and should
    not try to be one: no iris, no cornea highlight, nothing that would draw
    the viewer in to look at it. Just enough surface to stop the slit reading
    as a gap, at roughly the darkness a shadowed socket interior would be.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(
        (n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None
    )
    if bsdf is None:
        return mat
    # Not pure black: a true zero reads as a hole in the render just as much as
    # the gap did, and catches no light at all from the rig.
    bsdf.inputs["Base Color"].default_value = (0.020, 0.014, 0.011, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.55
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.20
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.0
    return mat


def add_eyes(body: bpy.types.Object, landmarks: Dict[str, Any], iris_hex: str) -> List[bpy.types.Object]:
    """Place a full eyeball in each socket."""
    return _place_socket_spheres(body, landmarks, _build_eye_material("eye", iris_hex), "eye")


def add_socket_fill(body: bpy.types.Object, landmarks: Dict[str, Any]) -> List[bpy.types.Object]:
    """Close the sockets with a plain dark surface instead of an eye."""
    return _place_socket_spheres(body, landmarks, _build_socket_fill_material("socket"), "socket")


# Hair sizes in real metres; converted to the figure's own units at build time.
HAIR_LENGTHS_M = {"scalp": 0.013, "brow": 0.008, "lash": 0.007}
HAIR_THICKNESS_M = 0.00009
# Parents x children. A real head carries ~100k hairs, a brow ~600 per side.
HAIR_COUNTS = {"scalp": (3200, 55), "brow": (500, 6), "lash": (160, 5)}
# Hair colour as (melanin, redness) rather than RGB: those are the two numbers
# the physical model is actually parameterised by, so the strand's colour stays
# coupled to how it scatters light instead of being tinted after the fact.
HAIR_TONES: Dict[str, Tuple[float, float]] = {
    "black": (1.00, 0.05),
    "dark_brown": (0.92, 0.08),
    "brown": (0.55, 0.20),
    "auburn": (0.35, 0.55),
    "blond": (0.12, 0.28),
    "grey": (0.02, 0.08),
}
DEFAULT_HAIR_TONE = "dark_brown"


def _local_length(body: bpy.types.Object, metres: float) -> float:
    """Convert a real-world length into the object-local units hair uses.

    Particle hair is generated in local space and then carried through the
    object matrix, so a length has to be divided back out by the object scale
    or a 3 mm crop comes out 7 mm long on a figure scaled 2.5x.
    """
    scale = abs(body.scale.x) or 1.0
    return metres * _world_scale(body) / scale


def _build_hair_material(name: str, melanin: float, redness: float) -> bpy.types.Material:
    """Principled Hair, parameterised by melanin rather than by an RGB colour.

    Melanin is what actually varies between heads of hair, and it keeps the
    strand's colour physically coupled to how it scatters -- an RGB tint does
    not, which is why tinted hair so often reads as coloured wire.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    hair = nodes.new("ShaderNodeBsdfHairPrincipled")
    hair.location = (-220, 0)
    if "parametrization" in hair.bl_rna.properties:
        hair.parametrization = "MELANIN"
    links.new(hair.outputs["BSDF"], output.inputs["Surface"])

    for socket, value in (
        ("Melanin", melanin),
        ("Melanin Redness", redness),
        ("Roughness", 0.32),
        ("Radial Roughness", 0.38),
        # Strands are never uniform; without variation a head of hair reads as
        # one solid object rather than as many separate fibres.
        ("Random Color", 0.10),
        ("Random Roughness", 0.12),
        ("IOR", 1.55),
    ):
        if socket in hair.inputs:
            hair.inputs[socket].default_value = value
    return mat


def _vertex_group_from_weights(
    body: bpy.types.Object,
    name: str,
    weights: Dict[int, float],
) -> Optional[str]:
    """Build a weighted vertex group, bucketed so this stays a few dozen calls."""
    if not weights:
        return None
    group = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
    buckets: Dict[int, List[int]] = {}
    for index, weight in weights.items():
        if weight <= 0.01:
            continue
        buckets.setdefault(int(round(weight * 32.0)), []).append(index)
    if not buckets:
        return None
    for step, indices in buckets.items():
        group.add(indices, step / 32.0, "REPLACE")
    return group.name


def _hash01(point: Vector) -> float:
    """Deterministic per-position noise in [0, 1], for breaking up straight edges."""
    value = math.sin(point.x * 127.1 + point.y * 311.7 + point.z * 74.7) * 43758.5453
    return value - math.floor(value)


def _hair_regions(
    body: bpy.types.Object,
    landmarks: Dict[str, Any],
    eye_radius: float,
) -> Dict[str, Dict[str, float]]:
    """Scalp, brow and lash emission regions, measured off the head landmarks.

    The hairline is the interesting one: it is not a height, it is a height
    that depends on which way the surface faces. Hair runs low at the back and
    sides of a skull and stops high on the forehead, so the threshold is
    interpolated by how strongly each vertex faces forward.
    """
    facing = landmarks["facing"]
    centre = landmarks["centre"]
    crown_z = landmarks["crown_z"]
    eyes = landmarks["eyes"]
    eye_z = sum(p.z for p in eyes) / len(eyes)
    eye_dx = sum(abs(p.x - centre.x) for p in eyes) / len(eyes)
    span = max(crown_z - eye_z, 1e-6)

    # Back and sides run down to just above the ears; the forehead stops well
    # short of the crown. Both are expressed against the eye-to-crown span so
    # a different head keeps the same proportions.
    back_limit = eye_z + 0.24 * span
    front_limit = crown_z - 0.39 * span

    matrix = body.matrix_world
    normal_matrix = matrix.to_3x3()
    regions: Dict[str, Dict[int, float]] = {"scalp": {}, "brow": {}, "lash": {}}
    # A real hairline is neither a clean line nor a step: it fades over a
    # centimetre or so and wanders. A hard threshold gives a bowl cut.
    feather = 0.13 * span

    for vert in body.data.vertices:
        point = matrix @ vert.co
        normal = (normal_matrix @ vert.normal).normalized()
        frontness = max(0.0, min(1.0, facing.dot(normal)))
        offset_x = abs(point.x - centre.x)

        threshold = back_limit + (front_limit - back_limit) * frontness
        threshold += (_hash01(point) - 0.5) * feather * 0.9
        weight = _smoothstep(threshold - feather * 0.5, threshold + feather * 0.5, point.z)
        if weight > 0.01:
            regions["scalp"][vert.index] = weight
            continue

        if frontness < 0.15 or facing.dot(point - centre) <= 0:
            continue
        if not (0.40 * eye_dx < offset_x < 1.85 * eye_dx):
            continue
        if eye_z + 0.09 * span < point.z < eye_z + 0.20 * span:
            regions["brow"][vert.index] = 1.0
        elif abs(point.z - eye_z) < 0.45 * eye_radius:
            regions["lash"][vert.index] = 1.0

    return regions


def _add_hair_system(
    body: bpy.types.Object,
    name: str,
    group: str,
    length: float,
    thickness: float,
    material_slot: int,
) -> None:
    parents, children = HAIR_COUNTS[name]
    modifier = body.modifiers.new(name=f"hair_{name}", type="PARTICLE_SYSTEM")
    system = body.particle_systems[modifier.name] if modifier.name in body.particle_systems else body.particle_systems[-1]
    system.vertex_group_density = group

    settings = system.settings
    settings.type = "HAIR"
    settings.use_advanced_hair = True
    settings.count = parents
    settings.hair_length = length
    settings.hair_step = 4
    settings.use_hair_bspline = True
    settings.material = material_slot

    settings.child_type = "INTERPOLATED"
    settings.rendered_child_count = children
    settings.child_length = 1.0
    settings.child_radius = length * 0.25

    # A strand tapers; a cylinder of constant width reads as fur made of tubes.
    settings.radius_scale = thickness
    settings.root_radius = 1.0
    settings.tip_radius = 0.12

    if name == "scalp":
        settings.clump_factor = 0.32
        settings.roughness_1 = 0.008
        settings.roughness_1_size = 0.06
        settings.roughness_endpoint = 0.012
    else:
        # Brows and lashes lie in a combed direction rather than clumping.
        settings.clump_factor = 0.10
        settings.roughness_endpoint = 0.004
    print(f"  hair '{name}': {parents} parents x {children} children, length {length:.4f}")


def add_hair(
    body: bpy.types.Object,
    landmarks: Dict[str, Any],
    eye_radius: float,
    hair_tone: str = DEFAULT_HAIR_TONE,
) -> None:
    """Scalp crop, eyebrows and eyelashes, emitted from detected regions."""
    regions = _hair_regions(body, landmarks, eye_radius)
    melanin, redness = HAIR_TONES.get(hair_tone, HAIR_TONES[DEFAULT_HAIR_TONE])
    material = _build_hair_material("hair", melanin, redness)
    body.data.materials.append(material)
    material_slot = len(body.data.materials)  # particle material index is 1-based

    thickness = _local_length(body, HAIR_THICKNESS_M)
    for name, weights in regions.items():
        group = _vertex_group_from_weights(body, f"hair_{name}", weights)
        if group is None:
            print(f"  hair '{name}': no emission vertices found, skipped")
            continue
        _add_hair_system(
            body,
            name,
            group,
            _local_length(body, HAIR_LENGTHS_M[name]),
            thickness,
            material_slot,
        )

    render = bpy.context.scene.render
    if hasattr(render, "hair_type"):
        render.hair_type = "STRAND"  # real curves, not camera-facing ribbons
        render.hair_subdiv = 2


def apply_pose(pose_id: str, body: bpy.types.Object) -> None:
    # Pose library not bundled locally; server resolves serverPose assets.
    _ = pose_id, body


# ---------------------------------------------------------------------------
# Cinematic rig
#
# The browser preview shades with parallel-ray directionals because that is
# what a cheap viewport shader can do. Mirroring those one-for-one into Cycles
# throws away everything Cycles is good at: soft shadows come from light *size*,
# and skin only reads as skin with subsurface. So the render path builds its own
# rig instead, and accepts that it will look better than the preview.
#
# Positions are polar around the figure and rotated to follow the camera, so the
# key stays off the camera's shoulder no matter how the user has orbited.
# (azimuth offset in degrees, distance, height, energy W, size m, colour)
# ---------------------------------------------------------------------------
CINEMATIC_RIGS: Dict[str, Dict[str, Any]] = {
    "studio_softbox": {
        "bg": (0.012, 0.013, 0.016),
        "backdrop": (0.045, 0.047, 0.052),
        "lights": (
            (35, 5.4, 3.0, 430, 3.5, (1.00, 0.95, 0.90)),
            (-50, 5.0, 1.2, 85, 4.0, (0.78, 0.85, 1.00)),
            (168, 4.6, 3.4, 700, 1.6, (1.00, 0.83, 0.68)),
            (-140, 4.6, 0.3, 180, 1.4, (1.00, 0.76, 0.60)),
        ),
    },
    "window_daylight": {
        "bg": (0.040, 0.046, 0.058),
        "backdrop": (0.100, 0.104, 0.112),
        "lights": (
            (58, 4.6, 2.4, 900, 4.5, (1.00, 0.98, 0.95)),
            (-62, 5.2, 1.4, 240, 4.5, (0.82, 0.88, 1.00)),
            (170, 5.0, 3.0, 420, 2.0, (0.95, 0.97, 1.00)),
        ),
    },
    "dramatic_rim": {
        "bg": (0.004, 0.004, 0.006),
        "backdrop": (0.020, 0.020, 0.024),
        "lights": (
            (28, 5.0, 2.8, 520, 2.0, (1.00, 0.94, 0.88)),
            (-70, 5.4, 1.0, 45, 3.0, (0.72, 0.80, 1.00)),
            (155, 4.2, 3.2, 1500, 1.2, (1.00, 0.80, 0.62)),
            (-152, 4.2, 0.5, 620, 1.0, (1.00, 0.72, 0.55)),
        ),
    },
}


def _camera_azimuth() -> float:
    """Angle of the camera around the figure, or the default front if unset."""
    cam = bpy.context.scene.camera
    if cam is None:
        return math.radians(-90.0)
    return math.atan2(cam.location.y, cam.location.x)


def _add_area_light(name, loc, energy, size, color, target=(0.0, 0.0, 0.0)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = Vector(loc)
    direction = Vector(target) - obj.location
    if direction.length > 0.001:
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj


def build_cinematic_rig(look_id: str, intensity_scale: float = 1.0, body_height: float = 4.2) -> None:
    """Area-light rig plus a seamless backdrop, both oriented to the camera."""
    rig = CINEMATIC_RIGS.get(look_id, CINEMATIC_RIGS["studio_softbox"])
    theta = _camera_azimuth()
    aim = (0.0, 0.0, body_height * 0.05)

    for i, (az, dist, height, energy, size, color) in enumerate(rig["lights"]):
        a = theta + math.radians(az)
        _add_area_light(
            f"cine_{i}",
            (dist * math.cos(a), dist * math.sin(a), height),
            energy * max(0.15, intensity_scale),
            size,
            color,
            aim,
        )

    world = bpy.context.scene.world
    if world and world.use_nodes:
        for node in world.node_tree.nodes:
            if node.type == "BACKGROUND":
                node.inputs["Color"].default_value = (*rig["bg"], 1.0)
                node.inputs["Strength"].default_value = 1.0

    mat = bpy.data.materials.new("cine_backdrop")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rig["backdrop"], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.62

    build_cyclorama(theta, -body_height / 2.0 - 0.02, body_height, mat)


def build_cyclorama(
    theta: float,
    floor_z: float,
    body_height: float,
    material: bpy.types.Material,
) -> bpy.types.Object:
    """A studio sweep: floor curving up into the back wall, with no seam.

    Two flat planes leave a hard horizon line where they meet, and once the
    camera moves back onto a long lens that line lands squarely behind the
    figure. Real studios solve this with a cyclorama -- a coved floor-to-wall
    curve that has no edge to catch the light -- so this builds one, sized from
    however far away the camera ended up.
    """
    camera = bpy.context.scene.camera
    cam_distance = camera.location.length if camera else body_height * 3.0

    radius = max(3.0, body_height * 1.1)          # cove radius
    start = max(body_height * 1.2, cam_distance * 0.30)  # where the floor starts to lift
    height = max(body_height * 3.0, cam_distance * 1.0)  # wall height, to fill frame
    half_width = max(body_height * 4.0, cam_distance * 1.0)
    front = max(body_height * 3.0, cam_distance * 0.6)   # floor toward the camera

    # Profile in (distance behind the subject, height above the floor).
    profile: List[Tuple[float, float]] = [(-front, 0.0), (start, 0.0)]
    arc_segments = 16
    for i in range(1, arc_segments + 1):
        a = (math.pi / 2.0) * i / arc_segments
        profile.append((start + radius * math.sin(a), radius * (1.0 - math.cos(a))))
    profile.append((start + radius, height))

    back = theta + math.pi
    back_dir = Vector((math.cos(back), math.sin(back), 0.0))
    side_dir = Vector((-math.sin(back), math.cos(back), 0.0))

    mesh = bpy.data.meshes.new("cyclorama")
    vertices = []
    for distance, lift in profile:
        base = back_dir * distance + Vector((0.0, 0.0, floor_z + lift))
        vertices.append(base - side_dir * half_width)
        vertices.append(base + side_dir * half_width)
    faces = [
        (2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2)
        for i in range(len(profile) - 1)
    ]
    mesh.from_pydata([tuple(v) for v in vertices], [], faces)
    mesh.update()
    # Smooth shading across the cove; a faceted curve reintroduces the very
    # banding the sweep exists to remove.
    for polygon in mesh.polygons:
        polygon.use_smooth = True

    obj = bpy.data.objects.new("cyclorama", mesh)
    obj.data.materials.append(material)
    obj.is_shadow_catcher = False
    bpy.context.scene.collection.objects.link(obj)
    return obj


def apply_cinematic_grade(quality_tier: str) -> None:
    """AgX rolls highlights off instead of clipping them to white."""
    view = bpy.context.scene.view_settings
    try:
        view.view_transform = "AgX"
        view.look = "AgX - Medium High Contrast"
    except TypeError:
        view.view_transform = "Filmic"
    view.exposure = 0.0
    if quality_tier != "preview":
        bpy.context.scene.cycles.use_denoising = True


# ---------------------------------------------------------------------------
# Photoreal skin
#
# Three things separate skin from wax, and the old shader had none of them.
#
# 1. Detail. The body .blend ships a 4096x4096 tangent-space normal bake of the
#    sculpt (pores, tendons, ear and knuckle folds) that nothing was reading.
#    Procedural noise cannot invent anatomy; the bake already has it.
# 2. Scale. Cycles' subsurface radius and bump distance are metric, and the
#    figure is authored ~4.2 units tall. Feeding millimetre numbers into a
#    world where a human is 4.2 m makes scattering vanish, which is exactly
#    what reads as painted plastic.
# 3. Colour zoning. Real skin is not one hue: the face and joints run red, the
#    midtones olive, and there are freckles. A single flat albedo is the
#    strongest mannequin tell of all, ahead of any BSDF parameter.
# ---------------------------------------------------------------------------

# bodyMeshId -> baked tangent-space normal map (assets/derived/, built with the meshes)
BODY_NORMAL_MAPS: Dict[str, str] = {
    "body_full": "body_male_realistic_normal.png",
    "body_full_female": "body_female_realistic_normal.png",
}

# Height of a real adult in metres. The ratio against the figure's actual
# height is what converts every metric shading value into scene units.
HUMAN_HEIGHT_M = 1.75


def _resolve_texture(contract_dir: str, filename: str) -> Optional[str]:
    """Find a baked texture next to the contract or in the repo's assets/derived."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    for base in (
        contract_dir,
        os.path.join(contract_dir, "assets"),
        os.path.join(contract_dir, "assets", "derived"),
        os.path.join(script_dir, "assets"),
        os.path.join(script_dir, "..", "assets", "derived"),
        os.path.join(script_dir, "..", "..", "assets", "derived"),
    ):
        if not base:
            continue
        candidate = os.path.join(base, filename)
        if os.path.exists(candidate):
            return os.path.abspath(candidate)
    return None


def _node_by_label(mat: bpy.types.Material, label: str):
    return next((n for n in mat.node_tree.nodes if n.label == label), None)


def _set(socket_owner, name: str, value) -> None:
    """Assign a socket default only where one exists and nothing is driving it."""
    socket = socket_owner.inputs.get(name)
    if socket is not None and not socket.is_linked:
        socket.default_value = value


def _world_scale(body: bpy.types.Object) -> float:
    """Scene units per real-world metre, from the figure's own height."""
    height = float(body.dimensions.z) or HUMAN_HEIGHT_M
    return max(0.05, height / HUMAN_HEIGHT_M)


def _attach_normal_bake(mat, bsdf, body_mesh_id: str, contract_dir: str) -> bool:
    """Feed the sculpt bake into the bump chain so procedural pores sit on top of it."""
    filename = BODY_NORMAL_MAPS.get(body_mesh_id)
    if not filename:
        return False
    path = _resolve_texture(contract_dir, filename)
    if not path:
        print(f"Normal bake not found for '{body_mesh_id}' ({filename}); procedural detail only.")
        return False

    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    tex = nodes.new("ShaderNodeTexImage")
    tex.label = "Sculpt normal bake"
    tex.location = (-1000, -700)
    tex.image = bpy.data.images.load(path, check_existing=True)
    # A normal map is vector data; sRGB decoding would bend every surface.
    tex.image.colorspace_settings.name = "Non-Color"
    tex.interpolation = "Smart"

    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.label = "Sculpt normal"
    normal_map.location = (-700, -700)
    normal_map.inputs["Strength"].default_value = 1.0
    links.new(tex.outputs["Color"], normal_map.inputs["Color"])

    # The bake carries macro anatomy, the bump carries pores. Chaining them
    # through Bump.Normal composes both instead of one replacing the other.
    bump = _node_by_label(mat, "Skin micro-relief")
    if bump is not None and bump.type == "BUMP":
        links.new(normal_map.outputs["Normal"], bump.inputs["Normal"])
    else:
        socket = bsdf.inputs.get("Normal")
        if socket is not None and not socket.is_linked:
            links.new(normal_map.outputs["Normal"], socket)
    print(f"Wired sculpt normal bake: {os.path.basename(path)}")
    return True


def _reproject_detail_to_object_space(mat: bpy.types.Material) -> None:
    """Drive procedural detail from object space, sized in millimetres.

    The body UVs are an atlas of separate islands, so UV-driven noise breaks at
    every seam and its frequency changes with island size. Object coordinates
    are continuous across the mesh and, because the local mesh is authored at
    roughly human size, one unit is roughly one metre -- so a noise Scale of
    1000 is a feature per millimetre no matter how the object is scaled.
    """
    mapping = next((n for n in mat.node_tree.nodes if n.type == "MAPPING"), None)
    tex_coord = next((n for n in mat.node_tree.nodes if n.type == "TEX_COORD"), None)
    if mapping is None or tex_coord is None:
        return

    for link in list(mapping.inputs["Vector"].links):
        mat.node_tree.links.remove(link)
    mat.node_tree.links.new(tex_coord.outputs["Object"], mapping.inputs["Vector"])
    mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0)

    # Feature sizes in cycles per metre of real skin.
    frequencies = {
        "Skin tone variation": 9.0,     # ~11 cm blotches: tonal zoning
        "Micro-relief": 220.0,          # ~5 mm: wrinkles and creases
        "Pore sockets": 900.0,          # ~1.1 mm: pores
        "Fine pores": 1400.0,           # sub-millimetre grain
        "Roughness variation": 140.0,   # ~7 mm oily/dry patches
    }
    for label, freq in frequencies.items():
        node = _node_by_label(mat, label)
        if node is not None and "Scale" in node.inputs:
            node.inputs["Scale"].default_value = freq


# bodyMeshId -> filename prefix of the baked mask set (tools/bake-body-textures.sh)
BODY_MASK_PREFIXES: Dict[str, str] = {
    "body_full": "body_male_realistic",
    "body_full_female": "body_female_realistic",
}


def _load_mask_texture(
    mat: bpy.types.Material,
    body_mesh_id: str,
    contract_dir: str,
    suffix: str,
    location: Tuple[float, float],
):
    """Load one baked mask, or None if it has not been baked for this body."""
    prefix = BODY_MASK_PREFIXES.get(body_mesh_id)
    if not prefix:
        return None
    path = _resolve_texture(contract_dir, f"{prefix}_{suffix}.png")
    if not path:
        return None
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.label = f"Baked {suffix}"
    tex.location = location
    tex.image = bpy.data.images.load(path, check_existing=True)
    # Masks are data. sRGB-decoding them would bend every value.
    tex.image.colorspace_settings.name = "Non-Color"
    tex.interpolation = "Smart"
    print(f"Wired baked {suffix}: {os.path.basename(path)}")
    return tex


def _curvature_split(mat: bpy.types.Material, curvature):
    """Split the curvature bake into convex and concave halves around 0.5.

    Convex is bone under skin -- knuckles, elbows, knees, shins, clavicles,
    the bridge of the nose. Concave is the folds: armpits, groin, the creases
    behind the knee. Skin behaves differently on each, and both differ from the
    flat expanses in between, so they are worth separating rather than using
    the raw map as one signal.
    """
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    convex = nodes.new("ShaderNodeMapRange")
    convex.label = "Convex (over bone)"
    convex.location = (-760, 900)
    convex.clamp = True
    convex.inputs["From Min"].default_value = 0.5
    convex.inputs["From Max"].default_value = 1.0
    convex.inputs["To Min"].default_value = 0.0
    convex.inputs["To Max"].default_value = 1.0
    links.new(curvature.outputs["Color"], convex.inputs["Value"])

    concave = nodes.new("ShaderNodeMapRange")
    concave.label = "Concave (folds)"
    concave.location = (-760, 740)
    concave.clamp = True
    # Inverted range, so the deepest folds come out at 1.0.
    concave.inputs["From Min"].default_value = 0.5
    concave.inputs["From Max"].default_value = 0.0
    concave.inputs["To Min"].default_value = 0.0
    concave.inputs["To Max"].default_value = 1.0
    links.new(curvature.outputs["Color"], concave.inputs["Value"])

    return convex.outputs["Result"], concave.outputs["Result"]


def _scaled(mat: bpy.types.Material, socket, factor: float, label: str, location):
    node = mat.node_tree.nodes.new("ShaderNodeMath")
    node.operation = "MULTIPLY"
    node.label = label
    node.location = location
    node.inputs[1].default_value = factor
    mat.node_tree.links.new(socket, node.inputs[0])
    return node.outputs["Value"]


def _apply_anatomical_masks(mat: bpy.types.Material, bsdf, convex, concave, cavity) -> None:
    """Darken bone ridges and folds, and redden the ridges, using the bakes.

    This is the half of skin colour that procedural noise structurally cannot
    do: noise does not know where a knuckle is. Melanin collects over bone and
    in folds -- knuckles, elbows, knees, armpits are darker on everyone -- and
    the same ridges run red because the tissue over them is thin.
    """
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    base_socket = bsdf.inputs["Base Color"]
    if not base_socket.is_linked:
        return
    albedo = base_socket.links[0].from_socket

    if convex is not None and concave is not None:
        ridge = _scaled(mat, convex, 0.50, "Ridge melanin", (-540, 900))
        fold = _scaled(mat, concave, 0.42, "Fold melanin", (-540, 740))

        melanin = nodes.new("ShaderNodeMath")
        melanin.operation = "MAXIMUM"
        melanin.label = "Melanin mask"
        melanin.location = (-330, 820)
        links.new(ridge, melanin.inputs[0])
        links.new(fold, melanin.inputs[1])

        melanin_mix = nodes.new("ShaderNodeMix")
        melanin_mix.label = "Melanin"
        melanin_mix.data_type = "RGBA"
        melanin_mix.blend_type = "MULTIPLY"
        melanin_mix.location = (260, 500)
        # Desaturated brown rather than grey: pigment, not shadow.
        melanin_mix.inputs["B"].default_value = (0.62, 0.48, 0.42, 1.0)
        links.new(melanin.outputs["Value"], melanin_mix.inputs["Factor"])
        links.new(albedo, melanin_mix.inputs["A"])
        albedo = melanin_mix.outputs["Result"]

    if cavity is not None:
        cavity_mix = nodes.new("ShaderNodeMix")
        cavity_mix.label = "Cavity"
        cavity_mix.data_type = "RGBA"
        cavity_mix.blend_type = "MULTIPLY"
        cavity_mix.location = (440, 500)
        cavity_mix.inputs["Factor"].default_value = 0.55
        links.new(albedo, cavity_mix.inputs["A"])
        links.new(cavity.outputs["Color"], cavity_mix.inputs["B"])
        albedo = cavity_mix.outputs["Result"]

    links.new(albedo, base_socket)


def _apply_ridge_gloss(mat: bpy.types.Material, bsdf, convex) -> None:
    """Skin stretched taut over bone is shinier than skin at rest."""
    if convex is None:
        return
    rough_socket = bsdf.inputs.get("Roughness")
    if rough_socket is None or not rough_socket.is_linked:
        return
    source = rough_socket.links[0].from_socket
    amount = _scaled(mat, convex, 0.12, "Ridge gloss", (-330, 640))

    subtract = mat.node_tree.nodes.new("ShaderNodeMath")
    subtract.operation = "SUBTRACT"
    subtract.label = "Roughness over bone"
    subtract.location = (-120, 640)
    subtract.use_clamp = True
    mat.node_tree.links.remove(rough_socket.links[0])
    mat.node_tree.links.new(source, subtract.inputs[0])
    mat.node_tree.links.new(amount, subtract.inputs[1])
    mat.node_tree.links.new(subtract.outputs["Value"], rough_socket)


def _add_colour_zoning(mat: bpy.types.Material, bsdf, convex=None) -> None:
    """Break the flat albedo with red zoning and freckles.

    Uniform base colour is the loudest mannequin tell there is -- it survives
    any amount of subsurface tuning, because no real skin is one colour.
    """
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    base_socket = bsdf.inputs["Base Color"]
    if not base_socket.is_linked:
        return
    albedo_source = base_socket.links[0].from_socket

    mapping = next((n for n in nodes if n.type == "MAPPING"), None)
    if mapping is None:
        return
    detail_vector = mapping.outputs["Vector"]

    # --- Red zoning: blood under thin skin, at a coarser scale than the tone noise
    zone_noise = nodes.new("ShaderNodeTexNoise")
    zone_noise.label = "Blood zoning"
    zone_noise.location = (-760, 420)
    zone_noise.inputs["Scale"].default_value = 3.5
    zone_noise.inputs["Detail"].default_value = 3.0
    zone_noise.inputs["Roughness"].default_value = 0.6
    links.new(detail_vector, zone_noise.inputs["Vector"])

    zone_ramp = nodes.new("ShaderNodeValToRGB")
    zone_ramp.label = "Zoning mask"
    zone_ramp.location = (-540, 420)
    zone_ramp.color_ramp.elements[0].position = 0.40
    zone_ramp.color_ramp.elements[1].position = 0.70
    # The ramp tops out grey, not white: zoning is a tint, and a full-strength
    # red overlay over half the body reads as bruising rather than circulation.
    zone_ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    zone_ramp.color_ramp.elements[1].color = (0.30, 0.30, 0.30, 1.0)
    links.new(zone_noise.outputs["Fac"], zone_ramp.inputs["Fac"])

    zone_mix = nodes.new("ShaderNodeMix")
    zone_mix.label = "Blood tint"
    zone_mix.data_type = "RGBA"
    zone_mix.blend_type = "OVERLAY"
    zone_mix.location = (-120, 320)
    zone_mix.inputs["B"].default_value = (0.66, 0.42, 0.38, 1.0)
    links.new(albedo_source, zone_mix.inputs["A"])

    if convex is None:
        links.new(zone_ramp.outputs["Color"], zone_mix.inputs["Factor"])
    else:
        # Noise gives organic mottling; the curvature bake puts red where it
        # actually belongs -- elbows, knees, knuckles, nose, ears. Taking the
        # larger of the two keeps both without stacking them into blotches.
        ridge_blood = _scaled(mat, convex, 0.55, "Ridge blood", (-330, 420))
        combined = nodes.new("ShaderNodeMath")
        combined.operation = "MAXIMUM"
        combined.label = "Blood mask"
        combined.location = (-200, 420)
        links.new(zone_ramp.outputs["Color"], combined.inputs[0])
        links.new(ridge_blood, combined.inputs[1])
        links.new(combined.outputs["Value"], zone_mix.inputs["Factor"])

    # --- Freckles / moles: sparse dark specks, mostly invisible but never absent
    freckle_tex = nodes.new("ShaderNodeTexVoronoi")
    freckle_tex.label = "Freckle cells"
    freckle_tex.location = (-760, 620)
    freckle_tex.feature = "F1"
    freckle_tex.inputs["Scale"].default_value = 260.0
    freckle_tex.inputs["Randomness"].default_value = 1.0
    links.new(detail_vector, freckle_tex.inputs["Vector"])

    freckle_ramp = nodes.new("ShaderNodeValToRGB")
    freckle_ramp.label = "Freckle mask"
    freckle_ramp.location = (-540, 620)
    freckle_ramp.color_ramp.interpolation = "EASE"
    freckle_ramp.color_ramp.elements[0].position = 0.0
    freckle_ramp.color_ramp.elements[0].color = (1.0, 1.0, 1.0, 1.0)
    freckle_ramp.color_ramp.elements[1].position = 0.055
    freckle_ramp.color_ramp.elements[1].color = (0.0, 0.0, 0.0, 1.0)
    links.new(freckle_tex.outputs["Distance"], freckle_ramp.inputs["Fac"])

    freckle_mix = nodes.new("ShaderNodeMix")
    freckle_mix.label = "Freckles"
    freckle_mix.data_type = "RGBA"
    freckle_mix.blend_type = "MULTIPLY"
    freckle_mix.location = (60, 320)
    freckle_mix.inputs["B"].default_value = (0.58, 0.42, 0.34, 1.0)
    links.new(zone_mix.outputs["Result"], freckle_mix.inputs["A"])

    freckle_strength = nodes.new("ShaderNodeMath")
    freckle_strength.label = "Freckle density"
    freckle_strength.operation = "MULTIPLY"
    freckle_strength.location = (-330, 620)
    freckle_strength.inputs[1].default_value = 0.45
    links.new(freckle_ramp.outputs["Color"], freckle_strength.inputs[0])
    links.new(freckle_strength.outputs["Value"], freckle_mix.inputs["Factor"])
    links.new(freckle_mix.outputs["Result"], base_socket)


def _tune_skin_bsdf(mat: bpy.types.Material, bsdf, world_scale: float) -> None:
    """Physical skin response, with every metric value expressed in scene units."""
    # Subsurface Radius is a per-channel multiplier on Subsurface Scale, which
    # is metres. Red light travels furthest through flesh; this ratio is what
    # warms ears, fingers and nostrils instead of glowing uniformly.
    _set(bsdf, "Subsurface Weight", 0.35)
    _set(bsdf, "Subsurface Radius", (1.0, 0.32, 0.18))
    _set(bsdf, "Subsurface Scale", 0.0085 * world_scale)  # ~8.5 mm of red transport
    _set(bsdf, "Subsurface IOR", 1.4)
    if hasattr(bsdf, "subsurface_method"):
        bsdf.subsurface_method = "RANDOM_WALK_SKIN" if "RANDOM_WALK_SKIN" in {
            item.identifier for item in bsdf.bl_rna.properties["subsurface_method"].enum_items
        } else "RANDOM_WALK"

    _set(bsdf, "Metallic", 0.0)
    _set(bsdf, "IOR", 1.4)                    # skin, not glass
    _set(bsdf, "Specular IOR Level", 0.5)     # 0.5 == "use the IOR above"
    _set(bsdf, "Diffuse Roughness", 0.35)

    # No coat. A clearcoat is a uniform lacquer layer, and a uniform highlight
    # over a whole body is precisely the plastic look we are trying to lose --
    # skin's second lobe is thin, patchy oil, which the roughness map handles.
    _set(bsdf, "Coat Weight", 0.0)

    # Sheen stands in for vellus hair: a soft grazing-angle rim that keeps
    # silhouettes from going hard and waxy.
    _set(bsdf, "Sheen Weight", 0.045)
    _set(bsdf, "Sheen Roughness", 0.25)
    _set(bsdf, "Sheen Tint", (1.0, 0.92, 0.88, 1.0))

    bump = _node_by_label(mat, "Skin micro-relief")
    if bump is not None and bump.type == "BUMP":
        _set(bump, "Strength", 0.35)
        _set(bump, "Distance", 0.0012 * world_scale)  # ~1.2 mm of relief

    # Skin is never mirror-smooth and never chalk: keep it in a plausible band,
    # varying at pore scale so highlights break up instead of forming blobs.
    rough_range = _node_by_label(mat, "Roughness range")
    if rough_range is not None and rough_range.type == "MAP_RANGE":
        _set(rough_range, "To Min", 0.38)
        _set(rough_range, "To Max", 0.62)


def enhance_skin_realism(
    body: bpy.types.Object,
    body_mesh_id: str = "body_full",
    contract_dir: str = "",
) -> None:
    """Turn the loaded skin material into a physically plausible skin shader."""
    if not body.data.materials:
        return
    mat = body.data.materials[0]
    if not mat.use_nodes:
        return
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return

    scale = _world_scale(body)
    print(f"Skin shading at {scale:.2f} scene units per metre (figure {body.dimensions.z:.2f} u tall)")

    _reproject_detail_to_object_space(mat)
    _attach_normal_bake(mat, bsdf, body_mesh_id, contract_dir)

    # The baked masks are tone-neutral, so one set serves every swatch in
    # registry.ts -- the tone stays a parameter rather than being baked in
    # four times. Absent bakes fall back to the procedural path unchanged.
    cavity = _load_mask_texture(mat, body_mesh_id, contract_dir, "cavity", (-1000, 900))
    curvature = _load_mask_texture(mat, body_mesh_id, contract_dir, "curvature", (-1000, 1120))
    convex = concave = None
    if curvature is not None:
        convex, concave = _curvature_split(mat, curvature)

    _add_colour_zoning(mat, bsdf, convex)
    _apply_anatomical_masks(mat, bsdf, convex, concave, cavity)
    _apply_ridge_gloss(mat, bsdf, convex)
    _tune_skin_bsdf(mat, bsdf, scale)


def _enable_gpu_devices() -> Optional[str]:
    """Switch Cycles onto a GPU backend. Returns the backend name, or None.

    The old code assumed a headless macOS process has no GPU context, which has
    not been true since Metal shipped in Cycles -- and on this hardware it is
    the difference between a final render finishing and hitting the server's
    timeout.
    """
    override = os.environ.get("SMARTINK_RENDER_DEVICE", "").upper()
    if override == "CPU":
        return None
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except (KeyError, AttributeError):
        return None

    for backend in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue  # this build was not compiled with that backend
        prefs.get_devices()
        if not any(device.type == backend for device in prefs.devices):
            continue
        # GPU only. On unified-memory hardware, adding the CPU back in makes
        # both contend for the same bandwidth and usually renders slower.
        for device in prefs.devices:
            device.use = device.type == backend
        return backend
    return None


def apply_render_quality(quality_tier: str, backend: Optional[str] = None) -> None:
    """Cycles settings that matter for skin: enough bounces to let light leave it."""
    cycles = bpy.context.scene.cycles
    # Subsurface is transmission under the hood; starving the bounce budget
    # makes scattered light terminate early and the skin go dark and flat.
    cycles.max_bounces = 12
    cycles.diffuse_bounces = 6
    cycles.glossy_bounces = 6
    cycles.transmission_bounces = 12
    cycles.transparent_max_bounces = 8
    cycles.use_adaptive_sampling = True
    # Adaptive sampling stops early where the image has already converged. The
    # previous 0.002 was far below what survives denoising and cost most of the
    # render budget resolving noise nobody sees.
    cycles.adaptive_threshold = 0.01 if quality_tier == "preview" else 0.005
    cycles.adaptive_min_samples = 0  # let Cycles pick from the threshold
    # Fireflies from small bright area lights read as noise the denoiser then
    # smears; clamping indirect keeps the skin clean without dulling the key.
    cycles.sample_clamp_indirect = 10.0
    cycles.blur_glossy = 1.0
    cycles.caustics_reflective = False
    cycles.caustics_refractive = False
    bpy.context.scene.render.filter_size = 1.5
    if quality_tier != "preview":
        cycles.use_denoising = True
        # OptiX denoises on the RT cores, so on NVIDIA it is far cheaper than
        # OpenImageDenoise on the CPU. Everywhere else (Metal, HIP, CPU) OIDN
        # is both the better result and the only option.
        for denoiser in (("OPTIX",) if backend == "OPTIX" else ()) + ("OPENIMAGEDENOISE",):
            try:
                cycles.denoiser = denoiser
            except TypeError:
                continue  # this build has no such denoiser
            break
        try:
            cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
            # OptiX has no prefilter setting; OIDN's ACCURATE is worth its cost.
            if cycles.denoiser == "OPENIMAGEDENOISE":
                cycles.denoising_prefilter = "ACCURATE"
        except TypeError:
            pass


def apply_world(
    look_id: str,
    lights_override: Optional[List[Dict[str, Any]]] = None,
    intensity_scale: Optional[float] = None,
    preset_name: Optional[str] = None,
    cinematic: bool = False,
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
    if cinematic:
        build_cinematic_rig(look_id, scale)
        return
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

    # Pigment sits in the dermis, under roughly a millimetre of translucent
    # epidermis, so it never reads as the pure ink colour: it is lifted and
    # cooled by the skin over it. Compositing the raw layer straight into Base
    # Color is what makes tattoos look like decals printed on the surface.
    ink_shift = nodes.new(type="ShaderNodeMix")
    ink_shift.label = "Ink under epidermis"
    ink_shift.data_type = "RGBA"
    ink_shift.blend_type = "MIX"
    ink_shift.inputs["Factor"].default_value = 0.14
    ink_shift.inputs["B"].default_value = (0.16, 0.17, 0.21, 1.0)  # blue-black healed ink
    links.new(ink_tex.outputs["Color"], ink_shift.inputs["A"])

    links.new(ink_shift.outputs["Result"], mix.inputs["B"])
    links.new(ink_tex.outputs["Alpha"], mix.inputs["Factor"])
    links.new(mix.outputs["Result"], base_color_socket)

    _apply_ink_surface_response(mat, bsdf, ink_tex)


def _apply_ink_surface_response(mat: bpy.types.Material, bsdf, ink_tex) -> None:
    """Inked skin scatters less and sits slightly flatter than bare skin."""
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    # Dense pigment blocks subsurface transport, so inked areas lose the warm
    # glow bare skin has. Without this the tattoo looks lit from inside.
    sss_socket = bsdf.inputs.get("Subsurface Weight")
    if sss_socket is not None and not sss_socket.is_linked:
        base_sss = float(sss_socket.default_value)
        sss_mix = nodes.new(type="ShaderNodeMix")
        sss_mix.label = "Subsurface under ink"
        sss_mix.data_type = "FLOAT"
        sss_mix.inputs["A"].default_value = base_sss
        sss_mix.inputs["B"].default_value = base_sss * 0.35
        links.new(ink_tex.outputs["Alpha"], sss_mix.inputs["Factor"])
        links.new(sss_mix.outputs["Result"], sss_socket)

    # Healed ink is marginally matter than the skin around it; the tiny
    # roughness step is what makes the edge of a tattoo catch the light.
    rough_socket = bsdf.inputs.get("Roughness")
    if rough_socket is not None and rough_socket.is_linked:
        source = rough_socket.links[0].from_socket
        rough_mix = nodes.new(type="ShaderNodeMix")
        rough_mix.label = "Roughness under ink"
        rough_mix.data_type = "FLOAT"
        rough_mix.blend_type = "ADD"
        rough_mix.inputs["B"].default_value = 0.06
        links.remove(rough_socket.links[0])
        links.new(source, rough_mix.inputs["A"])
        links.new(ink_tex.outputs["Alpha"], rough_mix.inputs["Factor"])
        links.new(rough_mix.outputs["Result"], rough_socket)


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


# ---------------------------------------------------------------------------
# Camera realism
#
# The contract's FOV comes from the browser orbit camera, which is wide (45 deg,
# about a 29 mm lens) because a wide lens keeps the whole figure on screen in a
# small viewport. Nobody photographs a person on a 29 mm lens: it stretches
# whatever is nearest the camera and splays the limbs. Portrait and fashion work
# sits between 70 and 135 mm, and the difference is not subtle -- it is most of
# what separates "a render" from "a photograph" once the shading is right.
#
# Swapping the lens alone would reframe the shot, so the camera is dollied back
# by the same ratio. Subject size on the sensor is unchanged; only the
# perspective compresses.
# ---------------------------------------------------------------------------

# Portrait lens the cinematic path targets, and the aperture it opens to.
CINEMATIC_LENS_MM = 85.0
CINEMATIC_FSTOP = 2.8
# Below this the dolly is not worth the framing risk (the contract already asked
# for a long lens, or the camera is nearly on top of the subject).
MIN_LENS_COMPRESSION = 1.05


def apply_lens_compression(
    cam_obj: bpy.types.Object,
    target: Vector,
    focal_mm: float,
) -> None:
    """Swap to a longer lens and dolly back to hold the same framing.

    Subject height on the sensor goes as focal / distance, so scaling both by
    the same factor leaves the figure exactly the size it was while flattening
    the perspective.
    """
    current = cam_obj.data.lens
    if focal_mm <= current * MIN_LENS_COMPRESSION:
        return
    offset = cam_obj.location - target
    distance = offset.length
    if distance < 1e-4:
        return
    ratio = focal_mm / current
    cam_obj.data.lens = focal_mm
    cam_obj.location = target + offset.normalized() * (distance * ratio)
    print(f"Lens {current:.1f}mm -> {focal_mm:.1f}mm, dollied {distance:.2f} -> {distance * ratio:.2f}")


def _ink_focus_point(body: bpy.types.Object, ink_path: str) -> Optional[Vector]:
    """World-space centroid of the inked skin, so focus lands on the tattoo.

    In a photograph of a tattoo the tattoo is what is sharp. Focusing on the
    body's bounding-box centre instead would routinely put the plane of focus
    somewhere inside the figure and leave the artwork soft.
    """
    if not os.path.exists(ink_path):
        return None
    mesh = body.data
    if not isinstance(mesh, bpy.types.Mesh) or not mesh.uv_layers:
        return None
    try:
        import numpy as np
    except ImportError:
        return None

    image = bpy.data.images.load(os.path.abspath(ink_path), check_existing=True)
    width, height = image.size
    if width == 0 or height == 0:
        return None
    buffer = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(buffer)
    # Blender image rows run bottom-up, which is also how UV v runs -- no flip.
    alpha = buffer.reshape(height, width, 4)[:, :, 3]

    uv_data = mesh.uv_layers.active.data
    matrix = body.matrix_world
    accumulator = Vector((0.0, 0.0, 0.0))
    total = 0.0
    for poly in mesh.polygons:
        loops = poly.loop_indices
        u = sum(uv_data[i].uv.x for i in loops) / len(loops)
        v = sum(uv_data[i].uv.y for i in loops) / len(loops)
        px = min(width - 1, max(0, int(u * width)))
        py = min(height - 1, max(0, int(v * height)))
        weight = float(alpha[py, px])
        if weight > 0.15:
            accumulator += (matrix @ poly.center) * weight
            total += weight

    if total <= 0.0:
        return None
    return accumulator / total


def _is_in_frame(cam_obj: bpy.types.Object, point: Vector) -> bool:
    """Whether a world-space point falls inside the camera's rendered frame."""
    try:
        from bpy_extras.object_utils import world_to_camera_view
    except ImportError:
        return True
    projected = world_to_camera_view(bpy.context.scene, cam_obj, point)
    return projected.z > 0.0 and 0.0 <= projected.x <= 1.0 and 0.0 <= projected.y <= 1.0


def _centre_of_frame_hit(cam_obj: bpy.types.Object, body: bpy.types.Object) -> Optional[Vector]:
    """Where the middle of the frame lands on the figure, as a focus fallback."""
    direction = (cam_obj.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0))).normalized()
    inverse = body.matrix_world.inverted()
    hit, location, _, _ = body.ray_cast(
        inverse @ cam_obj.location,
        (inverse.to_3x3() @ direction).normalized(),
    )
    return body.matrix_world @ location if hit else None


def apply_camera_realism(
    cam_obj: bpy.types.Object,
    body: bpy.types.Object,
    ink_path: str,
    cam_data: Dict[str, Any],
) -> None:
    """Focus on the tattoo and open the aperture to a real portrait f-stop."""
    # The lens compression moved the camera; without this its matrix_world is
    # still the pre-dolly one and every projection below is computed against a
    # camera that is no longer there.
    bpy.context.view_layer.update()

    focus = _ink_focus_point(body, ink_path)
    if focus is not None and not _is_in_frame(cam_obj, focus):
        # The user has framed something other than the tattoo -- a head-and-
        # shoulders crop, say. Holding focus on an off-screen tattoo would put
        # the whole visible subject out of focus, which is never what was meant.
        print("Ink is outside the frame; focusing on what is centred instead.")
        focus = None
    if focus is None:
        focus = _centre_of_frame_hit(cam_obj, body)
    if focus is None:
        # Nothing under the crosshair: fall back to the upper chest, where a
        # photographer would focus on a standing figure.
        corners = [body.matrix_world @ Vector(c) for c in body.bound_box]
        centre = sum(corners, Vector()) / len(corners)
        focus = Vector((centre.x, centre.y, centre.z + body.dimensions.z * 0.22))
        print("Focusing on the upper chest.")
    else:
        print(f"Focusing on {tuple(round(c, 3) for c in focus)}")

    dof = cam_obj.data.dof
    dof.use_dof = True
    dof.focus_object = None
    requested_focus = cam_data.get("focusDistance")
    dof.focus_distance = (
        float(requested_focus)
        if requested_focus
        else (focus - cam_obj.location).length
    )

    # Defocus blur shrinks in proportion to how far away everything is, and this
    # figure is authored ~2.4x life size. Dividing the f-stop by that factor
    # gives the depth of field a real f/2.8 lens would have on a real person,
    # instead of a background that stays stubbornly sharp.
    fstop = float(cam_data.get("aperture") or CINEMATIC_FSTOP)
    dof.aperture_fstop = max(0.35, fstop / _world_scale(body))
    # Slightly polygonal bokeh; a perfectly circular iris is a CG tell of its own.
    dof.aperture_blades = 7
    dof.aperture_rotation = math.radians(12.0)
    print(f"DOF: focus {dof.focus_distance:.2f} u, f/{fstop:.1f} (scene f/{dof.aperture_fstop:.2f})")


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


def resolve_samples(tier_id: str, tier: Dict[str, int], requested: Any) -> int:
    """Final renders honour the UI quality slider; previews stay fast."""
    if tier_id != "final" or requested is None:
        return tier["samples"]
    try:
        value = int(requested)
    except (TypeError, ValueError):
        return tier["samples"]
    return max(FINAL_SAMPLES_MIN, min(FINAL_SAMPLES_MAX, value))


def setup_output(output: Dict[str, Any], contract_dir: str) -> str:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    backend = _enable_gpu_devices()
    scene.cycles.device = "GPU" if backend else "CPU"
    print(f"Cycles device: {scene.cycles.device}" + (f" ({backend})" if backend else ""))
    tier_id = output.get("qualityTier", "final")
    tier = OUTPUT_TIERS.get(tier_id, OUTPUT_TIERS["final"])
    scene.cycles.samples = resolve_samples(tier_id, tier, output.get("samples"))
    scene.cycles.use_denoising = tier_id != "preview"
    apply_render_quality(tier_id, backend)

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
    apply_body_shape(body, contract.get("bodyShape"))
    center_body_at_origin(body)  # the reshaped bounds differ from the loaded ones
    isolate_body_region(body, contract.get("bodyRegion"))

    # "cinematic" (the default) builds a Cycles-native rig; "preview" mirrors the
    # browser's lights one-for-one, which is duller but matches the viewport.
    style = contract.get("renderStyle", "cinematic")
    cinematic = style != "preview"

    # Eyes and hair go on after the shape sliders and the region cut, so they
    # follow the deformed head and are simply skipped when it is not in shot.
    landmarks = detect_head_landmarks(body) if cinematic else None
    if landmarks:
        # Eyeballs are off by default. The lash band still needs the eye's size,
        # which comes from the figure's scale rather than from the eye objects,
        # so hair is unaffected by the switch.
        eye_radius = EYE_DIAMETER_M * 0.5 * _world_scale(body)
        if contract.get("showEyes"):
            add_eyes(body, landmarks, contract.get("eyeColor") or DEFAULT_IRIS_COLOUR)
        else:
            add_socket_fill(body, landmarks)
        add_hair(body, landmarks, eye_radius, contract.get("hairTone") or DEFAULT_HAIR_TONE)
    elif cinematic:
        print("No head in frame; skipping eyes and hair.")

    # The camera comes first now: the cinematic rig and the backdrop are placed
    # relative to it, so the key light follows wherever the user orbited to.
    camera_cfg = contract.get("camera", {})
    cam_obj = setup_camera(camera_cfg)
    if cinematic:
        # Before the rig, so the key light is placed against the final camera
        # position rather than the wide-angle one it was dollied back from.
        apply_lens_compression(
            cam_obj,
            three_to_blender_position(camera_cfg.get("target", [0, 0, 0])),
            float(camera_cfg.get("lensMm") or CINEMATIC_LENS_MM),
        )

    lighting = contract.get("lighting") or {}
    apply_world(
        contract.get("lookId", "studio_softbox"),
        lighting.get("lights"),
        lighting.get("intensityScale"),
        lighting.get("presetName"),
        cinematic=cinematic,
    )
    if cinematic:
        enhance_skin_realism(body, contract["bodyMeshId"], contract_dir)
        apply_cinematic_grade(contract.get("output", {}).get("qualityTier", "final"))

    ink_name = contract.get("inkTextureUrl", "ink.png")
    if ink_name.startswith("data:"):
        ink_name = "ink.png"
    ink_path = ink_name if os.path.isabs(ink_name) else os.path.join(contract_dir, os.path.basename(ink_name))
    apply_uv_ink_layer(body, ink_path)
    if cinematic:
        # After the ink, because focus is pulled to the tattoo itself.
        apply_camera_realism(cam_obj, body, ink_path, camera_cfg)
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
