"""Offline perspective rasterization of actual posed GLB + production camera output.
This validates framing/placement, not exact browser or Blender shading parity.
Run tattoo-camera.test.mjs --visual first.
"""
from pathlib import Path
import json,math,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parent.parent;OUT=ROOT/'reports/tattoo-camera'
views=json.loads((OUT/'views.json').read_text());cache={}
def unit(x):return x/max(1e-12,np.linalg.norm(x))
def font(size):
    try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',size)
    except OSError:return ImageFont.load_default()
logo=np.asarray(Image.open(ROOT/'public/logo.png').convert('RGBA'),dtype=float)/255

def render(view):
    width,height=500,400;data=cache.setdefault(view['geometry'],json.loads((OUT/view['geometry']).read_text()))
    pos=np.asarray(data['positions']).reshape(-1,3);norm=np.asarray(data['normals']).reshape(-1,3);uv=np.asarray(data['uv']).reshape(-1,2);mask=np.asarray(data['mask']);triangles=np.arange(len(pos)).reshape(-1,3)
    cam=view['camera'];eye=np.array(cam['position']);target=np.array(cam['target']);out=unit(eye-target);right=unit(np.cross([0,1,0],out));up=unit(np.cross(out,right));relative=pos-eye;depth=-(relative@out);tan=math.tan(math.radians(cam['fov'])/2)
    x=(relative@right)/(np.maximum(depth,1e-6)*tan*view['aspect']);y=(relative@up)/(np.maximum(depth,1e-6)*tan);screen=np.stack([(x+1)*width/2,(1-y)*height/2],axis=-1)
    image=np.full((height,width,3),[.08,.105,.14]);zbuffer=np.full((height,width),np.inf);key=unit(out-right*.5+up*.7);fill=unit(out+right*.7);skin=np.array([.73,.58,.47]);c=math.cos(data['rotationRad']);s=math.sin(data['rotationRad']);dims=data['size']*np.array([min(data['aspect'],1),min(1/data['aspect'],1)])
    rotated=np.stack([c*uv[:,0]+s*uv[:,1],-s*uv[:,0]+c*uv[:,1]],axis=-1)/dims+.5
    for ids in triangles:
        if np.any(depth[ids]<.05):continue
        xy=screen[ids];low=np.maximum([0,0],np.floor(xy.min(0)).astype(int));high=np.minimum([width-1,height-1],np.ceil(xy.max(0)).astype(int))
        if np.any(high<low):continue
        (x0,y0),(x1,y1),(x2,y2)=xy;den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
        if abs(den)<1e-9:continue
        X,Y=np.meshgrid(np.arange(low[0],high[0]+1)+.5,np.arange(low[1],high[1]+1)+.5);a=((y1-y2)*(X-x2)+(x2-x1)*(Y-y2))/den;b=((y2-y0)*(X-x2)+(x0-x2)*(Y-y2))/den;cc=1-a-b
        weights=np.stack([a,b,cc],axis=-1)/depth[ids];zz=1/weights.sum(-1);weights*=zz[...,None];sl=np.s_[low[1]:high[1]+1,low[0]:high[0]+1];valid=(a>=0)&(b>=0)&(cc>=0)&(zz<zbuffer[sl]);
        if not valid.any():continue
        normal=weights@norm[ids];normal/=np.maximum(1e-12,np.linalg.norm(normal,axis=-1,keepdims=True));lighting=.22+.65*np.maximum(0,normal@key)+.13*np.maximum(0,normal@fill);rgb=skin*lighting[...,None]
        texture=weights@rotated[ids];inkok=(weights@mask[ids]>=.9999)&(texture[...,0]>=0)&(texture[...,0]<=1)&(texture[...,1]>=0)&(texture[...,1]<=1)
        tx=np.minimum(logo.shape[1]-1,np.maximum(0,(texture[...,0]*(logo.shape[1]-1)).astype(int)));ty=np.minimum(logo.shape[0]-1,np.maximum(0,((1-texture[...,1])*(logo.shape[0]-1)).astype(int)));tex=logo[ty,tx];alpha=tex[...,3]*inkok;rgb=rgb*(1-alpha[...,None])+tex[...,:3]*.85*lighting[...,None]*alpha[...,None]
        image[sl][valid]=rgb[valid];zbuffer[sl][valid]=zz[valid]
    result=Image.fromarray((np.clip(image,0,1)*255).astype('uint8'));draw=ImageDraw.Draw(result);draw.line([(244,200),(256,200)],fill='#56d8c2',width=1);draw.line([(250,194),(250,206)],fill='#56d8c2',width=1)
    return result
sheet=Image.new('RGB',(1500,440*math.ceil(len(views)/3)),'#121922');draw=ImageDraw.Draw(sheet)
for i,view in enumerate(views):
    x=i%3*500;y=i//3*440;shot=render(view);shot.save(OUT/f"{view['id']}.png");sheet.paste(shot,(x,y+30));draw.text((x+10,y+8),view['id'],fill='white',font=font(14));print('Rendered',view['id'],flush=True)
sheet.save(OUT/'camera-contact-sheet.png');print(OUT/'camera-contact-sheet.png')
