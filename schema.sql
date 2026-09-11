-- Step 1: Enable PostGIS (adds geographic spatial capabilities to PostgreSQL)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Step 2: Create the central observations table
CREATE TABLE IF NOT EXISTS observations (
    id SERIAL PRIMARY KEY,
    type VARCHAR(30) NOT NULL, -- Options: 'trip_report', 'avalanche', 'accident', 'snowpack'
    geom GEOMETRY(Point, 4326) NOT NULL, -- Stores exact GPS point (Longitude, Latitude) in WGS84
    season_year INT NOT NULL, -- e.g., 2026. Used to archive old trip reports
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    details JSONB NOT NULL -- Flexible JSON field for snowpack & avalanche parameters
);

-- Step 3: Spatial Index for fast spatial map queries
CREATE INDEX IF NOT EXISTS idx_obs_geom ON observations USING GIST (geom);

-- Step 4: Index for fast type + season filtering
CREATE INDEX IF NOT EXISTS idx_obs_type_season ON observations (type, season_year);

-- Rebuild the spatial index
CREATE INDEX idx_observations_geom ON observations USING GIST (geom);
