"""Native appearance contract/geometry/visibility tests and actual render proof.
Blender -b -t 2 --python tools/appearance-native.py -- --assets /path/to/smartink-live --output reports/appearance/blender --render
"""
import argparse
import importlib.util
import json
from pathlib import Path
import struct
import sys
import zlib

import bpy

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--assets', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--render', action='store_true')
parser.add_argument('--cases', help='Optional comma-separated case names for focused follow-up checks')
parser.add_argument('--diagnostic', action='store_true', help='Flat object colors: red skin, green shirt, blue bottoms')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
args.output.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('appearance_importer', root / 'smartink-live/sceneImporter.py')
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)


def signature(body):
    mesh = body.data
    return ([tuple(v.co) for v in mesh.vertices], [tuple(p.vertices) for p in mesh.polygons],
            [[tuple(loop.uv) for loop in layer.data] for layer in mesh.uv_layers], tuple(body.location))


def guard(function):
    def checked(body, *arguments):
        before = signature(body)
        result = function(body, *arguments)
        assert signature(body) == before, function.__name__ + ' changed body positions, faces, UVs or centering'
        return result
    return checked


imp.add_appearance_clothing = guard(imp.add_appearance_clothing)
imp.add_appearance_hair = guard(imp.add_appearance_hair)


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(b'\0' * 5)) + chunk(b'IEND', b''))
wardrobe = {'top': 'tshirt', 'bottom': 'trousers', 'hairStyle': 'short', 'hairTone': 'dark_brown'}
cases = [
    {'name': 'casual', 'appearance': wardrobe, 'style': 'preview'},
    {'name': 'shorts-posed', 'appearance': {**wardrobe, 'bottom': 'shorts', 'topColor': '#6c7764', 'hairStyle': 'buzz', 'hairTone': 'blond'},
     'style': 'preview', 'pose': 'flex', 'shape': {'build': .7, 'arms': .8, 'legs': -.5}},
    {'name': 'focus-arm', 'appearance': wardrobe, 'style': 'preview', 'region': 'armLeft', 'pose': 'arm_showcase'},
    {'name': 'focus-head', 'appearance': wardrobe, 'style': 'preview', 'region': 'head', 'angles': {'headTurn': 30, 'headTilt': 12}},
    {'name': 'cinematic-none', 'appearance': {}, 'style': 'cinematic'},
    {'name': 'cinematic-casual', 'appearance': wardrobe, 'style': 'cinematic', 'pose': 'step'},
    {'name': 'legacy-hair', 'style': 'cinematic'},
]
if args.cases:
    requested = set(args.cases.split(','))
    cases = [case for case in cases if case['name'] in requested]
    assert len(cases) == len(requested), 'Unknown native appearance case'
