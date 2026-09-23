"""Offline CPU rendering and geometry diagnostics of the actual application meshes.

Same orthographic camera/lighting/scale across each comparison. This audits geometry,
not browser shader integration. Reversed relative normals are diagnostic candidates,
not a general proof of self-intersection. NumPy and Pillow are the only dependencies.
"""
import json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT=Path(sys.argv[1]);FLAGS=sys.argv[2:]
MANIFEST=json.loads((OUT/'manifest.json').read_text())
def font(size,bold=False):
    try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial'+(' Bold' if bold else '')+'.ttf',size)
    except OSError:return ImageFont.load_default()
def unit(a):return a/max(1e-15,np.linalg.norm(a))
def load(case,kind='positions'):return np.fromfile(OUT/f'{case}-{kind}.f32',dtype='<f4').reshape(-1,3).astype(float)
def percentile(v,p):return float(np.percentile(v,p)) if len(v) else None
def bbox(v):return np.ptp(v,axis=0)

def metrics(base,pos,ids):
    a=base[ids];b=pos[ids]
    an=np.cross(a[:,1]-a[:,0],a[:,2]-a[:,0]);bn=np.cross(b[:,1]-b[:,0],b[:,2]-b[:,0])
    aa=np.linalg.norm(an,axis=1);ba=np.linalg.norm(bn,axis=1);valid=aa>1e-10
    ratios=ba[valid]/aa[valid];dots=np.sum(an[valid]*bn[valid],axis=1)/np.maximum(1e-18,aa[valid]*ba[valid])
    edges=np.concatenate([np.linalg.norm((b[:,k]-b[:,(k+1)%3]),axis=1)/np.maximum(1e-12,np.linalg.norm((a[:,k]-a[:,(k+1)%3]),axis=1)) for k in range(3)])
    h=(base[:,1]-base[:,1].min())/np.ptp(base[:,1]);u=np.abs(base[:,0])/np.max(np.abs(base[:,0]))
    sections={}
    # Track identical original vertices; this isolates thickness from length/height.
    for name,height,lowx,highx in [('upperArm',.69,.48,1.1),('elbow',.62,.55,1.1),('forearm',.58,.55,1.1),('wrist',.52,.65,1.1),('chest',.75,0,.43),('waist',.61,0,.43),('thigh',.40,.03,.50),('calf',.18,.03,.55)]:
        selected=(np.abs(h-height)<.008)&(base[:,0]>lowx)&(base[:,0]<highx)
        if selected.sum()<4:continue
        original=base[selected][:,[0,2]];changed=pos[selected][:,[0,2]]
        oldspan=np.ptp(original,axis=0);span=np.ptp(changed,axis=0)
        sections[name]={'vertices':int(selected.sum()),'widthRatio':float(span[0]/max(1e-9,oldspan[0])),'depthRatio':float(span[1]/max(1e-9,oldspan[1])),'width':float(span[0]),'depth':float(span[1])}
    preserved={}
    for name,mask in [('head',h>.89),('rightHand',(h<.50)&(u>.82)&(base[:,0]>0)),('wristTransition',(h>=.50)&(h<.54)&(u>.75)&(base[:,0]>0)),('feet',h<.07)]:
        selected=base[mask];changed=pos[mask]
        if len(selected)<4:continue
        # Translation-free shape difference; recentering the figure is expected.
        delta=(changed-changed.mean(axis=0))-(selected-selected.mean(axis=0))
        preserved[name]={'vertices':len(selected),'maxInternalDisplacement':float(np.max(np.linalg.norm(delta,axis=1))),'bboxRatios':(bbox(changed)/np.maximum(1e-9,bbox(selected))).tolist()}
    flipped=np.flatnonzero(valid)[dots<0];locations=[]
    for face in flipped[:80]:
        point=a[face].mean(axis=0);height=(point[1]-base[:,1].min())/np.ptp(base[:,1])
        locations.append({'face':int(face),'baseCenter':point.tolist(),'heightFraction':float(height)})
    return {'finite':bool(np.isfinite(pos).all()),'relativeReversedFaces':int(np.sum(dots<0)),'severelyReversedFaces':int(np.sum(dots<-.5)),'degenerateFaces':int(np.sum(ba<1e-10)),'collapsedBelow5pctArea':int(np.sum(ratios<.05)),'areaRatioMin':float(ratios.min()),'areaRatioP01':percentile(ratios,1),'areaRatioP99':percentile(ratios,99),'edgeRatioP01':percentile(edges,1),'edgeRatioP99':percentile(edges,99),'dimensions':bbox(pos).tolist(),'sections':sections,'preservation':preserved,'firstReversedFaceLocations':locations}

all_results=[]
for sex in ['male','female']:
    base=load(f'{sex}-default');indices=np.fromfile(OUT/f'{sex}-indices.u32',dtype='<u4').reshape(-1,3)
    for case in [c for c in MANIFEST['cases'] if c['sex']==sex]:
        result={**case,**metrics(base,load(case['id']),indices)};all_results.append(result)
        if case['case'] in ['arms-min','arms-max','build-min','build-max','all-min','all-max']:
            print(f"{case['id']}: flipped={result['relativeReversedFaces']} severe={result['severelyReversedFaces']} collapsed={result['collapsedBelow5pctArea']} areaP01={result['areaRatioP01']:.3f}",flush=True)
