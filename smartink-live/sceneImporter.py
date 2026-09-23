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
import struct
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
STUDIO_DEFAULTS = {"mode": "sweep", "color": "#d6cdc1", "shadow": 0.4, "showGuides": False}


def _studio_settings(contract):
    """Absent preserves legacy exports; partial explicit settings use UI defaults."""
    if 'studio' not in contract:
        return None
    value = contract['studio']
    if not isinstance(value, dict) or any(key not in STUDIO_DEFAULTS and key != 'gradient' for key in value):
        raise ValueError('Invalid studio settings')
    studio = {**STUDIO_DEFAULTS, **value}
    if not isinstance(studio['mode'], str) or studio['mode'] not in ('plain', 'sweep'):
        raise ValueError('Unknown studio mode')
    color = studio['color']
    if not isinstance(color, str) or len(color) != 7 or color[0] != '#' or any(c not in '0123456789abcdefABCDEF' for c in color[1:]):
        raise ValueError('Invalid studio color')
    if type(studio['shadow']) not in (int, float) or not math.isfinite(studio['shadow']) or not 0 <= studio['shadow'] <= 1:
        raise ValueError('studio.shadow must be between zero and one')
    if type(studio['showGuides']) is not bool:
        raise ValueError('studio.showGuides must be true or false')
    if 'gradient' in studio:
        stops = studio['gradient']
        if not isinstance(stops, list) or not 2 <= len(stops) <= 8 or any(not isinstance(c, str) or len(c) != 7 or c[0] != '#' or any(v not in '0123456789abcdefABCDEF' for v in c[1:]) for c in stops):
            raise ValueError('Invalid studio gradient')
    studio['color'] = color.lower()
    return studio

BODY_APPEARANCE_DEFAULTS = {
    "top": "none", "bottom": "none", "topColor": "#e8e3d9", "bottomColor": "#263449",
    "hairStyle": "none", "hairTone": "dark_brown",
}
BODY_APPEARANCE_OPTIONS = {
    "top": {"none", "tshirt"}, "bottom": {"none", "shorts", "trousers"},
    "hairStyle": {"none", "buzz", "short"},
    "hairTone": {"black", "dark_brown", "brown", "auburn", "blond", "grey"},
}


def _body_appearance(contract):
    """Absent preserves legacy exports; an explicit empty object is bare."""
    if 'bodyAppearance' not in contract:
        return None
    value = contract['bodyAppearance']
    if not isinstance(value, dict) or any(key not in BODY_APPEARANCE_DEFAULTS for key in value):
        raise ValueError('Invalid bodyAppearance')
    appearance = {**BODY_APPEARANCE_DEFAULTS, **value}
    for key, item in appearance.items():
        if key in BODY_APPEARANCE_OPTIONS:
            if not isinstance(item, str) or item not in BODY_APPEARANCE_OPTIONS[key]:
                raise ValueError(f'Unknown bodyAppearance.{key}')
        elif not isinstance(item, str) or len(item) != 7 or item[0] != '#' or any(c not in '0123456789abcdefABCDEF' for c in item[1:]):
            raise ValueError(f'Invalid bodyAppearance.{key} color')
        else:
            appearance[key] = item.lower()
    return appearance

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
    "height": 0.08,
    "build": 0.14,
    "shoulders": 0.012,
    "chest": {"width": 0.10, "depth": 0.14, "c": 0.735, "hw": 0.13},
    "waist": {"scale": 0.16, "c": 0.605, "hw": 0.12},
    "belly": {"depth": 0.022, "c": 0.59, "hw": 0.13},
    "hips": 0.009,
    "arms": {"scale": 0.27, "min": 0.78, "max": 1.32},
    "legs": {"scale": 0.25, "min": 0.80, "max": 1.30},
    "torso": {"min": 0.80, "max": 1.28},
    "legLength": 0.035,
    "head": {"scale": 0.06, "pivot": 0.855},
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
        # Match TypeScript: strings, booleans and non-finite values are ignored.
        if key in out and type(value) in (int, float) and math.isfinite(value):
            out[key] = max(-1.0, min(1.0, value))
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


def _measure_shape_frame(coords, bounds):
    """Original-mesh centerlines, matching measureFrame in bodyShape.ts."""
    min_x, max_x, min_y, max_y, min_z, max_z = bounds
    height = max_y - min_y
    cx, half_w = (min_x + max_x) / 2.0, (max_x - min_x) / 2.0

    def section(h, side, limb):
        min_sx = min_sz = float("inf")
        max_sx = max_sz = float("-inf")
        for x, y, z in coords:
            if abs((y - min_y) / height - h) > 0.018:
                continue
            if side and (x - cx) * side <= 0:
                continue
            outside = abs(x - cx) / half_w > _torso_half_width(h)
            if h > 0.5 and outside != limb:
                continue
            min_sx, max_sx = min(min_sx, x), max(max_sx, x)
            min_sz, max_sz = min(min_sz, z), max(max_sz, z)
        return (
            (min_sx + max_sx) / 2.0 if math.isfinite(min_sx) else cx + side * height * 0.1,
            min_y + h * height,
            (min_sz + max_sz) / 2.0 if math.isfinite(min_sz) else (min_z + max_z) / 2.0,
        )

    return {
        "arms": [(section(0.54, side, True), section(0.76, side, True)) for side in (-1, 1)],
        "legs": [(section(0.12, side, False), section(0.42, side, False)) for side in (-1, 1)],
        "torsoZ": section(0.60, 0, False)[2],
        "headZ": section(0.90, 0, False)[2],
    }


def _radial_shape_delta(point, axis, amount):
    a, b = axis
    dx, dy, dz = (b[i] - a[i] for i in range(3))
    t = sum((point[i] - a[i]) * d for i, d in enumerate((dx, dy, dz))) / max(1e-12, dx * dx + dy * dy + dz * dz)
    return tuple((point[i] - a[i] - t * d) * amount for i, d in enumerate((dx, dy, dz)))


def _deform_body_points(coords, shape):
    """Pure proportional deformation in the (side, up, front) body frame.

    All measurements come from the original positions. Radial scaling retains
    skin detail and avoids pushing opposite sides of thin limbs through each
    other, while hands, feet, face and joints have separate transition bands.
    This function is also exercised directly by the browser/Blender parity test.
    """
    s, T = _effective_shape(shape), BODY_SHAPE_TUNING
    if not coords or all(abs(v) < 1e-4 for v in s.values()):
        return coords
    min_x, max_x = min(c[0] for c in coords), max(c[0] for c in coords)
    min_y, max_y = min(c[1] for c in coords), max(c[1] for c in coords)
    min_z, max_z = min(c[2] for c in coords), max(c[2] for c in coords)
    height = max_y - min_y
    if height <= 0:
        return coords
    half_w = max(1e-6, (max_x - min_x) / 2.0)
    cx, cz = (min_x + max_x) / 2.0, (min_z + max_z) / 2.0
    frame = _measure_shape_frame(coords, (min_x, max_x, min_y, max_y, min_z, max_z))
    height_k = 1.0 + T["height"] * s["height"]
    arm_amount = max(T["arms"]["min"], min(T["arms"]["max"], 1 + T["arms"]["scale"] * s["arms"] + 0.12 * s["build"])) - 1
    leg_amount = max(T["legs"]["min"], min(T["legs"]["max"], 1 + T["legs"]["scale"] * s["legs"] + 0.12 * s["build"])) - 1
    result = []
    for x0, y0, z0 in coords:
        h, u = (y0 - min_y) / height, abs(x0 - cx) / half_w
        sign = -1 if x0 < cx else 1
        side = 0 if sign < 0 else 1
        torso_width = _torso_half_width(h)
        arm_mask = (_smoothstep(torso_width - 0.035, torso_width + 0.065, u)
                    * _smoothstep(0.32, 0.40, h) * (1 - _smoothstep(0.82, 0.88, h)))
        torso_envelope = _smoothstep(0.43, 0.52, h) * (1 - _smoothstep(0.79, 0.87, h))
        torso_mask = (1 - arm_mask) * torso_envelope
        chest, waist = _band(h, T["chest"]["c"], T["chest"]["hw"]), _band(h, T["waist"]["c"], T["waist"]["hw"])
        width = max(T["torso"]["min"], min(T["torso"]["max"], 1 + T["build"] * s["build"]
                    + T["chest"]["width"] * s["chest"] * chest + T["waist"]["scale"] * s["waist"] * waist)) - 1
        depth = max(T["torso"]["min"], min(T["torso"]["max"], 1 + T["build"] * s["build"]
                    + T["chest"]["depth"] * s["chest"] * chest + T["waist"]["scale"] * s["waist"] * waist)) - 1
        x = x0 + (x0 - cx) * width * torso_mask
        carry_width = max(T["torso"]["min"], min(T["torso"]["max"], 1 + T["build"] * s["build"] + T["chest"]["width"] * s["chest"])) - 1
        x += sign * height * 0.105 * carry_width * arm_mask
        y = y0
        z = z0 + (z0 - frame["torsoZ"]) * depth * torso_mask
        z += (height * T["belly"]["depth"] * s["belly"] * _band(h, T["belly"]["c"], T["belly"]["hw"])
              * torso_mask * _smoothstep(-0.01, 0.045, (z0 - frame["torsoZ"]) / height))
        arm_weight = (arm_mask * _smoothstep(0.51, 0.57, h) * (1 - _smoothstep(0.77, 0.85, h))
                      * (1 - 0.25 * _band(h, 0.64, 0.04)))
        leg_weight = ((1 - arm_mask) * _smoothstep(0.075, 0.17, h) * (1 - _smoothstep(0.40, 0.51, h))
                      * (1 - 0.55 * _band(h, 0.275, 0.055)) * _smoothstep(0, 0.035, abs(x0 - cx) / height))
        da = _radial_shape_delta((x0, y0, z0), frame["arms"][side], arm_amount * arm_weight)
        dl = _radial_shape_delta((x0, y0, z0), frame["legs"][side], leg_amount * leg_weight)
        x += da[0] + dl[0]
        y += da[1] + dl[1]
        z += da[2] + dl[2]
        shoulder_weight = (arm_mask + (1 - arm_mask) * _smoothstep(0.65, 0.78, h)
                           * (1 - _smoothstep(0.82, 0.89, h)) * _smoothstep(0, 0.09, abs(x0 - cx) / height))
        x += sign * height * T["shoulders"] * s["shoulders"] * shoulder_weight
        hip_weight = ((1 - arm_mask) * _smoothstep(0.20, 0.47, h) * (1 - _smoothstep(0.54, 0.64, h))
                      * _smoothstep(0, 0.065, abs(x0 - cx) / height))
        x += sign * height * T["hips"] * s["hips"] * hip_weight
        head_k = T["head"]["scale"] * s["head"] * _smoothstep(0.83, 0.90, h)
        x += (x0 - cx) * head_k
        y += (y0 - (min_y + T["head"]["pivot"] * height)) * head_k
        z += (z0 - frame["headZ"]) * head_k
        y += T["legLength"] * height * s["legLength"] * (arm_mask + (1 - arm_mask) * _smoothstep(0.045, 0.48, h))
        result.append((cx + (x - cx) * height_k, min_y + (y - min_y) * height_k, cz + (z - cz) * height_k))
    return result


def apply_body_shape(body: bpy.types.Object, shape: Optional[Dict[str, Any]]) -> None:
    """Apply the browser's shape in an explicit side/up/front coordinate frame."""
    s = _effective_shape(shape)
    if all(abs(v) < 1e-4 for v in s.values()):
        return
    mesh = body.data
    if not isinstance(mesh, bpy.types.Mesh) or len(mesh.vertices) == 0:
        return
    up, front = _body_axes(mesh, body)
    side = up.cross(front)
    coords = [(v.co.dot(side), v.co.dot(up), v.co.dot(front)) for v in mesh.vertices]
    for vertex, (x, y, z) in zip(mesh.vertices, _deform_body_points(coords, s)):
        vertex.co = side * x + up * y + front * z
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


def _original_body_regions(coords):
    """Stable skin membership, before body proportions or pose move vertices."""
    if not coords:
        return []
    min_x, max_x = min(c[0] for c in coords), max(c[0] for c in coords)
    min_y, max_y = min(c[1] for c in coords), max(c[1] for c in coords)
    height = max(max_y - min_y, 1e-6)
    cx, half_w = (min_x + max_x) / 2.0, max(1e-6, (max_x - min_x) / 2.0)
    return [classify_region((c[1] - min_y) / height, (c[0] - cx) / half_w) for c in coords]


