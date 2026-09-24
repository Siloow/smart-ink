import sys,json,gzip
from pathlib import Path
if len(sys.argv) != 2: raise SystemExit('Usage: python tools/export-measurement-assets.py /path/to/experiments/original-mesh')
sys.path.insert(0,str(Path(sys.argv[1]).resolve()))
from full_body import FullBody
import numpy as np
for sex in ['male','female']:
 m=FullBody(sex)
 descriptors=[]
 for i,d in enumerate(m.descriptors):
  delta=m.basis[i];ids=np.flatnonzero(np.any(abs(delta)>1e-12,axis=1))
  descriptors.append(dict(key=d['key'],kind=d['kind'],side=d.get('sideId',0),f=d.get('f',0),origin=d['origin'].tolist(),normal=d['normal'].tolist(),edges=d['edges'].flatten().tolist(),ids=ids.tolist(),delta=delta[ids].flatten().tolist()))
 data=dict(version=1,sex=sex,H=m.H,baseline=m.baseline,positions=m.base.flatten().tolist(),indices=m.faces.flatten().tolist(),descriptors=descriptors,arms=[dict(side=side,wrist=a['wrist'].tolist(),elbow=a['elbow'].tolist(),axis=a['axis'].tolist(),length=a['length'],shift=((1-np.clip(a['t'],0,1))*a['weight']).tolist()) for side,a in m.arms.items()])
 file=Path('public/measurements')/(sex+'-v1.bin');file.write_bytes(gzip.compress(json.dumps(data,separators=(',',':')).encode(),mtime=0));print(sex,file.stat().st_size)
