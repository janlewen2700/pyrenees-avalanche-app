# Avalanche app v4.4 — implementation and next steps

This is a revised source project reconstructed from your combined Markdown attachment. It is not deployed to GitHub, Render or Supabase. Your existing source files are retained except for the changes below; original binary photographs, DEMs and database contents were not recoverable from the text export. Do not overwrite your original photo/data directories with an empty replacement.

## 1. What changed

- Elevation (altitude above sea level), aspect (slope direction) and slope move into a collapsed **Extra terrain parameters** section. They still populate automatically. Unknown values remain unknown and do not block a report. Manual edits survive delayed requests; earlier location requests cannot overwrite a later location. The submitted payload records the original terrain estimate and which fields were manually edited.
- Avalanche, incident, snow, test and trip markers now have distinct icons: 🏔️, 🚨, 🔎, 🧪 and 🎿. Type names remain visible; emoji are not the only meaning cue.
- The language menu offers English, Catalan, Spanish, French, Aranese and Basque. German/Italian are removed from selectable locales; previously saved preferences for them fall back to English. The selected Catalan language retains its CSS senyera, and Aran/Basque have regional flags.
- Aranese and Basque have partial draft interface dictionaries with an explicit notice and English fallback. This implements your smaller language option, not a claim of full translation. Existing dictionaries are now served correctly and the learning-page exclusion is removed. Remaining dynamic English, untranslated safety text and native review are still work to do.
- The information resources retain ICGC, AEMET, Météo-France and Andorra, and add Lauegi for Val d’Aran. The existing provider resolver already included Lauegi.
- About-page photo slots are ready for snow, landscapes and fieldwork; missing photographs show a labelled empty state. Background filenames now match your original uppercase `.JPG` names on Linux. Observation photo attachments already existed and are preserved.
- The terrain display uses purple shades for local terrain/weather context. Official regional danger remains separately labelled. It now displays source warnings, effective sampling information, bulletin date and calculation time. A failed/new analysis clears the previous surface. This remains an untrained heuristic; historical overlays are not yet model features. The legacy advisory score remains in the API for compatibility, but no longer drives the displayed colours.
- Root-level translations, hazard helpers, manifest and service worker now have explicit routes alongside `public/`. Missing assets return 404, not the HTML app shell. The check command uses the actual `public/app.js` path.
- Production cannot silently fall back to a disposable JSON file. Database failures return an error; reconnect attempts are allowed after a cooldown. Local development JSON writes are serialized and atomic. Database TLS certificate verification is enabled and the observations table has row-level security enabled for direct database-API access; the backend uses the table-owner connection.
- The existing PWA service worker is now registered and served. It caches only the same-origin application shell, not observations, bulletins, weather or map tiles. It does not make the app fully usable offline.
- Training requires an explicit predictor list and a two-class independent development holdout; unmatched holdouts fail. Each model gets its own fitted preprocessing. All-missing weather is not silently treated as zero precipitation; wind direction uses a circular mean; hourly data at/after the event cutoff are excluded.

## 2. Fix persistence on Render / Supabase

**The file can be written; its lifetime is the problem.** The original server fell back to `data/observations.json` when `DATABASE_URL` was missing or initialization failed. Render's default filesystem is ephemeral: local modifications disappear on restart or redeploy. This is a strong code-based explanation, not a verified diagnosis of your account. [Render persistent disk documentation](https://render.com/docs/disks).

Use Supabase Postgres as the authoritative store:

1. Back up existing observations before deploying. Export any still-existing fallback JSON from the old service and separately retain your Supabase data. Files already lost on an ephemeral disk are not reconstructed by this update.
2. Create a branch in your GitHub project and copy these changed sources over it. Retain your photographs and real datasets. Review changes before merging.
3. In Supabase, open **Connect** and copy the appropriate Postgres connection URI. A persistent server can use a direct connection when network-compatible; the session pooler is the documented alternative for IPv4-only connectivity. Use the database password, not a Supabase API key. [Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres).
4. In Render's service environment, set `DATABASE_URL` to that URI and `NODE_ENV=production`. Never put it in frontend JavaScript or GitHub. Percent-encode special characters in URI passwords. Keep certificate verification enabled. If your connection needs a provider CA, download it from Supabase and configure `NODE_EXTRA_CA_CERTS` with its path on Render; avoid URI SSL options that override the driver's TLS configuration.
5. Run `schema.sql` against the intended database with the owner/admin connection. The app also attempts initialization. Existing databases may place PostGIS in `extensions`; ensure the backend role's `search_path` includes the schema containing PostGIS functions/types. If logs show missing `geometry` or `ST_*`, fix the extension/search path rather than changing storage mode. The backend role must own the table or have explicitly designed RLS policies; do not add anonymous write policies to make initialization errors disappear.
6. Render should run a **Node web service**, with the project root containing `package.json` and `server.js`, build command `npm ci` and start command `npm start`. If the repo contains this folder as a subdirectory, set Render's Root Directory accordingly.
7. Open `/api/health`. Require `storage: "postgresql-postgis"` and `persistentAcrossDeploys: true`. A 503 means the database is not ready; the app remains viewable, but observations are unavailable. Check Render logs for the actual error. Merely having a Supabase project does not connect this server to it.
8. Publish one clearly identified test avalanche, reload it in another browser, restart/redeploy Render and confirm that it remains. Delete the test using its originating browser. An end-to-end hosted persistence check is still required.

