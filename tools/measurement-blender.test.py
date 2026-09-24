"""Native cage + UV/multires + posed fit checks. Optional real textured render.
Blender -b -t 2 --python tools/measurement-blender.test.py -- [--render /tmp/fit.png]
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.measurement_fit import load_asset, deform_fit
spec = importlib.util.spec_from_file_location('importer', ROOT/'smartink-live/sceneImporter.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)
parser=argparse.ArgumentParser()
parser.add_argument('--render',type=Path)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
recipes=json.loads((ROOT/'tools/fixtures/body-fit-recipes.json').read_text())
for row in recipes:
    fit=row['fit']; asset=load_asset(fit['bodyMeshId']); base=asset['positions']; target=deform_fit(asset,fit)
    importer.clear_scene()
    body=importer.load_body_mesh(fit['bodyMeshId'],str(ROOT/'smartink-live'))
    up,front=importer._body_axes(body.data,body); side=up.cross(front)
    original=[(v.co.dot(side),v.co.dot(up),v.co.dot(front)) for v in body.data.vertices]
    uv=[tuple(v.uv) for v in body.data.uv_layers.active.data]
    topology=[tuple(p.vertices) for p in body.data.polygons]
    modifiers=[(m.name,m.type,m.render_levels) for m in body.modifiers]
    importer.apply_measurement_fit(body,fit['bodyMeshId'],fit)
    tree=KDTree(len(target)//3)
    for i in range(0,len(target),3): tree.insert(target[i:i+3],i//3)
    tree.balance()
    worst=max(tree.find((v.co.dot(side),v.co.dot(up),v.co.dot(front)))[2] for v in body.data.vertices)
    assert worst < .00015, (row['sex'],row['label'],worst)
    assert uv == [tuple(v.uv) for v in body.data.uv_layers.active.data]
    assert topology == [tuple(p.vertices) for p in body.data.polygons]
    assert modifiers == [(m.name,m.type,m.render_levels) for m in body.modifiers]
    importer.apply_pose('arm_showcase',body,None,original,[])
    assert all(all(abs(c)<10 for c in v.co) for v in body.data.vertices)
    print(f"PASS {row['sex']}/{row['label']}: native cage within {worst*1000:.4f} mm, UVs and multires preserved, pose applied")
# Also reject a mesh which belongs to another asset/version before any mutation.
body.data.vertices[0].co += Vector((.1,0,0))
before=[tuple(v.co) for v in body.data.vertices]
try: importer.apply_measurement_fit(body,fit['bodyMeshId'],fit)
except ValueError: pass
else: raise AssertionError('Mismatched cage accepted')
assert before == [tuple(v.co) for v in body.data.vertices]
if args.render:
    import base64
    smoke_spec=importlib.util.spec_from_file_location('smoke',ROOT/'tools/runpod-smoke.py')
    smoke=importlib.util.module_from_spec(smoke_spec);smoke_spec.loader.exec_module(smoke)
    job=smoke.test_job()['input']; contract=job['contract']
    contract.update(bodyFit=next(r['fit'] for r in recipes if r['sex']=='male' and r['label']=='fuller'),showEyes=True,bodyHair='none',poseId='arm_showcase')
    contract['camera'].update(position=[0,.1,7],target=[0,0,0],preserveFraming=True,depthOfField=False)
    contract['output'].update(width=560,height=720,qualityTier='final',samples=32)
    contract['camera']['aspect']=560/720
    args.render.parent.mkdir(parents=True,exist_ok=True)
    (args.render.parent/'contract.json').write_text(json.dumps(contract))
    (args.render.parent/'ink.png').write_bytes(base64.b64decode(job['ink_base64']))
    importer.build_scene(str(args.render.parent/'contract.json'))
    bpy.context.scene.render.filepath=str(args.render)
    bpy.ops.render.render(write_still=True)
    print('TEXTURED_FIT_RENDER',args.render)