def _original_body_region_masks(coords):
    """Continuous Focus fields, mirrored by src/render/bodyRegionMask.ts.

    Values are fractions of original body height; nonnegative is visible.
    Keep fields on the undeformed skin so cuts follow shape and pose exactly.
    """
    if not coords:
        return {region: [] for region in BODY_REGION_IDS}
    min_y, max_y = min(p[1] for p in coords), max(p[1] for p in coords)
    min_x, max_x = min(p[0] for p in coords), max(p[0] for p in coords)
    height, half_width = max(1e-6, max_y - min_y), max(1e-6, (max_x - min_x) / 2)
    cx = (min_x + max_x) / 2
    boundary = []
    for h in (0.42, 0.46, 0.50, 0.54, 0.58, 0.62, 0.66, 0.70):
        samples = sorted(abs(p[0] - cx) for p in coords if abs((p[1] - min_y) / height - h) < 0.012)
        gap, middle = 0, _torso_half_width(h) * half_width
        for a, b in zip(samples, samples[1:]):
            candidate, mid = b - a, (a + b) / 2
            if mid < height * 0.06 or mid > height * 0.22:
                continue
            if candidate > gap:
                gap, middle = candidate, mid
        boundary.append((h, middle / height if gap > height * 0.008 else _torso_half_width(h) * half_width / height))

    def width_at(h):
        if h <= boundary[0][0]:
            return boundary[0][1]
        for (h0, w0), (h1, w1) in zip(boundary, boundary[1:]):
            if h <= h1:
                t = (h - h0) / (h1 - h0)
                return w0 + (w1 - w0) * t * t * (3 - 2 * t)
        return boundary[-1][1]

    fields = {region: [] for region in BODY_REGION_IDS}
    for p in coords:
        h, x = (p[1] - min_y) / height, (p[0] - cx) / height
        width = width_at(h)
        inside = width - abs(x)
        fields['head'].append(h - 0.87)
        fields['torso'].append(min(0.87 - h, h - 0.46, inside))
        fields['armLeft'].append(min(h - 0.32, 0.87 - h, x - width))
        fields['armRight'].append(min(h - 0.32, 0.87 - h, -x - width))
        fields['legLeft'].append(min(0.46 - h, inside, x))
        fields['legRight'].append(min(0.46 - h, inside, -x))
    return fields


def _apply_focus_material(material) -> None:
    """Transparent hidden skin casts no shadow and remains absent in reflections."""
    if material is None or not material.use_nodes:
        return
    nodes, links = material.node_tree.nodes, material.node_tree.links
    if nodes.get('SmartInkFocusCut'):
        return
    attribute = nodes.new('ShaderNodeAttribute')
    attribute.attribute_name = 'SmartInkFocus'
    attribute.label = 'Focus region on original skin'
    outside = nodes.new('ShaderNodeMath')
    outside.operation = 'LESS_THAN'
    outside.inputs[1].default_value = 0
    links.new(attribute.outputs['Fac'], outside.inputs[0])
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    transparent.inputs['Color'].default_value = (1, 1, 1, 1)
    for output in [node for node in nodes if node.type == 'OUTPUT_MATERIAL']:
        surface = output.inputs['Surface']
        if not surface.is_linked:
            continue
        original = surface.links[0].from_socket
        mix = nodes.new('ShaderNodeMixShader')
        mix.name = 'SmartInkFocusCut'
        links.new(outside.outputs[0], mix.inputs[0])
        links.new(original, mix.inputs[1])
        links.new(transparent.outputs[0], mix.inputs[2])
        links.new(mix.outputs[0], surface)


def _focus_visible_triangles(mesh):
    """Small CPU view of the shader cut for focus rays and hair area only."""
    field = mesh.attributes.get('SmartInkFocus')
    if field is None:
        return None
    mesh.calc_loop_triangles()
    visible = []
    for triangle in mesh.loop_triangles:
        polygon = [(mesh.vertices[i].co, field.data[i].value) for i in triangle.vertices]
        clipped = []
        for (a, va), (b, vb) in zip(polygon, polygon[1:] + polygon[:1]):
            if va >= 0:
                clipped.append(a)
            if (va >= 0) != (vb >= 0):
                clipped.append(a.lerp(b, va / (va - vb)))
        for i in range(1, len(clipped) - 1):
            visible.append((clipped[0], clipped[i], clipped[i + 1]))
    return visible


def isolate_body_region(body: bpy.types.Object, region_id: Optional[str], original_masks=None) -> None:
    """Clip at the same signed zero contour as the editor, preserving topology.

    A shader cut keeps all original UVs, multires detail and vertex groups.
    Hair density is cleared on hidden/crossing faces so invisible skin cannot
    emit stray strands. No positions or original vertex indices change.
    """
    if not region_id or region_id not in BODY_REGION_IDS:
        return
    mesh = body.data
    if not isinstance(mesh, bpy.types.Mesh) or len(mesh.vertices) == 0:
        return
    if original_masks is None:
        up, front = _body_axes(mesh, body)
        side = up.cross(front)
        original_masks = _original_body_region_masks([(v.co.dot(side), v.co.dot(up), v.co.dot(front)) for v in mesh.vertices])
    values = original_masks[region_id]
    if len(values) != len(mesh.vertices):
        raise ValueError('Original Focus field no longer matches the mesh')
    if not any(value >= 0 for value in values):
        raise ValueError('Focus region selected no skin')
    _apply_skin_visibility(body, values, f"Focus {region_id}")


def _apply_skin_visibility(body, values, label):
    """Shared surface-only cut for Focus and skin underneath clothing."""
    mesh = body.data
    attribute = mesh.attributes.get('SmartInkFocus') or mesh.attributes.new('SmartInkFocus', 'FLOAT', 'POINT')
    attribute.data.foreach_set('value', values)
    for material in mesh.materials:
        _apply_focus_material(material)
    # Transparent surfaces also disappear to shadow/reflection rays. Allow
    # enough passes through overlapping fingers and the opposite hidden skin.
    cycles = bpy.context.scene.cycles
    cycles.transparent_max_bounces = max(32, cycles.transparent_max_bounces)
    hidden_hair = set()
    for polygon in mesh.polygons:
        if any(values[i] < 0 for i in polygon.vertices):
            hidden_hair.update(polygon.vertices)
    if hidden_hair:
        for group in body.vertex_groups:
            if group.name.startswith(('body_', 'hair_')):
                group.remove(list(hidden_hair))
    mesh.update()
    print(f"[smartink] {label}: {sum(value >= 0 for value in values)} visible base vertices; topology preserved.")


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
    pupil_edge = elements.new(PUPIL_RADIUS_FRACTION * 0.75)
    pupil_edge.color = (0.003, 0.003, 0.003, 1.0)
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
    # Restrict visible texture to the iris. The previous unused noise node
    # left a uniformly red tint over both the iris and the whole sclera.
    iris_mask = nodes.new("ShaderNodeMath")
    iris_mask.operation = "LESS_THAN"
    iris_mask.inputs[1].default_value = IRIS_RADIUS_FRACTION
    links.new(radius.outputs["Value"], iris_mask.inputs[0])
    iris_detail = nodes.new("ShaderNodeMapRange")
    iris_detail.label = "Iris tonal detail"
    iris_detail.inputs["To Min"].default_value = 0.58
    iris_detail.inputs["To Max"].default_value = 1.0
    links.new(veins.outputs["Fac"], iris_detail.inputs["Value"])
    links.new(iris_mask.outputs["Value"], tint.inputs["Factor"])
    links.new(iris_detail.outputs["Result"], tint.inputs["B"])
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
            radius=1.0, segments=48, ring_count=24, location=centre
        )
        sphere = bpy.context.active_object
        sphere.name = f"{name}_{index}"
        # Unit local coordinates are required by the iris/pupil radial material.
        sphere.scale = (radius, radius, radius)
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


# Deterministic viewport appearance geometry, in the preview's X/right,
# Y/up, Z/front coordinate frame. Body skin topology remains untouched.
APPEARANCE_HAIR_COLORS = {
    'black': '#171411', 'dark_brown': '#302219', 'brown': '#634530',
    'auburn': '#874c30', 'blond': '#bd9b64', 'grey': '#96938d',
}


def _appearance_add(a, b, scale=1):
    return tuple(a[i] + b[i] * scale for i in range(3))


def _appearance_sub(a, b):
    return tuple(a[i] - b[i] for i in range(3))


def _appearance_mul(a, scale):
    return tuple(value * scale for value in a)


def _appearance_dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def _appearance_cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _appearance_normal(a):
    length = math.sqrt(_appearance_dot(a, a))
    return _appearance_mul(a, 1 / length) if length else tuple(a)


def _appearance_noise(x):
    value = math.sin(x * 127.1 + 311.7) * 43758.5453
    return value - math.floor(value)


def _appearance_scalp_field(original):
    min_y, max_y = min(p[1] for p in original), max(p[1] for p in original)
    height = max(1e-6, max_y - min_y)
    cx = (min(p[0] for p in original) + max(p[0] for p in original)) / 2
    crown = [p for p in original if (p[1] - min_y) / height > 0.95]
    min_z, max_z = min(p[2] for p in crown), max(p[2] for p in crown)
    half_x = max(abs(p[0] - cx) for p in crown)
    cz, rz = (min_z + max_z) / 2, max(1e-6, (max_z - min_z) / 2)
    field = []
    for p in original:
        h, x, z = (p[1] - min_y) / height, (p[0] - cx) / max(1e-6, half_x), (p[2] - cz) / rz
        front = _smoothstep(-0.25, 0.72, z)
        temple = _smoothstep(0.38, 0.9, abs(x)) * _smoothstep(0.05, 0.6, z)
        ear_arch = 0.025 * math.exp(-((z + 0.1) / 0.48) ** 2) * _smoothstep(0.65, 0.98, abs(x))
        line = 0.919 + 0.042 * front + 0.006 * temple + ear_arch + 0.0008 * math.sin(x * 23 + z * 17) + 0.0004 * math.sin(x * 57 - z * 11)
        field.append(_pose_float32((h - line) * height))
    return field


def _appearance_clip(corners):
    result = []
    for a, b in zip(corners, corners[1:] + corners[:1]):
        if a['f'] >= 0:
            result.append(a)
        if (a['f'] >= 0) != (b['f'] >= 0):
            t = a['f'] / (a['f'] - b['f'])
            result.append({'p': _appearance_add(a['p'], _appearance_sub(b['p'], a['p']), t),
                           'n': _appearance_normal(_appearance_add(a['n'], _appearance_sub(b['n'], a['n']), t)),
                           'o': _appearance_add(a['o'], _appearance_sub(b['o'], a['o']), t), 'f': 0})
    return result


