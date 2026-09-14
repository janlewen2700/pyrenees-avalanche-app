#!/usr/bin/env python3
"""Sample a terrain-feature raster and aligned avalanche-zone mask into an auditable ML table."""
from __future__ import annotations
import argparse, math
from pathlib import Path
import numpy as np, pandas as pd, rasterio

def main():
    p=argparse.ArgumentParser(); p.add_argument('--features',required=True,type=Path); p.add_argument('--labels',required=True,type=Path)
    p.add_argument('--out',required=True,type=Path); p.add_argument('--background-ratio',type=float,default=1.5); p.add_argument('--block-km',type=float,default=10)
    p.add_argument('--seed',type=int,default=42); a=p.parse_args(); rng=np.random.default_rng(a.seed)
    with rasterio.open(a.features) as f, rasterio.open(a.labels) as l:
        if f.crs!=l.crs or f.transform!=l.transform or f.width!=l.width or f.height!=l.height: raise SystemExit('Features and labels must be perfectly aligned.')
        z=f.read(); labels=l.read(1); names=[d or f'band_{i}' for i,d in enumerate(f.descriptions,1)]
        valid=(labels!=255) & np.all(np.isfinite(z),axis=0) & np.all(z!=-9999,axis=0)
        pos=np.argwhere(valid & (labels==1)); bg=np.argwhere(valid & (labels==0))
        nbg=min(len(bg),int(max(1,len(pos)*a.background_ratio))); bg=bg[rng.choice(len(bg),nbg,replace=False)] if nbg else bg
        idx=np.vstack([pos,bg]); y=np.r_[np.ones(len(pos),dtype=int),np.zeros(len(bg),dtype=int)]
        rows=[]; block_m=a.block_km*1000
        for (r,c),label in zip(idx,y):
            x,ycoord=f.xy(int(r),int(c)); rec={'label':int(label),'label_kind':'mapped_zone_presence' if label else 'background_unmapped','x':x,'y':ycoord}
            rec['spatial_block']=f'{math.floor(x/block_m)}:{math.floor(ycoord/block_m)}'
            for bi,name in enumerate(names): rec[name]=float(z[bi,r,c])
            rows.append(rec)
    df=pd.DataFrame(rows).sample(frac=1,random_state=a.seed).reset_index(drop=True); a.out.parent.mkdir(parents=True,exist_ok=True); df.to_parquet(a.out,index=False)
    print(f'Wrote {len(df)} rows: positives={int(df.label.sum())}, background={int((df.label==0).sum())}')
if __name__=='__main__': main()
