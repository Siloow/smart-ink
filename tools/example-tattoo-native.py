"""Render the production-chart CPU atlas with the actual staged Blender importer."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import bpy

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--assets', required=True, type=Path)
parser.add_argument('--focused-only', action='store_true', help='Render production tattoo-camera compositions beside existing proofs')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
spec = importlib.util.spec_from_file_location('example_importer', root / 'smartink-live/sceneImporter.py')
imp = importlib.util.module_from_spec(spec); spec.loader.exec_module(imp)
report = []
names = ('focused-black-default', 'focused-rotated-seam-posed') if args.focused_only else ('black-default', 'rotated-seam-posed', 'hidden')
for name in names:
    folder = root / 'reports/example-tattoo' / name
    fixture = json.loads((folder / 'chart.json').read_text())
    for asset in ('body_full.blend', 'body_male_realistic.glb', 'assets'):
        destination = folder / asset
        if not destination.exists(): destination.symlink_to((args.assets / asset).resolve())
    for texture in (args.assets.parent / 'assets/derived').glob('*.png'):
        destination = folder / texture.name
        if not destination.exists(): destination.symlink_to(texture.resolve())
    posed = fixture['pose'] != 'neutral'
    contract = {'schemaVersion': 1, 'bodyMeshId': 'body_full', 'skinToneId': 'tone_03', 'poseId': fixture['pose'],
                'bodyAppearance': {}, 'bodyHair': 'none', 'showEyes': True, 'lookId': 'studio_softbox',
                'renderStyle': 'cinematic', 'inkTextureUrl': 'ink.png',
                'camera': {'position': [2, 1.25, 3] if posed else [.17, 1, 2.1],
                           'target': [.6, 1.1, 0] if posed else [.17, 1, 0], 'fov': 26, 'aspect': 1, 'preserveFraming': True, 'aperture': 8},
                'studio': {'mode': 'plain', 'color': '#b8afa4', 'shadow': .4, 'showGuides': False},
                'lighting': {'intensityScale': 1, 'lights': [
                    {'type': 'directional', 'position': [-3, 4, 5], 'target': [0, 1, 0], 'intensity': .9, 'color': '#ffffff', 'softness': .65, 'castShadow': True},
                    {'type': 'directional', 'position': [4, 2, 2], 'target': [0, 1, 0], 'intensity': .25, 'color': '#e9f2ff', 'softness': 1},
                    {'type': 'ambient', 'position': [0, 0, 0], 'intensity': .04, 'color': '#ffffff'}]},
                'output': {'qualityTier': 'final', 'width': 640, 'height': 640, 'samples': 64}}
    if args.focused_only:
        contract['camera'] = fixture['camera']
    file = folder / 'contract.json'; file.write_text(json.dumps(contract, indent=2))
    output = imp.build_scene(str(file)); body = bpy.data.objects['Body']
    material = body.data.materials[0]; ink = imp._node_by_label(material, 'InkLayer')
    assert ink is not None and ink.image.size[:] == (2048, 2048)
    assert imp._node_by_label(material, 'Roughness under ink').operation == 'ADD'
    camera = bpy.context.scene.camera
    assert (camera.location - imp.three_to_blender_position(contract['camera']['position'])).length < 1e-6
    assert abs(camera.data.lens - imp.fov_degrees_to_focal_length_mm(contract['camera']['fov'])) < 1e-5
    bpy.ops.render.render(write_still=True)
    report.append({'case': name, 'render': output, 'source': fixture['source'], 'pose': fixture['pose'],
                   'rotation': fixture['rotation'], 'opacity': fixture['opacity'], 'tint': fixture['color'], 'seam': fixture.get('seam', False),
                   'camera': contract['camera'], 'cameraSourceSha': fixture.get('cameraSourceSha')})
(root / 'reports/example-tattoo' / ('focused-native-report.json' if args.focused_only else 'native-report.json')).write_text(json.dumps(report, indent=2))
print('EXAMPLE_TATTOO_NATIVE_PASS', len(report))