def _appearance_hair_mesh(original, posed, normals, indices, appearance):
    """Mirror createPreviewHair: clipped scalp foundation and swept locks."""
    result = {'positions': [], 'normals': [], 'colors': [], 'lockCount': 0}
    if appearance['hairStyle'] == 'none':
        return result
    short = appearance['hairStyle'] == 'short'
    min_y, max_y = min(p[1] for p in original), max(p[1] for p in original)
    height = max_y - min_y
    field = _appearance_scalp_field(original)
    color = hex_to_rgb(APPEARANCE_HAIR_COLORS[appearance['hairTone']])
    triangles, area = [], 0
    def triangle_area(triangle):
        a, b, c = (corner['p'] for corner in triangle)
        cross = _appearance_cross(_appearance_sub(b, a), _appearance_sub(c, a))
        return math.sqrt(_appearance_dot(cross, cross)) / 2
    for face in range(0, len(indices), 3):
        ids = indices[face:face + 3]
        if all(field[i] < 0 for i in ids):
            continue
        polygon = _appearance_clip([{'p': posed[i], 'n': _appearance_normal(normals[i]), 'o': original[i], 'f': field[i]} for i in ids])
        for k in range(1, len(polygon) - 1):
            triangle = [polygon[0], polygon[k], polygon[k + 1]]
            area += triangle_area(triangle)
            triangles.append(triangle)
    def add(p, n, shade):
        result['positions'].extend(p)
        result['normals'].extend(n)
        result['colors'].extend(value * shade for value in color)
    offset = height * (0.0010 if short else 0.0005)
    for triangle in triangles:
        for corner in triangle:
            x, y, z = corner['o']
            grain = _appearance_noise(x * 151 + y * 89 + z * 173)
            add(_appearance_add(corner['p'], corner['n'], offset), corner['n'], 0.70 + grain * 0.14)
    for face, triangle in enumerate(triangles):
        a, b, c = triangle
        desired = triangle_area(triangle) / max(area, 1e-12) * (1500 if short else 1100)
        count = math.floor(desired) + (1 if _appearance_noise(face + 71) < desired % 1 else 0)
        e1, e2 = _appearance_sub(b['o'], a['o']), _appearance_sub(c['o'], a['o'])
        original_normal = _appearance_normal(_appearance_cross(e1, e2))
        groom = (0.38, -0.65, -0.55)
        groom = _appearance_add(groom, original_normal, -_appearance_dot(groom, original_normal))
        d11, d12, d22 = _appearance_dot(e1, e1), _appearance_dot(e1, e2), _appearance_dot(e2, e2)
        determinant = d11 * d22 - d12 * d12
        if abs(determinant) < 1e-18:
            continue
        u = (_appearance_dot(groom, e1) * d22 - _appearance_dot(groom, e2) * d12) / determinant
        v = (_appearance_dot(groom, e2) * d11 - _appearance_dot(groom, e1) * d12) / determinant
        current_groom = _appearance_normal(_appearance_add(_appearance_mul(_appearance_sub(b['p'], a['p']), u), _appearance_sub(c['p'], a['p']), v))
        for lock in range(count):
            seed = face * 31 + lock * 13
            r, random = math.sqrt(_appearance_noise(seed + 1)), _appearance_noise(seed + 2)
            weights = (1 - r, r * (1 - random), r * random)
            p, n, original_point = (0, 0, 0), (0, 0, 0), (0, 0, 0)
            for corner, weight in zip(triangle, weights):
                p, n = _appearance_add(p, corner['p'], weight), _appearance_add(n, corner['n'], weight)
                original_point = _appearance_add(original_point, corner['o'], weight)
            n = _appearance_normal(n)
            crown = _smoothstep(0.935, 0.985, (original_point[1] - min_y) / height)
            length = height * (0.003 + 0.007 * crown if short else 0.0011 + 0.0004 * crown) * (0.7 + 0.6 * _appearance_noise(seed + 3))
            width = height * (0.0010 if short else 0.00065) * (0.65 + _appearance_noise(seed + 4) * 0.7)
            tangent = _appearance_normal(_appearance_add(current_groom, n, -_appearance_dot(current_groom, n)))
            across = _appearance_normal(_appearance_cross(n, tangent))
            base = _appearance_add(p, n, offset * 0.8)
            mid = _appearance_add(_appearance_add(base, n, length * 0.45), tangent, length * 0.55)
            tip = _appearance_add(_appearance_add(base, n, length * 0.27), tangent, length * 1.2)
            left, right = _appearance_add(base, across, -width), _appearance_add(base, across, width)
            ml, mr = _appearance_add(mid, across, -width * 0.5), _appearance_add(mid, across, width * 0.5)
            shade = 0.86 + _appearance_noise(seed + 7) * 0.25
            for point, multiplier in ((left, 0.9), (right, 0.9), (ml, 1), (right, 0.9), (mr, 1), (ml, 1), (ml, 1), (mr, 1), (tip, 1.02)):
                add(point, n, shade * multiplier)
            result['lockCount'] += 1
    for key in ('positions', 'normals', 'colors'):
        result[key] = [_pose_float32(value) for value in result[key]]
    return result


def _appearance_clothing_template(original, indices):
    height = max(p[1] for p in original) - min(p[1] for p in original)
    min_y = min(p[1] for p in original)
    min_x, max_x = min(p[0] for p in original), max(p[0] for p in original)
    cx, half_width = (min_x + max_x) / 2, (max_x - min_x) / 2
    sections = []
    for h in (0.42, 0.46, 0.50, 0.54, 0.58, 0.62, 0.66, 0.70):
        samples = sorted(abs(p[0] - cx) for p in original if abs((p[1] - min_y) / height - h) < 0.012)
        gap, width = 0, _torso_half_width(h) * half_width
        for a, b in zip(samples, samples[1:]):
            mid, delta = (a + b) / 2, b - a
            if height * 0.06 <= mid <= height * 0.22 and delta > gap:
                gap, width = delta, mid
        sections.append((h, width if gap > height * 0.008 else _torso_half_width(h) * half_width))
    def width_at(h):
        if h <= sections[0][0]:
            return sections[0][1]
        for (h0, w0), (h1, w1) in zip(sections, sections[1:]):
            if h <= h1:
                return w0 + (w1 - w0) * ((h - h0) / (h1 - h0))
        return sections[-1][1]
    t = {'height': height, 'cx': cx, 'h': [], 'width': [], 'top': [], 'shorts': [], 'trousers': []}
    for p in original:
        x, h = (p[0] - cx) / height, _pose_float32((p[1] - min_y) / height)
        width = _pose_float32(width_at(h) / height)
        inside = width - abs(x)
        front = max(0, min(1, (p[2] / height + 0.02) / 0.08))
        neck = 0.855 - (0.014 + 0.014 * front) * math.sqrt(max(0, 1 - (x / 0.061) ** 2))
        sleeve = 0.718 - h + max(0, abs(x) - 0.10) * 0.55
        t['h'].append(h)
        t['width'].append(width)
        t['top'].append(_pose_float32(min(h - 0.505, neck - h, max(inside, -sleeve))))
        t['shorts'].append(_pose_float32(min(0.518 - h, h - 0.335, inside)))
        t['trousers'].append(_pose_float32(min(0.518 - h, h - 0.085, inside)))
    ids, representatives, unique = [], [], {}
    epsilon = height * 1e-7
    for i, p in enumerate(original):
        key = tuple(math.floor(value / epsilon + 0.5) for value in p)
        if key not in unique:
            unique[key] = len(representatives)
            representatives.append(i)
        ids.append(unique[key])
    faces, neighbors = [], [{} for _ in representatives]
    for start in range(0, len(indices), 3):
        face = [ids[i] for i in indices[start:start + 3]]
        faces.append(face)
        for k in range(3):
            neighbors[face[k]][face[(k + 1) % 3]] = True
            neighbors[face[k]][face[(k + 2) % 3]] = True
    t.update(ids=ids, representatives=representatives, faces=faces, neighbors=[list(items) for items in neighbors])
    return t


def _appearance_normals(points, faces, three_order=False):
    result = [[0.0, 0.0, 0.0] for _ in points]
    for face in faces:
        a, b, c = (points[i] for i in face)
        normal = (_appearance_cross(_appearance_sub(c, b), _appearance_sub(a, b)) if three_order
                  else _appearance_cross(_appearance_sub(b, a), _appearance_sub(c, a)))
        for i in face:
            for axis in range(3):
                result[i][axis] = _pose_float32(result[i][axis] + normal[axis])
    return [tuple(_pose_float32(value) for value in _appearance_normal(p)) for p in result]


def _appearance_relax(points, neighbors):
    result = list(points)
    for _ in range(18):
        next_points = list(result)
        for i, adjacent in enumerate(neighbors):
            if adjacent:
                next_points[i] = tuple(_pose_float32(result[i][axis] * 0.55 + sum(result[j][axis] for j in adjacent) / len(adjacent) * 0.45) for axis in range(3))
        result = next_points
    return result


def _appearance_tailored(points, t, original, kind):
    smooth = _appearance_relax(points, t['neighbors'])
    normals = _appearance_normals(smooth, t['faces'])
    result = [list(p) for p in smooth]
    top, height = kind == 'top', t['height']
    start, end = (0.505, 0.80) if top else ((0.335 if kind == 'shorts' else 0.085), 0.46)
    sections, h = [], start
    while h <= end + 0.008:
        for side in ([0] if top else [-1, 1]):
            points_in_slice = []
            for j, i in enumerate(t['representatives']):
                x = (original[i][0] - t['cx']) / height
                if abs(t['h'][i] - h) > 0.016 or abs(x) > t['width'][i] or (side and x * side < 0.008):
                    continue
                points_in_slice.append(smooth[j])
            if points_in_slice:
                min_x, max_x = min(p[0] for p in points_in_slice), max(p[0] for p in points_in_slice)
                min_z, max_z = min(p[2] for p in points_in_slice), max(p[2] for p in points_in_slice)
                sections.append({'y': h, 'side': side, 'cx': (min_x + max_x) / 2, 'cz': (min_z + max_z) / 2, 'rx': (max_x - min_x) / 2, 'rz': (max_z - min_z) / 2})
        h += 0.015
    for j, i in enumerate(t['representatives']):
        h, x = t['h'][i], (original[i][0] - t['cx']) / height
        inside = abs(x) < t['width'][i] - 0.004
        ease = height * (0.013 + 0.014 * max(0, min(1, (0.75 - h) / 0.24)) if top else 0.012)
        for axis in range(3):
            result[j][axis] = _pose_float32(result[j][axis] + normals[j][axis] * ease)
        result[j][1] = points[j][1]
        if not inside or h < start or h > end:
            continue
        side = 0 if top else (-1 if x < 0 else 1)
        available = [section for section in sections if section['side'] == side]
        if not available:
            continue
        lower, upper = available[0], available[-1]
        for candidate in available:
            if candidate['y'] <= h:
                lower = candidate
            if candidate['y'] >= h:
                upper = candidate
                break
        weight = max(0, min(1, (h - lower['y']) / max(0.0001, upper['y'] - lower['y'])))
        section = {key: lower[key] + (upper[key] - lower[key]) * weight for key in ('cx', 'cz', 'rx', 'rz')}
        breadth = 0 if top else height * (0.035 if kind == 'trousers' else 0.044)
        rx, rz = max(breadth, section['rx']) + ease, max(breadth * 0.95, section['rz']) + ease
        angle = math.atan2((smooth[j][2] - section['cz']) / max(0.001, section['rz']), (smooth[j][0] - section['cx']) / max(0.001, section['rx']))
        blend = max(0, min(1, (0.805 - h) / 0.045 if top else (0.46 - h) / 0.05))
        result[j][0] = _pose_float32(result[j][0] + (section['cx'] + rx * math.cos(angle) - result[j][0]) * blend)
        result[j][2] = _pose_float32(result[j][2] + (section['cz'] + rz * math.sin(angle) - result[j][2]) * blend)
    return result


def _appearance_transport(shaped, posed, garment, t):
    n0, n1 = _appearance_normals(shaped, t['faces']), _appearance_normals(posed, t['faces'])
    result = []
    for i in range(len(t['representatives'])):
        neighbor = t['neighbors'][i][0] if t['neighbors'][i] else i
        old_t, new_t = _appearance_sub(shaped[neighbor], shaped[i]), _appearance_sub(posed[neighbor], posed[i])
        old_t = _appearance_normal(_appearance_add(old_t, n0[i], -_appearance_dot(old_t, n0[i])))
        new_t = _appearance_normal(_appearance_add(new_t, n1[i], -_appearance_dot(new_t, n1[i])))
        old_b, new_b = _appearance_cross(n0[i], old_t), _appearance_cross(n1[i], new_t)
        offset = _appearance_sub(garment[i], shaped[i])
        point = _appearance_add(posed[i], new_t, _appearance_dot(offset, old_t))
        point = _appearance_add(point, new_b, _appearance_dot(offset, old_b))
        point = _appearance_add(point, n1[i], _appearance_dot(offset, n0[i]))
        result.append(tuple(_pose_float32(value) for value in point))
    return result


def _appearance_clipped_garment(points, t, field, color, name):
    positions, faces, vertex_map, hems = [], [], {}, []
    def vertex(key, point):
        if key not in vertex_map:
            vertex_map[key] = len(positions)
            positions.append(tuple(point))
        return vertex_map[key]
    for face in t['faces']:
        polygon, cut = [], []
        for k in range(3):
            a, b = face[k], face[(k + 1) % 3]
            fa, fb = field[t['representatives'][a]], field[t['representatives'][b]]
            if fa >= 0:
                polygon.append(vertex(a, points[a]))
            if (fa >= 0) != (fb >= 0):
                weight = fa / (fa - fb)
                i = vertex((min(a, b), max(a, b)), _appearance_add(points[a], _appearance_sub(points[b], points[a]), weight))
                polygon.append(i)
                cut.append(i)
        for k in range(1, len(polygon) - 1):
            faces.append((polygon[0], polygon[k], polygon[k + 1]))
        if len(cut) == 2:
            hems.append(cut)
    float_positions = [tuple(_pose_float32(value) for value in point) for point in positions]
    normals = _appearance_normals(float_positions, faces, True)
    def mesh_data(name, points, faces, normals, scale=1):
        return {'name': name, 'color': color, 'colorScale': scale,
                'positions': [value for face in faces for i in face for value in points[i]],
                'normals': [value for face in faces for i in face for value in normals[i]]}
    cloth = mesh_data(name, float_positions, faces, normals)
    hem_points, hem_faces, thickness = [], [], t['height'] * 0.0018
    for a, b in hems:
        offset = len(hem_points)
        for i, inner in ((a, 0), (b, 0), (a, 1), (b, 1)):
            hem_points.append(tuple(_pose_float32(positions[i][axis] - normals[i][axis] * thickness * inner) for axis in range(3)))
        hem_faces.extend(((offset, offset + 1, offset + 2), (offset + 1, offset + 3, offset + 2)))
    hem = mesh_data(name + ' hems', hem_points, hem_faces, _appearance_normals(hem_points, hem_faces, True), 0.8)
    return [cloth, hem]


