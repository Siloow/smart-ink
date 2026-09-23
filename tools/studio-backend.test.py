"""Validate studio/light contracts and current production geometry math."""
import ast
import json
import math
from pathlib import Path
import sys
import unittest

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from server.app import STUDIO_DEFAULTS, validate_contract
from fastapi import HTTPException

source = (root / 'smartink-live/sceneImporter.py').read_text()
names = {'STUDIO_DEFAULTS', '_studio_settings', '_cyclorama_profile', '_studio_light_parameters'}
parts = []
for node in ast.parse(source).body:
    name = node.name if isinstance(node, ast.FunctionDef) else (node.targets[0].id if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) else None)
    if name in names:
        parts.append(ast.get_source_segment(source, node))
        names.remove(name)
assert not names, names
production = {'math': math}
exec('\n\n'.join(parts), production)


def shot(**change):
    return {'schemaVersion': 1, 'bodyMeshId': 'body_full', 'skinToneId': 'tone_03', 'poseId': 'neutral',
            'lookId': 'studio_softbox', 'inkTextureUrl': 'ink.png',
            'camera': {'position': [0, 0, 8], 'target': [0, 0, 0], 'fov': 45, 'aspect': 1},
            'output': {'qualityTier': 'preview', 'width': 512, 'height': 512}, **change}


def valid(**change):
    return validate_contract(json.dumps(shot(**change)).encode())


def light(**change):
    return {'type': 'directional', 'position': [3, 4, 5], 'target': [0, 0, 0], 'intensity': 1, 'color': '#ffffff', **change}


class StudioValidationTests(unittest.TestCase):
    def test_legacy_absence_and_explicit_defaults(self):
        self.assertNotIn('studio', valid())
        self.assertIsNone(production['_studio_settings'](shot()))
        self.assertEqual(valid(studio={})['studio'], STUDIO_DEFAULTS)
        self.assertEqual(production['_studio_settings'](shot(studio={})), STUDIO_DEFAULTS)

    def test_gradient_settings(self):
        studio = {'mode': 'plain', 'gradient': ['#3a1c71', '#d76d77', '#ffaf7b']}
        self.assertEqual(valid(studio=studio)['studio'], production['_studio_settings'](shot(studio=studio)))
        for stops in (None, [], ['#123456'], ['red', '#123456'], ['#123456'] * 9):
            with self.assertRaises(HTTPException):
                valid(studio={'gradient': stops})
            with self.assertRaises(ValueError):
                production['_studio_settings'](shot(studio={'gradient': stops}))

    def test_modes_partial_defaults_and_color_normalization(self):
        for mode in ('plain', 'sweep'):
            for shadow in (0, .4, 1):
                studio = {'mode': mode, 'color': '#D6CdC1', 'shadow': shadow, 'showGuides': True}
                self.assertEqual(valid(studio=studio)['studio'], production['_studio_settings'](shot(studio=studio)))
        self.assertEqual(valid(studio={'mode': 'sweep'})['studio']['shadow'], .4)

    def test_malformed_studio_rejected_by_server_and_direct_importer(self):
        for studio in (None, [], False, 'sweep', {'extra': 1}, {'mode': 'room'}, {'mode': []},
                       {'color': '#abc'}, {'color': '#12345g'}, {'color': '#123456\n'}, {'color': 123},
                       {'shadow': -0.01}, {'shadow': 1.01}, {'shadow': True}, {'shadow': '0.5'},
                       {'shadow': float('nan')}, {'showGuides': 1}):
            with self.subTest(studio=studio):
                with self.assertRaises(HTTPException):
                    valid(studio=studio)
                with self.assertRaises(ValueError):
                    production['_studio_settings'](shot(studio=studio))

    def test_empty_and_disabled_lights_are_preserved(self):
        for lights in ([], [light(enabled=False)], [light(intensity=0)]):
            for style in ('preview', 'cinematic'):
                self.assertEqual(valid(lighting={'lights': lights}, renderStyle=style)['lighting']['lights'], lights)

    def test_supported_light_controls(self):
        for kind in ('ambient', 'directional', 'area', 'point', 'spot'):
            for softness in (0, .45, 1):
                item = light(type=kind, enabled=True, name='Key light', softness=softness, castShadow=True, blenderAreaSize=[.25, 4])
                self.assertEqual(valid(lighting={'lights': [item]})['lighting']['lights'][0], item)

    def test_invalid_light_controls_rejected(self):
        for change in ({'enabled': 0}, {'enabled': None}, {'castShadow': 'yes'}, {'name': 'x' * 81},
                       {'name': 'two\nlines'}, {'name': []}, {'softness': -1}, {'softness': 2},
                       {'softness': True}, {'softness': None}, {'softness': float('inf')}):
            with self.subTest(change=change), self.assertRaises(HTTPException):
                valid(lighting={'lights': [light(**change)]})

    def test_sweep_profile_and_distance_scaled_emitters(self):
        for height, distance in ((2, 4), (4.2, 8), (6, 20)):
            profile, width = production['_cyclorama_profile'](height, distance)
            self.assertEqual(len(profile), 19)
            self.assertEqual(profile[0][1], 0)
            self.assertEqual(profile[1][1], 0)
            self.assertEqual(width, max(height * 4, distance))
            self.assertTrue(all(a[0] <= b[0] and a[1] <= b[1] for a, b in zip(profile, profile[1:])))
        parameters = production['_studio_light_parameters']
        hard, soft = parameters(light(softness=0)), parameters(light(softness=1))
        self.assertEqual((hard['width'], soft['width']), (.25, 4))
        self.assertEqual(hard['energy'], soft['energy'])
        self.assertEqual(parameters(light(type='point', softness=0))['radius'], 0)
        self.assertAlmostEqual(parameters(light(type='point'))['energy'], hard['energy'] * 4)
        self.assertEqual(parameters(light(), 0)['energy'], 0)
        self.assertEqual(parameters(light(blenderAreaSize=[1, 3]))['height'], 3)


if __name__ == '__main__':
    unittest.main(verbosity=2)
