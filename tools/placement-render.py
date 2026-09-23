"""CPU triangle renderer for actual decoded GLBs and the production surface chart.

This validates interpolation, seams, source orientation, and geometric distortion.
It does not replace an interactive browser/WebGL integration check.
"""
from pathlib import Path
import json, math, sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('PLACEMENT_REPORT_DIR',ROOT / 'reports' / 'placement'))
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
def font(n, bold=False):
    try: return ImageFont.truetype(BOLD if bold else FONT, n)
    except OSError: return ImageFont.load_default()

def artwork(kind):
    image = Image.new('RGBA', (1024,1024), (0,0,0,0)); d=ImageDraw.Draw(image)
    if kind == 'arrow':
        d.polygon([(512,35),(950,460),(682,460),(682,880),(342,880),(342,460),(75,460)],fill='#182d4e')
        d.ellipse((70,745,220,895),fill='#cf285d')
        d.text((512,485),'UP',anchor='mm',font=font(118,True),fill='#f7ead8')
        d.text((512,645),'INK',anchor='mm',font=font(118,True),fill='#f7ead8')
    else:
        d.rectangle((35,35,989,989),fill='#f1e5d4')
        for p in np.linspace(50,974,9):
            d.line((p,50,p,974),fill='#17243e',width=13);d.line((50,p,974,p),fill='#17243e',width=13)
        d.rectangle((53,53,969,969),outline='#d32367',width=24)
        d.ellipse((192,192,832,832),outline='#d32367',width=24)
        d.rectangle((455,35,569,150),fill='#d32367')
        d.text((75,80),'A',font=font(150,True),fill='#214775');d.text((795,770),'B',font=font(150,True),fill='#214775')
    image.save(OUT/f'design-{kind}.png')
    return np.asarray(image)/255.

textures={k:artwork(k) for k in ['grid','arrow']}
mesh_cache={}
def mesh_for(sex):
    if sex not in mesh_cache:
        m=json.loads((OUT/f'{sex}-mesh.json').read_text())
        mesh_cache[sex]={k:np.array(v).reshape(-1,2 if k=='atlas' else 3) for k,v in m.items()}
    return mesh_cache[sex]

def unit(v): return v/max(1e-12,np.linalg.norm(v))

def render(data, mode=0, pixels=380, reverse=False, overview=False, view_vector=None, span_override=None):
    m=mesh_for(data['sex']);positions=m['positions'];normals=m['normals'];triangles=m['indices'].astype(int)
    center=np.array(data['point']);N=np.array(data['normal']);right=unit(np.cross([0,1,0],N));up=unit(np.cross(N,right))
    if overview:
        view_n=np.array([0.,0.,1.]);view_right=np.array([1.,0.,0.]);view_up=np.array([0.,1.,0.]);center=np.zeros(3);span=4.65
    else:
        outward=np.array([1.,0.,0.]) if data.get('side')=='side' else np.array([0.,0.,-1.]) if data.get('side')=='back' else np.array([0.,0.,1.]); view_n=-N if reverse else unit(.4*N+.6*outward);view_right=unit(np.cross([0,1,0],view_n));view_up=unit(np.cross(view_n,view_right));span=max(.70,data['size']*2.1)
    if view_vector is not None:
        view_n=unit(np.array(view_vector));view_right=unit(np.cross([0,1,0],view_n));view_up=unit(np.cross(view_n,view_right))
    if span_override is not None:span=span_override
    p=positions-center;screen=np.stack([p@view_right,p@view_up],axis=-1)*pixels/span+pixels/2;screen[:,1]=pixels-screen[:,1];depth=p@view_n
    image=np.zeros((pixels,pixels,3),float);image[:]=[.102,.133,.176];zbuffer=np.full((pixels,pixels),-np.inf)
    size=max(.00001,data['size']);aspect=data['aspect'];angle=data['rotation'];c=math.cos(angle);s=math.sin(angle)
    if mode==0: offsets=np.array(data['chart']).reshape(-1,2);mask=np.array(data['mask'])
    elif mode==1: offsets=m['atlas']-np.array(data['centerUV']);mask=np.ones(len(positions));size*=.2;aspect=1
    else:
        p=positions-np.array(data['point']);offsets=np.stack([p@right,p@up],axis=-1);mask=np.ones(len(positions))
    transformed=np.stack([c*offsets[:,0]+s*offsets[:,1],-s*offsets[:,0]+c*offsets[:,1]],axis=-1)
    transformed/=size*np.array([min(aspect,1),min(1/aspect,1)]);transformed+=.5
    tex=textures[data.get('design','grid')];skin=np.array([.72,.57,.47]);light1=unit(np.array([2,3,4]));light2=unit(np.array([-3,1,-3]));
    face_mask=data.get('faceMask')
    for face_index,ids in enumerate(triangles):
        xy=screen[ids];low=np.maximum(0,np.floor(xy.min(axis=0)).astype(int));high=np.minimum(pixels-1,np.ceil(xy.max(axis=0)).astype(int))
        if np.any(high<low):continue
        (x0,y0),(x1,y1),(x2,y2)=xy;den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
        if abs(den)<1e-9:continue
        xs=np.arange(low[0],high[0]+1)+.5;ys=np.arange(low[1],high[1]+1)+.5;X,Y=np.meshgrid(xs,ys)
        a=((y1-y2)*(X-x2)+(x2-x1)*(Y-y2))/den;b=((y2-y0)*(X-x2)+(x0-x2)*(Y-y2))/den;cc=1-a-b
        w=np.stack([a,b,cc],axis=-1);zz=w@depth[ids];zslice=zbuffer[low[1]:high[1]+1,low[0]:high[0]+1]
        valid=(a>=-1e-6)&(b>=-1e-6)&(cc>=-1e-6)&(zz>zslice)
        if not valid.any():continue
        n=w@normals[ids];n/=np.maximum(1e-9,np.linalg.norm(n,axis=-1,keepdims=True));light=.40+.43*np.maximum(0,n@light1)+.22*np.maximum(0,n@light2)
        tuv=w@transformed[ids];inkok=(tuv[...,0]>=0)&(tuv[...,0]<=1)&(tuv[...,1]>=0)&(tuv[...,1]<=1)&((w@mask[ids])>=.999)
        if mode==0 and face_mask is not None and face_mask[face_index]<.999:inkok[:]=False
        tx=np.clip(tuv[...,0]*1023,0,1023).astype(int);ty=np.clip((1-tuv[...,1])*1023,0,1023).astype(int);ink=tex[ty,tx];alpha=ink[...,3]*inkok
        if mode==1:
            edge=np.minimum(tuv,1-tuv);v=np.clip(edge/.04,0,1);fade=v*v*(3-2*v);alpha*=fade[...,0]*fade[...,1]
        rgb=(skin[None,None,:]*(1-alpha[...,None])+ink[...,:3]*alpha[...,None])*light[...,None]
        target=image[low[1]:high[1]+1,low[0]:high[0]+1];target[valid]=rgb[valid];zslice[valid]=zz[valid]
    return Image.fromarray((np.clip(image,0,1)*255).astype(np.uint8))