report = []
for sex, body_id in [('male', 'body_full'), ('female', 'body_full_female')]:
    for case in cases:
        shot = args.output / f'{sex}-{case["name"]}'
        shot.mkdir(exist_ok=True)
        for asset in ('body_full.blend', 'body_full_female.blend', 'body_male_realistic.glb', 'body_female_realistic.glb', 'assets'):
            target = shot / asset
            if not target.exists():
                target.symlink_to((args.assets / asset).resolve())
        (shot / 'ink.png').write_bytes(png)
        contract = {'schemaVersion': 1, 'bodyMeshId': body_id, 'skinToneId': 'tone_03',
                    'poseId': case.get('pose', 'custom' if 'angles' in case else 'neutral'),
                    'bodyShape': case.get('shape', {}), 'bodyRegion': case.get('region'),
                    'renderStyle': case['style'], 'lookId': 'studio_softbox', 'inkTextureUrl': 'ink.png',
                    'bodyHair': 'light' if case['name'] == 'cinematic-casual' else 'none', 'showEyes': True,
                    'camera': {'position': [0, 1.5, 5] if case.get('region') == 'head' else [0, 0, 8],
                               'target': [0, 1.5, 0] if case.get('region') == 'head' else [0, 0, 0],
                               'fov': 22 if case.get('region') == 'head' else 36, 'aspect': .8},
                    'output': {'qualityTier': 'preview', 'width': 384, 'height': 480}}
        if 'appearance' in case:
            contract['bodyAppearance'] = case['appearance']
        if 'angles' in case:
            contract['bodyPose'] = case['angles']
        file = shot / 'contract.json'
        file.write_text(json.dumps(contract))
        output = imp.build_scene(str(file))
        body = bpy.data.objects['Body']
        appearance_objects = [obj for obj in bpy.data.objects if obj.name.startswith('Appearance ')]
        garment_objects = [obj for obj in appearance_objects if obj.name != 'Appearance hair']
        hair = bpy.data.objects.get('Appearance hair')
        expected = imp._body_appearance(contract)
        cloth_visible = expected is not None and not case.get('region') and (expected['top'] != 'none' or expected['bottom'] != 'none')
        hair_visible = expected is not None and case.get('region') in (None, 'head') and expected['hairStyle'] != 'none'
        assert bool(garment_objects) == cloth_visible, (sex, case['name'], 'Clothing Focus visibility mismatch')
        assert (hair is not None) == hair_visible, (sex, case['name'], 'Scalp visibility mismatch')
        scalp_particles = [system for system in body.particle_systems if system.name == 'hair_scalp']
        assert bool(scalp_particles) == (expected is None and case['style'] == 'cinematic'), (sex, case['name'], 'Legacy or explicit-none scalp mismatch')
        if expected is not None and case['style'] == 'cinematic':
            assert not scalp_particles
            assert len(body.particle_systems) >= 1, 'Cinematic facial hair was accidentally removed'
        if cloth_visible or case.get('region'):
            assert body.data.attributes.get('SmartInkFocus')
            assert body.data.materials[0].node_tree.nodes.get('SmartInkFocusCut')
            assert bpy.context.scene.cycles.transparent_max_bounces >= 32
            field = body.data.attributes['SmartInkFocus'].data
            hidden_hair = {i for polygon in body.data.polygons if any(field[i].value < 0 for i in polygon.vertices) for i in polygon.vertices}
            density = {group.index for group in body.vertex_groups if group.name.startswith(('body_', 'hair_'))}
            assert all(weight.weight == 0 or weight.group not in density for i in hidden_hair for weight in body.data.vertices[i].groups), 'Hair emits through fabric or outside Focus'
        else:
            assert body.data.attributes.get('SmartInkFocus') is None, 'No-clothes full figure was masked'
        for obj in appearance_objects:
            error = max(abs(obj.matrix_world[row][column] - body.matrix_world[row][column]) for row in range(4) for column in range(4))
            assert error < 1e-6, ('Appearance moved independently of body', error)
            assert len(obj.data.polygons) > 0
        entry = {'sex': sex, 'case': case['name'], 'objects': [obj.name for obj in appearance_objects],
                 'baseVertices': len(body.data.vertices), 'scalpParticles': len(scalp_particles)}
        if args.render and case['name'] != 'legacy-hair':
            scene = bpy.context.scene
            scene.cycles.device = 'CPU'
            scene.cycles.samples = 8
            if args.diagnostic:
                for obj in [body, *appearance_objects]:
                    material = bpy.data.materials.new('Object diagnostic')
                    material.use_nodes = True
                    material.node_tree.nodes.clear()
                    emission = material.node_tree.nodes.new('ShaderNodeEmission')
                    emission.inputs['Color'].default_value = ((1, 0, 0, 1) if obj == body else
                        (0, 1, 0, 1) if 'T-shirt' in obj.name else (0.02, 0.02, 0.02, 1) if obj == hair else (0, 0, 1, 1))
                    output_node = material.node_tree.nodes.new('ShaderNodeOutputMaterial')
                    material.node_tree.links.new(emission.outputs[0], output_node.inputs['Surface'])
                    obj.data.materials.clear()
                    obj.data.materials.append(material)
                    if obj == body and body.data.attributes.get('SmartInkFocus'):
                        imp._apply_focus_material(material)
                scene.render.filepath = str(shot / 'object-diagnostic.png')
                output = scene.render.filepath
                scene.cycles.samples = 2
            bpy.ops.render.render(write_still=True)
            assert Path(output).is_file(), 'Appearance render missing'
            entry['render'] = output
        report.append(entry)
        print('APPEARANCE_NATIVE_CASE', sex, case['name'])
(args.output / ('report-selected.json' if args.cases else 'report.json')).write_text(json.dumps(report, indent=2))
print('APPEARANCE_NATIVE_PASS', len(report))