Local JSON is deliberately limited to development and does not scale across service instances. Connecting Supabase does **not** automatically migrate old fallback records; perform a backed-up, deduplicated import preserving observation dates and ownership hashes before discarding that file.

The existing app filters snow/trip reports to its current season; older records can remain in the database while being hidden from the map. Avalanche/incident reports are permanent. Before historical training, harmonize the existing app's November/end-year season convention with the research script's September/start-year convention. Use event timestamps as the primary reference.

## 3. Why terrain may work locally but fail online

The current server does **not** read a local DEM for its live terrain endpoints. It requests IGN France elevation, ICGC WCS or Open-Meteo elevation. Simply committing a GeoTIFF would not make this server use it. The preprocessing scripts generate rasters for research; there is no production raster-serving adapter in this release.

After deploying, inspect the browser Network panel:

- `/translations.js`, `/hazard-model.js` and `/sw.js` must return JavaScript, not HTML. That routing defect is fixed here.
- `/api/terrain/point?lat=42.5&lng=1.2` must return JSON. Check the returned source and actual values.
- For `/api/terrain/analyze`, distinguish a provider error, timeout, invalid data and a Render service failure. Copy the response and corresponding server log when diagnosing. Hosted upstream requests are not verified in this package.

A 1 m source does not imply 1 m analysis: the live grid samples across a 5–10 km radius. The returned effective spacing is what matters. A smooth overlay adds no terrain information. No-data must remain unavailable, never a zero-elevation safe-looking surface.

For production, preprocess buffered regional DEM tiles, retain CRS/source/date/resolution metadata, publish terrain features as versioned raster tiles or Cloud Optimized GeoTIFFs in object storage, and implement a server reader/tile endpoint. Add asynchronous jobs and shared caches for expensive calculations. Keep large rasters out of the ordinary source repository. This is the main architectural step still needed for reliable, reproducible terrain delivery.

## 4. Public historical data and model readiness

Two research targets must stay separate:

| Target | Suitable labels | What it cannot establish |
|---|---|---|
| Static terrain susceptibility / extent | Mapped avalanche paths, release areas and documented inventory footprints | Today's probability, snow stability, safe travel |
| Activity for a specified place and time | Dated events, location/time uncertainty, consistent observation coverage, and documented comparison sampling | A slope-level probability from opportunistic reports alone |

