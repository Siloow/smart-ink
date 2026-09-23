"""Actual production-pose CPU visual audit. Global face-normal flips are NOT errors:
limbs intentionally rotate. Inspect edge/area strain and joint renderings instead.
This does not establish absence of every self-intersection or browser parity.
"""
from pathlib import Path
import json,math,sys
import numpy as np
from PIL import Image,ImageDraw,ImageFont
OUT=Path(sys.argv[1]);FLAGS=sys.argv[2:];REPORT=json.loads((OUT/'manifest.json').read_text())
SELECTED=FLAGS[FLAGS.index('--case')+1] if '--case' in FLAGS else None
def font(n,bold=False):
    try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial'+(' Bold' if bold else '')+'.ttf',n)
    except OSError:return ImageFont.load_default()
def load(case,kind='positions'):return np.fromfile(OUT/f'{case}-{kind}.f32',dtype='<f4').reshape(-1,3).astype(float)
def unit(v):return v/max(1e-12,np.linalg.norm(v))
def strain(shaped,posed,ids):
    a=shaped[ids];b=posed[ids];ae=a[:,1]-a[:,0];af=a[:,2]-a[:,0];be=b[:,1]-b[:,0];bf=b[:,2]-b[:,0]
    oldarea=np.linalg.norm(np.cross(ae,af),axis=1);newarea=np.linalg.norm(np.cross(be,bf),axis=1);valid=oldarea>1e-10;area=newarea[valid]/oldarea[valid]
    edges=np.concatenate([np.linalg.norm(b[:,k]-b[:,(k+1)%3],axis=1)/np.maximum(1e-12,np.linalg.norm(a[:,k]-a[:,(k+1)%3],axis=1)) for k in range(3)])
    L=np.linalg.norm(ae,axis=1);u=np.sum(ae*af,axis=1)/np.maximum(1e-12,L);v=np.sqrt(np.maximum(0,np.sum(af*af,axis=1)-u*u));good=valid&(L>1e-7)&(v>1e-7)
    j1=be[good]/L[good,None];j2=(bf[good]-u[good,None]*j1)/v[good,None];g11=np.sum(j1*j1,axis=1);g22=np.sum(j2*j2,axis=1);g12=np.sum(j1*j2,axis=1);disc=np.sqrt(np.maximum(0,(g11-g22)**2+4*g12*g12));small=np.sqrt(np.maximum(0,(g11+g22-disc)/2));large=np.sqrt(np.maximum(0,(g11+g22+disc)/2))
    return {'finite':bool(np.isfinite(posed).all()),'collapsedBelow5pctArea':int(np.sum(area<.05)),'areaRatioMin':float(area.min()),'areaRatioP01':float(np.percentile(area,1)),'areaRatioP99':float(np.percentile(area,99)),'edgeRatioMin':float(edges.min()),'edgeRatioMax':float(edges.max()),'edgeRatioP01':float(np.percentile(edges,1)),'edgeRatioP99':float(np.percentile(edges,99)),'singularValueMin':float(small.min()),'singularValueMax':float(large.max()),'severelyCompressedFaces':int(np.sum(small<.15)),'severelyStretchedFaces':int(np.sum(large>3))}
def preservation(base,shaped,posed):
    h=(base[:,1]-base[:,1].min())/np.ptp(base[:,1]);u=base[:,0]/np.max(np.abs(base[:,0]));result={}
    masks={'leftHand':(h<.50)&(u>.82),'rightHand':(h<.50)&(u<-.82),'leftFoot':(h<.065)&(u>0),'rightFoot':(h<.065)&(u<0),'head':h>.91}
    for name,mask in masks.items():
        ids=np.flatnonzero(mask)[::max(1,int(mask.sum()/64))];a=shaped[ids];b=posed[ids];ad=np.linalg.norm(a[:,None]-a[None,:],axis=-1);bd=np.linalg.norm(b[:,None]-b[None,:],axis=-1)
        result[name]={'maxPairDistanceError':float(np.max(np.abs(ad-bd))),'points':len(ids)}
    return result
