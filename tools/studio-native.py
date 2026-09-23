"""Actual Blender studio contract tests and optional small render proofs.
Blender -b -t 2 --python tools/studio-native.py -- --assets /path/to/smartink-live --output reports/studio/blender --render
"""
import argparse
import importlib.util
import json
from pathlib import Path
import struct
import sys
import zlib

import bpy
from mathutils import Vector

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--assets', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--render', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
args.output.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('studio_importer', root / 'smartink-live/sceneImporter.py')
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(b'\0' * 5)) + chunk(b'IEND', b''))
key = {'type': 'directional', 'name': 'Key', 'position': [4, 5, 6], 'target': [0, 0, 0], 'intensity': .8,
       'color': '#ffffff', 'softness': .65, 'castShadow': True}
fill = {'type': 'directional', 'name': 'Fill', 'position': [-4, 2, 3], 'target': [0, 0, 0], 'intensity': .25,
        'color': '#c3dcff', 'softness': .9, 'castShadow': False}
ambient = {'type': 'ambient', 'name': 'Ambient', 'position': [0, 0, 0], 'intensity': .04, 'color': '#ffffff'}
rig = [key, fill, ambient]
cases = [
    {'id': 'male-sweep-preview', 'sex': 'male', 'studio': {'mode': 'sweep', 'shadow': 1}},
    {'id': 'male-sweep-shadow-zero', 'sex': 'male', 'studio': {'mode': 'sweep', 'shadow': 0}},
    {'id': 'female-sweep-posed', 'sex': 'female', 'studio': {'mode': 'sweep', 'color': '#657b91'},
     'pose': 'step', 'shape': {'height': .8, 'legLength': .7}},
    {'id': 'male-plain-cinematic', 'sex': 'male', 'studio': {'mode': 'plain', 'color': '#929c89'}, 'style': 'cinematic'},
    {'id': 'male-all-disabled-preview', 'sex': 'male', 'studio': {'mode': 'plain'}, 'lights': [{**item, 'enabled': False} for item in rig], 'dark': True},
    {'id': 'male-empty-cinematic', 'sex': 'male', 'studio': {'mode': 'plain'}, 'style': 'cinematic', 'lights': [], 'dark': True},
    {'id': 'female-focus-arm', 'sex': 'female', 'studio': {'mode': 'sweep'}, 'region': 'armLeft'},
    {'id': 'male-below-floor', 'sex': 'male', 'studio': {'mode': 'sweep'}, 'camera': [0, -7, 4]},
    {'id': 'female-point-spot', 'sex': 'female', 'studio': {'mode': 'plain'},
     'lights': [{**key, 'type': 'spot', 'angle': .5, 'penumbra': .7, 'softness': 0}, {**fill, 'type': 'point', 'softness': 1}, ambient]},
    {'id': 'legacy-custom', 'sex': 'male', 'style': 'cinematic', 'noStudio': True},
    {'id': 'legacy-default', 'sex': 'male', 'style': 'cinematic', 'noStudio': True, 'noLights': True, 'noRender': True},
    {'id': 'source-cap', 'sex': 'male', 'studio': {'mode': 'plain'}, 'noRender': True,
     'lights': [{**key, 'enabled': False}, {**key, 'intensity': 0}, *[{**key, 'name': 'Extra' + str(i)} for i in range(6)], ambient]},
    {'id': 'coincident-light-aim', 'sex': 'male', 'studio': {'mode': 'plain'}, 'noRender': True,
     'lights': [{**key, 'type': kind, 'name': kind, 'position': [0, 0, 0], 'target': [0, 0, 0], 'softness': 0}
                for kind in ('directional', 'spot', 'point')]},
]
report = []
for case in cases:
    shot = args.output / case['id']
    shot.mkdir(exist_ok=True)
    for asset in ('body_full.blend', 'body_full_female.blend', 'body_male_realistic.glb', 'body_female_realistic.glb', 'assets'):
        target = shot / asset
        if not target.exists():
            target.symlink_to((args.assets / asset).resolve())
    for filename in ('body_male_realistic_normal.png', 'body_female_realistic_normal.png'):
        source = args.assets.parent / 'public/models' / filename
        target = shot / filename
        if source.exists() and not target.exists():
            target.symlink_to(source.resolve())
    (shot / 'ink.png').write_bytes(png)
    contract = {'schemaVersion': 1, 'bodyMeshId': 'body_full' if case['sex'] == 'male' else 'body_full_female',
                'skinToneId': 'tone_03', 'poseId': case.get('pose', 'neutral'), 'bodyShape': case.get('shape', {}),
                'bodyAppearance': {'top': 'tshirt', 'bottom': 'trousers', 'hairStyle': 'short'},
                'bodyHair': 'none', 'showEyes': True, 'bodyRegion': case.get('region'),
                'lookId': 'studio_softbox', 'renderStyle': case.get('style', 'preview'), 'inkTextureUrl': 'ink.png',
                'camera': {'position': case.get('camera', [0, .2, 8]), 'target': [0, 0, 0], 'fov': 36, 'aspect': .8},
                'output': {'qualityTier': 'preview', 'width': 384, 'height': 480}}
    if not case.get('noStudio'):
        contract['studio'] = {**imp.STUDIO_DEFAULTS, **case['studio']}
    if not case.get('noLights'):
        contract['lighting'] = {'lights': case.get('lights', rig), 'intensityScale': 1, 'presetName': 'studio'}
    contract_file = shot / 'contract.json'
    contract_file.write_text(json.dumps(contract))
    output = imp.build_scene(str(contract_file))
    scene, body = bpy.context.scene, bpy.data.objects['Body']
    lights = [obj for obj in scene.objects if obj.type == 'LIGHT']
    sweep = bpy.data.objects.get('cyclorama')
    expected_sweep = case['id'] in ('male-sweep-preview', 'male-sweep-shadow-zero', 'female-sweep-posed', 'legacy-custom', 'legacy-default')
    assert (sweep is not None) == expected_sweep, (case['id'], 'Unexpected backdrop or floor')
    if sweep is not None and 'studio' in contract:
        low, high = imp._studio_body_bounds(body)
        assert abs(min(vertex.co.z for vertex in sweep.data.vertices) - (low - .02)) < 1e-6
        assert len(sweep.data.vertices) == 38 and len(sweep.data.polygons) == 18
        assert abs(sweep['studioShadow'] - contract['studio']['shadow']) < 1e-7
    if case.get('noLights'):
        assert len(lights) == 4 and all(obj.name.startswith('cine_') for obj in lights)
    else:
        assert not any(obj.name.startswith('cine_') for obj in lights), 'Custom lights replaced by cinematic rig'
        sources = [item for item in contract['lighting']['lights'] if item.get('enabled', True) and item['intensity'] > 0 and item['type'] != 'ambient'][:4]
        assert len(lights) == len(sources), (case['id'], 'Disabled, empty or capped rig replaced')
        for obj, item in zip(lights, sources):
            expected = imp._studio_light_parameters(item)
            assert obj.data.type == expected['type']
            assert abs(obj.data.energy - expected['energy']) <= max(1e-4, expected['energy'] * 1e-6)
            assert obj.data.use_shadow == item.get('castShadow', False)
            if case['id'] == 'coincident-light-aim' and item['type'] != 'point':
                direction = obj.rotation_euler.to_quaternion() @ Vector((0, 0, -1))
                assert direction.dot(imp.three_to_blender_position([0, -1, 0])) > .999999, 'Coincident aim must point down'
        ambient_node = scene.world.node_tree.nodes.get('Studio ambient lighting')
        assert ambient_node is not None
        if case.get('dark'):
            assert not lights and max(ambient_node.inputs['Color'].default_value[:3]) == 0
        elif case['id'] == 'source-cap':
            assert abs(ambient_node.inputs['Color'].default_value[0] - .04) < 1e-6, 'Ambient ignored after source cap'
    entry = {'case': case['id'], 'lights': [obj.data.type for obj in lights], 'sweep': sweep is not None}
    if args.render and not case.get('noRender'):
        scene.cycles.device = 'CPU'
        scene.cycles.samples = 12
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(output, check_existing=False)
        pixels, (width, height) = list(image.pixels), image.size
        centre = [pixels[((height // 2 + y) * width + width // 2 + x) * 4 + channel]
                  for x in range(-4, 5) for y in range(-4, 5) for channel in range(3)]
        entry['centreMean'] = sum(centre) / len(centre)
        if case.get('dark'):
            assert entry['centreMean'] < .025, (case['id'], 'Unrequested light brightens figure', entry['centreMean'])
        bpy.data.images.remove(image)
        entry['render'] = output
    report.append(entry)
    print('STUDIO_NATIVE_CASE', entry)
(args.output / 'report.json').write_text(json.dumps(report, indent=2))
print('STUDIO_NATIVE_PASS', len(report))
