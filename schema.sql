-- Pyrenees Avalanche Network database schema
-- Run this once against the PostgreSQL database configured in DATABASE_URL.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS observations (
    id SERIAL PRIMARY KEY,
    type VARCHAR(30) NOT NULL CHECK (type IN ('trip_report', 'avalanche', 'accident', 'snowpack')),
    geom GEOMETRY(Point, 4326) NOT NULL,
    season_year INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    details JSONB NOT NULL,
    owner_token_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_obs_geom ON observations USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_obs_type_season ON observations (type, season_year);

ALTER TABLE observations ADD COLUMN IF NOT EXISTS owner_token_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_obs_owner ON observations (owner_token_hash);

-- The server uses the table owner connection; no direct anonymous REST policies.
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