rows=[]
for sex in ['male','female']:
    ids=np.fromfile(OUT/f'{sex}-indices.u32',dtype='<u4').reshape(-1,3);base=load(f'{sex}-neutral')
    for spec in [c for c in REPORT['cases'] if c['sex']==sex]:
        shaped=load(spec['id'],'shaped');posed=load(spec['id']);result={**spec,**strain(shaped,posed,ids),'rigidDetails':preservation(base,shaped,posed)};rows.append(result)
        if result['collapsedBelow5pctArea'] or result['severelyStretchedFaces'] or spec.get('preset'):
            print(f"{spec['id']}: collapse={result['collapsedBelow5pctArea']} severe stretch={result['severelyStretchedFaces']} minarea={result['areaRatioMin']:.3f} edge={result['edgeRatioMin']:.2f}..{result['edgeRatioMax']:.2f}",flush=True)
(OUT/'metrics.json').write_text(json.dumps({**{k:v for k,v in REPORT.items() if k!='cases'},'results':rows},indent=2))
if '--audit-only' in FLAGS:sys.exit(0)

def render(spec,view,pixels=(400,620)):
    width,height=pixels;pos=load(spec['id']);normal=load(spec['id'],'normals');triangles=np.fromfile(OUT/f"{spec['sex']}-indices.u32",dtype='<u4').reshape(-1,3)
    offsets=np.fromfile(OUT/f"{spec['sex']}-tattoo-uv.f32",dtype='<f4').reshape(-1,2);mask=np.fromfile(OUT/f"{spec['sex']}-tattoo-mask.f32",dtype='<f4')
    n=unit(np.array({'front':[0,0,1],'side':[1,0,0],'side-right':[-1,0,0],'back':[0,0,-1],'angle':[1,0,1]}[view],dtype=float));right=unit(np.cross([0,1,0],n));up=np.array([0,1,0]);factor=height/6.4
    screen=np.stack([pos@right*factor+width/2,-pos@up*factor+height/2],axis=-1);depth=pos@n;image=np.full((height,width,3),[.082,.106,.145]);zbuffer=np.full((height,width),-np.inf);key=unit(n-right*.6+up*.75);fill=unit(-n+right*.8+up*.3);skin=np.array([.72,.56,.45])
    for ids in triangles:
        xy=screen[ids];low=np.maximum([0,0],np.floor(xy.min(0)).astype(int));high=np.minimum([width-1,height-1],np.ceil(xy.max(0)).astype(int))
        if np.any(high<low):continue
        (x0,y0),(x1,y1),(x2,y2)=xy;den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
        if abs(den)<1e-9:continue
        X,Y=np.meshgrid(np.arange(low[0],high[0]+1)+.5,np.arange(low[1],high[1]+1)+.5);a=((y1-y2)*(X-x2)+(x2-x1)*(Y-y2))/den;b=((y2-y0)*(X-x2)+(x0-x2)*(Y-y2))/den;c=1-a-b;w=np.stack([a,b,c],axis=-1);zz=w@depth[ids];sl=np.s_[low[1]:high[1]+1,low[0]:high[0]+1];valid=(a>=-1e-6)&(b>=-1e-6)&(c>=-1e-6)&(zz>zbuffer[sl])
        if not valid.any():continue
        norm=w@normal[ids];norm/=np.maximum(1e-12,np.linalg.norm(norm,axis=-1,keepdims=True));light=.28+.62*np.maximum(0,norm@key)+.18*np.maximum(0,norm@fill)
        uv=(w@offsets[ids])/.30+.5;inkok=((w@mask[ids])>.999)&(uv[...,0]>=0)&(uv[...,0]<=1)&(uv[...,1]>=0)&(uv[...,1]<=1)
        grid=(np.mod(uv[...,0]*6,1)<.14)|(np.mod(uv[...,1]*6,1)<.14);border=(uv[...,0]<.04)|(uv[...,0]>.96)|(uv[...,1]<.04)|(uv[...,1]>.96);ink=np.empty((*grid.shape,3));ink[:]=[.9,.84,.7];ink[grid]=[.05,.12,.24];ink[border]=[.75,.12,.3];ink[(uv[...,0]<.20)&(uv[...,1]>.78)]=[.9,.22,.4]
        rgb=np.where(inkok[...,None],ink,skin)*light[...,None];image[sl][valid]=rgb[valid];zbuffer[sl][valid]=zz[valid]
    return Image.fromarray((np.clip(image,0,1)*255).astype('uint8'))

