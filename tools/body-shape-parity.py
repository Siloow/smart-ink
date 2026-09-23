"""Execute only the actual importer's pure shape functions; no bpy dependency.

The Node parity test sends actual decoded mesh positions/cases through stdin.
Extraction from the production source prevents a stale duplicated test algorithm.
"""
import ast
import json
import math
from pathlib import Path
import sys

source = (Path(__file__).resolve().parents[1] / 'smartink-live' / 'sceneImporter.py').read_text()
names = {'BODY_SHAPE_KEYS', 'BODY_SHAPE_TUNING', 'TORSO_HALF_WIDTH', '_band', '_smoothstep',
         '_effective_shape', '_measure_shape_frame', '_radial_shape_delta', '_deform_body_points', '_torso_half_width'}
selected = []
for node in ast.parse(source).body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
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
    raise RuntimeError('Missing production shape functions: ' + ', '.join(sorted(names)))
namespace = {'math': math}
exec(compile('from __future__ import annotations\n' + '\n\n'.join(selected), 'actual_sceneImporter_shape', 'exec'), namespace)
request = json.load(sys.stdin)
positions = request['positions']
coords = [positions[i:i + 3] for i in range(0, len(positions), 3)]
result = []
for case in request['cases']:
    deformed = namespace['_deform_body_points'](coords, case['shape'])
    result.append({'name': case['name'], 'position': [value for point in deformed for value in point]})
json.dump({'cases': result, 'tuning': namespace['BODY_SHAPE_TUNING']}, sys.stdout, separators=(',', ':'), allow_nan=False)
