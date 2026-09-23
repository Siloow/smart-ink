"""Evaluate production appearance math without importing Blender."""
import ast
import json
import math
from pathlib import Path
import struct
import sys

source = (Path(__file__).resolve().parents[1] / 'smartink-live/sceneImporter.py').read_text()
support = {'_body_appearance', 'BODY_APPEARANCE_DEFAULTS', 'BODY_APPEARANCE_OPTIONS', 'APPEARANCE_HAIR_COLORS',
           '_smoothstep', '_pose_float32', 'hex_to_rgb', 'srgb_to_linear', 'TORSO_HALF_WIDTH', '_torso_half_width'}
parts = []
for node in ast.parse(source).body:
    name = node.name if isinstance(node, ast.FunctionDef) else (
        node.target.id if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) else (
            node.targets[0].id if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) else None))
    if name and (name in support or name.startswith('_appearance_')):
        parts.append(ast.get_source_segment(source, node))
scope = {'math': math, 'struct': struct}
exec('from __future__ import annotations\n' + '\n\n'.join(parts), scope)
request = json.load(sys.stdin)
appearance = scope['_body_appearance']({'bodyAppearance': request['appearance']})
if request['kind'] == 'hair':
    result = scope['_appearance_hair_mesh'](request['original'], request['posed'], request['normals'], request['indices'], appearance)
else:
    result = scope['_appearance_clothing_meshes'](request['original'], request['shaped'], request['posed'], request['indices'], appearance)
json.dump(result, sys.stdout, separators=(',', ':'), allow_nan=False)
