"""Reproducible Cycles homepage photograph of the application's body and tattoo assets."""
import bpy, bmesh, types, math, os
from pathlib import Path
from mathutils import Vector
root=Path(os.environ.get('SMARTINK_ROOT', str(Path(__file__).resolve().parents[1])))
output=Path(os.environ.get('HERO_OUTPUT','/private/tmp/smartink-hero/preview.png'))
final=os.environ.get('HERO_FINAL')=='1'
source=root/'smartink-live/sceneImporter.py'
m=types.ModuleType('hero_importer');m.__file__=str(source);exec(compile(source.read_text(),str(source),'exec'),m.__dict__)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'public/models/body_male_realistic.glb'))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];body=max(meshes,key=lambda o:len(o.data.vertices))
for o in meshes:
 if o!=body:bpy.data.objects.remove(o,do_unlink=True)
bpy.context.view_layer.update()
m.apply_skin(body,'tone_03',str(root/'smartink-live'));m.enhance_skin_realism(body,'body_full',str(root/'smartink-live'))
# Retain the actual arm mesh and its original skin UVs; the shoulder ends outside the crop.
bm=bmesh.new();bm.from_mesh(body.data)
bmesh.ops.delete(bm,geom=[v for v in bm.verts if (body.matrix_world@v.co).x<.185 or (body.matrix_world@v.co).z<.70],context='VERTS');bm.to_mesh(body.data);bm.free()
for p in body.data.polygons:p.use_smooth=True
center=Vector((.326,-.035,1.055));up=Vector((-.371,0,.928));right=Vector((.928,0,.371))
uv=body.data.uv_layers.new(name='Hero tattoo projection')
for p in body.data.polygons:
 for li in p.loop_indices:
  d=body.matrix_world@body.data.vertices[body.data.loops[li].vertex_index].co-center
  uv.data[li].uv=(d.dot(right)/.067+.5,d.dot(up)/.105+.5)
body.data.uv_layers.active=uv
m.apply_uv_ink_layer(body,str(root/'public/logo.png'))
mat=body.data.materials[0]
for n in mat.node_tree.nodes:
 if n.type=='TEX_IMAGE' and n.label=='InkLayer':n.extension='CLIP';n.interpolation='Linear'
# Preserve original skin coordinates where material uses the active UV implicitly.
original_uv=mat.node_tree.nodes.new('ShaderNodeUVMap');original_uv.uv_map=body.data.uv_layers[0].name
for n in mat.node_tree.nodes:
 if n.type=='TEX_IMAGE' and n.label!='InkLayer' and not n.inputs['Vector'].is_linked:mat.node_tree.links.new(original_uv.outputs['UV'],n.inputs['Vector'])
body.data.uv_layers.active=body.data.uv_layers[0]
target=Vector((.323,-.01,1.055));bpy.ops.object.camera_add(location=target+Vector((.08,-1.1,.05)));cam=bpy.context.object;cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.rotation_euler.rotate_axis('Z',math.radians(-28));cam.data.type='ORTHO';cam.data.ortho_scale=.39;cam.data.dof.use_dof=False
scene=bpy.context.scene;scene.camera=cam
for name,offset,energy,size,color in [('Warm softbox',(-.3,-.4,.35),5,.32,(1,.83,.68)),('Cool edge',(.26,.16,.16),3,.24,(.46,.66,1)),('Soft fill',(.25,-.3,-.18),1,.35,(.8,.86,1))]:
 bpy.ops.object.light_add(type='AREA',location=target+Vector(offset));o=bpy.context.object;o.name=name;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;o.data.color=color;o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler()
scene.world=bpy.data.worlds.new('Dark studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.025,.028,.04,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.25
scene.render.engine='CYCLES';scene.cycles.samples=256 if final else 32;scene.cycles.use_denoising=True;scene.cycles.adaptive_threshold=.008;scene.cycles.filter_width=1.0
scene.render.resolution_x=1400 if final else 700;scene.render.resolution_y=1300 if final else 650;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
scene.render.filepath=str(output)
if final:
 bpy.ops.wm.save_as_mainfile(filepath=str(output.with_suffix('.blend')))
bpy.ops.render.render(write_still=True)