report={k:v for k,v in MANIFEST.items() if k!='cases'};report['results']=all_results
(OUT/'metrics.json').write_text(json.dumps(report,indent=2))
rows=['# Body figure geometry audit','',f"Stage: {MANIFEST['stage']}. Source SHA-256: `{MANIFEST['sourceSha']}`.",'','Diagnostics use actual male/female GLBs and the application shape implementation. Negative normal agreement flags folds or extreme rotation; it does not by itself prove self-intersection. Rendered comparisons use equal cameras and lighting.','', '| Case | Flipped faces | Severe flips | <5% area | 1st percentile area ratio |','|---|---:|---:|---:|---:|']
for r in all_results:rows.append(f"| {r['id']} | {r['relativeReversedFaces']} | {r['severelyReversedFaces']} | {r['collapsedBelow5pctArea']} | {r['areaRatioP01']:.3f} |")
(OUT/'audit.md').write_text('\n'.join(rows)+'\n')
if '--audit-only' in FLAGS:sys.exit(0)

def render(name,view='front',width=380,height=600,detail=False):
    pos=load(name);normal=load(name,'normals');sex=name.split('-')[0];triangles=np.fromfile(OUT/f'{sex}-indices.u32',dtype='<u4').reshape(-1,3)
    n=unit(np.array([0.,0.,1.]) if view=='front' else np.array([1.,0.,0.]));right=unit(np.cross([0,1,0],n));up=np.array([0.,1.,0.]);center=np.array([.64,.59,0]) if detail else np.zeros(3)
    span=1.8 if detail else 5.6;factor=height/span;p=pos-center;screen=np.stack([p@right*factor+width/2,-p@up*factor+height/2],axis=-1);depth=p@n
    image=np.full((height,width,3),[.082,.106,.145]);zbuffer=np.full((height,width),-np.inf)
    key=unit(n+right*-.6+up*.75);fill=unit(-n+right*.8+up*.3);skin=np.array([.72,.56,.45])
    for ids in triangles:
        xy=screen[ids];low=np.maximum([0,0],np.floor(xy.min(axis=0)).astype(int));high=np.minimum([width-1,height-1],np.ceil(xy.max(axis=0)).astype(int))
        if np.any(high<low):continue
        (x0,y0),(x1,y1),(x2,y2)=xy;den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
        if abs(den)<1e-9:continue
        X,Y=np.meshgrid(np.arange(low[0],high[0]+1)+.5,np.arange(low[1],high[1]+1)+.5)
        a=((y1-y2)*(X-x2)+(x2-x1)*(Y-y2))/den;b=((y2-y0)*(X-x2)+(x0-x2)*(Y-y2))/den;c=1-a-b;w=np.stack([a,b,c],axis=-1)
        zz=w@depth[ids];sl=np.s_[low[1]:high[1]+1,low[0]:high[0]+1];valid=(a>=-1e-6)&(b>=-1e-6)&(c>=-1e-6)&(zz>zbuffer[sl])
        if not valid.any():continue
        norm=w@normal[ids];norm/=np.maximum(1e-12,np.linalg.norm(norm,axis=-1,keepdims=True));light=.28+.62*np.maximum(0,norm@key)+.18*np.maximum(0,norm@fill)
        rgb=skin[None,None,:]*light[...,None];image[sl][valid]=rgb[valid];zbuffer[sl][valid]=zz[valid]
    return Image.fromarray((np.clip(image,0,1)*255).astype('uint8'))

cache={}
def tile(sex,case,view,detail=False):
    key=(sex,case,view,detail)
    if key not in cache:
        image=render(f'{sex}-{case}',view,380,480 if detail else 600,detail)
        cache[key]=image;image.save(OUT/(f'{sex}-{case}-{view}'+('-detail' if detail else '')+'.png'))
    return cache[key]

# Separate compact sheets make default/min/max silhouettes readable at full size.
for sex in ['male','female']:
    for group in ['arms','build','legs','all','opposing']:
        cases=['default','alternating-a','alternating-b'] if group=='opposing' else ['default',f'{group}-min',f'{group}-max'];sheet=Image.new('RGB',(1140,1290),'#151b25');draw=ImageDraw.Draw(sheet)
        for row,view in enumerate(['front','side']):
            for col,case in enumerate(cases):
                x=col*380;y=row*630;sheet.paste(tile(sex,case,view),(x,y+30));draw.text((x+12,y+7),f'{sex} | {case} | {view}',font=font(17,True),fill='white')
        draw.text((12,1268),f"{MANIFEST['stage']} | equal camera scale | real GLB + production shape math",font=font(15),fill='#b2c8dc');sheet.save(OUT/f'{sex}-{group}-comparison.png');print('Rendered',sex,group,flush=True)
    sheet=Image.new('RGB',(1140,550),'#151b25');draw=ImageDraw.Draw(sheet)
    for col,case in enumerate(['arms-min','default','arms-max']):
        sheet.paste(tile(sex,case,'front',True),(380*col,35));draw.text((380*col+12,8),f'{sex} | {case}',font=font(18,True),fill='white')
    draw.text((12,525),'Arm detail: same camera and scale for every state',font=font(16),fill='#b2c8dc');sheet.save(OUT/f'{sex}-arms-detail.png')
if '--all-renders' in FLAGS:
    for sex in ['male','female']:
        cases=[r['case'] for r in all_results if r['sex']==sex and r['case']!='default'];sheet=Image.new('RGB',(1140,math.ceil(len(cases)/4)*375),'#151b25');draw=ImageDraw.Draw(sheet)
        for i,case in enumerate(cases):
            x=(i%4)*285;y=(i//4)*375;sheet.paste(tile(sex,case,'front').resize((228,360)),(x+28,y+15));draw.text((x+8,y+2),case,font=font(14),fill='white')
        sheet.save(OUT/f'{sex}-all-controls.png')
print('Saved visual evidence to',OUT,flush=True)