cache={}
def tile(spec,view):
    key=(spec['sex'],json.dumps(spec['pose'],sort_keys=True),json.dumps(spec['shape'],sort_keys=True),view)
    if key not in cache:cache[key]=render(spec,view)
    return cache[key]
for sex in ([] if '--gallery-only' in FLAGS else ['male','female']):
    cases=[r for r in rows if r['sex']==sex and (not SELECTED or SELECTED in r['id'])]
    if not cases:continue
    selected=cases if SELECTED else [r for r in cases if r['case']=='neutral' or r.get('preset') or r['case'] in ['all-max','opposing-a','opposing-b','shape-max-flex','shape-max-step','narrow-shoulder-bent-arms']]
    for spec in selected:
        sheet=Image.new('RGB',(1200,690),'#151b25');draw=ImageDraw.Draw(sheet)
        for col,view in enumerate(['front','side','back']):sheet.paste(tile(spec,view),(col*400,32));draw.text((col*400+12,8),f"{spec['id']} | {view}",font=font(16,True),fill='white')
        draw.text((12,661),f"Collapsed faces {spec['collapsedBelow5pctArea']} | edge p1–p99 {spec['edgeRatioP01']:.2f}–{spec['edgeRatioP99']:.2f} | diagnostic ink follows the skin",font=font(16),fill='#b2c8dc');sheet.save(OUT/f"{spec['id']}-views.png");print('Rendered',spec['id'],flush=True)
    contact=Image.new('RGB',(1200,math.ceil(len(selected)/4)*350),'#151b25');draw=ImageDraw.Draw(contact)
    for i,spec in enumerate(selected):x=i%4*300;y=i//4*350;contact.paste(tile(spec,'front').resize((210,326)),(x+45,y+24));draw.text((x+8,y+3),spec['case'],font=font(14),fill='white')
    contact.save(OUT/f'{sex}-presets-stress.png')
    if '--quick' not in FLAGS:
        endpoints=[r for r in cases if r.get('endpoint')]
        if not endpoints:continue
        contact=Image.new('RGB',(1200,math.ceil(len(endpoints)/4)*350),'#151b25');draw=ImageDraw.Draw(contact)
        for i,spec in enumerate(endpoints):x=i%4*300;y=i//4*350;contact.paste(tile(spec,'front').resize((210,326)),(x+45,y+24));draw.text((x+8,y+3),spec['case'],font=font(14),fill='white')
        contact.save(OUT/f'{sex}-endpoints.png')
        groups={'arm-lift':'ArmLift','arm-forward':'ArmForward','elbows':'Elbow','leg-spread':'LegSpread','leg-forward':'LegForward','knees':'Knee','head-turn':'headTurn','head-tilt':'headTilt'}
        for group,pattern in groups.items():
            selected_endpoints=[r for r in endpoints if pattern in r['case']]
            if not selected_endpoints:continue
            sheet=Image.new('RGB',(960,len(selected_endpoints)*505),'#151b25');draw=ImageDraw.Draw(sheet)
            for row,spec in enumerate(selected_endpoints):
                side='side-right' if spec['case'].startswith('right') else 'side'
                for col,view in enumerate(['front',side,'back']):
                    x=col*320;y=row*505;sheet.paste(tile(spec,view).resize((300,465)),(x+10,y+29));draw.text((x+9,y+7),f"{spec['case']} | {'side' if view.startswith('side') else view}",font=font(14,True),fill='white')
            sheet.save(OUT/f'{sex}-endpoints-{group}.png');print('Endpoint views',sex,group,flush=True)
if not SELECTED:
    presets=[r for r in rows if r['sex']=='male' and (r['case']=='neutral' or r.get('preset'))]
    gallery=Image.new('RGB',(240*len(presets),840),'#151b25');draw=ImageDraw.Draw(gallery)
    for row,sex in enumerate(['male','female']):
        for col,preset in enumerate(presets):
            spec=next(r for r in rows if r['sex']==sex and r['case']==preset['case']);x=col*240;y=row*420;gallery.paste(tile(spec,'front').resize((240,372)),(x,y+31));draw.text((x+10,y+8),f"{sex} | {spec['case'].replace('preset-','')}",font=font(15,True),fill='white')
    gallery.save(OUT/'preset-gallery.png')
print('Pose visual evidence:',OUT,flush=True)
