"""Appearance contract validation, including explicit and legacy defaults.
Run: PYTHONDONTWRITEBYTECODE=1 server/.venv/bin/python tools/appearance-backend.test.py
"""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.app import BODY_APPEARANCE_DEFAULTS, BODY_APPEARANCE_OPTIONS, validate_contract
from fastapi import HTTPException


def shot(**change):
    return {'schemaVersion': 1, 'bodyMeshId': 'body_full', 'skinToneId': 'tone_03', 'poseId': 'neutral',
            'lookId': 'studio_softbox', 'inkTextureUrl': 'ink.png',
            'camera': {'position': [0, 0, 8], 'target': [0, 0, 0], 'fov': 45, 'aspect': 1},
            'output': {'qualityTier': 'preview', 'width': 512, 'height': 512}, **change}


def valid(**change):
    return validate_contract(json.dumps(shot(**change)).encode())


class AppearanceContractTests(unittest.TestCase):
    def test_legacy_absence_is_preserved(self):
        self.assertNotIn('bodyAppearance', valid())
        result = valid(hairTone='blond')
        self.assertNotIn('bodyAppearance', result)
        self.assertEqual(result['hairTone'], 'blond')

    def test_explicit_empty_means_default_unclothed_no_scalp_hair(self):
        self.assertEqual(valid(bodyAppearance={})['bodyAppearance'], BODY_APPEARANCE_DEFAULTS)
        self.assertEqual(valid(bodyAppearance={}, hairTone='blond')['bodyAppearance']['hairTone'], 'dark_brown')

    def test_every_supported_choice_and_partial_defaults(self):
        for key, choices in BODY_APPEARANCE_OPTIONS.items():
            for choice in choices:
                with self.subTest(key=key, choice=choice):
                    appearance = valid(bodyAppearance={key: choice})['bodyAppearance']
                    self.assertEqual(appearance, {**BODY_APPEARANCE_DEFAULTS, key: choice})
        result = valid(bodyAppearance={'top': 'tshirt', 'bottom': 'trousers', 'topColor': '#FfAa00', 'hairStyle': 'short'})
        self.assertEqual(result['bodyAppearance']['topColor'], '#ffaa00')

    def test_unknown_or_malformed_appearance_rejected(self):
        for appearance in (None, [], False, 'tshirt', 0, {'shirt': 'tshirt'}, {'top': 'shirt'},
                           {'bottom': 'jeans'}, {'hairStyle': 'long'}, {'hairTone': 'red'},
                           {'top': None}, {'hairStyle': []}, {'topColor': None}, {'bottomColor': 123},
                           {'topColor': '#fff'}, {'topColor': '#12345678'}, {'topColor': 'navy'},
                           {'bottomColor': '#gggggg'}, {'bottomColor': '#123456\n'}):
            with self.subTest(appearance=appearance), self.assertRaises(HTTPException) as error:
                valid(bodyAppearance=appearance)
            self.assertEqual(error.exception.status_code, 422)

    def test_focus_and_render_styles_keep_valid_appearance(self):
        appearance = {'top': 'tshirt', 'bottom': 'trousers', 'hairStyle': 'buzz'}
        for region in (None, 'head', 'torso', 'armLeft', 'armRight', 'legLeft', 'legRight'):
            for style in ('preview', 'cinematic'):
                with self.subTest(region=region, style=style):
                    result = valid(bodyAppearance=appearance, bodyRegion=region, renderStyle=style)
                    self.assertEqual(result['bodyAppearance']['bottom'], 'trousers')
                    self.assertEqual(result['bodyAppearance']['hairStyle'], 'buzz')


if __name__ == '__main__':
    unittest.main(verbosity=2)