def _appearance_clothing_meshes(original, shaped, posed, indices, appearance):
    result = {'coverage': [-1] * len(original), 'meshes': []}
    if appearance['top'] == 'none' and appearance['bottom'] == 'none':
        return result
    t = _appearance_clothing_template(original, indices)
    kinds = (['top'] if appearance['top'] == 'tshirt' else []) + ([appearance['bottom']] if appearance['bottom'] != 'none' else [])
    result['coverage'] = [max(t[kind][i] for kind in kinds) for i in range(len(original))]
    shaped_unique = [shaped[i] for i in t['representatives']]
    posed_unique = [posed[i] for i in t['representatives']]
    for kind in kinds:
        garment = _appearance_tailored(shaped_unique, t, original, kind)
        points = _appearance_transport(shaped_unique, posed_unique, garment, t)
        color = appearance['topColor'] if kind == 'top' else appearance['bottomColor']
        name = {'top': 'T-shirt', 'shorts': 'Shorts', 'trousers': 'Trousers'}[kind]
        result['meshes'].extend(_appearance_clipped_garment(points, t, t[kind], color, name))
    return result


def _add_appearance_mesh(body, name, data, color=None, roughness=0.84):
    if not data['positions']:
        return None
    up, front = _body_axes(body.data, body)
    side = up.cross(front)
    source = data['positions']
    vertices = [side * source[i] + up * source[i + 1] + front * source[i + 2] for i in range(0, len(source), 3)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], [tuple(range(i, i + 3)) for i in range(0, len(vertices), 3)])
    mesh.update()
    for face in mesh.polygons:
        face.use_smooth = True
    if data.get('normals'):
        normal = data['normals']
        mesh.normals_split_custom_set([side * normal[i] + up * normal[i + 1] + front * normal[i + 2] for i in range(0, len(normal), 3)])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.matrix_world = body.matrix_world.copy()
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = roughness
    if data.get('colors'):
        colors = mesh.color_attributes.new(name='AppearanceColor', type='FLOAT_COLOR', domain='CORNER')
        source = data['colors']
        colors.data.foreach_set('color', [value for i in range(0, len(source), 3) for value in (*source[i:i + 3], 1)])
        attribute = material.node_tree.nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = colors.name
        material.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*(channel * data.get('colorScale', 1) for channel in hex_to_rgb(color or '#ffffff')), 1)
    mesh.materials.append(material)
    return obj


def add_appearance_hair(body, original, appearance):
    up, front = _body_axes(body.data, body)
    side = up.cross(front)
    posed = [(v.co.dot(side), v.co.dot(up), v.co.dot(front)) for v in body.data.vertices]
    normals = [(v.normal.dot(side), v.normal.dot(up), v.normal.dot(front)) for v in body.data.vertices]
    body.data.calc_loop_triangles()
    indices = [i for triangle in body.data.loop_triangles for i in triangle.vertices]
    data = _appearance_hair_mesh(original, posed, normals, indices, appearance)
    return _add_appearance_mesh(body, 'Appearance hair', data)


def add_appearance_clothing(body, original, shaped, appearance):
    up, front = _body_axes(body.data, body)
    side = up.cross(front)
    posed = [(v.co.dot(side), v.co.dot(up), v.co.dot(front)) for v in body.data.vertices]
    body.data.calc_loop_triangles()
    indices = [i for triangle in body.data.loop_triangles for i in triangle.vertices]
    data = _appearance_clothing_meshes(original, shaped, posed, indices, appearance)
    objects = [_add_appearance_mesh(body, 'Appearance ' + mesh['name'], mesh, mesh['color'], 0.92) for mesh in data['meshes']]
    if objects:
        # Match the browser's coverage field, suppress pokethrough and body
        # hair under fabric. The original body and its atlas remain intact.
        _apply_skin_visibility(body, [-value for value in data['coverage']], 'Clothing coverage')
    return [obj for obj in objects if obj is not None]


def enhance_appearance_materials(body) -> None:
    """Subtle fibre response for existing garments; no silhouette or fit changes."""
    world_scale = _world_scale(body)
    # Object coordinates follow the garment through poses. Convert their
    # metric frequency separately from the bump distance (which is world-space).
    local_scale = sum(abs(value) for value in body.scale) / 3
    frequency = 1600 * local_scale / world_scale
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or not obj.name.startswith('Appearance '):
            continue
        hair = obj.name == 'Appearance hair'
        for material in obj.data.materials:
            if not material or not material.use_nodes:
                continue
            nodes, links = material.node_tree.nodes, material.node_tree.links
            bsdf = next((node for node in nodes if node.type == 'BSDF_PRINCIPLED'), None)
            if bsdf is None:
                continue
            _set(bsdf, 'Sheen Weight', 0.12 if hair else 0.22)
            _set(bsdf, 'Sheen Roughness', 0.55)
            _set(bsdf, 'Roughness', 0.58 if hair else 0.82)
            if hair:
                continue
            coords = nodes.new('ShaderNodeTexCoord')
            grain = nodes.new('ShaderNodeTexNoise')
            grain.label = 'Fine fabric fibres'
            grain.inputs['Scale'].default_value = frequency
            grain.inputs['Detail'].default_value = 2
            links.new(coords.outputs['Object'], grain.inputs['Vector'])
            bump = nodes.new('ShaderNodeBump')
            bump.label = 'Fabric micro-relief'
            bump.inputs['Strength'].default_value = .18
            bump.inputs['Distance'].default_value = .00008 * world_scale
            links.new(grain.outputs['Fac'], bump.inputs['Height'])
            links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])


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
    prepared_regions: bool = False,
    scalp_style: Optional[str] = None,
) -> None:
    """Scalp crop, eyebrows and eyelashes, emitted from detected regions."""
    regions = ({name: {} for name in ("scalp", "brow", "lash")} if prepared_regions
               else _hair_regions(body, landmarks, eye_radius))
    melanin, redness = HAIR_TONES.get(hair_tone, HAIR_TONES[DEFAULT_HAIR_TONE])
    material = _build_hair_material("hair", melanin, redness)
    body.data.materials.append(material)
    material_slot = len(body.data.materials)  # particle material index is 1-based

    thickness = _local_length(body, HAIR_THICKNESS_M)
    for name, weights in regions.items():
        if name == 'scalp' and scalp_style == 'none':
            continue
        existing = body.vertex_groups.get(f"hair_{name}") if prepared_regions else None
        group = (existing.name if existing is not None else None) if prepared_regions else _vertex_group_from_weights(body, f"hair_{name}", weights)
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


# ---------------------------------------------------------------------------
# Body hair
#
# Skin is never bare. Every square centimetre outside the palms, soles and
# lips carries vellus hair -- the near-invisible fuzz that catches a rim light
# and softens every silhouette in a photograph -- and the limbs and torso add
# terminal hair on top. A render with neither reads as porcelain no matter how
# good the shading is: the "mannequin" tell is, more than anything else, skin
# with no fibre on it.
#
# Densities are per square metre of real skin, so a region cut-out keeps the
# same coverage instead of piling the whole body's strands onto one forearm.
# ---------------------------------------------------------------------------

# contract.bodyHair -> terminal-hair density multiplier. Vellus is always on
# unless the level is "none".
BODY_HAIR_LEVELS: Dict[str, float] = {
    "none": 0.0,
    "vellus": 0.0,
    "light": 0.4,
    "medium": 1.0,
    "heavy": 1.8,
}
BODY_HAIR_DEFAULTS: Dict[str, str] = {"body_full": "medium", "body_full_female": "vellus"}
DEFAULT_BODY_HAIR = "medium"

VELLUS_LENGTH_M = 0.0028
VELLUS_THICKNESS_M = 0.000025      # ~25 microns: vellus is a third of a scalp hair
VELLUS_PARENTS_PER_M2 = 5200
VELLUS_CHILDREN = 40               # ~200k strands over a whole body

TERMINAL_LENGTH_M = 0.009
TERMINAL_THICKNESS_M = 0.00007
TERMINAL_PARENTS_PER_M2 = 2600
TERMINAL_CHILDREN = 12

# Measured on this figure: a particle system's evaluated strands come out
# shorter than hair_length (read the hair keys, not the setting), so body hair
# is authored through this gain to land at the lengths above. The emission
# velocity's Object-Aligned, Normal and Random terms are all absolute rather
# than multiples of hair_length, so each is scaled to the intended length --
# a bare Object-Aligned or Normal value produced strands a metre long.
# 1.48 puts the median evaluated strand on VELLUS_LENGTH_M / TERMINAL_LENGTH_M;
# re-measure it if the emission settings above ever change again.
HAIR_LENGTH_GAIN = 1.48
HAIR_RANDOM_PER_LENGTH = 0.0975


def _skin_area_m2(body: bpy.types.Object) -> float:
    """Surface area of the base mesh in real square metres."""
    visible = _focus_visible_triangles(body.data)
    local_area = (sum((b - a).cross(c - a).length / 2 for a, b, c in visible)
                  if visible is not None else sum(p.area for p in body.data.polygons))
    scene_area = local_area * float(body.scale.x) ** 2
    return max(0.05, scene_area / (_world_scale(body) ** 2))


def mark_body_hair_regions(body: bpy.types.Object) -> None:
    """Write vellus and terminal density groups off the whole figure.

    Runs before the region cut-out, because the densities are read against the
    full figure's height and width; the groups ride along on whatever vertices
    survive the cut. Terminal hair follows where it actually grows on a man:
    shins and thighs, the outer forearm, a chest patch and the line below the
    navel, almost nothing on the back, none on the face.
    """
    mesh = body.data
    if not isinstance(mesh, bpy.types.Mesh) or len(mesh.vertices) == 0:
        return
    up, front = _body_axes(mesh, body)
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

    vellus: Dict[int, float] = {}
    terminal: Dict[int, float] = {}
    for v in mesh.vertices:
        h = (v.co.dot(up) - min_y) / height
        u = (v.co.dot(side) - cx) / half_w
        facing = v.normal.dot(front)
        region = classify_region(h, u)
        # Hairs never grow at one density: patches thin and thicken over a few
        # centimetres, which is what stops the coverage reading as a texture.
        patch = 0.55 + 0.45 * _hash01(v.co * 7.0)

        t = 0.0
        if region.startswith("leg"):
            if abs(u) > 0.60:
                t = 0.30                       # the hands hang this low in an A-pose
            elif h < 0.06:
                t = 0.35                       # tops of the feet and toes
            else:
                t = 1.0 - 0.7 * _smoothstep(0.40, 0.46, h)
                if facing < -0.3:
                    t *= 0.75                  # backs of the legs run thinner
        elif region.startswith("arm"):
            if h < 0.52:
                t = 0.90                       # forearm and back of the hand
            else:
                t = 0.45 - 0.25 * _smoothstep(0.66, 0.78, h)
            if facing > 0.35:
                t *= 0.35                      # the inner arm is nearly bare
        elif region == "torso":
            if facing > 0.15:
                chest = _band(h, 0.725, 0.075)
                treasure = _band(h, 0.52, 0.075) * _band(u, 0.0, 0.28)
                t = 0.5 * chest + 0.65 * treasure
            else:
                t = 0.05
        vellus[v.index] = 0.7 if region == "head" else 1.0
        if t > 0.0:
            terminal[v.index] = min(1.0, t * patch)

    _vertex_group_from_weights(body, "body_vellus", vellus)
    _vertex_group_from_weights(body, "body_terminal", terminal)


def _exclude_scalp_from_vellus(body: bpy.types.Object) -> None:
    """Vellus under a scalp crop is invisible; leaving it there doubles the strands."""
    vellus = body.vertex_groups.get("body_vellus")
    scalp = body.vertex_groups.get("hair_scalp")
    if vellus is None or scalp is None:
        return
    for v in body.data.vertices:
        weights = {g.group: g.weight for g in v.groups}
        s = weights.get(scalp.index, 0.0)
        if s > 0.0 and vellus.index in weights:
            vellus.add([v.index], weights[vellus.index] * (1.0 - s), "REPLACE")


