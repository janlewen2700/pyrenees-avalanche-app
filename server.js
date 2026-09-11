const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/avalanche_db',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});
// Database Connection Settings
//const pool = new Pool({
    //user: process.env.DB_USER || 'postgres',
    //host: process.env.DB_HOST || 'localhost',
    //database: process.env.DB_NAME || 'avalanche_db',
    //password: process.env.DB_PASSWORD || 'password',
    //port: process.env.DB_PORT || 5432,
//});

// GET /api/observations: Fetches spatial observations in GeoJSON format
app.get('/api/observations', async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        
        // QUERY RULE:
        // 1. 'avalanche' and 'accident' remain permanently across ALL years.
        // 2. 'trip_report' and 'snowpack' are shown ONLY for the current season.
        const query = `
            SELECT json_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(json_agg(
                    json_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(geom)::json,
                        'properties', json_build_object(
                            'id', id,
                            'type', type,
                            'season_year', season_year,
                            'created_at', created_at,
                            'details', details
                        )
                    )
                ), '[]'::json)
            ) AS geojson
            FROM observations
            WHERE type IN ('avalanche', 'accident')
               OR season_year = $1;
        `;
        
        const { rows } = await pool.query(query, [currentYear]);
        res.json(rows[0].geojson);
    } catch (err) {
        console.error('Error fetching observations:', err);
        res.status(500).json({ error: 'Database query error' });
    }
});

// POST /api/observations: Saves a new citizen observation
app.post('/api/observations', async (req, res) => {
    const { type, lat, lng, season_year, details } = req.body;

    if (!type || !lat || !lng || !details) {
        return res.status(400).json({ error: 'Missing required observation parameters' });
    }

    try {
        // ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) creates PostGIS geometry
        const query = `
            INSERT INTO observations (type, geom, season_year, details)
            VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5)
            RETURNING id;
        `;
        const values = [
            type,
            parseFloat(lng), // Longitude is X
            parseFloat(lat), // Latitude is Y
            season_year || new Date().getFullYear(),
            details
        ];

        const { rows } = await pool.query(query, values);
        res.json({ success: true, id: rows[0].id });
    } catch (err) {
        console.error('Error saving observation:', err);
        res.status(500).json({ error: 'Database insert error' });
    }
});

// GET /api/bulletin: Mock/Proxy endpoint for ICGC Catalan Pyrenees Regions with EAWS status
app.get('/api/bulletin', (req, res) => {
    // Current operational status toggle (true = active winter season, false = summer/out of season)
    const isSeasonActive = true;

    // GeoJSON defining Pyrenean forecasting zones with EAWS danger ratings
    const bulletinGeoJSON = {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {
                    region: "Aran - Franja Nord de la Ribagorça",
                    danger_level: isSeasonActive ? 3 : 0, // Level 3: Orange (Considerable)
                    primary_problem: "Wind Slab / Persistent Weak Layer",
                    issued_at: isSeasonActive ? "2026-03-01" : null
                },
                geometry: {
                    type: "Polygon",
                    coordinates: [[[0.6, 42.6], [0.95, 42.6], [0.95, 42.85], [0.6, 42.85], [0.6, 42.6]]]
                }
            },
            {
                type: "Feature",
                properties: {
                    region: "Pallaresa - Ribagorçana",
                    danger_level: isSeasonActive ? 2 : 0, // Level 2: Yellow (Moderate)
                    primary_problem: "Wind-drifted snow",
                    issued_at: isSeasonActive ? "2026-03-01" : null
                },
                geometry: {
                    type: "Polygon",
                    coordinates: [[[0.95, 42.35], [1.3, 42.35], [1.3, 42.6], [0.95, 42.6], [0.95, 42.35]]]
                }
            },
            {
                type: "Feature",
                properties: {
                    region: "Ter - Freser / Cerdanya",
                    danger_level: isSeasonActive ? 1 : 0, // Level 1: Green (Low)
                    primary_problem: "None",
                    issued_at: isSeasonActive ? "2026-03-01" : null
                },
                geometry: {
                    type: "Polygon",
                    coordinates: [[[1.8, 42.25], [2.4, 42.25], [2.4, 42.45], [1.8, 42.45], [1.8, 42.25]]]
                }
            }
        ]
    };

    res.json(bulletinGeoJSON);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Avalanche Safety Server running on http://localhost:${PORT}`));
