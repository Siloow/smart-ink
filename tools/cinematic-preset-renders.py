"""Actual production-pipeline preset render proofs. Generate contracts with cinematic-preset-fixtures.mjs first."""
import ast,importlib.util,json,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
out=Path('/tmp/smartink-cinematic')
def load(path):
 spec=importlib.util.spec_from_file_location('cine_importer',path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
imp=load(ROOT/'smartink-live/sceneImporter.py')
source=(ROOT/'tools/render-realism-native.py').read_text()
function=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='tattoo_fixture')
fixture=ast.get_source_segment(source,function).replace('size = 2048','size = 4096')
fixture=fixture.replace('    coverage = np.zeros', "    artwork = bpy.data.images.load(str(ROOT/'public/tattoos/botanical-rose.png'))\n    aw, ah = artwork.size\n    art = np.array(artwork.pixels[:]).reshape(ah,aw,4)\n    coverage = np.zeros")
start=fixture.index('        graphic = ');end=fixture.index('        inside =',start)
fixture=fixture[:start]+"        u, v = px * .75 + .5, pz * .5 + .5\n        rgba = art[np.clip((v*(ah-1)).astype(int),0,ah-1),np.clip((u*(aw-1)).astype(int),0,aw-1)]\n        graphic = (u>=0)&(u<=1)&(v>=0)&(v<=1)\n"+fixture[end:]
fixture=fixture.replace('area[mask] = (.005, .006, .009, 1)','area[mask] = rgba[mask]')
fixture=fixture.replace("pixels[alpha > 0] = (.005, .006, .009, 1)","pixels[:,:,3] = alpha")
exec(fixture,globals())
shots=json.loads((out/'contracts.json').read_text())
for c in shots:
 folder=out/c['id'];folder.mkdir(exist_ok=True)
 assets=folder/'assets';assets.mkdir(exist_ok=True)
 for file in (ROOT/'server/runpod/textures').glob('*.png'):
  if not (assets/file.name).exists():(assets/file.name).symlink_to(file)
 if not (assets/'skins.blend').exists():(assets/'skins.blend').symlink_to(ROOT/'smartink-live/assets/skins.blend')
 for sex in ['body_full','body_full_female']:
  if not (folder/(sex+'.blend')).exists():(folder/(sex+'.blend')).symlink_to(ROOT/('smartink-live/'+sex+'.blend'))
 tattoo_fixture(c['bodyMeshId'],folder)
 (folder/'contract.json').write_text(json.dumps(c))
 imp.build_scene(str(folder/'contract.json'))
 bpy.context.scene.render.filepath=str(out/(c['id']+'.png'))
 bpy.ops.render.render(write_still=True)
 print('CINEMATIC_RENDER',c['id'],flush=True)
 if c['id']=='detail' and (out/'baseline.py').exists():
  baseline=load(out/'baseline.py');baseline.build_scene(str(folder/'contract.json'))
  bpy.context.scene.render.filepath=str(out/'detail-before.png');bpy.ops.render.render(write_still=True)
