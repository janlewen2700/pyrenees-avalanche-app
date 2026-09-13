-- Optional PostGIS research schema for normalized historical avalanche data.
-- Keep provenance and licensing metadata on every imported record.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS historical_avalanche_events (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    source_event_id TEXT,
    inventory_kind TEXT NOT NULL CHECK (inventory_kind IN ('event','observation','historical_extent','release_area','path','runout')),
    event_time_start TIMESTAMPTZ,
    event_time_end TIMESTAMPTZ,
    geometry GEOMETRY(Geometry, 4326) NOT NULL,
    avalanche_type TEXT,
    trigger TEXT,
    size_class TEXT,
    crown_depth_cm REAL,
    crown_width_m REAL,
    location_confidence TEXT,
    source_url TEXT,
    source_license TEXT,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(source, source_event_id)
);

CREATE INDEX IF NOT EXISTS historical_avalanche_events_geom_gix
    ON historical_avalanche_events USING GIST (geometry);
CREATE INDEX IF NOT EXISTS historical_avalanche_events_time_idx
    ON historical_avalanche_events (event_time_start);

CREATE TABLE IF NOT EXISTS ml_training_samples (
    sample_id BIGSERIAL PRIMARY KEY,
    sample_time TIMESTAMPTZ,
    geom GEOMETRY(Point, 4326) NOT NULL,
    label SMALLINT CHECK (label IN (0,1)),
    label_kind TEXT NOT NULL, -- presence, background, pseudo_absence, verified_absence
    source_event_id TEXT,
    spatial_block TEXT,
    season_year INT,
    terrain JSONB NOT NULL DEFAULT '{}'::jsonb,
    weather JSONB NOT NULL DEFAULT '{}'::jsonb,
    bulletin JSONB NOT NULL DEFAULT '{}'::jsonb,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ml_training_samples_geom_gix
    ON ml_training_samples USING GIST (geom);
CREATE INDEX IF NOT EXISTS ml_training_samples_block_idx
    ON ml_training_samples (spatial_block, season_year);
