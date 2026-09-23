"""Run production Python shape/pose math without importing Blender (JSON stdin/stdout)."""
import ast
import json
import math
from pathlib import Path
import struct
import sys

root = Path(__file__).resolve().parents[1]
source = (root / 'smartink-live/sceneImporter.py').read_text()
names = {
    'BODY_SHAPE_KEYS', 'BODY_SHAPE_TUNING', 'TORSO_HALF_WIDTH', '_band', '_smoothstep',
    '_effective_shape', '_measure_shape_frame', '_radial_shape_delta', '_deform_body_points', '_torso_half_width',
    'BODY_POSE_BOUNDS', 'BODY_POSE_PRESETS', '_effective_pose', '_pose_from_preset', '_pose_rig',
    '_pose_rotate', '_pose_float32', '_measure_pose_arm_boundary', '_pose_arm_boundary_at', '_pose_body_points', '_original_body_regions', 'classify_region',
    'REGION_HEAD_FROM', 'REGION_LEG_TO', 'REGION_ARM_FROM',
}
selected = []
for node in ast.parse(source).body:
    if isinstance(node, ast.FunctionDef):
        name = node.name
    elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        name = node.target.id
    elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        name = node.targets[0].id
    else:
        continue
    if name in names:
        selected.append(ast.get_source_segment(source, node))
        names.remove(name)
if names:
    raise RuntimeError('Missing actual production helpers: ' + ', '.join(names))
namespace = {'math': math, 'struct': struct}
exec(compile('from __future__ import annotations\n' + '\n\n'.join(selected), 'actual_sceneImporter_pose', 'exec'), namespace)
backend_bounds = None
for node in ast.parse((root / 'server/app.py').read_text()).body:
    if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'BODY_POSE_BOUNDS' for target in node.targets):
        backend_bounds = ast.literal_eval(node.value)
request = json.load(sys.stdin)
positions = request['positions']
original = [positions[i:i + 3] for i in range(0, len(positions), 3)]
result = []
for case in request['cases']:
    shaped = namespace['_deform_body_points'](original, case.get('shape', {}))
    shaped = [tuple(namespace['_pose_float32'](value) for value in point) for point in shaped]
    pose = case['pose'] if 'pose' in case else namespace['_pose_from_preset'](case['preset'])
    posed = namespace['_pose_body_points'](original, shaped, pose)
    result.append({'name': case['name'], 'position': [value for point in posed for value in point]})
json.dump({'cases': result, 'bounds': namespace['BODY_POSE_BOUNDS'], 'backendBounds': backend_bounds,
           'presets': namespace['BODY_POSE_PRESETS'], 'regions': namespace['_original_body_regions'](original)},
          sys.stdout, separators=(',', ':'), allow_nan=False)
