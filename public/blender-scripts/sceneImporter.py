#!/usr/bin/env python3
"""
Blender Scene Importer for Smart Ink / Three.js scene exports.
Supports tattoo format: bodyMesh, decals, camera (position+target), lighting.

Coordinate systems: Three.js is Y-up, right-handed. Blender is Z-up.
We convert position (x,y,z) -> (x, -z, y) and apply -90° X rotation for orientations.

Usage:
  blender --background --python sceneImporter.py -- /path/to/scene-export.json

Place scene-export.json, decal.png (if any), and your body mesh (e.g. FinalBaseMesh.obj
or monk.glb) in the same folder, or set bodyMeshPath in the JSON to an absolute path.
"""

import bpy
import json
import math
import os
import sys
from mathutils import Vector, Euler, Matrix
from typing import Dict, Any, List, Tuple, Optional

# ---------------------------------------------------------------------------
# Coordinate conversion: Three.js (Y-up) -> Blender (Z-up)
# ---------------------------------------------------------------------------

def three_to_blender_position(pos: Any) -> Vector:
    """Convert position from Three.js (x, y, z) Y-up to Blender (x, -z, y) Z-up."""
    if isinstance(pos, dict):
        x, y, z = pos.get('x', 0), pos.get('y', 0), pos.get('z', 0)
    else:
        x, y, z = pos[0], pos[1], pos[2]
    return Vector((x, -z, y))


def three_to_blender_rotation_euler(rot: Dict[str, Any], order: str = 'XYZ') -> Euler:
    """Convert rotation from Three.js Euler (radians, Y-up) to Blender Euler (Z-up)."""
    if isinstance(rot, dict):
        rx = rot.get('x', 0)
        ry = rot.get('y', 0)
        rz = rot.get('z', 0)
    else:
        rx, ry, rz = rot[0], rot[1], rot[2]
    e = Euler((rx, ry, rz), order)
    mat = e.to_matrix().to_4x4()
    conv = Matrix.Rotation(-math.pi / 2, 4, 'X')
    mat_blender = conv @ mat
    return mat_blender.to_euler('XYZ')


def fov_degrees_to_focal_length_mm(fov_degrees: float, sensor_height_mm: float = 24.0) -> float:
    """Convert vertical FOV (degrees) to Blender focal length (mm)."""
    fov_rad = math.radians(fov_degrees)
    return sensor_height_mm / (2.0 * math.tan(fov_rad / 2.0))


def hex_to_rgb(hex_str: str) -> Tuple[float, float, float]:
    """Convert hex color '#rrggbb' to (r, g, b) 0-1."""
    hex_str = hex_str.lstrip('#')
    if len(hex_str) == 6:
        return (
            int(hex_str[0:2], 16) / 255.0,
            int(hex_str[2:4], 16) / 255.0,
            int(hex_str[4:6], 16) / 255.0,
        )
    return (1.0, 1.0, 1.0)


def is_tattoo_format(data: Dict[str, Any]) -> bool:
    """Detect tattoo pipeline format (bodyMesh + decals + camera with target)."""
    return (
        data.get('bodyMesh') is not None
        and 'decals' in data
        and 'camera' in data
        and 'lighting' in data
        and 'renderSettings' in data
    )


# Cycles energy from relative intensity (key light = 1.0)
BLENDER_BASE_ENERGY = {
    'directional': 400,
    'spot': 800,
    'point': 300,
    'ambient': 0.3,
}

DEFAULT_AREA_SIZE = (2.0, 2.0)


# ---------------------------------------------------------------------------
# Tattoo pipeline
# ---------------------------------------------------------------------------

