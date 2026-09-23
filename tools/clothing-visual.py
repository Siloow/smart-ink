"""CPU rasterization of actual generated garment meshes, smooth normals and coverage."""
from pathlib import Path
import json,sys,numpy as np
from PIL import Image,ImageDraw,ImageFont
out=Path(sys.argv[1]);cases=json.loads((out/'manifest.json').read_text())
def unit(v):return v/max(1e-12,np.linalg.norm(v))
def font(n):
 try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',n)
 except OSError:return ImageFont.load_default()
def render(case,view):
 w,h=380,540;n=unit(np.array({'front':[0,0,1],'side':[1,0,0],'back':[0,0,-1],'angle':[1,0,1]}[view],float));right=unit(np.cross([0,1,0],n));up=np.array([0,1,0]);factor=h/5.6
 image=np.full((h,w,3),[.0066,.0091,.0143]);zbuffer=np.full((h,w),-np.inf);key=unit(n-right*.6+up*.75);fill=unit(-n+right*.8+up*.3)
 for mesh in case['meshes']:
  prefix=f"{case['id']}-{mesh['i']}";p=np.fromfile(out/f'{prefix}-positions.f32',dtype='<f4').reshape(-1,3);normals=np.fromfile(out/f'{prefix}-normals.f32',dtype='<f4').reshape(-1,3);triangles=np.fromfile(out/f'{prefix}-indices.u32',dtype='<u4').reshape(-1,3);field=np.fromfile(out/f'{prefix}-coverage.f32',dtype='<f4') if mesh['coverage'] else None
  screen=np.stack([p@right*factor+w/2,-p@up*factor+h/2],axis=-1);depth=p@n
  for ids in triangles:
   if field is not None and np.min(field[ids])>=0:continue
   xy=screen[ids];lo=np.maximum([0,0],np.floor(xy.min(0)).astype(int));hi=np.minimum([w-1,h-1],np.ceil(xy.max(0)).astype(int))
   if np.any(hi<lo):continue
   (x0,y0),(x1,y1),(x2,y2)=xy;den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
   if abs(den)<1e-9:continue
   X,Y=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5);a=((y1-y2)*(X-x2)+(x2-x1)*(Y-y2))/den;b=((y2-y0)*(X-x2)+(x0-x2)*(Y-y2))/den;c=1-a-b;weights=np.stack([a,b,c],axis=-1);zz=weights@depth[ids];sl=np.s_[lo[1]:hi[1]+1,lo[0]:hi[0]+1];valid=(a>=0)&(b>=0)&(c>=0)&(zz>zbuffer[sl]);
   if field is not None:valid&=weights@field[ids]<0
   if not valid.any():continue
   norm=weights@normals[ids];norm/=np.maximum(1e-12,np.linalg.norm(norm,axis=-1,keepdims=True));light=.30+.61*np.maximum(0,norm@key)+.20*np.maximum(0,norm@fill);rgb=np.array(mesh['color'])*light[...,None];image[sl][valid]=rgb[valid];zbuffer[sl][valid]=zz[valid]
 srgb=np.where(image<=.0031308,image*12.92,1.055*np.maximum(0,image)**(1/2.4)-.055)
 return Image.fromarray(np.uint8(np.clip(srgb,0,1)*255))
for case in cases:
 sheet=Image.new('RGB',(1140,580),'#131820');draw=ImageDraw.Draw(sheet)
 for i,v in enumerate(['front','side','back']):sheet.paste(render(case,v),(380*i,30));draw.text((380*i+12,8),f"{case['id']} · {v}",font=font(16),fill='white')
 sheet.save(out/f"{case['id']}.png");print('Rendered',case['id'],flush=True)