def _add_body_hair_system(
    body: bpy.types.Object,
    name: str,
    group: str,
    parents: int,
    children: int,
    length: float,
    thickness: float,
    material_slot: int,
    spread: float,
) -> None:
    modifier = body.modifiers.new(name=f"hair_{name}", type="PARTICLE_SYSTEM")
    system = body.particle_systems[modifier.name] if modifier.name in body.particle_systems else body.particle_systems[-1]
    system.vertex_group_density = group
    system.seed = 7 if name == "vellus" else 11

    settings = system.settings
    settings.type = "HAIR"
    settings.use_advanced_hair = True
    settings.count = max(1, parents)
    settings.hair_length = length * HAIR_LENGTH_GAIN
    settings.length_random = 0.45
    settings.hair_step = 3
    settings.use_hair_bspline = True
    settings.material = material_slot
    settings.use_even_distribution = True

    # Absolute, in local units -- not a multiple of hair_length. Left at 1.0 it
    # threw every strand a full unit along its normal, so 2.8 mm vellus rendered
    # as ~1.7 units on a 4.2-unit figure: a metre of fuzz per pore, which read
    # as a radial blowout under any rim light. Scale it to the intended length
    # for the same reason factor_random below is scaled.
    settings.normal_factor = settings.hair_length
    settings.factor_random = spread * HAIR_RANDOM_PER_LENGTH * settings.hair_length

    settings.child_type = "INTERPOLATED"
    settings.rendered_child_count = children
    settings.child_length = 1.0
    settings.child_length_threshold = 0.35
    settings.child_radius = length * 0.9
    settings.clump_factor = 0.0
    settings.roughness_2 = 0.03
    settings.roughness_2_size = 0.35
    settings.roughness_endpoint = 0.05 if name == "vellus" else 0.015

    settings.radius_scale = thickness
    settings.root_radius = 1.0
    settings.tip_radius = 0.05
    print(f"  hair '{name}': {parents} parents x {children} children, length {length:.4f}")


def add_body_hair(body: bpy.types.Object, level: str, hair_tone: str = DEFAULT_HAIR_TONE) -> None:
    """Vellus everywhere, terminal hair where the density groups put it."""
    level = level if level in BODY_HAIR_LEVELS else DEFAULT_BODY_HAIR
    if level == "none" or body.vertex_groups.get("body_vellus") is None:
        return
    _exclude_scalp_from_vellus(body)
    area = _skin_area_m2(body)
    thickness_scale = _world_scale(body) / (abs(body.scale.x) or 1.0)

    # Vellus is pale on everyone, whatever the scalp colour: it has almost no
    # pigment, which is why it only shows up against the light.
    vellus_mat = _build_hair_material("vellus", 0.03, 0.30)
    body.data.materials.append(vellus_mat)
    _add_body_hair_system(
        body, "vellus", "body_vellus",
        int(VELLUS_PARENTS_PER_M2 * area), VELLUS_CHILDREN,
        _local_length(body, VELLUS_LENGTH_M),
        VELLUS_THICKNESS_M * thickness_scale,
        len(body.data.materials), spread=0.6,
    )

    density = BODY_HAIR_LEVELS[level]
    if density > 0.0 and body.vertex_groups.get("body_terminal") is not None:
        melanin, redness = HAIR_TONES.get(hair_tone, HAIR_TONES[DEFAULT_HAIR_TONE])
        terminal_mat = _build_hair_material("body_hair", min(1.0, melanin * 0.85), redness)
        body.data.materials.append(terminal_mat)
        _add_body_hair_system(
            body, "terminal", "body_terminal",
            int(TERMINAL_PARENTS_PER_M2 * area * density), TERMINAL_CHILDREN,
            _local_length(body, TERMINAL_LENGTH_M),
            TERMINAL_THICKNESS_M * thickness_scale,
            len(body.data.materials), spread=0.8,
        )

    render = bpy.context.scene.render
    if hasattr(render, "hair_type"):
        render.hair_type = "STRAND"
        render.hair_subdiv = 2
    print(f"Body hair '{level}' over {area:.2f} m2 of skin")


BODY_POSE_BOUNDS = {
    "leftArmLift": (-10, 40), "rightArmLift": (-10, 40),
    "leftArmForward": (-10, 35), "rightArmForward": (-10, 35),
    "leftElbow": (0, 85), "rightElbow": (0, 85),
    "leftLegSpread": (-5, 15), "rightLegSpread": (-5, 15),
    "leftLegForward": (-15, 30), "rightLegForward": (-15, 30),
    "leftKnee": (0, 55), "rightKnee": (0, 55),
    "headTurn": (-35, 35), "headTilt": (-15, 15),
}
BODY_POSE_PRESETS = {
    "neutral": {},
    "relaxed": {"leftArmLift": -10, "rightArmLift": -10, "leftElbow": 8, "rightElbow": 8},
    "arms_out": {"leftArmLift": 40, "rightArmLift": 40, "leftElbow": 5, "rightElbow": 5},
    "arm_showcase": {"leftArmLift": 28, "leftArmForward": 24, "leftElbow": 35, "rightArmLift": -8, "headTurn": 12},
    "flex": {"leftArmLift": 32, "rightArmLift": 32, "leftElbow": 70, "rightElbow": 70},
    "step": {"leftLegForward": 16, "leftKnee": 18, "rightLegForward": -5, "rightKnee": 5, "leftArmForward": -8, "rightArmForward": 14},
}


def _effective_pose(pose):
    result = dict.fromkeys(BODY_POSE_BOUNDS, 0.0)
    for key, value in (pose or {}).items():
        if key in result and type(value) in (int, float) and math.isfinite(value):
            low, high = BODY_POSE_BOUNDS[key]
            result[key] = max(low, min(high, value))
    for side in ("left", "right"):
        result[side + "ArmForward"] = min(result[side + "ArmForward"], 35 + min(0, result[side + "ArmLift"]))
        result[side + "Elbow"] = min(result[side + "Elbow"], 100 - max(result[side + "ArmForward"], 0))
    return result


def _pose_from_preset(pose_id):
    return _effective_pose(BODY_POSE_PRESETS.get("arms_out" if pose_id == "arm_extended" else pose_id, {}))


def _pose_rig(original, shaped):
    """Original skin selects joints; pivot positions follow the current shape."""
    minimum = [min(p[axis] for p in original) for axis in range(3)]
    maximum = [max(p[axis] for p in original) for axis in range(3)]
    height = maximum[1] - minimum[1]
    cx = (minimum[0] + maximum[0]) / 2.0
    half_width = max(1e-6, (maximum[0] - minimum[0]) / 2.0)
    middle_z = (minimum[2] + maximum[2]) / 2.0

    def section(h, side, limb):
        low, high = [float("inf")] * 3, [float("-inf")] * 3
        for base, current in zip(original, shaped):
            x, y = base[0], base[1]
            original_h = (y - minimum[1]) / height
            if abs(original_h - h) > 0.014 or (side and (x - cx) * side <= 0):
                continue
            u = abs(x - cx) / half_width
            if limb == "arm" and u < _torso_half_width(original_h) - 0.025:
                continue
            if limb == "leg" and (u > _torso_half_width(original_h) - 0.04 or abs(x - cx) < height * 0.015):
                continue
            for axis in range(3):
                low[axis], high[axis] = min(low[axis], current[axis]), max(high[axis], current[axis])
        if math.isfinite(low[0]):
            return tuple((low[axis] + high[axis]) / 2.0 for axis in range(3))
        return (cx + side * height * (0.13 if limb == "arm" else 0.075), minimum[1] + height * h, middle_z)

    def limb(side):
        return {"shoulder": section(0.78, side, "arm"), "elbow": section(0.645, side, "arm"),
                "hip": section(0.49, side, "leg"), "knee": section(0.275, side, "leg")}
    return {"left": limb(1), "right": limb(-1), "head": section(0.855, 0, "head")}


def _pose_rotate(point, pivot, axis, radians):
    """Same partial-angle quaternion rotation used by the browser."""
    if abs(radians) < 1e-12:
        return point
    half = radians / 2.0
    sine, qw = math.sin(half), math.cos(half)
    qx, qy, qz = (a * sine for a in axis)
    x, y, z = (point[i] - pivot[i] for i in range(3))
    tx, ty, tz = 2 * (qy * z - qz * y), 2 * (qz * x - qx * z), 2 * (qx * y - qy * x)
    return (pivot[0] + x + qw * tx + qy * tz - qz * ty,
            pivot[1] + y + qw * ty + qz * tx - qx * tz,
            pivot[2] + z + qw * tz + qx * ty - qy * tx)


def _pose_float32(value):
    # Browser caches feather weights in Float32Array. Preserve that rounding.
    return struct.unpack('f', struct.pack('f', value))[0]


def _measure_pose_arm_boundary(original):
    height = max(p[1] for p in original) - min(p[1] for p in original)
    min_y = min(p[1] for p in original)
    min_x, max_x = min(p[0] for p in original), max(p[0] for p in original)
    cx, half_width = (min_x + max_x) / 2.0, (max_x - min_x) / 2.0
    result = []
    for h in (0.42, 0.46, 0.50, 0.54, 0.58, 0.62, 0.66, 0.70):
        samples = sorted(abs(p[0] - cx) for p in original if abs((p[1] - min_y) / height - h) < 0.012)
        gap, middle = 0.0, _torso_half_width(h) * half_width
        for i in range(1, len(samples)):
            candidate, mid = samples[i] - samples[i - 1], (samples[i] + samples[i - 1]) / 2.0
            if mid < height * 0.06 or mid > height * 0.22:
                continue
            if candidate > gap:
                gap, middle = candidate, mid
        result.append({"h": h, "middle": middle / half_width, "halfGap": gap * 0.375 / half_width}
                      if gap > height * 0.008 else {"h": h, "middle": _torso_half_width(h), "halfGap": 0.015})
    return result


def _pose_arm_boundary_at(boundary, h):
    if h <= boundary[0]["h"]:
        return boundary[0]
    for i in range(1, len(boundary)):
        if h > boundary[i]["h"]:
            continue
        a, b = boundary[i - 1], boundary[i]
        t = (h - a["h"]) / (b["h"] - a["h"])
        return {"middle": a["middle"] + (b["middle"] - a["middle"]) * t,
                "halfGap": a["halfGap"] + (b["halfGap"] - a["halfGap"]) * t}
    return boundary[-1]


def _pose_body_points(original, shaped, partial, rig=None):
    pose = _effective_pose(partial)
    if not original or all(abs(v) < 1e-8 for v in pose.values()):
        return shaped
    min_y, max_y = min(p[1] for p in original), max(p[1] for p in original)
    height = max_y - min_y
    if height <= 0:
        return shaped
    min_x, max_x = min(p[0] for p in original), max(p[0] for p in original)
    cx, half_width = (min_x + max_x) / 2.0, max(1e-6, (max_x - min_x) / 2.0)
    rig = _pose_rig(original, shaped) if rig is None else rig
    original_rig = _pose_rig(original, original)
    boundary = _measure_pose_arm_boundary(original)
    degrees = math.pi / 180
    settings = {}
    for side, prefix in ((-1, "right"), (1, "left")):
        joints = rig[prefix]
        dx, dy = (joints["elbow"][i] - joints["shoulder"][i] for i in range(2))
        length = math.hypot(dx, dy)
        settings[side] = {
            "joints": joints, "elbow_axis": (dy / length, -dx / length, 0) if length > 1e-8 else (-1, 0, 0),
            "lift": pose[prefix + "ArmLift"] * degrees * side,
            "forward": -pose[prefix + "ArmForward"] * degrees,
            "elbow": pose[prefix + "Elbow"] * degrees,
            "spread": pose[prefix + "LegSpread"] * degrees * side,
            "leg_forward": -pose[prefix + "LegForward"] * degrees,
            "knee": pose[prefix + "Knee"] * degrees,
        }
    result = []
    for base, point in zip(original, shaped):
        x, h = base[0], (base[1] - min_y) / height
        u = abs(x - cx) / half_width
        joints = original_rig["right" if x < cx else "left"]
        direction = [joints["elbow"][axis] - joints["shoulder"][axis] for axis in range(3)]
        along_arm = sum((base[axis] - joints["shoulder"][axis]) * direction[axis] for axis in range(3)) / (math.hypot(*direction) * height)
        split, attachment = _pose_arm_boundary_at(boundary, h), _smoothstep(0.67, 0.79, h)
        inner = split["halfGap"] + (0.08 - split["halfGap"]) * attachment
        outer = split["halfGap"] + (0.10 - split["halfGap"]) * attachment
        arm_region = (_smoothstep(split["middle"] - inner, split["middle"] + outer, u)
                      * _smoothstep(0.32, 0.40, h) * (1 - _smoothstep(0.80, 0.875, h)))
        arm = arm_region * _smoothstep(-0.015, 0.05, along_arm)
        leg = (1 - arm_region) * (1 - _smoothstep(0.43, 0.58, h)) * _smoothstep(0, 0.025, abs(x - cx) / height)
        forearm = _pose_float32(arm * (1 - _smoothstep(0.605, 0.685, h)))
        calf = _pose_float32(leg * (1 - _smoothstep(0.235, 0.315, h)))
        neck = _pose_float32(_smoothstep(0.83, 0.89, h))
        arm, leg = _pose_float32(arm), _pose_float32(leg)
        s = settings[-1 if x < cx else 1]
        joints = s["joints"]
        point = _pose_rotate(point, joints["elbow"], s["elbow_axis"], s["elbow"] * forearm)
        point = _pose_rotate(point, joints["shoulder"], (1, 0, 0), s["forward"] * arm)
        point = _pose_rotate(point, joints["shoulder"], (0, 0, 1), s["lift"] * arm)
        point = _pose_rotate(point, joints["knee"], (1, 0, 0), s["knee"] * calf)
        point = _pose_rotate(point, joints["hip"], (1, 0, 0), s["leg_forward"] * leg)
        point = _pose_rotate(point, joints["hip"], (0, 0, 1), s["spread"] * leg)
        point = _pose_rotate(point, rig["head"], (0, 1, 0), pose["headTurn"] * degrees * neck)
        point = _pose_rotate(point, rig["head"], (0, 0, 1), -pose["headTilt"] * degrees * neck)
        result.append(point)
    return result