def run_tattoo_import(
    scene_data: Dict[str, Any],
    json_file_path: Optional[str] = None,
    preview: bool = False,
) -> None:
    """Load tattoo-format JSON: body mesh, decals (shrinkwrap), camera, lights, then render."""
    clear_scene()
    json_dir = os.path.dirname(os.path.abspath(json_file_path)) if json_file_path else None
    body = load_body_mesh_tattoo(scene_data, json_dir)
    if body is None:
        print("ERROR: Could not load body mesh")
        return
    setup_skin_material(body)
    for decal in scene_data.get('decals', []):
        apply_tattoo_decal(body, decal, json_dir)
    setup_camera_tattoo(scene_data.get('camera', {}))
    setup_background(scene_data.get('background') or {})
    setup_lights_tattoo(scene_data.get('lighting', {}))
    setup_render_tattoo(scene_data.get('renderSettings', {}), scene_data.get('camera', {}), preview=preview)
    output_path = (scene_data.get('renderSettings') or {}).get('outputPath', '/tmp/render_output.png')
    ensure_output_dir(output_path)
    bpy.context.scene.render.filepath = output_path
    bpy.context.scene.render.image_settings.file_format = 'PNG'
    print(f"Rendering to {output_path}")
    bpy.ops.render.render(write_still=True)
    print("Render completed!")


