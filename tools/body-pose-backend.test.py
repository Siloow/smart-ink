"""Pose contract acceptance/rejection before a render can launch.
Run: PYTHONDONTWRITEBYTECODE=1 server/.venv/bin/python tools/body-pose-backend.test.py
"""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.app import BODY_POSE_BOUNDS, BODY_POSE_IDS, validate_contract
from fastapi import HTTPException


def shot():
    return {'schemaVersion': 1, 'bodyMeshId': 'body_full', 'skinToneId': 'tone_03', 'poseId': 'neutral',
            'lookId': 'studio_softbox', 'inkTextureUrl': 'ink.png',
            'camera': {'position': [0, 0, 8], 'target': [0, 0, 0], 'fov': 45, 'aspect': 1},
            'output': {'qualityTier': 'preview', 'width': 512, 'height': 512}}


def valid(contract):
    return validate_contract(json.dumps(contract).encode())


class BodyPoseValidationTests(unittest.TestCase):
    def test_every_preset_and_legacy_alias(self):
        for pose in BODY_POSE_IDS - {'custom'}:
            with self.subTest(pose=pose):
                contract = {**shot(), 'poseId': pose}
                self.assertEqual(valid(contract)['poseId'], pose)

    def test_all_angle_bounds_and_partial_custom(self):
        for key, (low, high) in BODY_POSE_BOUNDS.items():
            for value in (low, 0, high):
                with self.subTest(key=key, value=value):
                    contract = {**shot(), 'poseId': 'custom', 'bodyPose': {key: value}}
                    self.assertEqual(valid(contract)['bodyPose'][key], value)
        self.assertEqual(valid({**shot(), 'bodyPose': {}})['bodyPose'], {})

    def test_unsafe_angles_rejected(self):
        for key, (low, high) in BODY_POSE_BOUNDS.items():
            for value in (low - 0.01, high + 0.01, True, '12', None, float('inf'), float('nan')):
                with self.subTest(key=key, value=value):
                    with self.assertRaises(HTTPException) as raised:
                        valid({**shot(), 'bodyPose': {key: value}})
                    self.assertEqual(raised.exception.status_code, 422)

    def test_missing_unknown_or_malformed_pose_rejected(self):
        for change in ({'poseId': 'custom'}, {'poseId': 'missing'}, {'bodyPose': []},
                       {'bodyPose': None}, {'bodyPose': {'elbow': 1}}):
            with self.subTest(change=change), self.assertRaises(HTTPException):
                valid({**copy.deepcopy(shot()), **change})

    def test_combined_shoulder_elbow_limit(self):
        for side in ('left', 'right'):
            with self.assertRaises(HTTPException):
                valid({**shot(), 'bodyPose': {side + 'ArmForward': 35, side + 'Elbow': 85}})
            valid({**shot(), 'bodyPose': {side + 'ArmForward': 35, side + 'Elbow': 65}})
            with self.assertRaises(HTTPException):
                valid({**shot(), 'bodyPose': {side + 'ArmLift': -10, side + 'ArmForward': 35}})
            valid({**shot(), 'bodyPose': {side + 'ArmLift': -10, side + 'ArmForward': 25, side + 'Elbow': 75}})


if __name__ == '__main__':
    unittest.main(verbosity=2)