def apply_pose(pose_id: str, body: bpy.types.Object, body_pose=None, original_coords=None, head_followers=()) -> None:
    """Pose the freshly shaped cage, preserving original triangle/UV identity."""
    pose = _pose_from_preset(pose_id) if body_pose is None else _effective_pose(body_pose)
    if all(abs(v) < 1e-8 for v in pose.values()):
        return
    mesh = body.data
    up, front = _body_axes(mesh, body)
    side = up.cross(front)
    shaped = [(v.co.dot(side), v.co.dot(up), v.co.dot(front)) for v in mesh.vertices]
    original = shaped if original_coords is None else original_coords
    if len(original) != len(shaped):
        raise ValueError("Original pose vertices no longer match the mesh")
    rig = _pose_rig(original, shaped)
    if head_followers:
        pivot = side * rig["head"][0] + up * rig["head"][1] + front * rig["head"][2]
        head_matrix = (Matrix.Translation(pivot)
                       @ Matrix.Rotation(math.radians(-pose["headTilt"]), 4, front)
                       @ Matrix.Rotation(math.radians(pose["headTurn"]), 4, up)
                       @ Matrix.Translation(-pivot))
        bpy.context.view_layer.update()
        world_head = body.matrix_world @ head_matrix @ body.matrix_world.inverted()
        for follower in head_followers:
            follower.matrix_world = world_head @ follower.matrix_world
    for vertex, (x, y, z) in zip(mesh.vertices, _pose_body_points(original, shaped, pose, rig)):
        vertex.co = side * x + up * y + front * z
    mesh.update()
    print(f"[smartink] Applied pose '{pose_id}'")


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


def build_cinematic_rig(look_id: str, intensity_scale: float = 1.0, body_height: float = 4.2, backdrop: bool = True, configure_world: bool = True) -> None:
    """Area-light rig plus a seamless backdrop, both oriented to the camera."""
    rig = CINEMATIC_RIGS.get(look_id, CINEMATIC_RIGS["studio_softbox"])
    theta = _camera_azimuth()
    aim = (0.0, 0.0, body_height * 0.05)

    for i, (az, dist, height, energy, size, color) in enumerate(rig["lights"]):
        a = theta + math.radians(az)
        _add_area_light(
            f"cine_{i}",
            (dist * math.cos(a), dist * math.sin(a), height),
            energy * max(0.0, intensity_scale),
            size,
            color,
            aim,
        )

    world = bpy.context.scene.world
    if configure_world and world and world.use_nodes:
        for node in world.node_tree.nodes:
            if node.type == "BACKGROUND":
                node.inputs["Color"].default_value = (*rig["bg"], 1.0)
                node.inputs["Strength"].default_value = 1.0

    if not backdrop:
        return
    mat = bpy.data.materials.new("cine_backdrop")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rig["backdrop"], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.62

    build_cyclorama(theta, -body_height / 2.0 - 0.02, body_height, mat)


def _cyclorama_profile(body_height, camera_distance):
    """The same quarter-circle sweep profile used by the browser studio."""
    body_height = max(0.1, body_height if math.isfinite(body_height) else 4.2)
    camera_distance = max(0.1, camera_distance if math.isfinite(camera_distance) else 8)
    radius = max(3.0, body_height * 1.1)
    start = max(body_height * 1.2, camera_distance * 0.30)
    height = max(body_height * 3.0, camera_distance, radius + 0.1)
    half_width = max(body_height * 4.0, camera_distance)
    front = max(body_height * 3.0, camera_distance * 0.6)
    profile = [(-front, 0.0), (start, 0.0)]
    for i in range(1, 17):
        angle = math.pi * 0.5 * i / 16
        profile.append((start + radius * math.sin(angle), radius * (1.0 - math.cos(angle))))
    profile.append((start + radius, height))
    return profile, half_width


def _studio_body_bounds(body):
    bpy.context.view_layer.update()
    points = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
    return min(point.z for point in points), max(point.z for point in points)


def _studio_backdrop_material(color, shadow):
    material = bpy.data.materials.new('Studio backdrop')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 0.9
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.15
    flat = nodes.new('ShaderNodeEmission')
    flat.inputs['Color'].default_value = (*color, 1)
    flat.inputs['Strength'].default_value = 1
    contrast = nodes.new('ShaderNodeMixShader')
    contrast.label = 'Ground shadow strength'
    contrast.inputs[0].default_value = shadow
    links.new(flat.outputs[0], contrast.inputs[1])
    links.new(bsdf.outputs[0], contrast.inputs[2])
    # Camera-only flat colour can soften the visible ground shadow without
    # turning the chosen backdrop colour into an extra light on the figure.
    path = nodes.new('ShaderNodeLightPath')
    camera_mix = nodes.new('ShaderNodeMixShader')
    links.new(path.outputs['Is Camera Ray'], camera_mix.inputs[0])
    links.new(bsdf.outputs[0], camera_mix.inputs[1])
    links.new(contrast.outputs[0], camera_mix.inputs[2])
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(camera_mix.outputs[0], output.inputs['Surface'])
    return material


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

    profile, half_width = _cyclorama_profile(body_height, cam_distance)

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
    # A bent knee, raised arm or focused cut must not change hair/skin scale.
    height = float(body.get("smartink_rest_height", body.dimensions.z)) or HUMAN_HEIGHT_M
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
    # The base mesh already carries the large anatomical forms. At full
    # strength this bake doubles their ridges into a carved, glossy appearance.
    normal_map.inputs["Strength"].default_value = 0.65
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
        # The light transport already darkens folds. A strong baked cavity
        # multiply double-counts that shadow and makes the skin look dirty.
        cavity_mix.inputs["Factor"].default_value = 0.25
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
    amount = _scaled(mat, convex, 0.05, "Ridge gloss", (-330, 640))

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
    _set(bsdf, "Subsurface Weight", SKIN_SSS_WEIGHT)
    _set(bsdf, "Subsurface Radius", (1.0, 0.32, 0.18))
    _set(bsdf, "Subsurface Scale", SKIN_SSS_SCALE_M * world_scale)
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

    # Real vellus hair now does the grazing-angle work; a trace of sheen stays
    # for the strands too fine to resolve.
    _set(bsdf, "Sheen Weight", 0.02)
    _set(bsdf, "Sheen Roughness", 0.25)
    _set(bsdf, "Sheen Tint", (1.0, 0.92, 0.88, 1.0))

    # Skin is never mirror-smooth and never chalk: keep it in a plausible band,
    # varying at pore scale so highlights break up instead of forming blobs.
    rough_range = _node_by_label(mat, "Roughness range")
    if rough_range is not None and rough_range.type == "MAP_RANGE":
        _set(rough_range, "To Min", 0.43)
        _set(rough_range, "To Max", 0.65)


# ---------------------------------------------------------------------------
# Micro-relief
#
# Under a lens, skin is not noise: it is a polygonal network of cells a
# millimetre or two across, each ringed by a shallow groove, with pores where
# the grooves meet and fine creases running through the lot. That network is
# what a highlight actually breaks up on. Perlin noise, which is what the
# skins.blend chain was made of, has no edges, so the highlight stays one
# smooth sheet -- which is the wax read, whatever the roughness value.
#
# Everything here is built in object space (one unit ~ one metre of skin), so
# the frequencies below are cycles per metre and read as feature sizes.
# ---------------------------------------------------------------------------

CELL_FREQ = 650.0          # ~1.5 mm cells
CELL_FINE_FREQ = 1450.0    # secondary network inside the primary cells
PORE_FREQ = 520.0          # ~2 mm pore spacing, thinned by a density mask
CREASE_FREQ = 170.0        # ~6 mm creases, deepest over joints
RELIEF_DEPTH_M = 0.00022   # shallow surface texture; anatomy stays in the sculpt bake
SKIN_SSS_WEIGHT = 0.85     # random-walk skin wants to own most of the diffuse lobe
SKIN_SSS_SCALE_M = 0.003   # restrained red transport keeps tattoos and creases legible


def _math(mat, op: str, a, b=None, clamp: bool = False, location=(0, 0)):
    node = mat.node_tree.nodes.new("ShaderNodeMath")
    node.operation = op
    node.use_clamp = clamp
    node.location = location
    for i, value in enumerate((a, b)):
        if value is None:
            continue
        if isinstance(value, (int, float)):
            node.inputs[i].default_value = float(value)
        else:
            mat.node_tree.links.new(value, node.inputs[i])
    return node.outputs["Value"]


def _map01(mat, value, from_min: float, from_max: float, location=(0, 0)):
    node = mat.node_tree.nodes.new("ShaderNodeMapRange")
    node.clamp = True
    node.location = location
    node.inputs["From Min"].default_value = from_min
    node.inputs["From Max"].default_value = from_max
    mat.node_tree.links.new(value, node.inputs["Value"])
    return node.outputs["Result"]


def _voronoi(mat, vector, scale: float, feature: str, label: str, location):
    node = mat.node_tree.nodes.new("ShaderNodeTexVoronoi")
    node.label = label
    node.feature = feature
    node.location = location
    node.inputs["Scale"].default_value = scale
    node.inputs["Randomness"].default_value = 1.0
    mat.node_tree.links.new(vector, node.inputs["Vector"])
    return node.outputs["Distance"]


def _noise(mat, vector, scale: float, detail: float, roughness: float, label: str, location, ridged: bool = False):
    node = mat.node_tree.nodes.new("ShaderNodeTexNoise")
    node.label = label
    node.location = location
    node.inputs["Scale"].default_value = scale
    node.inputs["Detail"].default_value = detail
    node.inputs["Roughness"].default_value = roughness
    if ridged and "noise_type" in node.bl_rna.properties:
        node.noise_type = "RIDGED_MULTIFRACTAL"
    mat.node_tree.links.new(vector, node.inputs["Vector"])
    return node.outputs["Fac"]


