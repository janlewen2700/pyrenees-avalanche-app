# High-resolution terrain preprocessing

The live server can query high-resolution official terrain services for small interactive windows, but a production route-planning layer should be **precomputed**. Re-querying 1–5 m elevation services for every map interaction is slower, creates provider load, and makes results harder to reproduce.

`build_terrain_features.py` accepts a local DEM GeoTIFF/COG and writes a multi-band terrain-feature GeoTIFF containing:

1. elevation (m)
2. slope (degrees)
3. aspect (degrees clockwise from north)
4. profile/along-gradient curvature proxy
5. plan/cross-gradient curvature proxy
6. ruggedness (local standard deviation, m)
7. potential release-area score (0–1)
8. connected-steep-terrain / overhead score (0–1)
9. simple runout-corridor proxy (0–1)

The release/runout products are **screening features**, not physical avalanche simulation. A later stage should evaluate a dedicated process model such as Flow-Py or another validated avalanche-runout method against expert/historical maps.

## Recommended terrain sources

- Catalonia: ICGC 5 m DTM for reproducible cross-region preprocessing; higher-resolution LiDAR products can be evaluated separately.
- France: IGN RGE ALTI 1 m / 5 m.
- Spanish Pyrenees outside Catalonia: IGN/PNOA MDT05 (5 m) as a common baseline; MDT02 where complete and appropriate.
- Andorra: official 2025 LiDAR products include a 50 cm MDT. Use the licensed/downloaded national DEM as the native source, then harmonize to 5 m for the cross-border model while retaining the 0.5 m source metadata for local validation.

For a cross-border model, use a harmonized **5 m modelling grid** where possible. Keep `dem_source`, `dem_date`, `native_resolution_m`, and resampling method as metadata because mixed source quality otherwise leaks into the model.

## Example

```bash
pip install -r requirements.txt
python build_terrain_features.py \
  --dem /data/pyrenees_dem_5m.tif \
  --output /data/pyrenees_terrain_features.tif
```

For very large Pyrenees rasters, run by buffered tiles and mosaic the output. The script is deliberately deterministic and does not download third-party datasets automatically.
