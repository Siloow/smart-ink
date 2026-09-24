"""Measured render request validation, including corrupt and mismatched recipes."""
import copy
import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from fastapi import HTTPException
from server.app import validate_contract
RECIPES=json.loads((ROOT/'tools/fixtures/body-fit-recipes.json').read_text())
def shot(fit):
    return dict(schemaVersion=1,bodyMeshId=fit['bodyMeshId'],skinToneId='tone_03',poseId='neutral',lookId='studio_softbox',inkTextureUrl='ink.png',bodyFit=fit,camera=dict(position=[0,0,8],target=[0,0,0],fov=45,aspect=1),output=dict(qualityTier='preview',width=256,height=256))
class MeasurementValidation(unittest.TestCase):
    def test_valid_fits_survive_unchanged(self):
        for row in RECIPES:
            c=shot(row['fit'])
            self.assertEqual(validate_contract(json.dumps(c).encode()),c)
    def test_invalid_recipes_rejected(self):
        mutations=[lambda f:f.update(version=2),lambda f:f.update(version=True),lambda f:f.update(bodyMeshId='body_full_female'),lambda f:f.update(parameters=[0]*19),lambda f:f['parameters'].__setitem__(0,1),lambda f:f['parameters'].__setitem__(0,True),lambda f:f.update(armDeltas=[0,1]),lambda f:f.update(maxErrorMm=3),lambda f:f['measurements'].update(height=float('nan')),lambda f:f['measurements'].update(inseam=f['measurements']['height']*.6),lambda f:f['measurements'].pop('wrist'),lambda f:f['measurements'].update(waist=999)]
        for change in mutations:
            fit=copy.deepcopy(RECIPES[0]['fit']);c=shot(fit);change(fit)
            with self.assertRaises(HTTPException):validate_contract(json.dumps(c).encode())
        for fit in [None,[],False,'fit']:
            c=shot(RECIPES[0]['fit']);c['bodyFit']=fit
            with self.assertRaises(HTTPException):validate_contract(json.dumps(c).encode())
    def test_shape_cannot_override_fit(self):
        c=shot(RECIPES[0]['fit']);c['bodyShape']={'height':.3}
        with self.assertRaises(HTTPException):validate_contract(json.dumps(c).encode())
    def test_legacy_contract(self):
        c=shot(RECIPES[0]['fit']);c.pop('bodyFit');c['bodyShape']={'height':.3}
        self.assertEqual(validate_contract(json.dumps(c).encode()),c)
if __name__=='__main__':unittest.main()
