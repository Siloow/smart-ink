"""Native Focus shader/topology/hair checks on the production Blender bodies.
Blender -b -t 2 --python tools/body-region-mask-blender.py -- --assets /path/to/smartink-live --output reports/focus/blender --render
"""
import argparse
import importlib.util
import json
from pathlib import Path
import struct
import sys
import zlib

import bpy
from mathutils import Vector

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--assets', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--render', action='store_true')
parser.add_argument('--scene-checks', action='store_true', help='Render two actual cinematic build_scene exports')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
args.output.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('focus_importer', root / 'smartink-live/sceneImporter.py')
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)
report = []
for sex, body_id in [('male', 'body_full'), ('female', 'body_full_female')]:
    cases = [(region, 'neutral') for region in imp.BODY_REGION_IDS]
    cases += [('armLeft', 'arms_out'), ('armRight', 'flex'), ('head', 'head-turn')]
    for region, pose in cases:
        imp.clear_scene()
        body = imp.load_body_mesh(body_id, str(args.assets.resolve()))
        mesh = body.data
        up, front = imp._body_axes(mesh, body)
        side = up.cross(front)
        original = [(v.co.dot(side), v.co.dot(up), v.co.dot(front)) for v in mesh.vertices]
        masks = imp._original_body_region_masks(original)
        imp.apply_body_shape(body, {'build': 0.4, 'arms': 0.3} if pose == 'flex' else {})
        imp.center_body_at_origin(body)
        imp.mark_body_hair_regions(body)
        imp.apply_pose(pose, body, {'headTurn': 30, 'headTilt': 12} if pose == 'head-turn' else None, original)
        bpy.context.view_layer.update()
        # Use a flat diagnostic material so alpha alone verifies actual Cycles
        # visibility, independently of studio lighting and skin pigmentation.
        material = bpy.data.materials.new('Focus diagnostic')
        material.use_nodes = True
        nodes, links = material.node_tree.nodes, material.node_tree.links
        nodes.clear()
        emission = nodes.new('ShaderNodeEmission')
        emission.inputs['Color'].default_value = (0.65, 0.7, 0.76, 1)
        output = nodes.new('ShaderNodeOutputMaterial')
        links.new(emission.outputs[0], output.inputs['Surface'])
        mesh.materials.clear()
        mesh.materials.append(material)
        before = ([tuple(v.co) for v in mesh.vertices], [tuple(p.vertices) for p in mesh.polygons],
                  [[tuple(loop.uv) for loop in layer.data] for layer in mesh.uv_layers])
        imp.isolate_body_region(body, region, masks)
        imp.apply_render_quality('preview')
        assert bpy.context.scene.cycles.transparent_max_bounces >= 32, 'Final quality setup overwrote Focus transparency passes'
        after = ([tuple(v.co) for v in mesh.vertices], [tuple(p.vertices) for p in mesh.polygons],
                 [[tuple(loop.uv) for loop in layer.data] for layer in mesh.uv_layers])
        assert before == after, (sex, region, pose, 'Focus changed positions, topology or atlas')
        values = [entry.value for entry in mesh.attributes['SmartInkFocus'].data]
        assert all(abs(a - b) < 1e-7 for a, b in zip(values, masks[region]))
        assert material.node_tree.nodes.get('SmartInkFocusCut')
        forbidden_hair = {i for p in mesh.polygons if any(values[i] < 0 for i in p.vertices) for i in p.vertices}
        density_groups = {g.index for g in body.vertex_groups if g.name.startswith(('body_', 'hair_'))}
        assert all(weight.weight == 0 or weight.group not in density_groups for i in forbidden_hair for weight in mesh.vertices[i].groups)
        # Subdivision must carry the scalar field, not lose it and show the
        # whole body. This checks the actual final modifier stack.
        evaluated_body = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        evaluated = evaluated_body.to_mesh()
        assert evaluated.attributes.get('SmartInkFocus'), (sex, 'Modifier lost Focus attribute')
        evaluated_body.to_mesh_clear()
        visible_triangles = imp._focus_visible_triangles(mesh)
        assert visible_triangles, (sex, region, 'No CPU-visible skin for focus ray')
        visible_area = sum((b - a).cross(c - a).length / 2 for a, b, c in visible_triangles)
        assert 0 < visible_area < sum(p.area for p in mesh.polygons), 'Hidden skin counted in focus area'
        entry = {'sex': sex, 'region': region, 'pose': pose, 'vertices': len(mesh.vertices),
                 'visibleVertices': sum(value >= 0 for value in values), 'hairExcludedVertices': len(forbidden_hair)}
        if args.render:
            # Fixed full-figure front camera exposes any ghost parts elsewhere.
            scene = bpy.context.scene
            scene.render.engine = 'CYCLES'
            scene.cycles.device = 'CPU'
            scene.cycles.samples = 4
            scene.cycles.use_denoising = False
            scene.render.resolution_x = scene.render.resolution_y = 384
            scene.render.resolution_percentage = 100
            scene.render.film_transparent = True
            scene.render.image_settings.color_mode = 'RGBA'
            scene.render.image_settings.file_format = 'PNG'
            camera_data = bpy.data.cameras.new('Focus proof')
            camera = bpy.data.objects.new('Focus proof', camera_data)
            bpy.context.collection.objects.link(camera)
            scene.camera = camera
            camera_data.type = 'ORTHO'
            camera_data.ortho_scale = 5.2
            camera.location = (0, -9, 0)
            camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = str(args.output / f'{sex}-{region}-{pose}.png')
            bpy.ops.render.render(write_still=True)
            # Render Result pixel data can be empty in background Blender;
            # reload the saved PNG through Blender's own decoder instead.
            result = bpy.data.images.load(scene.render.filepath, check_existing=False)
            pixels = list(result.pixels)
            width, height = result.size
            opaque = [(i % width, i // width) for i in range(width * height) if pixels[i * 4 + 3] > 0.5]
            assert opaque, (sex, region, pose, 'Focus rendered empty')
            from bpy_extras.object_utils import world_to_camera_view
            projected = [world_to_camera_view(scene, camera, body.matrix_world @ vertex.co) for vertex, value in zip(mesh.vertices, values) if value >= 0]
            bounds = (min(p.x for p in projected) * width, max(p.x for p in projected) * width,
                      min(p.y for p in projected) * height, max(p.y for p in projected) * height)
            actual = (min(p[0] for p in opaque), max(p[0] for p in opaque), min(p[1] for p in opaque), max(p[1] for p in opaque))
            assert actual[0] >= bounds[0] - 5 and actual[1] <= bounds[1] + 5 and actual[2] >= bounds[2] - 5 and actual[3] <= bounds[3] + 5, (sex, region, pose, 'Visible pixels outside selected skin', actual, bounds)
            entry['renderBounds'] = actual
            entry['opaquePixels'] = len(opaque)
            bpy.data.images.remove(result)
        report.append(entry)
(args.output / 'report.json').write_text(json.dumps(report, indent=2))
print('FOCUS_NATIVE_PASS', len(report), 'original-mesh, UV, field, modifier, hair and render cases')
if args.scene_checks:
    def png_chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    transparent_png = (b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0))
                       + png_chunk(b'IDAT', zlib.compress(b'\0' * 5)) + png_chunk(b'IEND', b''))
    for sex, body_id, region in [('male', 'body_full', 'armLeft'), ('female', 'body_full_female', 'head')]:
        shot = args.output / f'{sex}-pipeline'
        shot.mkdir(exist_ok=True)
        for asset in ('body_full.blend', 'body_full_female.blend', 'body_male_realistic.glb', 'body_female_realistic.glb', 'assets'):
            target = shot / asset
            if not target.exists():
                target.symlink_to((args.assets / asset).resolve())
        for filename in ('body_male_realistic_normal.png', 'body_female_realistic_normal.png'):
            source = args.assets.parent / 'public/models' / filename
            target = shot / filename
            if source.exists() and not target.exists():
                target.symlink_to(source.resolve())
        (shot / 'ink.png').write_bytes(transparent_png)
        contract = {'schemaVersion': 1, 'bodyMeshId': body_id, 'skinToneId': 'tone_03',
                    'poseId': 'arms_out' if region == 'armLeft' else 'custom',
                    'bodyPose': imp._pose_from_preset('arms_out') if region == 'armLeft' else {'headTurn': 30, 'headTilt': 12},
                    'bodyRegion': region, 'lookId': 'studio_softbox', 'inkTextureUrl': 'ink.png',
                    'bodyHair': 'light' if region == 'armLeft' else 'none', 'showEyes': True,
                    'camera': {'position': [1.05, 0.6, 7] if region == 'armLeft' else [0, 1.6, 5],
                               'target': [1.05, 0.6, 0] if region == 'armLeft' else [0, 1.6, 0],
                               'fov': 25 if region == 'armLeft' else 22, 'aspect': 1},
                    'output': {'qualityTier': 'preview', 'width': 384, 'height': 384}}
        contract_path = shot / 'contract.json'
        contract_path.write_text(json.dumps(contract))
        output = imp.build_scene(str(contract_path))
        scene = bpy.context.scene
        scene.cycles.device = 'CPU'
        scene.cycles.samples = 8
        assert scene.cycles.transparent_max_bounces >= 32, 'Actual export reset transparent passes'
        body = bpy.data.objects['Body']
        assert body.data.attributes.get('SmartInkFocus')
        assert body.data.materials[0].node_tree.nodes.get('SmartInkFocusCut'), 'Skin detail replaced Focus material'
        assert 0 < scene.camera.data.dof.focus_distance < 100
        bpy.ops.render.render(write_still=True)
        assert Path(output).is_file(), 'Actual focused pipeline did not render'
        print('FOCUS_PIPELINE_RENDER', output)
