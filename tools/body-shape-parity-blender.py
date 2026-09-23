"""Optional native Blender cage probe and shape verification.

Example:
  Blender -b -t 2 --python tools/body-shape-parity-blender.py -- \
    --assets /path/to/smartink-live --output reports/body-shape/blender
Only reads the supplied model assets. All results go under --output.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--assets', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--render', action='store_true', help='Render old/new multires front and side comparisons')
parser.add_argument('--baseline-importer', type=Path, help='Unmodified importer for the left comparison figure')
parser.add_argument('--render-cases', help='Comma-separated case names to render; every case is still verified')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
args.output.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('shape_importer', ROOT / 'smartink-live' / 'sceneImporter.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)
baseline = None
if args.render:
    if not args.baseline_importer:
        parser.error('--render requires --baseline-importer')
    baseline_spec = importlib.util.spec_from_file_location('old_shape_importer', args.baseline_importer)
    baseline = importlib.util.module_from_spec(baseline_spec)
    baseline_spec.loader.exec_module(baseline)
cases = [('default', {})]
for key in ('arms', 'build'):
    cases.extend([(key + '-min', {key: -1}), (key + '-max', {key: 1})])
cases.extend([('all-min', dict.fromkeys(importer.BODY_SHAPE_KEYS, -1)), ('all-max', dict.fromkeys(importer.BODY_SHAPE_KEYS, 1))])
report = {}
for sex, body_id in [('male', 'body_full'), ('female', 'body_full_female')]:
    importer.clear_scene()
    body = importer.load_body_mesh(body_id, str(args.assets.resolve()))
    bpy.context.view_layer.update()
    mesh = body.data
    world_height = body.dimensions.z
    up, front = importer._body_axes(mesh, body)
    side = up.cross(front)
    coords = [[v.co.dot(side), v.co.dot(up), v.co.dot(front)] for v in mesh.vertices]
    local_base = [v.co.copy() for v in mesh.vertices]
    minimum = [min(v[axis] for v in coords) for axis in range(3)]
    maximum = [max(v[axis] for v in coords) for axis in range(3)]
    mesh.calc_loop_triangles()
    entry = {
        'vertices': len(coords), 'triangles': len(mesh.loop_triangles),
        'bounds': [minimum, maximum], 'up': list(up), 'front': list(front),
        'worldMatrix': [list(row) for row in body.matrix_world],
        'worldHeight': world_height,
        'modifiers': [{'name': m.name, 'type': m.type, 'viewport': m.show_viewport, 'render': m.show_render,
                       **({'levels': m.levels, 'renderLevels': m.render_levels} if hasattr(m, 'levels') else {})}
                      for m in body.modifiers],
        'position': [component for co in coords for component in co],
        'indices': [int(index) for triangle in mesh.loop_triangles for index in triangle.vertices],
        'cases': [],
    }
    max_wrapper_delta = 0
    before = None
    if args.render:
        before = body.copy()
        before.data = body.data.copy()
        bpy.context.collection.objects.link(before)
        camera_data = bpy.data.cameras.new('Shape comparison camera')
        camera = bpy.data.objects.new('Shape comparison camera', camera_data)
        bpy.context.collection.objects.link(camera)
        camera_data.type = 'ORTHO'
        camera_data.ortho_scale = world_height * 1.55
        scene = bpy.context.scene
        scene.camera = camera
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.render.resolution_x, scene.render.resolution_y = 900, 700
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'SINGLE'
        scene.display.shading.single_color = (0.62, 0.67, 0.72)
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
        scene.display.shading.cavity_type = 'BOTH'
        scene.display.shading.background_type = 'WORLD'
        scene.world.color = (0.12, 0.12, 0.12)
        scene.render.film_transparent = False
    for name, shape in cases:
        body.location = (0, 0, 0)
        for vertex, original in zip(mesh.vertices, local_base):
            vertex.co = original
        mesh.update()
        importer.apply_body_shape(body, shape)
        actual = [[v.co.dot(side), v.co.dot(up), v.co.dot(front)] for v in mesh.vertices]
        pure = importer._deform_body_points(coords, shape)
        delta = max(abs(actual[i][axis] - pure[i][axis]) for i in range(len(actual)) for axis in range(3))
        max_wrapper_delta = max(max_wrapper_delta, delta)
        assert delta < 0.000001, (sex, name, 'Native axis-wrapper mismatch', delta)
        entry['cases'].append({'name': name, 'shape': shape, 'position': [value for point in actual for value in point]})
        if args.render and (not args.render_cases or name in args.render_cases.split(',')):
            camera_data.ortho_scale = world_height * (2.0 if name == 'all-max' else 1.55)
            before.location = (0, 0, 0)
            for vertex, original in zip(before.data.vertices, local_base):
                vertex.co = original
            before.data.update()
            baseline.apply_body_shape(before, shape)
            importer.center_body_at_origin(body)
            importer.center_body_at_origin(before)
            centered_current, centered_before = body.location.copy(), before.location.copy()
            for view, location in [('front', Vector((0, -5, 0))), ('side', Vector((5, 0, 0)))]:
                camera.location = location
                camera.rotation_euler = (-location).to_track_quat('-Z', 'Y').to_euler()
                right = camera.rotation_euler.to_quaternion() @ Vector((1, 0, 0))
                offset = right * world_height * 0.4
                before.location = centered_before - offset
                body.location = centered_current + offset
                scene.render.filepath = str(args.output / f'{sex}-{name}-{view}.png')
                bpy.ops.render.render(write_still=True)
    entry['maxWrapperDelta'] = max_wrapper_delta
    (args.output / f'{sex}-cage.json').write_text(json.dumps(entry))
    report[sex] = {key: value for key, value in entry.items() if key not in ('position', 'indices', 'cases')}
(args.output / 'probe.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
