# Pyrenees research dataset pipeline — v4.3

This pipeline deliberately separates **static terrain susceptibility** from **dated avalanche activity**.

## 1. High-resolution static terrain

Use the best legally reusable DEM for each area, preprocess once, and never recompute millions of raw DEM cells on each map click.

- Catalonia: ICGC high-resolution terrain models are published under CC BY 4.0. Current product pages describe terrain models down to 50 cm. For a cross-Pyrenees research grid, resample derivatives to **5 m** for a consistent working resolution while retaining the native source DEM separately.
- Spain outside Catalonia: CNIG/IGN PNOA MDT05 is 5 m and its download pages state a licence compatible with CC BY 4.0, with attribution required.
- France / Andorra: keep adapters separate and only ingest datasets after their dataset-specific reuse terms are confirmed for this project.

Example:

```bash
python terrain_pipeline/build_terrain_features.py --dem catalonia_dem.tif --target-resolution 5 --output data/terrain/catalonia_features_5m.tif
```

A **10 km radius** contains ~16 million 5 m cells, so the web application must read precomputed features and downsample for display rather than recomputing all cells live.

## 2. Catalonia static avalanche labels

`download_icgc_zone_mask.py` downloads the public ICGC `zonesallaus` WMS as an aligned raster presence mask. It is for *terrain susceptibility* training/validation, not dated avalanche forecasting.

```bash
python research_pipeline/download_icgc_zone_mask.py \
  --bbox 320000,4680000,430000,4765000 --resolution 5 \
  --output data/labels/icgc_zonesallaus_5m.tif
```

Then sample a manageable research table:

```bash
python research_pipeline/build_static_training_table.py \
  --features data/terrain/catalonia_features_5m.tif \
  --labels data/labels/icgc_zonesallaus_5m.tif \
  --out ml/data/catalonia_static.parquet
```

**Important:** pixels outside mapped avalanche zones are background/unmapped, not verified negatives.

## 3. Dated activity dataset

Only add an event to the dynamic model if it has a defensible date/time (or explicit uncertainty), coordinates/geometry, source and provenance. Community reports can enter here. Do not infer event dates from static avalanche-zone polygons.

Once dated BDAC observations can be exported through a documented/public interface, normalize them into the same schema. Until then, do not scrape private/internal endpoints.

## 4. Holdouts

Static terrain model: hold out entire 10–20 km spatial blocks or named valleys.

Dynamic activity model: use both **whole-valley** and **whole-winter** holdouts. A random row split is not accepted as final evidence because nearby cells share terrain/weather.

## What downloads automatically?

The current research pipeline is intentionally mixed:

- **ICGC Catalonia avalanche-zone labels:** downloaded directly from the public ICGC WMS by `download_icgc_zone_mask.py`. You do **not** need to download these manually.
- **DEM / elevation rasters:** **not downloaded automatically**. Download the legally reusable DEM/COG for the area you want to process, keep its source/licence metadata, then pass the local GeoTIFF/COG into `terrain_pipeline/build_terrain_features.py`. This makes large preprocessing jobs reproducible and avoids repeatedly hammering public terrain services.
- **Historical weather:** fetched from Open-Meteo only when `ml/build_training_dataset.py --fetch-weather` is used. Cache the resulting dataset afterwards.
- **Community reports:** can be exported from the app database and normalized into the dated-activity schema; no separate external download is needed.
- **France/Andorra historical avalanche datasets:** do not bulk-download or train on them until their dataset-specific reuse permission/licence is confirmed.

So, for the first real Catalonia training run, the main thing you still need locally is the **DEM**. The public ICGC avalanche-zone training mask can be sourced by the script itself.
