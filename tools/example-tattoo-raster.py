"""CPU diagnostic equivalent of sampleSurfaceTattoo, using the shipped PNG."""
import json
import math
from pathlib import Path
import sys
import numpy as np
from PIL import Image

root, logo = Path(sys.argv[1]), Path(sys.argv[2])
image = np.asarray(Image.open(logo).convert('RGBA'), dtype=float) / 255
assert image.shape == (512, 512, 4)
assert image[:, :, 3].max() == 1 and image[:, :, 3].min() == 0
print('Logo:512x512 RGBA, opaque and transparent pixels; alpha coverage', float(image[:, :, 3].mean()))
def linear(c): return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)
def srgb(c): return np.where(c <= .0031308, c * 12.92, 1.055 * np.maximum(c, 0) ** (1 / 2.4) - .055)
image[:, :, :3] = linear(image[:, :, :3])
for file in root.glob('*/chart.json'):
    case = json.loads(file.read_text())
    atlas, offsets, masks = np.array(case['atlas']).reshape(-1, 3, 2), np.array(case['chart']).reshape(-1, 3, 2), np.array(case['mask']).reshape(-1, 3)
    size = 2048
    pixels = np.zeros((size, size, 4), dtype=np.uint8)
    coverage = np.zeros_like(pixels)
    cosine, sine = math.cos(case['rotation']), math.sin(case['rotation'])
    tint = linear(np.array([int(case['color'][i:i + 2], 16) for i in (1, 3, 5)]) / 255)
    for uv, offset, mask in zip(atlas, offsets, masks):
        xy = uv * size
        lo = np.maximum(0, np.floor(xy.min(axis=0)).astype(int)); hi = np.minimum(size - 1, np.ceil(xy.max(axis=0)).astype(int))
        if np.any(hi < lo): continue
        (x0, y0), (x1, y1), (x2, y2) = xy
        den = (y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
        if abs(den) < 1e-10: continue
        y, x = np.mgrid[lo[1]:hi[1]+1, lo[0]:hi[0]+1]
        a=((y1-y2)*(x+.5-x2)+(x2-x1)*(y+.5-y2))/den
        b=((y2-y0)*(x+.5-x2)+(x0-x2)*(y+.5-y2))/den
        w=np.stack([a,b,1-a-b],axis=-1); inside=np.min(w,axis=-1)>=-1e-8
        region=coverage[lo[1]:hi[1]+1,lo[0]:hi[0]+1]; region[inside]=255
        if mask.min()<.9999 or case['opacity']==0: continue
        o=w@offset
        tex=np.stack([cosine*o[...,0]+sine*o[...,1],-sine*o[...,0]+cosine*o[...,1]],axis=-1)/case['size']+.5
        valid=inside&(tex.min(axis=-1)>=0)&(tex.max(axis=-1)<=1)
        if not valid.any(): continue
        # TextureLoader flips image rows; the atlas is already glTF's down-V.
        tx=np.clip(tex[...,0]*512-.5,0,511);ty=np.clip((1-tex[...,1])*512-.5,0,511)
        ix,iy=np.floor(tx).astype(int),np.floor(ty).astype(int);fx,fy=(tx-ix)[...,None],(ty-iy)[...,None]
        sample=((image[iy,ix]*(1-fx)+image[iy,np.minimum(ix+1,511)]*fx)*(1-fy)
                +(image[np.minimum(iy+1,511),ix]*(1-fx)+image[np.minimum(iy+1,511),np.minimum(ix+1,511)]*fx)*fy)
        # Exact cap of production edge AA; logo artwork is clear of this edge.
        edge=np.minimum(tex,1-tex);fade=np.clip(edge/.005,0,1);fade=fade*fade*(3-2*fade)
        rgba=np.concatenate([srgb(sample[...,:3]*tint), (sample[...,3]*case['opacity']*fade.prod(axis=-1))[...,None]],axis=-1)
        region=pixels[lo[1]:hi[1]+1,lo[0]:hi[0]+1];region[valid]=np.clip(np.rint(rgba[valid]*255),0,255).astype(np.uint8)
    (file.parent/'ink.rgba').write_bytes(pixels.tobytes());(file.parent/'coverage.rgba').write_bytes(coverage.tobytes())
    print(case['id'],'alpha pixels',int(np.count_nonzero(pixels[:,:,3])),'max alpha',int(pixels[:,:,3].max()))
