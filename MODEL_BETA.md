# Terrain Beta — Pyrenees prototype (v4.2)

## Safety purpose and display rule

Terrain Beta is **experimental decision-support information**. It is not an avalanche bulletin, a route recommendation, a slope-level forecast, or proof that a route is safe.

Every time the Terrain Beta page is selected, the app now requires acknowledgement of a dedicated warning. The public display keeps these concepts separate:

1. **Official regional avalanche danger** — authoritative regional context.
2. **Local release susceptibility** — terrain/loading screening score.
3. **Connected/overhead exposure** — steep terrain above and a first runout-corridor proxy.
4. **Displayed advisory score** — conservatively cannot fall below the current official regional danger floor.

A flat/unconnected cell may therefore be described as having low *local release susceptibility*, but the app does not relabel an official Danger 3 region as “Danger 1”.

## Live v4.2 terrain engine

`GET /api/terrain/analyze?lat=...&lng=...&radiusKm=0.5&grid=25`

The endpoint resolves the official warning region and chooses the best currently wired terrain source:

- **France:** IGN RGE ALTI high-resolution elevation sampling.
- **Catalonia / Val d'Aran:** ICGC Digital Terrain Model WCS, using the 5 m source where the requested resolution selects it.
- **Other areas:** explicit Open-Meteo/Copernicus elevation fallback while the production 5 m national/Andorran preprocessing path is completed.

For each analysis window it derives:

- elevation;
- slope and aspect;
- a curvature/convexity proxy;
- potential release-area score;
- recent snowfall/rain/warming/wind factors;
- lee-side wind-loading proxy;
- connected higher/steeper terrain;
- first geometric runout-corridor proxy;
- local release/exposure scores;
- conservative displayed advisory floor from the official regional danger.

`GET /api/terrain/point` uses the same terrain-source logic to automatically populate elevation, slope and aspect when a user starts a field report. The values stay editable because a field measurement may be better than a raster estimate.

## Production high-resolution preprocessing

The repository now includes `terrain_pipeline/build_terrain_features.py`. It accepts a projected local DEM and deterministically builds a multi-band terrain raster with:

- elevation;
- slope;
- aspect;
- profile and plan curvature proxies;
- ruggedness;
- potential release-area score;
- connected/overhead steep-terrain score;
- runout-corridor screening proxy.

A **5 m harmonized modelling grid** is the recommended cross-border baseline where available. Native 1–2 m/50 cm data remain valuable for local validation, but mixing resolutions without provenance can itself become a model artefact.

The geometric runout feature is intentionally not presented as avalanche dynamics. Before operational consideration it should be compared with historical/expert avalanche paths and, ideally, a validated process/runout method.

## Historical avalanche data architecture

The app now has a common historical-overlay loader and a source registry in `data/historical/`.

### Catalonia — BDAC / ICGC

ICGC's BDAC combines mapped avalanche zones and season-by-season information. The app directly streams official WMS layers:

- `zonesallaus` — mapped avalanche zones;
- `enquestes` — historical avalanches from surveys;
- `observacions` — recent observed avalanches.

This source is already useful for visual validation of derived release/path terrain.

### France — EPA + CLPA

France has two complementary inventories:

- **EPA** — event chronology on observed avalanche sites; useful for the dynamic dated-event model.
- **CLPA** — mapped/extreme known avalanche extents; useful for static terrain/path validation.

The repository does **not** redistribute these datasets automatically. Their current reuse/redistribution conditions should be reviewed before committing a normalized copy. The app exposes an importer slot (`france-clpa-epa.geojson`) only after a licence-cleared export is installed.

### Andorra

The official IDE Andorra catalogue explicitly lists the avalanche WMS at `https://www.ideandorra.ad/Serveis/wms_allaus/wms`. v4.2 discovers the named WMS layers from GetCapabilities at runtime and streams them directly when available, so the repository does not copy or redistribute the underlying avalanche dataset. A normalized import slot remains as a permission/licence-cleared fallback.

For terrain, Cartografia d'Andorra publishes a 2025 LiDAR-derived **50 cm MDT**. The production pipeline can ingest that native DEM and harmonize it to the cross-border 5 m modelling grid while preserving source-resolution metadata.

### Spanish Pyrenees outside Catalonia

No single chain-wide dated avalanche-event database equivalent to BDAC/EPA has yet been identified. Regional products should remain provider-labelled rather than being treated as equally complete observations.

For terrain, however, Spain's national IDEE OGC API exposes a 5 m LiDAR-derived DTM for the Iberian Peninsula/Balearics under its published service licence. The repository's production preprocessing design is ready to use this 5 m source or downloaded PNOA MDT05 tiles.

## ML phase: now scaffolded

The repository now includes a research pipeline under `ml/`.

