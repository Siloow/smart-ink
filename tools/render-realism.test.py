"""Snapshot framing contract validation, using the real production validator."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from server.app import validate_contract

BASE = {'schemaVersion': 1, 'bodyMeshId': 'body_full', 'skinToneId': 'tone_03', 'poseId': 'neutral',
        'lookId': 'studio_softbox', 'inkTextureUrl': 'ink.png', 'renderStyle': 'cinematic',
        'camera': {'position': [0, 1, 8], 'target': [0, 0, 0], 'fov': 45, 'aspect': 1.5},
        'output': {'qualityTier': 'final', 'width': 960, 'height': 640, 'samples': 64}}


class SnapshotCameraTests(unittest.TestCase):
    def validate(self, **camera):
        contract = copy.deepcopy(BASE)
        contract['camera'].update(camera)
        return validate_contract(json.dumps(contract).encode())

    def test_legacy_contract_remains_legacy(self):
        self.assertNotIn('preserveFraming', self.validate()['camera'])

    def test_exact_camera_request_survives_validation(self):
        for enabled in (False, True):
            camera = self.validate(preserveFraming=enabled, aperture=8)['camera']
            self.assertIs(camera['preserveFraming'], enabled)
            self.assertEqual(camera['position'], BASE['camera']['position'])
            self.assertEqual(camera['target'], BASE['camera']['target'])
            self.assertEqual(camera['fov'], 45)
            self.assertEqual(camera['aperture'], 8)

    def test_detailed_depth_of_field(self):
        self.assertIs(self.validate(depthOfField=False)['camera']['depthOfField'], False)
        for value in (None, 0, 'false', []):
            with self.assertRaises(HTTPException):
                self.validate(depthOfField=value)

    def test_malformed_flag_rejected_before_blender(self):
        for value in (None, 0, 1, 'true', [], {}):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                self.validate(preserveFraming=value)


if __name__ == '__main__':
    unittest.main(verbosity=2)
