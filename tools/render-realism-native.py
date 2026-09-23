"""Native snapshot camera/material checks, with reproducible before/after renders.
Blender -b -t 2 --python tools/render-realism-native.py -- --assets /path/to/smartink-live --output reports/realism/after --render
For an unmodified baseline add --importer /path/to/baseline-importer.py --baseline.
Baseline visual comparisons deliberately keep the same camera and f/8 aperture.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys
import zlib

import bpy
import numpy as np
from mathutils import Vector

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--assets', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--importer', type=Path, default=root / 'smartink-live/sceneImporter.py')
parser.add_argument('--baseline', action='store_true')
parser.add_argument('--render', action='store_true')
parser.add_argument('--cpu', action='store_true', help='Force CPU rather than the production-selected renderer')
parser.add_argument('--cases', default='male-tattoo,female-portrait,male-clothing')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
args.output.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('realism_importer', args.importer)
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)
if args.baseline:
    imp.apply_lens_compression = lambda *unused: None

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

transparent = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0))
               + chunk(b'IDAT', zlib.compress(b'\0' * 5)) + chunk(b'IEND', b''))


def tattoo_fixture(body_id, shot):
    """Bake a crisp test emblem onto the real model's chest atlas, without an old fixture."""
    imp.clear_scene()
    body = imp.load_body_mesh(body_id, str(shot))
    imp.center_body_at_origin(body)
    imp.ensure_box_projection_uvs(body)
    bpy.context.view_layer.update()
    world = np.array([tuple(body.matrix_world @ vertex.co) for vertex in body.data.vertices])
    height = float(world[:, 2].max() - world[:, 2].min())
    radius, centre = height * .068, height * .175
    size = 2048
    pixels = np.zeros((size, size, 4), dtype=np.float32)
    coverage = np.zeros((size, size), dtype=bool)
    body.data.calc_loop_triangles()
    uvs = body.data.uv_layers.active.data
    for tri in body.data.loop_triangles:
        points = world[list(tri.vertices)]
        if points[:, 1].mean() > -.03 * height or points[:, 2].max() < centre - radius or points[:, 2].min() > centre + radius:
            continue
        if points[:, 0].max() < -radius or points[:, 0].min() > radius:
            continue
        uv = np.array([tuple(uvs[i].uv) for i in tri.loops]) * size
        left, bottom = np.maximum(0, np.floor(uv.min(axis=0)).astype(int))
        right, top = np.minimum(size - 1, np.ceil(uv.max(axis=0)).astype(int))
        if right < left or top < bottom:
            continue
        y, x = np.mgrid[bottom:top + 1, left:right + 1]
        denominator = (uv[1, 1] - uv[2, 1]) * (uv[0, 0] - uv[2, 0]) + (uv[2, 0] - uv[1, 0]) * (uv[0, 1] - uv[2, 1])
        if abs(denominator) < 1e-8:
            continue
        a = ((uv[1, 1] - uv[2, 1]) * (x + .5 - uv[2, 0]) + (uv[2, 0] - uv[1, 0]) * (y + .5 - uv[2, 1])) / denominator
        b = ((uv[2, 1] - uv[0, 1]) * (x + .5 - uv[2, 0]) + (uv[0, 0] - uv[2, 0]) * (y + .5 - uv[2, 1])) / denominator
        c = 1 - a - b
        px = (a * points[0, 0] + b * points[1, 0] + c * points[2, 0]) / radius
        pz = (a * points[0, 2] + b * points[1, 2] + c * points[2, 2] - centre) / radius
        distance = np.sqrt(px * px + pz * pz)
        graphic = ((abs(distance - .89) < .035) | (abs(distance - .68) < .02)
                   | ((abs(px) < .022) & (abs(pz) < .5))
                   | ((abs(abs(px) + abs(pz) - .48) < .035)))
        inside = (a >= 0) & (b >= 0) & (c >= 0)
        coverage[bottom:top + 1, left:right + 1] |= inside
        mask = inside & graphic
        area = pixels[bottom:top + 1, left:right + 1]
        area[mask] = (.005, .006, .009, 1)
    assert np.count_nonzero(pixels[:, :, 3]) > 300, 'Chest tattoo fixture missed the atlas'
    # Match export's atlas padding so filtering across UV-island borders
    # cannot introduce a white seam into this diagnostic fixture.
    alpha = pixels[:, :, 3]
    for unused in range(3):
        pad = np.pad(alpha, 1)
        expanded = np.maximum.reduce([pad[y:y + size, x:x + size] for y in range(3) for x in range(3)])
        alpha = np.where(coverage, pixels[:, :, 3], expanded)
    pixels[alpha > 0] = (.005, .006, .009, 1)
    image = bpy.data.images.new('Test chest emblem', size, size, alpha=True)
    image.pixels.foreach_set(pixels.reshape(-1))
    image.filepath_raw = str(shot / 'ink.png')
    image.file_format = 'PNG'
    image.save()
    bpy.data.images.remove(image)

