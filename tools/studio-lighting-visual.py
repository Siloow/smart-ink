"""Offline diffuse-only shader-math proof. Actual body/garment geometry and
production emitter samples; this does not claim WebGL/PBR/shadow equivalence."""
from pathlib import Path
import json,sys,numpy as np
from PIL import Image,ImageDraw,ImageFont
out=Path(sys.argv[1]);cases=json.loads((out/'manifest.json').read_text())
def unit(v):return v/max(1e-12,np.linalg.norm(v))
def font(n):
 try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',n)
 except OSError:return ImageFont.load_default()
def aces(color):
 # Exact Three r177 ACESFilmicToneMapping: GLSL mat3 constructors contain
 # columns, so row-vector numpy data multiplies the listed arrays directly.
 input_matrix=np.array([[.59719,.07600,.02840],[.35458,.90834,.13383],[.04823,.01566,.83777]])
 output_matrix=np.array([[1.60475,-.10208,-.00327],[-.53108,1.10813,-.07276],[-.07367,-.00605,1.07602]])
 value=(color/.6)@input_matrix
 value=(value*(value+.0245786)-.000090537)/(value*(.983729*value+.4329510)+.238081)
 return np.clip(value@output_matrix,0,1)
def render(case):
 w,h=300,470;n=unit(np.array([.25,.10,1],float));right=unit(np.cross([0,1,0],n));up=unit(np.cross(n,right));factor=h/5.6;image=np.full((h,w,3),[.045,.050,.057]);zbuffer=np.full((h,w),-np.inf)
 for mesh in case['meshes']:
  prefix=f"{case['sex']}-{mesh['i']}";p=np.fromfile(out/f'{prefix}-positions.f32',dtype='<f4').reshape(-1,3);normals=np.fromfile(out/f'{prefix}-normals.f32',dtype='<f4').reshape(-1,3);triangles=np.fromfile(out/f'{prefix}-indices.u32',dtype='<u4').reshape(-1,3);field=np.fromfile(out/f'{prefix}-coverage.f32',dtype='<f4') if mesh['coverage'] else None;screen=np.stack([p@right*factor+w/2,-p@up*factor+h/2],axis=-1);depth=p@n
  for ids in triangles:
   if field is not None and np.min(field[ids])>=0:continue
   xy=screen[ids];lo=np.maximum([0,0],np.floor(xy.min(0)).astype(int));hi=np.minimum([w-1,h-1],np.ceil(xy.max(0)).astype(int))
   if np.any(hi<lo):continue
   (x0,y0),(x1,y1),(x2,y2)=xy;den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
   if abs(den)<1e-9:continue
   X,Y=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5);a=((y1-y2)*(X-x2)+(x2-x1)*(Y-y2))/den;b=((y2-y0)*(X-x2)+(x0-x2)*(Y-y2))/den;c=1-a-b;weights=np.stack([a,b,c],axis=-1);zz=weights@depth[ids];sl=np.s_[lo[1]:hi[1]+1,lo[0]:hi[0]+1];valid=(a>=0)&(b>=0)&(c>=0)&(zz>zbuffer[sl]);
   if field is not None:valid&=weights@field[ids]<0
   if not valid.any():continue
   norm=weights@normals[ids];norm/=np.maximum(1e-12,np.linalg.norm(norm,axis=-1,keepdims=True));world=weights@p[ids];light=np.empty_like(norm);light[:]=np.array(case['ambientColor'])*case['ambientStrength']
   for sample in case['samples']:
    position=np.array(sample['position']);target=np.array(sample['target']);atten=1
    if sample['type']=='directional':L=unit(position-target)
    else:
     delta=position-world;d2=np.sum(delta*delta,axis=-1);L=delta/np.maximum(.0001,np.sqrt(d2))[...,None];atten=sample['distanceScale']/np.maximum(.01,d2)
     if sample['type']=='spot':
      axis=unit(target-position);cosine=np.sum(-L*axis,axis=-1);outer=np.cos(sample['angle']);inner=np.cos(sample['angle']*(1-sample['penumbra']));t=np.clip((cosine-outer)/max(1e-6,inner-outer),0,1);atten*=t*t*(3-2*t) if inner-outer>=1e-6 else cosine>=outer
    light+=np.array(sample['color'])*sample['intensity']*(np.maximum(0,np.sum(norm*L,axis=-1))*atten)[...,None]
   rgb=aces(np.array(mesh['color'])*light);image[sl][valid]=rgb[valid];zbuffer[sl][valid]=zz[valid]
 srgb=np.where(image<=.0031308,image*12.92,1.055*np.maximum(0,image)**(1/2.4)-.055);return Image.fromarray(np.uint8(np.clip(srgb,0,1)*255))
sheet=Image.new('RGB',(1500,1040),'#262a31');draw=ImageDraw.Draw(sheet)
for i,case in enumerate(cases):
 col=i%5;row=i//5;im=render(case);sheet.paste(im,(col*300,row*500+28));draw.text((col*300+10,row*500+7),f"{case['sex']} · {case['id']}",font=font(16),fill='white');im.save(out/f"{case['sex']}-{case['id']}.png");print('Rendered',case['sex'],case['id'],flush=True)
draw.text((12,1008),'Actual geometry + emitter samples + Three ACES display transform · diffuse diagnostic; browser PBR and shadows need separate validation',font=font(15),fill='#c3cfdf');sheet.save(out/'lighting-contact-sheet.png')
