# Historical avalanche imports

This directory is intentionally empty in the public repository. Historical avalanche datasets are large and their redistribution terms differ by provider.

The app checks for the following normalized GeoJSON files:

- `france-clpa-epa.geojson`
- `andorra-allaus.geojson`
- `spain-pyrenees-avalanches.geojson`

Catalonia is displayed directly from the official ICGC avalanche WMS and is not copied into this repository.

## Normalized feature properties

Each imported feature should use EPSG:4326 and retain, where available:

- `source` — provider/inventory name
- `source_event_id` — stable provider identifier
- `event_date` / `date_start` / `date_end`
- `inventory_kind` — `event`, `historical_extent`, `release_area`, `path`, or `observation`
- `trigger`, `avalanche_type`, `size`
- `crown_depth_cm`, `crown_width_m`
- `location_confidence`
- `source_url`
- `source_license`

Do **not** convert absence of a historical feature into a “safe” label. Avalanche inventories are observation-biased and incomplete.

## Source notes

### Catalonia — ICGC / BDAC

Official WMS: `https://geoserveis.icgc.cat/geoserver/nivoallaus/wms`

Useful layers include `zonesallaus`, `enquestes` and `observacions`. The application streams these directly.

### France — EPA / CLPA

The EPA event inventory and CLPA mapped avalanche extents are highly valuable, but the public-site terms and redistribution conditions must be reviewed before bundling copies. Keep this repository importer-only unless permission/licensing is confirmed.

### Andorra

The official IDE Andorra service catalogue lists a dedicated avalanche WMS:

`https://www.ideandorra.ad/Serveis/wms_allaus/wms`

v4.2 discovers the service's named layers from GetCapabilities and streams the WMS directly when available. The current general legal notice restricts reproduction/republication of portal contents without prior written permission, so this public repository does **not** copy or normalize Andorran avalanche geometries automatically. Confirm a dataset-specific licence or obtain permission before redistributing an export.

Andorra also publishes 2025 LiDAR-derived terrain products including an official **50 cm MDT**, which is suitable as a native source for the offline terrain pipeline before harmonizing to the common 5 m modelling grid.

### Spanish Pyrenees outside Catalonia

Regional hazard/cartographic products exist, but this project has not identified a single chain-wide historical event inventory equivalent to BDAC/EPA. Keep regional imports source-labelled instead of merging them as if they had identical completeness.