def clear_scene() -> None:
    """Remove all objects and reset to empty scene."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if not bpy.context.scene.world:
        bpy.context.scene.world = bpy.data.worlds.new("World")


def _find_body_mesh_path(body_mesh_id: str, body_mesh_path: Optional[str], json_dir: Optional[str]) -> Optional[str]:
    """Resolve path to body mesh: explicit path, or same dir as JSON, or script-relative."""
    if body_mesh_path and os.path.isabs(body_mesh_path) and os.path.exists(body_mesh_path):
        return body_mesh_path
    if body_mesh_path and json_dir:
        candidate = os.path.join(json_dir, os.path.basename(body_mesh_path))
        if os.path.exists(candidate):
            return candidate
    if json_dir:
        for ext in ('.glb', '.gltf', '.obj'):
            candidate = os.path.join(json_dir, body_mesh_id + ext)
            if os.path.exists(candidate):
                return candidate
        if body_mesh_id.lower() == 'monk':
            for name in ('monk.glb', 'Monk.glb'):
                candidate = os.path.join(json_dir, name)
                if os.path.exists(candidate):
                    return candidate
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parent = os.path.join(script_dir, '..')
    for ext in ('.glb', '.gltf', '.obj'):
        candidate = os.path.join(parent, body_mesh_id + ext)
        if os.path.exists(candidate):
            return candidate
    return None


def load_body_mesh_tattoo(scene_data: Dict[str, Any], json_dir: Optional[str] = None):
    """Load body mesh from bodyMeshPath, or from same dir as JSON, or script-relative."""
    body_mesh_id = scene_data.get('bodyMesh', '')
    body_mesh_path = scene_data.get('bodyMeshPath')
    path = _find_body_mesh_path(body_mesh_id, body_mesh_path, json_dir)
    if not path:
        print(f"Body mesh not found for '{body_mesh_id}'. Using fallback cube.")
        bpy.ops.mesh.primitive_cube_add(size=(1, 1, 1), location=(0, 0, 0.5))
        return bpy.context.active_object
    file_ext = os.path.splitext(path)[1].lower()
    if file_ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    elif file_ext == '.obj':
        bpy.ops.import_scene.obj(filepath=path)
    else:
        print(f"Unsupported body mesh format: {file_ext}")
        return None
    obj = bpy.context.selected_objects[0] if bpy.context.selected_objects else None
    if obj:
        obj.name = "Body"
    return obj


def setup_skin_material(body: bpy.types.Object) -> None:
    """Apply PBR skin shader with subsurface scattering to body."""
    mat = bpy.data.materials.new(name="Skin")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
    output = nodes.new(type='ShaderNodeOutputMaterial')
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (0.8, 0.6, 0.5, 1.0)
    bsdf.inputs['Subsurface Weight'].default_value = 0.3
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.2, 0.1)
    bsdf.inputs['Roughness'].default_value = 0.4
    bsdf.inputs['Metallic'].default_value = 0.0
    if body.data.materials:
        body.data.materials[0] = mat
    else:
        body.data.materials.append(mat)


def _resolve_decal_image_path(image_url: str, json_dir: Optional[str]) -> Optional[str]:
    """Resolve decal image: local path, or same dir as JSON."""
    if not image_url:
        return None
    if image_url.startswith('data:'):
        return None
    if os.path.isabs(image_url) and os.path.exists(image_url):
        return image_url
    if json_dir:
        candidate = os.path.join(json_dir, os.path.basename(image_url))
        if os.path.exists(candidate):
            return candidate
        if os.path.exists(os.path.join(json_dir, image_url)):
            return os.path.join(json_dir, image_url)
    if os.path.exists(image_url):
        return os.path.abspath(image_url)
    return None


def apply_tattoo_decal(body: bpy.types.Object, decal_data: Dict[str, Any], json_dir: Optional[str] = None) -> None:
    """Project tattoo onto body: plane with texture + shrinkwrap onto mesh."""
    pos = decal_data.get('position', [0, 0, 0])
    rot = decal_data.get('rotation', [0, 0, 0])
    scale = decal_data.get('scale', [0.3, 0.4])
    opacity = decal_data.get('opacity', 0.95)
    image_url = decal_data.get('imageUrl', '')
    image_path = _resolve_decal_image_path(image_url, json_dir)
    if not image_path:
        print(f"Decal image not found: {image_url}. Skipping decal.")
        return
    loc = three_to_blender_position(pos)
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.active_object
    plane.location = loc
    plane.rotation_euler = three_to_blender_rotation_euler(
        {'x': rot[0], 'y': rot[1], 'z': rot[2]}
    )
    plane.scale = (scale[0], scale[1], 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    mat = bpy.data.materials.new(name="TattooMat")
    mat.use_nodes = True
    mat.blend_method = 'BLEND'
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    tex = nodes.new(type='ShaderNodeTexImage')
    try:
        tex.image = bpy.data.images.load(os.path.abspath(image_path))
    except Exception as e:
        print(f"Could not load decal image: {e}")
        bpy.data.materials.remove(mat)
        bpy.data.objects.remove(plane)
        return
    bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
    output = nodes.new(type='ShaderNodeOutputMaterial')
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    bsdf.inputs['Alpha'].default_value = opacity
    plane.data.materials.append(mat)
    sw = plane.modifiers.new(name="Shrinkwrap", type='SHRINKWRAP')
    sw.target = body
    sw.wrap_method = 'PROJECT'
    sw.use_project_z = True
    sw.offset = 0.001


def setup_camera_tattoo(cam_data: Dict[str, Any]) -> None:
    """Create camera with position and look-at target (Three.js convention)."""
    pos = cam_data.get('position', [0, 1.5, 2.5])
    target = cam_data.get('target', [0, 1.4, 0])
    fov_deg = cam_data.get('fov', 40)
    aspect = float(cam_data.get('aspectRatio', 1.0))
    bpy.ops.object.camera_add()
    cam_obj = bpy.context.active_object
    cam_obj.location = three_to_blender_position(pos)
    cam = cam_obj.data
    cam.type = 'PERSP'
    cam.lens = fov_degrees_to_focal_length_mm(fov_deg)
    if aspect >= 1.0:
        cam.sensor_fit = 'HORIZONTAL'
    else:
        cam.sensor_fit = 'VERTICAL'
    target_empty = bpy.data.objects.new("CamTarget", None)
    bpy.context.collection.objects.link(target_empty)
    target_empty.location = three_to_blender_position(target)
    constraint = cam_obj.constraints.new(type='TRACK_TO')
    constraint.target = target_empty
    constraint.track_axis = 'TRACK_NEGATIVE_Z'
    constraint.up_axis = 'UP_Y'
    bpy.context.scene.camera = cam_obj


def setup_background(bg_data: Dict[str, Any]) -> None:
    """Set up Blender World shader from exported background data."""
    if not bg_data:
        return

    world = bpy.context.scene.world
    if not world:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()

    output = nodes.new(type='ShaderNodeOutputWorld')
    output.location = (400, 0)

    bg_type = bg_data.get('type', 'solid')

    if bg_type == 'solid':
        bg = nodes.new(type='ShaderNodeBackground')
        bg.location = (200, 0)
        color = hex_to_rgb(bg_data.get('color', '#ffffff'))
        bg.inputs['Color'].default_value = (*color, 1.0)
        bg.inputs['Strength'].default_value = 1.0
        links.new(bg.outputs['Background'], output.inputs['Surface'])

    elif bg_type == 'gradient':
        stops_raw = bg_data.get('gradientStops', [])
        if not stops_raw:
            return
        stops = sorted(stops_raw, key=lambda s: float(s.get('position', 0)))

        tex_coord = nodes.new(type='ShaderNodeTexCoord')
        tex_coord.location = (-400, 0)

        separate = nodes.new(type='ShaderNodeSeparateXYZ')
        separate.location = (-200, 0)
        links.new(tex_coord.outputs['Generated'], separate.inputs['Vector'])

        ramp = nodes.new(type='ShaderNodeValToRGB')
        ramp.location = (0, 0)
        links.new(separate.outputs['Z'], ramp.inputs['Fac'])

        color_ramp = ramp.color_ramp
        while len(color_ramp.elements) > 2:
            color_ramp.elements.remove(color_ramp.elements[-1])

        if len(stops) == 2:
            for i, stop in enumerate(stops):
                rgb = hex_to_rgb(stop.get('color', '#ffffff'))
                pos = float(stop.get('position', 0))
                color_ramp.elements[i].position = pos
                color_ramp.elements[i].color = (*rgb, 1.0)
        else:
            rgb0 = hex_to_rgb(stops[0].get('color', '#ffffff'))
            pos0 = float(stops[0].get('position', 0))
            color_ramp.elements[0].position = pos0
            color_ramp.elements[0].color = (*rgb0, 1.0)
            rgb_last = hex_to_rgb(stops[-1].get('color', '#ffffff'))
            pos_last = float(stops[-1].get('position', 1))
            color_ramp.elements[1].position = pos_last
            color_ramp.elements[1].color = (*rgb_last, 1.0)
            for stop in stops[1:-1]:
                rgb = hex_to_rgb(stop.get('color', '#ffffff'))
                pos = float(stop.get('position', 0))
                elem = color_ramp.elements.new(pos)
                elem.color = (*rgb, 1.0)

        bg = nodes.new(type='ShaderNodeBackground')
        bg.location = (200, 0)
        bg.inputs['Strength'].default_value = 1.0
        links.new(ramp.outputs['Color'], bg.inputs['Color'])
        links.new(bg.outputs['Background'], output.inputs['Surface'])


def _ambient_add_to_world(rel_intensity: float, color_hex: str) -> None:
    """Merge ambient into existing world Background, or create minimal world."""
    rgb = hex_to_rgb(color_hex)
    add = rel_intensity * BLENDER_BASE_ENERGY['ambient']
    world = bpy.context.scene.world
    if world and world.use_nodes and world.node_tree:
        for node in world.node_tree.nodes:
            if node.type == 'BACKGROUND':
                node.inputs['Strength'].default_value += add
                return
    if not world:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    bg = nodes.new(type='ShaderNodeBackground')
    output = nodes.new(type='ShaderNodeOutputWorld')
    bg.inputs['Color'].default_value = (*rgb, 1.0)
    bg.inputs['Strength'].default_value = add
    links.new(bg.outputs['Background'], output.inputs['Surface'])


def setup_lights_tattoo(light_data: Dict[str, Any]) -> None:
    """Create lights from exported scene data with cinematic Cycles upgrades."""
    lights = light_data.get('lights', [])

    for light in lights:
        ltype = light.get('type', 'point')
        pos = light.get('position', [0, 0, 0])
        rel_intensity = float(light.get('intensity', 0.5))
        color_hex = light.get('color', '#ffffff')
        rgb = hex_to_rgb(color_hex)
        cast_shadow = light.get('castShadow', True)

        if ltype == 'ambient':
            _ambient_add_to_world(rel_intensity, color_hex)
            continue

        if ltype == 'directional':
            bpy.ops.object.light_add(type='AREA')
            light_obj = bpy.context.active_object
            area_size = light.get('blenderAreaSize', DEFAULT_AREA_SIZE)
            light_obj.data.shape = 'RECTANGLE'
            light_obj.data.size = float(area_size[0])
            light_obj.data.size_y = float(area_size[1])
            base = BLENDER_BASE_ENERGY['directional']

        elif ltype == 'area':
            # Legacy v1.0 exports (intensity was already Cycles-style watts)
            bpy.ops.object.light_add(type='AREA')
            light_obj = bpy.context.active_object
            light_obj.data.shape = 'RECTANGLE'
            light_obj.data.size = 2.0
            light_obj.data.size_y = 2.0
            base = None

        elif ltype == 'spot':
            bpy.ops.object.light_add(type='SPOT')
            light_obj = bpy.context.active_object
            light_obj.data.spot_size = float(light.get('angle', 0.5))
            light_obj.data.spot_blend = float(light.get('penumbra', 0.5))
            base = BLENDER_BASE_ENERGY['spot']

        elif ltype == 'point':
            bpy.ops.object.light_add(type='POINT')
            light_obj = bpy.context.active_object
            light_obj.data.shadow_soft_size = 0.15
            base = BLENDER_BASE_ENERGY['point']

        else:
            bpy.ops.object.light_add(type='POINT')
            light_obj = bpy.context.active_object
            base = BLENDER_BASE_ENERGY['point']

        light_obj.location = three_to_blender_position(pos)
        if base is None:
            light_obj.data.energy = rel_intensity
        else:
            light_obj.data.energy = rel_intensity * base
        light_obj.data.color = rgb
        light_obj.data.use_shadow = cast_shadow

        target = light.get('target', [0, 1.0, 0])
        target_loc = three_to_blender_position(target)
        direction = target_loc - light_obj.location
        if direction.length > 0.001:
            rot_quat = direction.to_track_quat('-Z', 'Y')
            light_obj.rotation_euler = rot_quat.to_euler()


def setup_render_tattoo(
    settings: Dict[str, Any],
    camera_data: Optional[Dict[str, Any]] = None,
    preview: bool = False,
) -> None:
    """Apply render settings with aspect ratio from camera export."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    if preview:
        scene.cycles.samples = 24
        scene.cycles.use_denoising = True
    else:
        scene.cycles.samples = settings.get('samples', 256)
        scene.cycles.use_denoising = True

    res = settings.get('resolution', [2048, 2048])
    aspect = 1.0
    if camera_data:
        aspect = float(camera_data.get('aspectRatio', 1.0))
    if aspect <= 0:
        aspect = 1.0

    base_w, base_h = int(res[0]), int(res[1])
    if preview:
        if aspect >= 1.0:
            base_w, base_h = 512, max(1, int(512 / aspect))
        else:
            base_h = 512
            base_w = max(1, int(512 * aspect))

    if aspect >= 1.0:
        scene.render.resolution_x = base_w
        scene.render.resolution_y = max(1, int(base_w / aspect))
    else:
        scene.render.resolution_y = base_h
        scene.render.resolution_x = max(1, int(base_h * aspect))

    scene.render.resolution_percentage = 100


