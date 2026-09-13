# v4.3 — route-scale terrain + research pipeline

- Terrain Beta defaults to a 10 km radius, with 5 / 7.5 / 10 km route-scale options.
- Every new map click cancels the previous analysis request and recalculates around the new point.
- Replaced pixel rectangles with a smoothly interpolated canvas/image surface. Interpolation is visual only; underlying model values remain discrete and auditable.
- Live terrain computation is bounded for responsiveness; full native-resolution DEM derivatives are designed to be precomputed once and reused.
- Added a Catalonia-first public-data research pipeline: aligned ICGC avalanche-zone mask downloader, 5 m terrain-feature sampling, and auditable training-table creation.
- ML trainer now supports explicit whole-valley/spatial-block and whole-winter holdouts and compares logistic regression, random forest, and histogram gradient boosting.
- France/Andorra event-data ingestion remains disabled unless dataset-specific reuse rights are confirmed.
- Added PWA files so the site can be installed to an iPhone Home Screen as a standalone web app for testing.