def _rebuild_micro_relief(mat: bpy.types.Material, bsdf, world_scale: float, convex, concave) -> None:
    """Replace the noise bump with a cell network, pores and joint creases."""
    bump = _node_by_label(mat, "Skin micro-relief")
    mapping = next((n for n in mat.node_tree.nodes if n.type == "MAPPING"), None)
    if bump is None or bump.type != "BUMP" or mapping is None:
        return
    links = mat.node_tree.links
    vector = mapping.outputs["Vector"]
    height_in = bump.inputs["Height"]
    old_height = height_in.links[0].from_socket if height_in.is_linked else None
    for link in list(height_in.links):
        links.remove(link)

    # Cell network: 1 on a plateau, 0 in the groove around it.
    cells = _voronoi(mat, vector, CELL_FREQ, "DISTANCE_TO_EDGE", "Skin cells", (-1000, -1000))
    plateau = _map01(mat, cells, 0.0, 0.11, (-780, -1000))
    fine_cells = _voronoi(mat, vector, CELL_FINE_FREQ, "DISTANCE_TO_EDGE", "Fine cells", (-1000, -1200))
    fine_plateau = _map01(mat, fine_cells, 0.0, 0.16, (-780, -1200))

    # Pores: a dimple at each cell centre, thinned so they come in patches.
    pores = _voronoi(mat, vector, PORE_FREQ, "F1", "Pore field", (-1000, -1400))
    outside_pore = _map01(mat, pores, 0.05, 0.17, (-780, -1400))
    pore_density = _map01(
        mat, _noise(mat, vector, 35.0, 2.0, 0.5, "Pore density", (-1000, -1600), ), 0.36, 0.64, (-780, -1600)
    )
    dimple = _math(mat, "MULTIPLY", _math(mat, "SUBTRACT", 1.0, outside_pore, location=(-560, -1400)), pore_density, location=(-380, -1400))

    # Creases: sharp ridged lines, weighted onto knuckles, knees and folds.
    crease = _map01(
        mat, _noise(mat, vector, CREASE_FREQ, 6.0, 0.62, "Creases", (-1000, -1800), ridged=True), 0.35, 0.95, (-780, -1800)
    )
    weight = 0.22
    if convex is not None:
        weight = _math(mat, "ADD", weight, _math(mat, "MULTIPLY", convex, 0.65, location=(-780, -2000)), location=(-560, -2000))
    if concave is not None:
        weight = _math(mat, "ADD", weight, _math(mat, "MULTIPLY", concave, 0.45, location=(-780, -2150)), clamp=True, location=(-380, -2000))
    crease_term = _math(mat, "MULTIPLY", crease, weight, location=(-200, -1800))

    # Compose: a plateau at 1, with each feature cut down from it.
    height = _math(mat, "SUBTRACT", 1.0, _math(mat, "MULTIPLY", _math(mat, "SUBTRACT", 1.0, plateau, location=(-560, -1000)), 0.22, location=(-380, -1000)), location=(-200, -1000))
    height = _math(mat, "SUBTRACT", height, _math(mat, "MULTIPLY", _math(mat, "SUBTRACT", 1.0, fine_plateau, location=(-560, -1200)), 0.10, location=(-380, -1200)), location=(-40, -1000))
    height = _math(mat, "SUBTRACT", height, _math(mat, "MULTIPLY", dimple, 0.55, location=(-200, -1400)), location=(120, -1000))
    height = _math(mat, "SUBTRACT", height, _math(mat, "MULTIPLY", crease_term, 0.40, location=(-40, -1800)), location=(280, -1000))
    if old_height is not None:
        # The old noise chain stays in at low weight as sub-millimetre grain.
        height = _math(mat, "ADD", height, _math(mat, "MULTIPLY", old_height, 0.15, location=(120, -1300)), location=(440, -1000))
    links.new(height, height_in)
    _set(bump, "Strength", 0.65)
    _set(bump, "Distance", RELIEF_DEPTH_M * world_scale)

    # The grooves and pores are matte; the plateaus between them carry the
    # oil. Tying roughness to the same relief is what makes a highlight
    # sparkle across skin instead of sliding over it.
    rough_socket = bsdf.inputs.get("Roughness")
    if rough_socket is not None and rough_socket.is_linked:
        source = rough_socket.links[0].from_socket
        links.remove(rough_socket.links[0])
        groove = _math(mat, "MULTIPLY", _math(mat, "SUBTRACT", 1.0, plateau, location=(-560, -800)), 0.12, location=(-380, -800))
        pore_rough = _math(mat, "MULTIPLY", dimple, 0.06, location=(-380, -700))
        rough = _math(mat, "ADD", source, groove, location=(-200, -800))
        rough = _math(mat, "ADD", rough, pore_rough, clamp=True, location=(-40, -800))
        links.new(rough, rough_socket)


def _add_oil_layer(mat: bpy.types.Material, bsdf, convex) -> None:
    """A thin, patchy sebum film as a second, sharper specular lobe.

    Skin's highlight is two lobes: a broad one from the stratum corneum and a
    tight one from the oil sitting on it. The old shader dropped the coat
    because a uniform coat is lacquer -- but the answer is a coat that varies,
    not none: the film pools on the T-zone, joints and the shins and is nearly
    absent elsewhere, and its highlight rides on the same pore relief.
    """
    mapping = next((n for n in mat.node_tree.nodes if n.type == "MAPPING"), None)
    if mapping is None or "Coat Weight" not in bsdf.inputs:
        return
    vector = mapping.outputs["Vector"]
    oil = _map01(mat, _noise(mat, vector, 14.0, 3.0, 0.55, "Sebum patches", (-1000, 1400)), 0.42, 0.74, (-780, 1400))
    weight = _math(mat, "ADD", 0.015, _math(mat, "MULTIPLY", oil, 0.06, location=(-560, 1400)), location=(-380, 1400))
    if convex is not None:
        weight = _math(mat, "ADD", weight, _math(mat, "MULTIPLY", convex, 0.035, location=(-560, 1250)), clamp=True, location=(-200, 1400))
    mat.node_tree.links.new(weight, bsdf.inputs["Coat Weight"])
    _set(bsdf, "Coat Roughness", 0.22)
    _set(bsdf, "Coat IOR", 1.45)
    _set(bsdf, "Coat Tint", (1.0, 1.0, 1.0, 1.0))
    bump = _node_by_label(mat, "Skin micro-relief")
    if bump is not None and "Coat Normal" in bsdf.inputs:
        mat.node_tree.links.new(bump.outputs["Normal"], bsdf.inputs["Coat Normal"])


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
    _tune_skin_bsdf(mat, bsdf, scale)
    _rebuild_micro_relief(mat, bsdf, scale, convex, concave)
    _apply_ridge_gloss(mat, bsdf, convex)
    _add_oil_layer(mat, bsdf, convex)


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
    cycles.transparent_max_bounces = max(8, cycles.transparent_max_bounces)
    cycles.use_adaptive_sampling = True
    # Adaptive sampling stops early where the image has already converged. The
    # previous 0.002 was far below what survives denoising and cost most of the
    # render budget resolving noise nobody sees.
    cycles.adaptive_threshold = 0.01 if quality_tier == "preview" else 0.005
    cycles.adaptive_min_samples = 32 if quality_tier != "preview" and cycles.samples >= 512 else 0
    # Fireflies from small bright area lights read as noise the denoiser then
    # smears; clamping indirect keeps the skin clean without dulling the key.
    cycles.sample_clamp_indirect = 10.0
    cycles.blur_glossy = 1.0
    cycles.caustics_reflective = False
    cycles.caustics_refractive = False
    bpy.context.scene.render.filter_size = 1.0 if cycles.samples >= 512 else 1.5
    if quality_tier != "preview":
        cycles.use_denoising = True
        # OptiX denoises on the RT cores, so on NVIDIA it is far cheaper than
        # OpenImageDenoise on the CPU. Everywhere else (Metal, HIP, CPU) OIDN
        # is both the better result and the only option.
        for denoiser in (("OPENIMAGEDENOISE", "OPTIX") if cycles.samples >= 512 else (("OPTIX",) if backend == "OPTIX" else ()) + ("OPENIMAGEDENOISE",)):
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