def ensure_output_dir(filepath: str) -> None:
    d = os.path.dirname(filepath)
    if d:
        os.makedirs(d, exist_ok=True)


def _parse_script_args() -> Tuple[str, bool]:
    """Parse args after Blender's '--' separator."""
    if '--' in sys.argv:
        argv = sys.argv[sys.argv.index('--') + 1:]
    else:
        argv = [a for a in sys.argv[1:] if not a.endswith('.py') and not a.endswith('sceneImporter.py')]
    preview = '--preview' in argv
    json_args = [a for a in argv if a != '--preview']
    if not json_args:
        raise ValueError("Missing scene export JSON path")
    return json_args[0], preview


def main():
    try:
        json_file, preview = _parse_script_args()
    except ValueError:
        print("Usage: blender --background --python sceneImporter.py -- <scene_export.json> [--preview]")
        return
    if not os.path.exists(json_file):
        print(f"Error: Scene export file not found: {json_file}")
        return
    try:
        with open(json_file, 'r') as f:
            scene_data = json.load(f)
        if is_tattoo_format(scene_data):
            mode = 'preview' if preview else 'full'
            print(f"Detected tattoo scene format. Running tattoo pipeline ({mode})...")
            run_tattoo_import(scene_data, json_file, preview=preview)
        else:
            print("This script supports only tattoo scene format (bodyMesh, decals, camera, lighting).")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
