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


# ---------------------------------------------------------------------------
# Tattoo pipeline
# ---------------------------------------------------------------------------

def run_tattoo_import(scene_data: Dict[str, Any], json_file_path: Optional[str] = None) -> None:
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
    setup_lights_tattoo(scene_data.get('lighting', {}))
    setup_render_tattoo(scene_data.get('renderSettings', {}))
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
    bpy.ops.object.camera_add()
    cam_obj = bpy.context.active_object
    cam_obj.location = three_to_blender_position(pos)
    cam = cam_obj.data
    cam.type = 'PERSP'
    cam.lens = fov_degrees_to_focal_length_mm(fov_deg)
    cam.sensor_fit = 'VERTICAL'
    target_empty = bpy.data.objects.new("CamTarget", None)
    bpy.context.collection.objects.link(target_empty)
    target_empty.location = three_to_blender_position(target)
    constraint = cam_obj.constraints.new(type='TRACK_TO')
    constraint.target = target_empty
    constraint.track_axis = 'TRACK_NEGATIVE_Z'
    constraint.up_axis = 'UP_Y'
    bpy.context.scene.camera = cam_obj


def setup_lights_tattoo(light_data: Dict[str, Any]) -> None:
    """Create lights from tattoo lighting (position array, hex color, intensity)."""
    lights = light_data.get('lights', [])
    for light in lights:
        ltype = light.get('type', 'point')
        pos = light.get('position', [0, 0, 0])
        intensity = light.get('intensity', 500)
        color_hex = light.get('color', '#ffffff')
        rgb = hex_to_rgb(color_hex)
        if ltype == 'area':
            bpy.ops.object.light_add(type='AREA')
        elif ltype == 'point':
            bpy.ops.object.light_add(type='POINT')
        elif ltype == 'spot':
            bpy.ops.object.light_add(type='SPOT')
        elif ltype == 'directional':
            bpy.ops.object.light_add(type='SUN')
        elif ltype == 'ambient':
            bpy.ops.object.light_add(type='AREA')
        else:
            bpy.ops.object.light_add(type='POINT')
        light_obj = bpy.context.active_object
        light_obj.location = three_to_blender_position(pos)
        light_obj.data.energy = intensity
        light_obj.data.color = rgb
        light_obj.data.use_shadow = light.get('castShadow', True)


def setup_render_tattoo(settings: Dict[str, Any]) -> None:
    """Apply render settings (resolution, samples, output)."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = settings.get('samples', 256)
    scene.cycles.use_denoising = True
    res = settings.get('resolution', [2048, 2048])
    scene.render.resolution_x = res[0]
    scene.render.resolution_y = res[1]
    scene.render.resolution_percentage = 100


def ensure_output_dir(filepath: str) -> None:
    d = os.path.dirname(filepath)
    if d:
        os.makedirs(d, exist_ok=True)


def main():
    if len(sys.argv) < 2:
        print("Usage: blender --background --python sceneImporter.py -- <scene_export.json>")
        return
    json_file = sys.argv[-1]
    if not os.path.exists(json_file):
        print(f"Error: Scene export file not found: {json_file}")
        return
    try:
        with open(json_file, 'r') as f:
            scene_data = json.load(f)
        if is_tattoo_format(scene_data):
            print("Detected tattoo scene format. Running tattoo pipeline...")
            run_tattoo_import(scene_data, json_file)
        else:
            print("This script supports only tattoo scene format (bodyMesh, decals, camera, lighting).")
    except Exception as e:
        print(f"Error during import: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