### Model A — static terrain susceptibility/exposure

Purpose: learn how DEM-derived terrain, forest/roughness and known avalanche extents relate to release/path/runout terrain.

Good labels/evidence:

- BDAC avalanche zones and surveyed extents;
- CLPA extents where reuse permits;
- Andorran/Spanish regional mapped avalanche paths;
- quality-controlled community-drawn crown/path geometry.

This is comparatively stable through time, but it is **not perfectly objective**: DEM quality, forest, terrain traps, map completeness and runout assumptions matter.

### Model B — dynamic avalanche activity

Purpose: estimate relative avalanche activity under a dated terrain/weather/bulletin state.

Useful dated evidence:

- EPA events;
- dated BDAC/recent observations;
- future verified community avalanche reports;
- historical official bulletins;
- reanalysis/weather history (snowfall, rain, temperature, wind, radiation, snow-depth proxy).

The Open-Meteo archive can provide long reanalysis histories, but source/model/resolution must be kept as metadata and snow-depth fields should not be treated as a full snowpack model.

### Baseline model family

`ml/train_models.py` currently compares:

- logistic regression (interpretable sanity check);
- random forest;
- histogram gradient boosting.

The intention is **model diversity**, not blindly averaging everything. A later ensemble should only combine candidates that add independent validated skill.

## Critical data-science rule: inventory absence is not safety

Historical avalanche datasets are observation-biased. Areas near roads, ski resorts, settlements and established observation sites are more likely to have records. Therefore:

> no historical avalanche record ≠ verified non-avalanche terrain.

The ML schema explicitly stores `label_kind` and supports presence/background or pseudo-absence training. Random point train/test splits are prohibited for serious evaluation because neighbouring cells share terrain and weather.

Validation should include:

- grouped spatial blocks/whole-valley holdouts;
- held-out winter seasons;
- country/provider-specific performance;
- calibration and Brier score as well as ranking metrics;
- failure analysis by official danger level and avalanche problem.

## Report data improvements for future modelling

v4.2 field reports now preserve:

- observation date/time separately from upload time;
- automatically derived elevation/slope/aspect plus source metadata;
- user-editable terrain values;
- direct/group/second-hand observation provenance;
- mapped-location precision;
- avalanche crown line and path polygon;
- size/type/trigger/crown depth/crown width;
- snow profile/test information and photographs where supplied.

These fields make community observations substantially more useful as future evidence, while still allowing confidence weighting.

## Next research milestones

1. Build/serve precomputed 5 m cross-border terrain tiles instead of live-querying large windows.
2. Confirm licence-compatible France/Andorra/regional Spain historical exports and normalize them.
3. Compare derived release/overhead/runout products against BDAC/CLPA/expert maps.
4. Build dated event + weather/bulletin table with explicit provenance and observation bias.
5. Train static terrain candidates first, then dynamic activity candidates.
6. Reserve complete geographic areas and winters for final testing.
7. Keep ML results out of the public safety layer until calibration, uncertainty and failure modes are acceptable.

## Source starting points

- ICGC BDAC / avalanche WMS: https://www.icgc.cat/ and https://geoserveis.icgc.cat/geoserver/nivoallaus/wms
- ICGC DTM WCS: https://geoserveis.icgc.cat/icc_mdt/wcs/service
- France EPA/CLPA: https://www.avalanches.fr/
- France RGE ALTI: https://geoservices.ign.fr/rgealti
- Spain IDEE OGC API Coverages: https://api-coverages.idee.es/
- Spain PNOA terrain downloads: https://pnoa.ign.es/pnoa-lidar/productos-a-descarga
- IDE Andorra avalanche WMS catalogue: https://www.cartografia.ad/serveis-ogc
- IDE Andorra LiDAR/MDT downloads: https://www.cartografia.ad/dades-lidar
- Open-Meteo historical weather: https://open-meteo.com/en/docs/historical-weather-api

## v4.3 route-scale architecture

The interactive map now targets 5–10 km route-planning context. A 10 km radius contains roughly 16 million cells at 5 m resolution, so native DEM derivatives must be precomputed offline rather than recalculated on every click. The browser receives a bounded regular grid and renders it as a smooth interpolated surface; this interpolation is visual and does not create extra model information.

The first legally conservative research target is Catalonia static terrain susceptibility. `research_pipeline/download_icgc_zone_mask.py` converts the public ICGC `zonesallaus` WMS into an aligned raster label and `build_static_training_table.py` samples it against the terrain feature stack. Outside mapped zones is treated as background/unmapped, never as verified safe terrain.

Dynamic avalanche-activity training remains gated on dated event inventories with clear reuse permission. Community reports can already satisfy that schema when their observation date/location/provenance is adequate.
