"""Native Blender pose/cut/accessory checks plus optional full-figure renders.
Blender -b -t 2 --python tools/body-pose-parity-blender.py -- --assets /path/to/smartink-live --output reports/body-pose/blender --render
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import struct
import zlib

import bpy
from mathutils import Vector

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--assets', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--render', action='store_true')
parser.add_argument('--scene-checks', action='store_true', help='Also render the actual cinematic build_scene pipeline')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
args.output.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('pose_importer', root / 'smartink-live/sceneImporter.py')
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)
cases = [{'name': preset, 'preset': preset} for preset in imp.BODY_POSE_PRESETS]
cases.extend([
    {'name': 'head-turn-tilt', 'pose': {'headTurn': 30, 'headTilt': 12}},
    {'name': 'heavy-showcase', 'preset': 'arm_showcase', 'shape': {'build': 0.7, 'belly': 0.7, 'arms': 0.5}},
    {'name': 'slim-flex', 'preset': 'flex', 'shape': {'build': -0.6, 'arms': -0.7, 'height': -0.3}},
])
report = {}
for sex, body_id in [('male', 'body_full'), ('female', 'body_full_female')]:
    imp.clear_scene()
    body = imp.load_body_mesh(body_id, str(args.assets.resolve()))
    bpy.context.view_layer.update()
    mesh = body.data
    up, front = imp._body_axes(mesh, body)
    side = up.cross(front)
    base = [v.co.copy() for v in mesh.vertices]
    original = [(v.dot(side), v.dot(up), v.dot(front)) for v in base]
    region_masks = imp._original_body_region_masks(original)
    mesh.calc_loop_triangles()
    entry = {'position': [value for point in original for value in point],
             'indices': [int(i) for tri in mesh.loop_triangles for i in tri.vertices], 'cases': [], 'cuts': []}
    marker = mesh.attributes.new('_pose_test_original_index', 'INT', 'POINT')
    for i in range(len(mesh.vertices)):
        marker.data[i].value = i
    world_height = body.dimensions.z
    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new('Pose check camera')
    camera = bpy.data.objects.new('Pose check camera', camera_data)
    bpy.context.collection.objects.link(camera)
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = world_height * 1.55
    scene.camera = camera
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'SINGLE'
    scene.display.shading.single_color = (0.62, 0.67, 0.72)
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.display.shading.background_type = 'WORLD'
    scene.world.color = (0.12, 0.12, 0.12)
    max_follower_error = 0
    for case in cases:
        body.location = (0, 0, 0)
        for vertex, co in zip(mesh.vertices, base):
            vertex.co = co
        mesh.update()
        imp.apply_body_shape(body, case.get('shape'))
        imp.center_body_at_origin(body)
        body['smartink_rest_height'] = float(body.dimensions.z)
        bpy.context.view_layer.update()
        shaped = [(v.co.dot(side), v.co.dot(up), v.co.dot(front)) for v in mesh.vertices]
        pose = imp._effective_pose(case['pose']) if 'pose' in case else imp._pose_from_preset(case['preset'])
        rig = imp._pose_rig(original, shaped)
        # A tiny standalone head marker uses the same object-matrix path as eyes.
        local_marker = (rig['head'][0], rig['head'][1] + world_height / body.scale.x * 0.065, rig['head'][2] + 0.04)
        follower = bpy.data.objects.new('Head attachment check', None)
        bpy.context.collection.objects.link(follower)
        follower.location = body.matrix_world @ (side * local_marker[0] + up * local_marker[1] + front * local_marker[2])
        expected = imp._pose_rotate(local_marker, rig['head'], (0, 1, 0), pose['headTurn'] * 3.141592653589793 / 180)
        expected = imp._pose_rotate(expected, rig['head'], (0, 0, 1), -pose['headTilt'] * 3.141592653589793 / 180)
        expected_world = body.matrix_world @ (side * expected[0] + up * expected[1] + front * expected[2])
        imp.apply_pose(case.get('preset', 'custom'), body, case.get('pose'), original, [follower])
        bpy.context.view_layer.update()
        follower_error = (follower.matrix_world.translation - expected_world).length
        max_follower_error = max(max_follower_error, follower_error)
        assert follower_error < 0.000003, (sex, case['name'], 'Head attachment mismatch', follower_error)
        bpy.data.objects.remove(follower, do_unlink=True)
        posed = [(v.co.dot(side), v.co.dot(up), v.co.dot(front)) for v in mesh.vertices]
        entry['cases'].append({**case, 'position': [value for point in posed for value in point]})
        imp.center_body_at_origin(body)
        if case['name'] in ('arm_showcase', 'step', 'head-turn-tilt'):
            for region in imp.BODY_REGION_IDS:
                isolated = body.copy()
                isolated.data = body.data.copy()
                bpy.context.collection.objects.link(isolated)
                imp.isolate_body_region(isolated, region, region_masks)
                survivors = [value.value for value in isolated.data.attributes['_pose_test_original_index'].data]
                assert survivors == list(range(len(base))), (sex, case['name'], region, 'Focus changed skin topology')
                actual = [value.value for value in isolated.data.attributes['SmartInkFocus'].data]
                expected = [struct.unpack('<f', struct.pack('<f', value))[0] for value in region_masks[region]]
                assert actual == expected, (sex, case['name'], region, 'Cut changed original skin field')
                entry['cuts'].append({'pose': case['name'], 'region': region, 'vertices': len(survivors),
                                      'visibleVertices': sum(value >= 0 for value in actual)})
                isolated_mesh = isolated.data
                bpy.data.objects.remove(isolated, do_unlink=True)
                bpy.data.meshes.remove(isolated_mesh)
        if args.render:
            for view, location in [('front', Vector((0, -9, 0))), ('side', Vector((9, 0, 0)))]:
                camera.location = location
                camera.rotation_euler = (-location).to_track_quat('-Z', 'Y').to_euler()
                scene.render.filepath = str(args.output / f'{sex}-{case["name"]}-{view}.png')
                bpy.ops.render.render(write_still=True)
    entry['maxHeadAttachmentError'] = max_follower_error
    (args.output / f'{sex}-poses.json').write_text(json.dumps(entry))
    report[sex] = {'vertices': len(base), 'cases': len(cases), 'verifiedRegionCuts': len(entry['cuts']),
                   'maxHeadAttachmentError': max_follower_error}
(args.output / 'report.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if args.scene_checks:
    def png_chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    transparent_png = (b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0))
                       + png_chunk(b'IDAT', zlib.compress(b'\0' * 5)) + png_chunk(b'IEND', b''))
    for sex, body_id, region in [('male', 'body_full', None), ('female', 'body_full_female', 'head')]:
        shot = args.output / f'{sex}-pipeline'
        shot.mkdir(exist_ok=True)
        for asset in ('body_full.blend', 'body_full_female.blend', 'body_male_realistic.glb', 'body_female_realistic.glb', 'assets'):
            target = shot / asset
            if not target.exists():
                target.symlink_to((args.assets / asset).resolve())
        (shot / 'ink.png').write_bytes(transparent_png)
        for filename in ('body_male_realistic_normal.png', 'body_female_realistic_normal.png'):
            source = args.assets.parent / 'public/models' / filename
            target = shot / filename
            if source.exists() and not target.exists():
                target.symlink_to(source.resolve())
        contract = {'schemaVersion': 1, 'bodyMeshId': body_id, 'skinToneId': 'tone_03',
                    'poseId': 'arm_showcase' if region is None else 'custom',
                    'bodyPose': imp._pose_from_preset('arm_showcase') if region is None else {'headTurn': 30, 'headTilt': 12},
                    'lookId': 'studio_softbox', 'inkTextureUrl': 'ink.png', 'bodyHair': 'none', 'showEyes': True,
                    'camera': {'position': [3, 1, 8] if region is None else [0, 1.6, 5],
                               'target': [0, 0, 0] if region is None else [0, 1.6, 0], 'fov': 40 if region is None else 22, 'aspect': 1},
                    'output': {'qualityTier': 'preview', 'width': 384, 'height': 384}}
        if region:
            contract['bodyRegion'] = region
        contract_path = shot / 'contract.json'
        contract_path.write_text(json.dumps(contract))
        output = imp.build_scene(str(contract_path))
        scene = bpy.context.scene
        scene.cycles.device = 'CPU'
        scene.cycles.samples = 32
        bpy.ops.render.render(write_still=True)
        assert Path(output).is_file(), 'Actual posed pipeline did not render'
        print('POSE_PIPELINE_RENDER', output)
