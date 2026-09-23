"""Reproduce old scalar region discard and compare production signed masks/camera."""
from pathlib import Path
import json,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
OUT=Path(sys.argv[1]);REPORT=json.loads((OUT/'manifest.json').read_text())
def font(n,bold=False):
    try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial'+(' Bold' if bold else '')+'.ttf',n)
    except OSError:return ImageFont.load_default()
def compact_comparison():
    source=Image.open(OUT/'male-focus-comparison.png')
    sheet=Image.new('RGB',(1200,520),'#151b25');draw=ImageDraw.Draw(sheet)
    # Reuse exact inspected render pixels; only simplify the presentation.
    for panel,column,label,note in [(0,0,'Before','Stray fragments highlighted in pink'),(1,2,'After','Clean cut, whole arm framed')]:
        sheet.paste(source.crop((column*400,30,column*400+400,490)),(panel*600+100,27))
        draw.text((panel*600+26,12),label,font=font(22,True),fill='white')
        draw.text((panel*600+26,492),note,font=font(15),fill='#b2c8dc')
    sheet.save(OUT/'focus-arm-before-after.png')
if '--compact-only' in sys.argv:
    compact_comparison();sys.exit(0)
def unit(x):return x/max(1e-12,np.linalg.norm(x))
def render(fig,region,mode,pixels=(400,480)):
    sex=fig['sex'];width,height=pixels
    pos=np.fromfile(OUT/f"{fig['id']}-positions.f32",dtype='<f4').reshape(-1,3).astype(float);normals=np.fromfile(OUT/f"{fig['id']}-normals.f32",dtype='<f4').reshape(-1,3).astype(float)
    labels=np.fromfile(OUT/f'{sex}-labels.f32',dtype='<f4');field=np.fromfile(OUT/f'{sex}-mask-{region}.f32',dtype='<f4');triangles=np.fromfile(OUT/f'{sex}-indices.u32',dtype='<u4').reshape(-1,3)
    camera=fig['framing'][region]['old' if mode=='old' else 'side' if mode=='side' else 'signed'];eye=np.array(camera['position']);target=np.array(camera['target']);n=unit(eye-target);right=unit(np.cross([0,1,0],n));up=unit(np.cross(n,right));view=pos-eye;depth=-(view@n);factor=height/(2*np.tan(np.deg2rad(camera['fov'])/2));screen=np.stack([view@right/depth*factor+width/2,-view@up/depth*factor+height/2],axis=-1)
    image=np.full((height,width,3),[.082,.106,.145]);zbuffer=np.full((height,width),np.inf);key=unit(n-right*.6+up*.75);fill=unit(-n+right*.8+up*.3);skin=np.array([.72,.56,.45]);want=REPORT['regions'][region];phantomPixels=0
    for f,ids in enumerate(triangles):
        signed=mode in ['signed','side']
        if signed and max(field[ids])<0:continue
        ls=labels[ids]
        if not signed and (max(ls)<want-.5 or min(ls)>want+.5):continue
        xy=screen[ids];low=np.maximum([0,0],np.floor(xy.min(0)).astype(int));high=np.minimum([width-1,height-1],np.ceil(xy.max(0)).astype(int))
        if np.any(high<low):continue
        (x0,y0),(x1,y1),(x2,y2)=xy;den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
        if abs(den)<1e-9:continue
        X,Y=np.meshgrid(np.arange(low[0],high[0]+1)+.5,np.arange(low[1],high[1]+1)+.5);a=((y1-y2)*(X-x2)+(x2-x1)*(Y-y2))/den;b=((y2-y0)*(X-x2)+(x0-x2)*(Y-y2))/den;c=1-a-b;w=np.stack([a,b,c],axis=-1);perspective=w/depth[ids];perspective/=np.maximum(1e-12,perspective.sum(axis=-1,keepdims=True));zz=perspective@depth[ids];sl=np.s_[low[1]:high[1]+1,low[0]:high[0]+1];valid=(a>=-1e-6)&(b>=-1e-6)&(c>=-1e-6)&(zz<zbuffer[sl])
        if signed:valid&=perspective@field[ids]>=0
        else:valid&=np.abs(perspective@ls-want)<=.5
        if not valid.any():continue
        norm=perspective@normals[ids];norm/=np.maximum(1e-12,np.linalg.norm(norm,axis=-1,keepdims=True));light=.28+.62*np.maximum(0,norm@key)+.18*np.maximum(0,norm@fill);rgb=skin*light[...,None]
        if want not in ls and not signed:rgb[:]=[.95,.24,.4];phantomPixels+=int(valid.sum())
        image[sl][valid]=rgb[valid];zbuffer[sl][valid]=zz[valid]
    return Image.fromarray((np.clip(image,0,1)*255).astype('uint8')),phantomPixels
for sex in ['male','female']:
    fig=next(c for c in REPORT['cases'] if c['sex']==sex and c['case']=='neutral')
    sheet=Image.new('RGB',(1200,4*520),'#151b25');draw=ImageDraw.Draw(sheet)
    for row,region in enumerate(['armLeft','armRight','torso','head']):
        for col,(mode,title) in enumerate([('old','Current: inherited elevated view'),('front','Old mask at level front camera'),('signed','Fixed mask at level front camera')]):
            im,n=render(fig,region,mode);sheet.paste(im,(col*400,row*520+30));draw.text((col*400+10,row*520+7),f'{region} | {title}',font=font(13,True),fill='white')
            if n:draw.text((col*400+10,row*520+493),f'Pink: invented region fragments ({n} pixels)',font=font(12),fill='#ff7d9d')
    sheet.save(OUT/f"{sex}-focus-comparison.png");print('Rendered comparison',sex,flush=True)
    cases=[c for c in REPORT['cases'] if c['sex']==sex]
    sheet=Image.new('RGB',(1600,len(cases)*520),'#151b25');draw=ImageDraw.Draw(sheet)
    for row,fig in enumerate(cases):
        for col,(region,mode) in enumerate([('armLeft','signed'),('armRight','signed'),('torso','signed'),('armLeft','side')]):
            im,_=render(fig,region,mode);sheet.paste(im,(col*400,row*520+30));draw.text((col*400+10,row*520+7),f"{fig['case']} | {region} | {'side' if mode=='side' else 'front'}",font=font(13,True),fill='white')
    sheet.save(OUT/f"{sex}-focus-poses-shapes.png");print('Rendered stress',sex,flush=True)
compact_comparison()
print('Focus visual evidence:',OUT,flush=True)