def build_plain_gradient(stops):
    """Camera-only background matching the viewport's 135-degree CSS gradient.

    A camera-aligned card has no effect on the studio lights or body shadows.
    Pixels interpolate in sRGB, then enter Blender in its linear working space.
    """
    scene = bpy.context.scene
    camera = scene.camera
    aspect = scene.render.resolution_x / max(1, scene.render.resolution_y)
    size = 256
    colors = [tuple(int(c[i:i + 2], 16) / 255.0 for i in (1, 3, 5)) for c in stops]
    pixels = []
    for y in range(size):
        for x in range(size):
            t = (x / (size - 1) * aspect + 1 - y / (size - 1)) / (aspect + 1)
            position = min(len(colors) - 1, max(0, t * (len(colors) - 1)))
            index = min(len(colors) - 2, int(position))
            fraction = position - index
            pixels.extend([srgb_to_linear(a + (b - a) * fraction) for a, b in zip(colors[index], colors[index + 1])] + [1.0])
    image = bpy.data.images.new('Viewport gradient', width=size, height=size, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(pixels)
    image.pack()
    frame = camera.data.view_frame(scene=scene)
    distance = camera.data.clip_end * 0.8
    half_width = max(abs(v.x / v.z) for v in frame) * distance
    half_height = max(abs(v.y / v.z) for v in frame) * distance
    mesh = bpy.data.meshes.new('Viewport gradient card')
    mesh.from_pydata([(-half_width, -half_height, -distance), (half_width, -half_height, -distance),
                     (half_width, half_height, -distance), (-half_width, half_height, -distance)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new(name='UVMap')
    for loop, coord in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop.uv = coord
    card = bpy.data.objects.new('Viewport gradient background', mesh)
    scene.collection.objects.link(card)
    card.matrix_world = camera.matrix_world.copy()
    for visibility in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(card, visibility, False)
    material = bpy.data.materials.new('Viewport gradient emission')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.extension = 'EXTEND'
    emission = nodes.new('ShaderNodeEmission')
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(texture.outputs['Color'], emission.inputs['Color'])
    links.new(emission.outputs[0], output.inputs['Surface'])
    mesh.materials.append(material)
    return card


def apply_world(
    look_id: str,
    lights_override: Optional[List[Dict[str, Any]]] = None,
    intensity_scale: Optional[float] = None,
    preset_name: Optional[str] = None,
    cinematic: bool = False,
    studio=None,
    body=None,
    body_region=None,
) -> None:
    world_def = LOOK_WORLDS.get(look_id, LOOK_WORLDS['studio_softbox'])
    preset = preset_name or world_def.get('lighting', 'studio')
    scale = intensity_scale if intensity_scale is not None else THREE_INTENSITY_SCALE.get(preset, 1.0)
    world = bpy.context.scene.world or bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputWorld')
    if studio is None and lights_override is None:
        # Contracts predating the studio and explicit light list retain their
        # original look. An explicit empty list must never enter this branch.
        background = nodes.new('ShaderNodeBackground')
        background.inputs['Color'].default_value = (*hex_to_rgb(world_def['bg']), 1)
        background.inputs['Strength'].default_value = 1
        links.new(background.outputs[0], output.inputs['Surface'])
        if cinematic:
            build_cinematic_rig(look_id, scale)
        else:
            setup_lights(preset, scale)
        return

    rig = CINEMATIC_RIGS.get(look_id, CINEMATIC_RIGS['studio_softbox'])
    color = hex_to_rgb(studio['color']) if studio else (rig['bg'] if cinematic else hex_to_rgb(world_def['bg']))
    visible = nodes.new('ShaderNodeBackground')
    visible.name = 'Studio visible background'
    visible.inputs['Color'].default_value = (*color, 1)
    visible.inputs['Strength'].default_value = 1
    ambient = nodes.new('ShaderNodeBackground')
    ambient.name = 'Studio ambient lighting'
    ambient.inputs['Color'].default_value = (0, 0, 0, 1)
    ambient.inputs['Strength'].default_value = 1
    path = nodes.new('ShaderNodeLightPath')
    mix = nodes.new('ShaderNodeMixShader')
    links.new(path.outputs['Is Camera Ray'], mix.inputs[0])
    links.new(ambient.outputs[0], mix.inputs[1])
    links.new(visible.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs['Surface'])

    if lights_override is not None:
        setup_lights_from_list(lights_override, scale, physical=True)
    elif cinematic:
        build_cinematic_rig(look_id, scale, backdrop=False, configure_world=False)
    else:
        setup_lights_from_list(LIGHTING_PRESETS.get(preset, LIGHTING_PRESETS['studio']), scale, physical=True)

    if studio is not None:
        if studio['mode'] != 'sweep' or body_region:
            return
        low, high = _studio_body_bounds(body) if body is not None else (-2.1, 2.1)
        floor_z = low - 0.02
        camera = bpy.context.scene.camera
        if camera is not None and camera.location.z <= floor_z:
            return  # looking up from below must not hide the subject
        material = _studio_backdrop_material(color, studio['shadow'])
        sweep = build_cyclorama(_camera_azimuth(), floor_z, max(0.001, high - low), material)
        sweep['studioFloor'] = floor_z
        sweep['studioShadow'] = studio['shadow']
    elif cinematic:
        # Keep the legacy backdrop while finally respecting a supplied rig.
        material = bpy.data.materials.new('cine_backdrop')
        material.use_nodes = True
        material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rig['backdrop'], 1)
        material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.62
        build_cyclorama(_camera_azimuth(), -2.12, 4.2, material)


def _ambient_add_to_world(rel_intensity: float, color_hex: str, intensity_scale: float = 1.0) -> None:
    rgb = hex_to_rgb(color_hex)
    amount = rel_intensity * intensity_scale * BLENDER_BASE_ENERGY['ambient']
    world = bpy.context.scene.world
    if not world or not world.use_nodes or not world.node_tree:
        return
    ambient = world.node_tree.nodes.get('Studio ambient lighting')
    if ambient is not None:
        current = ambient.inputs['Color'].default_value
        ambient.inputs['Color'].default_value = (*(current[i] + rgb[i] * amount for i in range(3)), 1)
        return
    for node in world.node_tree.nodes:
        if node.type == 'BACKGROUND':
            current = node.inputs['Color'].default_value
            mix = min(1.0, amount * 0.35)
            node.inputs['Color'].default_value = (*(current[i] * (1 - mix) + rgb[i] * mix for i in range(3)), 1)
            node.inputs['Strength'].default_value += amount
            return


def setup_lights(preset_name: str, intensity_scale: float = 1.0) -> None:
    setup_lights_from_list(
        LIGHTING_PRESETS.get(preset_name, LIGHTING_PRESETS["studio"]),
        intensity_scale,
    )


def _studio_light_parameters(light, intensity_scale=1.0):
    kind = light['type']
    position, target = light.get('position', [0, 0, 0]), light.get('target', [0, 0, 0])
    distance2 = sum((position[i] - target[i]) ** 2 for i in range(3))
    if kind in ('directional', 'spot') and distance2 < 1e-8:
        target = [position[0], position[1] - 1, position[2]]
        distance2 = 1
    distance2 = max(0.25, distance2)
    softness = light.get('softness')
    size = light.get('blenderAreaSize')
    if softness is None:
        softness = max(0.0, min(1.0, ((size[0] + size[1]) / 2 - 0.25) / 3.75)) if size else 0.45
    if size is None:
        diameter = 0.25 + 3.75 * softness
        size = [diameter, diameter]
    area = kind in ('directional', 'area')
    energy = light.get('intensity', 0.5) * intensity_scale * distance2 * math.pi ** 2 * (1 if area else 4)
    return {'type': 'AREA' if area else 'SPOT' if kind == 'spot' else 'POINT', 'energy': energy,
            'target': target,
            'width': size[0], 'height': size[1], 'radius': 0 if softness == 0 else (0.25 + 3.75 * softness) / 2,
            'spotSize': 2 * max(0.01, min(math.pi / 2, light.get('angle', math.pi / 6))), 'spotBlend': light.get('penumbra', 0.5)}


def _setup_studio_light(light, intensity_scale):
    if light['type'] == 'ambient':
        _ambient_add_to_world(light.get('intensity', 0.5), light.get('color', '#ffffff'), intensity_scale)
        return
    parameters = _studio_light_parameters(light, intensity_scale)
    name = light.get('name') or ('Studio ' + light['type'])
    data = bpy.data.lights.new(name, parameters['type'])
    data.energy = parameters['energy']
    data.color = hex_to_rgb(light.get('color', '#ffffff'))
    data.use_shadow = light.get('castShadow', False)
    if parameters['type'] == 'AREA':
        data.shape = 'RECTANGLE'
        data.size, data.size_y = parameters['width'], parameters['height']
    else:
        data.shadow_soft_size = parameters['radius']
        if parameters['type'] == 'SPOT':
            data.spot_size = min(math.pi, parameters['spotSize'])
            data.spot_blend = parameters['spotBlend']
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = three_to_blender_position(light.get('position', [0, 0, 0]))
    direction = three_to_blender_position(parameters['target']) - obj.location
    if direction.length <= 0.001:
        direction = three_to_blender_position([0, 0, -1])
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return obj


def setup_lights_from_list(lights: List[Dict[str, Any]], intensity_scale: float = 1.0, physical: bool = False) -> None:
    source_count = 0
    for light in lights:
        if light.get("enabled", True) is False or float(light.get("intensity", 0.5)) * intensity_scale <= 0:
            continue
        if physical:
            if light['type'] != 'ambient':
                if source_count >= 4:
                    continue
                source_count += 1
            _setup_studio_light(light, intensity_scale)
            continue
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

    # A small contribution from the actual overlying skin softens pigment.
    # A fixed pale blue-grey made black artwork unnaturally light on dark
    # skin and shifted every coloured tattoo toward the same cool tint.
    ink_shift = nodes.new(type="ShaderNodeMix")
    ink_shift.label = "Ink under epidermis"
    ink_shift.data_type = "RGBA"
    ink_shift.blend_type = "MIX"
    ink_shift.inputs["Factor"].default_value = 0.08
    if mix.inputs["A"].is_linked:
        links.new(mix.inputs["A"].links[0].from_socket, ink_shift.inputs["B"])
    else:
        ink_shift.inputs["B"].default_value = mix.inputs["A"].default_value
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
        # Mix blend modes only operate on colours. A Float Mix with B=.06
        # made opaque ink roughness .06 instead of adding .06: mirror ink.
        amount = nodes.new(type="ShaderNodeMath")
        amount.operation = "MULTIPLY"
        amount.label = "Ink roughness amount"
        amount.inputs[1].default_value = 0.06
        links.new(ink_tex.outputs["Alpha"], amount.inputs[0])
        rough_mix = nodes.new(type="ShaderNodeMath")
        rough_mix.label = "Roughness under ink"
        rough_mix.operation = "ADD"
        rough_mix.use_clamp = True
        links.remove(rough_socket.links[0])
        links.new(source, rough_mix.inputs[0])
        links.new(amount.outputs["Value"], rough_mix.inputs[1])
        links.new(rough_mix.outputs["Value"], rough_socket)


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
SNAPSHOT_FSTOP = 8.0
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
    focus_field = mesh.attributes.get('SmartInkFocus')
    matrix = body.matrix_world
    accumulator = Vector((0.0, 0.0, 0.0))
    total = 0.0
    for poly in mesh.polygons:
        if focus_field and sum(focus_field.data[i].value for i in poly.vertices) < 0:
            continue  # an invisible tattoo must not pull photographic focus
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
    visible = _focus_visible_triangles(body.data)
    if visible is not None:
        from mathutils.bvhtree import BVHTree
        vertices = [point for triangle in visible for point in triangle]
        tree = BVHTree.FromPolygons(vertices, [tuple(range(i, i + 3)) for i in range(0, len(vertices), 3)], all_triangles=True)
        location, _, _, _ = tree.ray_cast(inverse @ cam_obj.location, (inverse.to_3x3() @ direction).normalized())
        return body.matrix_world @ location if location is not None else None
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
        field = body.data.attributes.get('SmartInkFocus')
        if field:
            visible = [body.matrix_world @ vertex.co for vertex, value in zip(body.data.vertices, field.data) if value.value >= 0]
            focus = sum(visible, Vector()) / len(visible)
            print("Focusing on the selected body part.")
        else:
            # Nothing under the crosshair: fall back to the upper chest.
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
    # Blender measures the plane along the optical axis, not the radial
    # distance to an off-centre tattoo. A radial distance focuses behind it.
    view_direction = cam_obj.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0))
    dof.focus_distance = (
        float(requested_focus)
        if requested_focus
        else max(0.001, (focus - cam_obj.location).dot(view_direction.normalized()))
    )

    # Defocus blur shrinks in proportion to how far away everything is, and this
    # figure is authored ~2.4x life size. Dividing the f-stop by that factor
    # gives the depth of field a real f/2.8 lens would have on a real person,
    # instead of a background that stays stubbornly sharp.
    default_fstop = SNAPSHOT_FSTOP if cam_data.get("preserveFraming") is True else CINEMATIC_FSTOP
    fstop = float(cam_data.get("aperture") or default_fstop)
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
    appearance = _body_appearance(contract)
    studio = _studio_settings(contract)

    clear_scene()
    body = load_body_mesh(contract["bodyMeshId"], contract_dir)
    if body is None:
        raise RuntimeError(f"Could not load body mesh: {contract['bodyMeshId']}")

    # Save skin membership and pose selectors before either deformation.
    up, front = _body_axes(body.data, body)
    side = up.cross(front)
    original_coords = [(v.co.dot(side), v.co.dot(up), v.co.dot(front)) for v in body.data.vertices]
    original_masks = _original_body_region_masks(original_coords)
    center_body_at_origin(body)
    ensure_box_projection_uvs(body)
    apply_skin(body, contract.get("skinToneId", "tone_03"), contract_dir)
    apply_body_shape(body, contract.get("bodyShape"))
    shaped_coords = [(v.co.dot(side), v.co.dot(up), v.co.dot(front)) for v in body.data.vertices]
    center_body_at_origin(body)
    body["smartink_rest_height"] = float(body.dimensions.z)
    style = contract.get("renderStyle", "cinematic")
    cinematic = style != "preview"
    if cinematic:
        mark_body_hair_regions(body)

    # Upright landmarks are measured before posing. The resulting density
    # groups stay attached to skin vertices through rotation and region cuts.
    head_visible = contract.get("bodyRegion") in (None, "head")
    landmarks = detect_head_landmarks(body) if (cinematic or contract.get("showEyes")) and head_visible else None
    head_followers = []
    eye_radius = EYE_DIAMETER_M * 0.5 * _world_scale(body)
    if landmarks:
        if contract.get("showEyes"):
            head_followers = add_eyes(body, landmarks, contract.get("eyeColor") or DEFAULT_IRIS_COLOUR)
        else:
            head_followers = add_socket_fill(body, landmarks)
        for name, weights in _hair_regions(body, landmarks, eye_radius).items():
            _vertex_group_from_weights(body, f"hair_{name}", weights)
    elif cinematic:
        print("No head in frame; skipping eyes and hair.")

    apply_pose(contract.get("poseId", "neutral"), body, contract.get("bodyPose"), original_coords, head_followers)
    before_center = body.location.copy()
    center_body_at_origin(body)
    shift = body.location - before_center
    for follower in head_followers:
        follower.location += shift
    # Posing can move the whole-figure centre. Flush that final transform
    # before separate garments and scalp meshes copy the body's matrix.
    bpy.context.view_layer.update()
    isolate_body_region(body, contract.get("bodyRegion"), original_masks)
    if appearance is not None and not contract.get("bodyRegion"):
        add_appearance_clothing(body, original_coords, shaped_coords, appearance)
    if appearance is not None and head_visible and appearance['hairStyle'] != 'none':
        add_appearance_hair(body, original_coords, appearance)
    if landmarks:
        add_hair(body, landmarks, eye_radius, appearance['hairTone'] if appearance else contract.get("hairTone") or DEFAULT_HAIR_TONE,
                 prepared_regions=True, scalp_style='none' if appearance is not None else None)
    if cinematic:
        add_body_hair(
            body,
            contract.get("bodyHair") or BODY_HAIR_DEFAULTS.get(contract["bodyMeshId"], DEFAULT_BODY_HAIR),
            appearance['hairTone'] if appearance else contract.get("hairTone") or DEFAULT_HAIR_TONE,
        )

    # The camera comes first now: the cinematic rig and the backdrop are placed
    # relative to it, so the key light follows wherever the user orbited to.
    camera_cfg = contract.get("camera", {})
    cam_obj = setup_camera(camera_cfg)
    if cinematic and camera_cfg.get("preserveFraming") is not True:
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
        studio=studio,
        body=body,
        body_region=contract.get("bodyRegion"),
    )
    if cinematic:
        enhance_skin_realism(body, contract["bodyMeshId"], contract_dir)
        enhance_appearance_materials(body)
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
    output_path = setup_output(contract.get("output", {}), contract_dir)
    if studio and studio['mode'] == 'plain' and studio.get('gradient'):
        build_plain_gradient(studio['gradient'])
    return output_path


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
            if "--progressive" in argv:
                scene = bpy.context.scene
                width, height = scene.render.resolution_x, scene.render.resolution_y
                samples = scene.cycles.samples
                scale = min(1.0, 512 / max(width, height))
                # Preserve camera, lighting, grading and aspect; only lower cost.
                scene.render.resolution_percentage = max(1, round(scale * 100))
                scene.cycles.samples = min(16, samples)
                scene.render.filepath = os.path.join(os.path.dirname(output_path), "preview.png")
                print("SMARTINK_PHASE preview", flush=True)
                bpy.ops.render.render(write_still=True)
                print("SMARTINK_PREVIEW_READY", flush=True)
                scene.render.resolution_percentage = 100
                scene.cycles.samples = samples
                scene.render.filepath = output_path
                print("SMARTINK_PHASE final", flush=True)
            print(f"Rendering to {output_path}", flush=True)
            bpy.ops.render.render(write_still=True)
            print("Render completed!")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