def comparison(data,pixels=380):
    canvas=Image.new('RGB',(pixels*3,pixels+98),'#19212b');d=ImageDraw.Draw(canvas)
    for mode,label in enumerate(['Surface chart','Original atlas UV','Planar projection']):
        canvas.paste(render(data,mode,pixels),(pixels*mode,34));d.text((pixels*mode+12,8),label,font=font(18,True),fill='#eef5ff')
    label=f"{data['sex']} | {data['id']} | rotation {round(data['rotation']*180/math.pi)} deg | aspect {data['aspect']} | size {data['size']:.3f} / requested {data['requested']:.2f}"
    d.text((12,pixels+45),label,font=font(15),fill='#deebf8')
    d.text((12,pixels+68),f"{'FIXED SIZE' if data.get('fixedSize') else 'AUTO FIT'} | duplicate chart samples {data.get('duplicateSamples','?')} | max copies {data.get('maxMultiplicity','?')} | reversed faces {data.get('reversedFaces','?')}",font=font(14),fill='#b2c8dc')
    return canvas

report=json.loads((OUT/'results.json').read_text());selected=sys.argv[1:] or None
cards=[]
for result in report['results']:
    if 'error' in result:continue
    name=f"{result['sex']}-{result['id']}"
    if selected and not any(v in name for v in selected):continue
    data=json.loads((OUT/f'{name}.json').read_text())
    image=comparison(data);image.save(OUT/f'{name}.png');print('Rendered',name,flush=True)
    if data.get('coverage'):
        n=data['coverageResolution'];counts=np.array(data['coverage']).reshape(n,n);pixels=np.full((n,n,3),[25,33,43],dtype=np.uint8);pixels[counts==1]=[108,180,147];pixels[counts>1]=[238,71,80]
        overlap_image=Image.fromarray(pixels[::-1]).resize((384,384),Image.Resampling.NEAREST);overlap_image.save(OUT/f'{name}-overlap.png')
        if data.get('fixedSize'):
            multiple=Image.new('RGB',(1600,404),'#19212b');draw=ImageDraw.Draw(multiple)
            for i,(label,view) in enumerate([('Front',(0,0,1)),('Front / side',(1,0,1)),('Outer side',(1,0,0)),('Back',(0,0,-1))]):
                multiple.paste(render(data,0,320,view_vector=view,span_override=max(1.4,data['size']*1.6)),(i*320,30));draw.text((i*320+10,8),label,font=font(17,True),fill='white')
            multiple.paste(overlap_image.resize((320,320)),(1280,30));draw.text((1290,8),'Red = duplicated source pixels',font=font(17,True),fill='white')
            draw.text((10,361),f"{data['sex']} | {data['id']} | fixed {data['size']:.2f} | {data['duplicateSamples']} duplicated samples | {data['maxMultiplicity']} max copies",font=font(17),fill='white')
            draw.text((10,384),f"World anchor: {np.round(data['point'],5).tolist()} | face {data['anchor']['faceIndex']}",font=font(14),fill='#b2c8dc')
            multiple.save(OUT/f'{name}-views.png')
    thumb=image.resize((570,239));cards.append((name,thumb))
    if data['id'] in ['chest-seam','forearm','inner-thigh','back']:
        reverse=Image.new('RGB',(1140,420),'#19212b');d=ImageDraw.Draw(reverse)
        for mode,label in enumerate(['Surface: opposite side','Atlas: opposite side','Planar: opposite side']):
            reverse.paste(render(data,mode,380,reverse=True),(mode*380,35));d.text((mode*380+10,10),label,font=font(17),fill='white')
        reverse.save(OUT/f'{name}-opposite.png')
