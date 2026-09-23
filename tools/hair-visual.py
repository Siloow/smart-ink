from pathlib import Path
import json,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
OUT=Path(sys.argv[1]);REPORT=json.loads((OUT/'manifest.json').read_text())
def font(n):
 try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',n)
 except OSError:return ImageFont.load_default()
def unit(v):return v/max(1e-12,np.linalg.norm(v))
def render(spec,view):
 width,height=360,420
 pos=np.fromfile(OUT/f"{spec['id']}-positions.f32",dtype='<f4').reshape(-1,3).astype(float);normal=np.fromfile(OUT/f"{spec['id']}-normals.f32",dtype='<f4').reshape(-1,3).astype(float);colors=np.fromfile(OUT/f"{spec['id']}-colors.f32",dtype='<f4').reshape(-1,3).astype(float)
 n=unit(np.array({'front':[0,0,1],'side':[1,0,0],'back':[0,0,-1]}[view],float));right=unit(np.cross([0,1,0],n));up=np.array([0,1,0]);pos-=spec['center'];factor=height/(max(spec['dimensions'])*1.35);screen=np.stack([pos@right*factor+width/2,-pos@up*factor+height/2],axis=-1);depth=pos@n;image=np.full((height,width,3),[.035,.046,.064]);zbuffer=np.full((height,width),-np.inf);key=unit(n-right*.6+up*.75);fill=unit(-n+right*.8+up*.3)
 for start in range(0,len(pos),3):
  ids=np.arange(start,start+3);xy=screen[ids];low=np.maximum([0,0],np.floor(xy.min(0)).astype(int));high=np.minimum([width-1,height-1],np.ceil(xy.max(0)).astype(int))
  if np.any(high<low):continue
  (x0,y0),(x1,y1),(x2,y2)=xy;den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
  if abs(den)<1e-9:continue
  X,Y=np.meshgrid(np.arange(low[0],high[0]+1)+.5,np.arange(low[1],high[1]+1)+.5);a=((y1-y2)*(X-x2)+(x2-x1)*(Y-y2))/den;b=((y2-y0)*(X-x2)+(x0-x2)*(Y-y2))/den;c=1-a-b;w=np.stack([a,b,c],axis=-1);zz=w@depth[ids];sl=np.s_[low[1]:high[1]+1,low[0]:high[0]+1];valid=(a>=-1e-6)&(b>=-1e-6)&(c>=-1e-6)&(zz>zbuffer[sl])
  if not valid.any():continue
  norm=w@normal[ids];norm/=np.maximum(1e-12,np.linalg.norm(norm,axis=-1,keepdims=True));light=.34+.68*np.maximum(0,norm@key)+.22*np.maximum(0,norm@fill);rgb=(w@colors[ids])*light[...,None];image[sl][valid]=rgb[valid];zbuffer[sl][valid]=zz[valid]
 image=np.where(image<=.0031308,image*12.92,1.055*np.power(np.maximum(image,0),1/2.4)-.055);return Image.fromarray((np.clip(image,0,1)*255).astype('uint8'))
for sex in ['male','female']:
 cases=[c for c in REPORT['cases'] if c['sex']==sex and not c['id'].startswith('male-tone')];sheet=Image.new('RGB',(1080,len(cases)*450),'#354050');draw=ImageDraw.Draw(sheet)
 for row,spec in enumerate(cases):
  for col,view in enumerate(['front','side','back']):sheet.paste(render(spec,view),(col*360,row*450+30));draw.text((col*360+10,row*450+7),f"{spec['id']} | {view}",font=font(16),fill='white')
 sheet.save(OUT/f'{sex}-hair-views.png');print('Rendered',sex,flush=True)
cases=[c for c in REPORT['cases'] if c['id'].startswith('male-tone')];sheet=Image.new('RGB',(1080,900),'#354050');draw=ImageDraw.Draw(sheet)
for i,spec in enumerate(cases):x=i%3*360;y=i//3*450;sheet.paste(render(spec,'front'),(x,y+30));draw.text((x+10,y+7),spec['tone'],font=font(16),fill='white')
sheet.save(OUT/'hair-tones.png')