cases = {
    'male-tattoo': {'body': 'body_full', 'position': [0, 1.15, 2.3], 'target': [0, .95, 0], 'fov': 52, 'ink': True,
                    'appearance': {'bottom': 'trousers', 'hairStyle': 'short'}},
    'female-portrait': {'body': 'body_full_female', 'position': [1.2, 1.7, 3], 'target': [0, 1.45, 0], 'fov': 28,
                        'appearance': {'top': 'tshirt', 'bottom': 'trousers', 'hairStyle': 'short'}},
    'male-clothing': {'body': 'body_full', 'position': [1.6, .6, 6.5], 'target': [0, .15, 0], 'fov': 39,
                      'appearance': {'top': 'tshirt', 'topColor': '#747d6b', 'bottom': 'trousers', 'hairStyle': 'short'}},
}
cases['male-dark-tattoo'] = {**cases['male-tattoo'], 'tone': 'tone_07', 'eyes': False}
report = []
for name in args.cases.split(','):
    case = cases[name]
    shot = args.output / name
    shot.mkdir(exist_ok=True)
    for asset in ('body_full.blend', 'body_full_female.blend', 'body_male_realistic.glb', 'body_female_realistic.glb', 'assets'):
        target = shot / asset
        if not target.exists():
            target.symlink_to((args.assets / asset).resolve())
    for texture in (args.assets.parent / 'assets/derived').glob('*.png'):
        target = shot / texture.name
        if not target.exists():
            target.symlink_to(texture.resolve())
    if case.get('ink'):
        tattoo_fixture(case['body'], shot)
    else:
        (shot / 'ink.png').write_bytes(transparent)
    camera = {'position': case['position'], 'target': case['target'], 'fov': case['fov'], 'aspect': .8,
              'preserveFraming': True, 'aperture': 8}
    contract = {'schemaVersion': 1, 'bodyMeshId': case['body'], 'skinToneId': case.get('tone', 'tone_03'), 'poseId': 'neutral',
                'bodyAppearance': case['appearance'], 'bodyHair': 'none', 'showEyes': case.get('eyes', True), 'eyeColor': '#526554',
                'lookId': 'studio_softbox', 'renderStyle': 'cinematic', 'inkTextureUrl': 'ink.png',
                'camera': camera, 'studio': {'mode': 'sweep', 'color': '#b8afa4', 'shadow': .6, 'showGuides': False},
                'lighting': {'intensityScale': 1, 'lights': [
                    {'type': 'directional', 'name': 'Key', 'position': [-3, 4, 5], 'target': [0, .8, 0], 'intensity': .9, 'color': '#fff5e8', 'softness': .65, 'castShadow': True},
                    {'type': 'directional', 'name': 'Fill', 'position': [4, 2, 2], 'target': [0, .6, 0], 'intensity': .23, 'color': '#e9f2ff', 'softness': 1, 'castShadow': False},
                    {'type': 'ambient', 'position': [0, 0, 0], 'intensity': .04, 'color': '#ffffff'},
                ]}, 'output': {'qualityTier': 'final', 'width': 512, 'height': 640, 'samples': 64}}
    path = shot / 'contract.json'
    path.write_text(json.dumps(contract))
    output = imp.build_scene(str(path))
    scene, body, cam = bpy.context.scene, bpy.data.objects['Body'], bpy.context.scene.camera
    assert (cam.location - imp.three_to_blender_position(camera['position'])).length < 1e-6, 'Snapshot moved the camera'
    expected_lens = imp.fov_degrees_to_focal_length_mm(camera['fov'])
    assert abs(cam.data.lens - expected_lens) < 1e-5, 'Snapshot changed vertical FOV'
    assert abs(cam.data.dof.aperture_fstop - 8 / imp._world_scale(body)) < 1e-5
    assert scene.cycles.use_denoising and scene.cycles.samples == 64
    assert len([obj for obj in scene.objects if obj.type == 'LIGHT']) == 2, 'Chosen light rig replaced'
    mat = body.data.materials[0]
    assert mat.name.startswith(imp.SKIN_SHADERS[contract['skinToneId']]), 'Requested skin swatch fell back to a different material'
    assert imp._node_by_label(mat, 'Sculpt normal bake'), 'Actual sculpt normal bake missing'
    assert imp._node_by_label(mat, 'Sculpt normal bake').image.colorspace_settings.name == 'Non-Color'
    assert body.data.uv_layers.active and bpy.data.objects.get('cyclorama')
    if not args.baseline:
        bsdf = next(node for node in mat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        assert abs(bsdf.inputs['Subsurface Scale'].default_value - imp.SKIN_SSS_SCALE_M * imp._world_scale(body)) < 1e-7
        assert abs(imp._node_by_label(mat, 'Sculpt normal').inputs['Strength'].default_value - .65) < 1e-6
        ink_response = imp._node_by_label(mat, 'Ink under epidermis')
        assert abs(ink_response.inputs['Factor'].default_value - .08) < 1e-6
        assert ink_response.inputs['B'].is_linked, 'Ink was tinted with a fixed colour rather than actual skin'
        roughness = imp._node_by_label(mat, 'Roughness under ink')
        assert roughness.type == 'MATH' and roughness.operation == 'ADD' and roughness.use_clamp
        increment = roughness.inputs[1].links[0].from_node
        assert increment.operation == 'MULTIPLY' and abs(increment.inputs[1].default_value - .06) < 1e-6
        assert increment.inputs[0].links[0].from_socket.name == 'Alpha'
        for obj in scene.objects:
            if obj.type == 'MESH' and obj.name.startswith('Appearance ') and obj.name != 'Appearance hair':
                assert imp._node_by_label(obj.data.materials[0], 'Fabric micro-relief')
    if case.get('ink'):
        assert imp._node_by_label(mat, 'InkLayer').image.size[0] == 2048
        assert imp._node_by_label(mat, 'Subsurface under ink').inputs['Factor'].is_linked
    entry = {'case': name, 'camera': list(cam.location), 'lens': cam.data.lens, 'dof': cam.data.dof.aperture_fstop,
             'skinNodes': len(mat.node_tree.nodes), 'lights': 2, 'render': output}
    if args.render:
        if args.cpu:
            scene.cycles.device = 'CPU'
        bpy.ops.render.render(write_still=True)
    report.append(entry)
    print('REALISM_NATIVE_CASE', entry)
if not args.baseline:
    # Exercise the default independently of the explicit f/8 comparison shots.
    cam = bpy.context.scene.camera
    body = bpy.data.objects['Body']
    bpy.context.view_layer.update()
    direction = cam.matrix_world.to_3x3() @ Vector((0, 0, -1))
    across = cam.matrix_world.to_3x3() @ Vector((1, 0, 0))
    imp._ink_focus_point = lambda *unused: cam.location + direction * 3 + across
    imp._is_in_frame = lambda *unused: True
    imp.apply_camera_realism(cam, body, str(shot / 'ink.png'), {'preserveFraming': True})
    assert abs(cam.data.dof.focus_distance - 3) < 1e-5, 'Off-axis tattoo focused behind its plane'
    assert abs(cam.data.dof.aperture_fstop - 8 / imp._world_scale(body)) < 1e-5
    imp.apply_camera_realism(cam, body, str(shot / 'ink.png'), {'preserveFraming': False})
    assert abs(cam.data.dof.aperture_fstop - 2.8 / imp._world_scale(body)) < 1e-5, 'Legacy aperture changed'
    old_location, old_lens = cam.location.copy(), cam.data.lens
    target = imp.three_to_blender_position(camera['target'])
    imp.apply_lens_compression(cam, target, 85)
    assert cam.data.lens == 85 and (cam.location - target).length > (old_location - target).length
report_path = args.output / 'report.json'
previous = json.loads(report_path.read_text()) if report_path.exists() else []
merged = {entry['case']: entry for entry in previous}
merged.update({entry['case']: entry for entry in report})
report_path.write_text(json.dumps(list(merged.values()), indent=2))
print('REALISM_NATIVE_PASS', len(report))
