#!/usr/bin/env python3
"""Download an aligned Catalonia avalanche-zone presence mask from the public ICGC WMS.

The output is suitable as a *static susceptibility* label only. It is not a dated
avalanche-event inventory and 0 means background/unmapped, not proven safe terrain.
"""
from __future__ import annotations
import argparse, io, math
from pathlib import Path
import numpy as np
import requests
from PIL import Image
import rasterio
from rasterio.transform import from_origin

WMS = "https://geoserveis.icgc.cat/geoserver/nivoallaus/wms"

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--bbox', required=True, help='xmin,ymin,xmax,ymax in EPSG:25831')
    p.add_argument('--resolution', type=float, default=5.0)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--tile', type=int, default=1024)
    a=p.parse_args()
    xmin,ymin,xmax,ymax=map(float,a.bbox.split(',')); res=float(a.resolution)
    width=math.ceil((xmax-xmin)/res); height=math.ceil((ymax-ymin)/res)
    mask=np.zeros((height,width),dtype='uint8'); session=requests.Session()
    for row0 in range(0,height,a.tile):
        h=min(a.tile,height-row0)
        top=ymax-row0*res; bottom=top-h*res
        for col0 in range(0,width,a.tile):
            w=min(a.tile,width-col0); left=xmin+col0*res; right=left+w*res
            params={
                'SERVICE':'WMS','VERSION':'1.1.1','REQUEST':'GetMap','LAYERS':'zonesallaus',
                'STYLES':'','FORMAT':'image/png','TRANSPARENT':'TRUE','SRS':'EPSG:25831',
                'BBOX':f'{left},{bottom},{right},{top}','WIDTH':w,'HEIGHT':h
            }
            r=session.get(WMS,params=params,timeout=60); r.raise_for_status()
            im=Image.open(io.BytesIO(r.content)).convert('RGBA')
            arr=np.asarray(im)
            # WMS is requested transparent: any non-transparent rendered zone counts as mapped avalanche terrain.
            tile=(arr[:,:,3] > 0).astype('uint8')
            mask[row0:row0+h,col0:col0+w]=np.maximum(mask[row0:row0+h,col0:col0+w],tile)
            print(f'tile {col0}:{col0+w}, {row0}:{row0+h}')
    a.output.parent.mkdir(parents=True,exist_ok=True)
    with rasterio.open(a.output,'w',driver='GTiff',width=width,height=height,count=1,dtype='uint8',
        crs='EPSG:25831',transform=from_origin(xmin,ymax,res,res),compress='DEFLATE',nodata=255) as dst:
        dst.write(mask,1); dst.set_band_description(1,'icgc_mapped_avalanche_zone')
        dst.update_tags(source=WMS, layer='zonesallaus', licence='CC BY 4.0 ICGC geoinformation; verify source attribution at publication',
                        warning='0=background/unmapped, not confirmed non-avalanche terrain')
    print(f'Wrote {a.output} ({width}x{height})')
if __name__=='__main__': main()