France's EPA records events at selected observation sites; CLPA represents historical maximum known extents. They are useful candidates for different targets, not interchangeable labels or current warnings. Obtain the exact downloadable product and dataset licence before importing. [INRAE's EPA/CLPA portal](https://www.avalanches.fr/).

| Candidate | Intended use | Gate before training |
|---|---|---|
| ICGC avalanche mapping / published observations | Static extent work; dated events only where a documented export exists | Verify exact dataset licence, coverage and usable geometry. Do not infer dates from zone polygons. |
| Public EPA / CLPA products | Dated-site research / static validation respectively | Confirm product-specific open reuse terms and event/site identifiers. |
| Andorran public avalanche mapping | Context and possible static validation | Public viewing alone does not establish a bulk-training/republication licence. Leave unapproved products out. |
| Public IGN/CNIG/ICGC DEM products | Terrain predictors | Record exact product licence, vertical reference, date, resolution and redistribution conditions. [IGN RGE ALTI catalogue](https://geoservices.ign.fr/rgealti). |
| Open-Meteo historical weather | Reanalysis-based research predictors | Record weather model/version/grid and request parameters. Reanalysis is not a weather observation at each slope, nor necessarily the information available to a forecaster at that time. [Historical API documentation](https://open-meteo.com/en/docs/historical-weather-api). |
| Published official bulletins | Region/date context and an operational comparison baseline | Keep issue/validity times and source links; confirm archive reuse terms. Regional ratings are not event labels. |

Open-Meteo API data require attribution under CC BY 4.0. API access conditions and data reuse terms are separate checks; preserve attribution and transformation details. [Open-Meteo licence](https://open-meteo.com/en/licence).

The source registry now marks bulk training as unapproved pending documented public terms. This metadata is a review record, not an automatic enforcement system. The existing standalone download/normalization scripts still require operator review. In particular, the ICGC WMS-mask script treats rendered nontransparent pixels as mapped terrain: that can capture cartographic styling and must not be treated as an authoritative release-zone label without comparison against source geometry. Prefer licensed vector exports.

For every imported dataset record: source URL, exact open licence URL/name, attribution, retrieval date, release version, file checksum, geographic/time coverage and permitted use. For every event record: stable source/event ID, geometry role (release/path/deposit), event time or interval, coordinate precision, reporting method and label confidence. Do not use private centre records, private trip tracks, permission-only replacements or scraped personal reports. If an open export is unavailable, leave that source disabled.

**You can start data preparation now, outside winter.** Start static baseline training after a licensed DEM/inventory pair and geographically separated validation areas are ready. Start activity experiments after matching dated events to pre-event weather, defining the observation unit and comparison sampling, and reserving independent valleys and winters. There is no honest universal minimum number of rows: effective independent events and coverage matter more than pixel count. A small collection supports pipeline experiments; many pixels from the same event do not create independent evidence.

Before public model use:

- Audit duplicates across providers, event/site grouping and spatial buffers. Background/unreported locations are not confirmed non-events. Estimate reporting effort and bias.
- Exclude outcomes such as casualties, final avalanche size and post-event geometry from forecasting predictors. A label-derived inventory layer cannot also be an input to the same target.
- Train simple baselines first. Select using development folds; reserve another untouched spatial/temporal test. Report precision-recall, calibration, false negatives, performance by region/altitude/season and uncertainty. Brier scores on pseudo-absence samples do not establish population probability calibration.
- For operational evaluation, use archived forecasts available at each prediction issue time, with event windows and timezone handling defined. Reanalysis-only success is not evidence of real-time forecast skill.
- Agree evaluation criteria with avalanche professionals and run a prospective shadow pilot. Nothing in this update trains or deploys a real avalanche forecasting model.

## 5. A stronger avalanche-centre pitch

My recommendation is to pitch **a cross-border observation intake and evidence workspace** first. The strongest near-term value is useful field information that forecasters can inspect quickly, with traceable provenance and uncertainty.

Prioritize: durable submissions; moderation and duplicate linking; editable reports with revision history; observation precision/time/age badges; structured exports agreed with centres; and a dashboard showing which reports add new evidence in poorly observed areas. Separate reporter claims, reviewer status, official bulletins and experimental outputs everywhere.

Next, add idempotent submissions, authenticated cross-device ownership, configurable provider links, server feature flags, upload storage and moderation, rate limits, backups and recovery checks. The current browser token permits deletion only from that browser; it is not an account system. Photos stored in JSON are adequate for a small prototype but inefficient at scale. Migrate files to object storage, retaining ownership/consent/retention rules and authenticated upload limits.

For route planning, show route segments, overhead connected terrain, data gaps and dated evidence. Avoid a single “safe route” number. Validate runout/terrain traps against expert maps before presenting them as reliable physical predictions. The current heuristic and smooth live grid are not a substitute for that work.

Before a centre-facing pilot, also add abuse controls and media validation, audit the API/privacy model, move schema migrations out of startup, test restoration, and set operational availability targets. These are remaining tasks, not implemented features.

## 6. Turning it into an app

The existing web app already has a manifest. This update makes its service worker reachable and registers it, creating a basis for an installable web app where the browser supports it. It does not yet deliver complete offline maps, offline reporting or app-store distribution.

My suggested order:

1. Make the responsive web app dependable and usable with gloves/poor connectivity. Test actual iOS/Android devices; add suitable raster app icons and install guidance.
2. Add explicit offline drafts in IndexedDB, visible pending/sent/failed states, server idempotency keys, photo queues and deliberate retry. Do not silently auto-publish stale drafts. Make cached bulletin timestamps and offline status impossible to miss.
3. Add GPS permissions, battery-conscious location use and carefully licensed offline map packs. Do not promise emergency communications when offline.
4. Consider a native wrapper only when distribution, camera, background uploads or platform integration require it. Store review, permissions, signing, accessibility, crash monitoring and long-term maintenance become additional work.

Success depends more on sustained observation quality and centre adoption than on an app-store listing. Measure completion time, successful durable submissions, valid location/time coverage, reviewer usefulness and repeat participation before adding complex prediction features.

## Verification and limitations

Passed: JavaScript syntax checks; server integration checks for routing, unknown terrain, validation, ownership, concurrent saves, restart persistence and database failure guards; four form-lookup race/override/failure tests; synthetic training of all three baselines plus invalid holdouts, missing weather and circular wind checks. Synthetic test data/models are temporary and are not distributed as trained avalanche models.

Not verified: your live Supabase or Render environment, upstream terrain availability from Render, raster pipelines against real DEMs, complete translations, native-speaker terminology, visual browser/mobile layout. Browser installation failed in this environment, so perform the checklist in `tests/MANUAL_QA.md` before deployment. Original photographs remain yours to restore.


## Run Locally
On a linux/mac (On windows, ask AI) with brew you can run this:
```bash
brew services start postgresql
npm install
npm start
```

The command `npm start`, gives a local host and the webpage can be seen locally. The following is just for some test. Run a program to read all files inside the folder and then it is easier to send to AI for explanations. 

Run locally with Node and `npm ci`, then `npm start`. Run `npm run check`, `python tests/server-smoke.py`, and `node --test tests/terrain-form.test.cjs`. Install `ml/requirements.txt` in a virtual environment before `python tests/ml-smoke.py`. No credentials or private datasets are included.