if cards:
    sheet=Image.new('RGB',(1140,math.ceil(len(cards)/2)*239),'#19212b')
    for i,(_,thumb) in enumerate(cards):sheet.paste(thumb,((i%2)*570,(i//2)*239))
    sheet.save(OUT/'contact-sheet.png')
for title,names in {
    'comparison-summary':['male-chest-seam','male-shoulder','male-ribs','male-forearm','female-thigh-seam','female-calf'],
    'body-area-summary':['male-chest','male-back','male-thigh','male-knee','female-chest','female-back','female-thigh','female-knee','female-forearm','male-calf'],
    'rotation-scale-summary':['male-shoulder-r45-a0.45','male-shoulder-r90-a2.2','male-shoulder-r180-a0.45','female-shoulder-r45-a2.2','male-forearm-size0.12','male-forearm-size1.2','female-forearm-size0.12','female-forearm-size1.2'],
    'bleed-summary':['male-chest-seam-opposite','male-forearm-opposite','female-chest-seam-opposite','female-forearm-opposite'],
}.items():
    paths=[OUT/f'{name}.png' for name in names]
    if not all(path.exists() for path in paths): continue
    summary=Image.new('RGB',(1140,math.ceil(len(paths)/2)*239),'#19212b')
    for i,path in enumerate(paths):
        summary.paste(Image.open(path).resize((570,239)),((i%2)*570,(i//2)*239))
    summary.save(OUT/f'{title}.png')
if OUT.name=='fixed-after' and (OUT.parent/'fixed-before'/'results.json').exists():
    before_dir=OUT.parent/'fixed-before'
    for stem,title in [('male-armpit-size0.42-r0-grid','fixed-size-before-after'),('male-armpit-size0.7-r45-arrow','fixed-size-arrow-before-after')]:
        paths=[before_dir/f'{stem}-views.png',OUT/f'{stem}-views.png']
        if not all(path.exists() for path in paths):continue
        comparison_image=Image.new('RGB',(1280,878),'#19212b');draw=ImageDraw.Draw(comparison_image)
        for row,path in enumerate(paths):
            source=Image.open(path);top=row*439
            draw.text((14,top+6),'BEFORE: same source pixels appear twice' if row==0 else 'AFTER: one copy, same placement and fixed size',font=font(22,True),fill='#f08d91' if row==0 else '#a4dec4')
            comparison_image.paste(source.crop((0,0,960,404)),(0,top+35));comparison_image.paste(source.crop((1280,0,1600,350)),(960,top+35))
        comparison_image.save(OUT.parent/f'{title}.png')
    before=json.loads((before_dir/'results.json').read_text());after=json.loads((OUT/'results.json').read_text());a=after['results'];b=before['results']
    valid=[r for r in a if 'error' not in r];valid_before=[r for r in b if 'error' not in r]
    result={'cases':len(a),'beforeSourceSha':before['sourceSha'],'afterSourceSha':after['sourceSha'],'duplicateCasesBefore':sum(r['duplicateSamples']>0 for r in valid_before),'duplicateCasesAfter':sum(r['duplicateSamples']>0 for r in valid),'maxMultiplicityBefore':max(r['maxMultiplicity'] for r in valid_before),'maxMultiplicityAfter':max(r['maxMultiplicity'] for r in valid),'sizesPreserved':len(a)==len(b) and all(x.get('size')==y.get('size') for x,y in zip(a,b)),'anchorsPreserved':len(a)==len(b) and all(x.get('anchor')==y.get('anchor') for x,y in zip(a,b))}
    (OUT.parent/'fixed-size-comparison.json').write_text(json.dumps(result,indent=2))
print('Saved',OUT/'contact-sheet.png',flush=True)
