const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const dedicatedPublicDir = path.join(ROOT, 'public');
const hasDedicatedPublicDir = fs.existsSync(dedicatedPublicDir);
const publicDir = hasDedicatedPublicDir ? dedicatedPublicDir : ROOT;
const fallbackDataFile = process.env.LOCAL_DATA_FILE || path.join(ROOT, 'data', 'observations.json');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
if (hasDedicatedPublicDir) {
    app.use(express.static(publicDir));
} else {
    app.get('/app.js', (_req, res) => res.sendFile(path.join(ROOT, 'app.js')));
    app.get('/style.css', (_req, res) => res.sendFile(path.join(ROOT, 'style.css')));
    app.get('/index.html', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
}

const databaseUrl = process.env.DATABASE_URL || null;
const pool = databaseUrl
    ? new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
    : null;

let dbReady = false;
let dbInitError = null;
let dbInitPromise = null;
const reverseGeocodeCache = new Map();
const weatherGridCache = new Map();
const avalancheRegionCache = new Map();
const avalancheGeometryCache = new Map();

const BULLETINS = {
    icgc: {
        id: 'icgc',
        label: 'Catalonia · ICGC',
        country: 'ES-CT',
        url: 'https://bpa.icgc.cat/',
        pdfUrl: '/api/icgc/bulletin-pdf'
    },
    spain: {
        id: 'spain',
        label: 'Spain · AEMET',
        country: 'ES',
        url: 'https://www.aemet.es/es/eltiempo/prediccion/montana/boletin_peligro_aludes'
    },
    andorra: {
        id: 'andorra',
        label: 'Andorra · Meteo.ad',
        country: 'AD',
        url: 'https://www.meteo.ad/estatneu'
    },
    lauegi: {
        id: 'lauegi',
        label: "Val d'Aran · Lauegi",
        country: 'ES-CT-L',
        url: 'https://lauegi.report/'
    },
    france: {
        id: 'france',
        label: 'France · Météo-France Pyrenees',
        country: 'FR',
        url: 'https://meteofrance.com/meteo-montagne/pyrenees'
    }
};



const EAWS_REGION_BASE = 'https://regions.avalanches.org/micro-regions/latest';
const EAWS_REGION_NAMES_URL = 'https://regions.avalanches.org/micro-regions_names/en.json';
const EAWS_RATINGS_BASE = 'https://static.avalanche.report/eaws_bulletins';
const PYRENEES_BBOX = { west: -2.5, south: 41.75, east: 3.65, north: 43.75 };
const PYRENEES_REGION_SOURCES = [
    { code: 'ES-CT-L', providerId: 'lauegi', filter: false },
    { code: 'ES-CT', providerId: 'icgc', filter: false },
    { code: 'ES-AR', providerId: 'spain', filter: false },
    { code: 'ES', providerId: 'spain', filter: true },
    { code: 'AD', providerId: 'andorra', filter: false },
    { code: 'FR', providerId: 'france', filter: true }
];

async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'PyreneesAvalancheNetwork/3.0 (citizen-science project)' }
        });
        if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function dateInMadrid(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

function flattenCoordinatePairs(value, output = []) {
    if (!Array.isArray(value)) return output;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        output.push([Number(value[0]), Number(value[1])]);
        return output;
    }
    value.forEach(item => flattenCoordinatePairs(item, output));
    return output;
}

function geometryBbox(geometry) {
    const pairs = flattenCoordinatePairs(geometry?.coordinates || []);
    if (!pairs.length) return null;
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    pairs.forEach(([lng, lat]) => {
        west = Math.min(west, lng); east = Math.max(east, lng);
        south = Math.min(south, lat); north = Math.max(north, lat);
    });
    return { west, south, east, north };
}

function intersectsBbox(a, b) {
    return Boolean(a && !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north));
}

function regionIdFromFeature(feature) {
    const p = feature?.properties || {};
    return String(feature?.id || p.id || p.region_id || p.regionId || p.regionID || p.code || p.ID || '').trim();
}

function regionNameFromFeature(feature, names, regionId) {
    const p = feature?.properties || {};
    const fromProperties = p.name || p.NAME || p.nom || p.NOM || p.label || p.region_name || p.regionName;
    if (fromProperties) return String(fromProperties);
    const named = names?.[regionId];
    if (typeof named === 'string') return named;
    if (named && typeof named === 'object') return String(named.name || named.label || named.en || named.ca || named.es || named.fr || regionId);
    return regionId || 'Avalanche warning region';
}

function dangerForRegion(regionId, ratingMap) {
    if (!regionId || !ratingMap) return null;
    const direct = Number(ratingMap[regionId]);
    if (Number.isFinite(direct) && direct >= 1 && direct <= 5) return direct;
    const subValues = Object.entries(ratingMap)
        .filter(([key]) => key.startsWith(`${regionId}:`))
        .map(([, value]) => Number(value))
        .filter(value => Number.isFinite(value) && value >= 1 && value <= 5);
    if (subValues.length) return Math.max(...subValues);
    return null;
}

async function fetchEawsGeometry(sourceCode) {
    const cached = avalancheGeometryCache.get(sourceCode);
    if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) return cached.data;
    const url = `${EAWS_REGION_BASE}/${sourceCode}_micro-regions.geojson.json`;
    const data = await fetchJsonWithTimeout(url);
    avalancheGeometryCache.set(sourceCode, { timestamp: Date.now(), data });
    return data;
}

async function buildPyreneesAvalancheRegions(date) {
    const cacheKey = `pyrenees:${date}`;
    const cached = avalancheRegionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) return cached.data;

    let names = {};
    let ratings = null;
    const notes = [];
    try { names = await fetchJsonWithTimeout(EAWS_REGION_NAMES_URL); }
    catch (error) { notes.push(`Region names fallback: ${error.message}`); }
    try {
        ratings = await fetchJsonWithTimeout(`${EAWS_RATINGS_BASE}/${date}/${date}.ratings.json`);
    } catch (error) {
        notes.push(`No normalized current-day EAWS rating file for ${date}; regions without another rating stay gray.`);
    }
    const ratingMap = ratings?.maxDangerRatings || null;

    const results = await Promise.allSettled(PYRENEES_REGION_SOURCES.map(async source => ({
        source,
        geojson: await fetchEawsGeometry(source.code)
    })));

    const featuresById = new Map();
    results.forEach(result => {
        if (result.status !== 'fulfilled') {
            notes.push(`A warning-region geometry source was unavailable: ${result.reason?.message || 'unknown error'}`);
            return;
        }
        const { source, geojson } = result.value;
        (geojson?.features || []).forEach((feature, index) => {
            const bbox = geometryBbox(feature.geometry);
            if (source.filter && !intersectsBbox(bbox, PYRENEES_BBOX)) return;
            const regionId = regionIdFromFeature(feature) || `${source.code}-${index + 1}`;
            if (featuresById.has(regionId)) return;
            const provider = BULLETINS[source.providerId] || BULLETINS.spain;
            const dangerLevel = dangerForRegion(regionId, ratingMap);
            featuresById.set(regionId, {
                type: 'Feature',
                id: regionId,
                geometry: feature.geometry,
                properties: {
                    ...feature.properties,
                    region_id: regionId,
                    name: regionNameFromFeature(feature, names, regionId),
                    source_code: source.code,
                    provider_id: provider.id,
                    provider_label: provider.label,
                    bulletin_url: provider.url,
                    danger_level: dangerLevel,
                    danger_date: dangerLevel ? date : null,
                    danger_status: dangerLevel ? 'current' : 'no-current-machine-readable-rating'
                }
            });
        });
    });

    const payload = {
        type: 'FeatureCollection',
        date,
        generatedAt: new Date().toISOString(),
        geometrySource: 'EAWS avalanche warning regions',
        dangerSource: ratingMap ? 'EAWS normalized current-day ratings via static.avalanche.report' : null,
        notes,
        features: [...featuresById.values()]
    };
    avalancheRegionCache.set(cacheKey, { timestamp: Date.now(), data: payload });
    return payload;
}


function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = Number(ring[i][0]), yi = Number(ring[i][1]);
        const xj = Number(ring[j][0]), yj = Number(ring[j][1]);
        const intersects = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || Number.EPSILON) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function pointInGeometry(lng, lat, geometry) {
    if (!geometry) return false;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    return polygons.some(polygon => {
        if (!polygon?.length || !pointInRing(lng, lat, polygon[0])) return false;
        return !polygon.slice(1).some(hole => pointInRing(lng, lat, hole));
    });
}

async function resolveAvalancheRegion(lat, lng) {
    const collection = await buildPyreneesAvalancheRegions(dateInMadrid());
    const matches = (collection.features || []).filter(feature => pointInGeometry(lng, lat, feature.geometry));
    if (!matches.length) return null;
    const priority = { 'ES-CT-L': 5, 'AD': 5, 'ES-CT': 4, 'ES-AR': 4, 'FR': 3, 'ES': 2 };
    matches.sort((a,b) => (priority[b.properties?.source_code] || 0) - (priority[a.properties?.source_code] || 0));
    return matches[0];
}

function getSeasonYear(date = new Date()) {
    return date.getUTCMonth() >= 10 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

function ownerHashFromRequest(req) {
    const token = String(req.get('X-Observer-Token') || '').trim();
    if (token.length < 16 || token.length > 256) return null;
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function initDatabase() {
    if (!pool) {
        dbInitError = 'DATABASE_URL is not configured; using local JSON fallback storage.';
        return false;
    }

    try {
        await pool.query('SELECT 1');
        await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS observations (
                id SERIAL PRIMARY KEY,
                type VARCHAR(30) NOT NULL,
                geom GEOMETRY(Point, 4326) NOT NULL,
                season_year INT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                details JSONB NOT NULL,
                owner_token_hash TEXT
            );
        `);
        await pool.query('ALTER TABLE observations ADD COLUMN IF NOT EXISTS owner_token_hash TEXT;');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_obs_geom ON observations USING GIST (geom);');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_obs_type_season ON observations (type, season_year);');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_obs_owner ON observations (owner_token_hash);');
        dbReady = true;
        dbInitError = null;
        console.log('PostgreSQL/PostGIS storage is ready.');
        return true;
    } catch (error) {
        dbReady = false;
        dbInitError = error.message;
        console.warn(`Database unavailable; using local JSON fallback storage: ${error.message}`);
        return false;
    }
}

function ensureDatabase() {
    if (!dbInitPromise) dbInitPromise = initDatabase();
    return dbInitPromise;
}

async function readFallbackObservations() {
    try {
        const raw = await fsp.readFile(fallbackDataFile, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        if (error.code !== 'ENOENT') console.warn('Could not read fallback observation store:', error.message);
        return [];
    }
}

async function writeFallbackObservations(items) {
    await fsp.mkdir(path.dirname(fallbackDataFile), { recursive: true });
    await fsp.writeFile(fallbackDataFile, JSON.stringify(items, null, 2), 'utf8');
}

function toGeoJsonFeature(item, requesterOwnerHash = null) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(item.lng), Number(item.lat)] },
        properties: {
            id: item.id,
            type: item.type,
            season_year: item.season_year,
            created_at: item.created_at,
            details: item.details || {},
            can_delete: Boolean(requesterOwnerHash && item.owner_token_hash && requesterOwnerHash === item.owner_token_hash)
        }
    };
}

function featureCollection(features) {
    return { type: 'FeatureCollection', features };
}

function validateObservation(body) {
    const allowedTypes = new Set(['trip_report', 'avalanche', 'accident', 'snowpack']);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!allowedTypes.has(body.type)) return { error: 'Invalid observation type.' };
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: 'Latitude must be between -90 and 90.' };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { error: 'Longitude must be between -180 and 180.' };
    if (!body.details || typeof body.details !== 'object') return { error: 'Observation details are required.' };
    return { lat, lng };
}

app.get('/api/health', async (_req, res) => {
    await ensureDatabase();
    res.json({
        ok: true,
        storage: dbReady ? 'postgresql-postgis' : 'local-json-fallback',
        persistentAcrossDeploys: dbReady,
        databaseError: dbReady ? null : dbInitError
    });
});

app.get('/api/observations', async (req, res) => {
    await ensureDatabase();
    const seasonYear = getSeasonYear();
    const ownerHash = ownerHashFromRequest(req);

    try {
        if (dbReady) {
            const query = `
                SELECT id, type, ST_X(geom) AS lng, ST_Y(geom) AS lat,
                       season_year, created_at, details, owner_token_hash
                FROM observations
                WHERE type IN ('avalanche', 'accident') OR season_year = $1
                ORDER BY created_at DESC;
            `;
            const { rows } = await pool.query(query, [seasonYear]);
            return res.json(featureCollection(rows.map(row => toGeoJsonFeature(row, ownerHash))));
        }

        const items = await readFallbackObservations();
        const visible = items.filter(item => ['avalanche', 'accident'].includes(item.type) || item.season_year === seasonYear);
        return res.json(featureCollection(visible.map(item => toGeoJsonFeature(item, ownerHash))));
    } catch (error) {
        console.error('Error fetching observations:', error);
        res.status(500).json({ error: 'Could not load observations.' });
    }
});

app.post('/api/observations', async (req, res) => {
    await ensureDatabase();
    const validation = validateObservation(req.body);
    if (validation.error) return res.status(400).json({ error: validation.error });

    const { type, details } = req.body;
    const seasonYear = Number(req.body.season_year) || getSeasonYear();
    const { lat, lng } = validation;
    const ownerHash = ownerHashFromRequest(req);

    try {
        if (dbReady) {
            const query = `
                INSERT INTO observations (type, geom, season_year, details, owner_token_hash)
                VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5::jsonb, $6)
                RETURNING id, created_at;
            `;
            const { rows } = await pool.query(query, [type, lng, lat, seasonYear, JSON.stringify(details), ownerHash]);
            const created = {
                id: rows[0].id,
                type,
                lat,
                lng,
                season_year: seasonYear,
                created_at: rows[0].created_at,
                details,
                owner_token_hash: ownerHash
            };
            return res.status(201).json({ success: true, feature: toGeoJsonFeature(created, ownerHash), storage: 'postgresql-postgis' });
        }

        const items = await readFallbackObservations();
        const created = {
            id: items.length ? Math.max(...items.map(item => Number(item.id) || 0)) + 1 : 1,
            type,
            lat,
            lng,
            season_year: seasonYear,
            created_at: new Date().toISOString(),
            details,
            owner_token_hash: ownerHash
        };
        items.push(created);
        await writeFallbackObservations(items);
        return res.status(201).json({ success: true, feature: toGeoJsonFeature(created, ownerHash), storage: 'local-json-fallback' });
    } catch (error) {
        console.error('Error saving observation:', error);
        res.status(500).json({ error: 'Could not save observation.' });
    }
});

app.delete('/api/observations/:id', async (req, res) => {
    await ensureDatabase();
    const id = Number(req.params.id);
    const ownerHash = ownerHashFromRequest(req);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid observation id.' });
    if (!ownerHash) return res.status(403).json({ error: 'This browser cannot prove ownership of the observation.' });

    try {
        if (dbReady) {
            const { rows } = await pool.query(
                'DELETE FROM observations WHERE id = $1 AND owner_token_hash = $2 RETURNING id;',
                [id, ownerHash]
            );
            if (!rows.length) return res.status(403).json({ error: 'You can only delete observations created by this browser.' });
            return res.json({ success: true, id });
        }

        const items = await readFallbackObservations();
        const index = items.findIndex(item => Number(item.id) === id && item.owner_token_hash === ownerHash);
        if (index < 0) return res.status(403).json({ error: 'You can only delete observations created by this browser.' });
        items.splice(index, 1);
        await writeFallbackObservations(items);
        return res.json({ success: true, id });
    } catch (error) {
        console.error('Error deleting observation:', error);
        res.status(500).json({ error: 'Could not delete observation.' });
    }
});



app.get('/api/avalanche/regions', async (req, res) => {
    const requested = String(req.query.date || '').trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : dateInMadrid();
    try {
        res.json(await buildPyreneesAvalancheRegions(date));
    } catch (error) {
        res.status(502).json({ error: 'Avalanche warning-region geometry is temporarily unavailable.', details: error.message });
    }
});

app.get('/api/bulletins', (_req, res) => {
    res.json({ providers: Object.values(BULLETINS) });
});

app.get('/api/icgc/bulletin', (_req, res) => {
    res.json({
        source: 'ICGC',
        bulletinPage: BULLETINS.icgc.url,
        bulletinInfoPage: 'https://www.icgc.cat/ca/Ambits-tematics/Riscos-i-emergencies/Allaus/Butlleti-de-Perill-dAllaus-BPA',
        wmsUrl: 'https://geoserveis.icgc.cat/geoserver/nivoallaus/wms',
        forecastZoneLayer: 'zonesnivoclima',
        avalancheZoneLayer: 'zonesallaus',
        pdfResolver: BULLETINS.icgc.pdfUrl
    });
});

function absoluteUrl(href, base) {
    try {
        return new URL(href.replace(/&amp;/g, '&'), base).href;
    } catch (_error) {
        return null;
    }
}

app.get('/api/icgc/bulletin-pdf', async (_req, res) => {
    const source = BULLETINS.icgc.url;
    try {
        const response = await fetch(source, { headers: { 'User-Agent': 'PyreneesAvalancheNetwork/3.0' } });
        if (!response.ok) throw new Error(`ICGC returned ${response.status}`);
        const html = await response.text();
        const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1]);
        const pdfLinks = hrefs
            .map(href => absoluteUrl(href, source))
            .filter(Boolean)
            .filter(url => /\.pdf(?:$|\?)/i.test(url));
        const preferred = pdfLinks.find(url => /bpa|butlleti|allau/i.test(url)) || pdfLinks[0];
        if (preferred) return res.redirect(302, preferred);
        return res.redirect(302, source);
    } catch (error) {
        console.warn('Could not resolve live ICGC bulletin PDF:', error.message);
        return res.redirect(302, source);
    }
});

async function fetchIcgcFeatureInfo(lat, lng) {
    const delta = 0.08;
    const params = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetFeatureInfo',
        LAYERS: 'zonesnivoclima',
        QUERY_LAYERS: 'zonesnivoclima',
        STYLES: '',
        SRS: 'EPSG:4326',
        BBOX: `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`,
        WIDTH: '101',
        HEIGHT: '101',
        X: '50',
        Y: '50',
        FEATURE_COUNT: '5',
        INFO_FORMAT: 'application/json'
    });
    const response = await fetch(`https://geoserveis.icgc.cat/geoserver/nivoallaus/wms?${params.toString()}`);
    if (!response.ok) throw new Error(`ICGC WMS returned ${response.status}`);
    const text = await response.text();
    try { return JSON.parse(text); } catch (_error) { return { raw: text, features: [] }; }
}

app.get('/api/icgc/feature-info', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required.' });

    try {
        res.json(await fetchIcgcFeatureInfo(lat, lng));
    } catch (error) {
        res.status(502).json({ error: 'ICGC feature information is temporarily unavailable.', details: error.message });
    }
});

async function reverseGeocode(lat, lng, zoom = 12) {
    const key = `${lat.toFixed(3)},${lng.toFixed(3)},${zoom}`;
    if (reverseGeocodeCache.has(key)) return reverseGeocodeCache.get(key);
    const params = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), zoom: String(zoom), addressdetails: '1' });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
        headers: { 'User-Agent': process.env.NOMINATIM_USER_AGENT || 'PyreneesAvalancheNetwork/3.0 (citizen-science project)' }
    });
    if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
    const data = await response.json();
    const a = data.address || {};
    const town = a.town || a.village || a.city || a.municipality || a.hamlet || a.county || data.name || 'Unknown place';
    const result = {
        town,
        display_name: data.display_name || town,
        country: a.country || null,
        country_code: String(a.country_code || '').toLowerCase(),
        state: a.state || a.region || null
    };
    reverseGeocodeCache.set(key, result);
    return result;
}

app.get('/api/bulletins/resolve', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'Valid lat and lng are required.' });
    try {
        const region = await resolveAvalancheRegion(lat, lng);
        if (region) {
            const props = region.properties || {};
            const provider = BULLETINS[props.provider_id] || BULLETINS.spain;
            return res.json({
                provider,
                zone: props.name || props.region_id || 'Avalanche warning region',
                regionId: props.region_id || region.id,
                sourceCode: props.source_code,
                bulletinUrl: props.bulletin_url || provider.url,
                resolvedBy: 'avalanche-warning-region'
            });
        }
        const place = await reverseGeocode(lat, lng, 7);
        if (place.country_code === 'ad') return res.json({ provider: BULLETINS.andorra, place, resolvedBy: 'reverse-geocode' });
        if (place.country_code === 'fr') return res.json({ provider: BULLETINS.france, place, resolvedBy: 'reverse-geocode' });
        if (place.country_code === 'es' && /catal/i.test(String(place.state || ''))) return res.json({ provider: BULLETINS.icgc, place, resolvedBy: 'reverse-geocode' });
        if (place.country_code === 'es') return res.json({ provider: BULLETINS.spain, place, resolvedBy: 'reverse-geocode' });
        return res.status(404).json({ error: 'No configured avalanche bulletin region covers this point.' });
    } catch (error) {
        res.status(502).json({ error: 'Could not determine the official bulletin provider for this location.', details: error.message });
    }
});

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function meanByDay(times = [], values = []) {
    const buckets = new Map();
    times.forEach((time, index) => {
        const value = Number(values[index]);
        if (!Number.isFinite(value)) return;
        const day = String(time).slice(0, 10);
        if (!buckets.has(day)) buckets.set(day, []);
        buckets.get(day).push(value);
    });
    return Object.fromEntries([...buckets.entries()].map(([day, vals]) => [day, vals.reduce((a, b) => a + b, 0) / vals.length]));
}

function seasonScanStart(end) {
    const year = end.getUTCMonth() >= 8 ? end.getUTCFullYear() : end.getUTCFullYear() - 1;
    return new Date(Date.UTC(year, 8, 1)); // 1 September
}

function findMeaningfulSnowStart(dates = [], snowfall = []) {
    for (let i = 0; i < dates.length; i += 1) {
        const today = Number(snowfall[i]) || 0;
        const threeDay = [0, 1, 2].reduce((sum, offset) => sum + (Number(snowfall[i + offset]) || 0), 0);
        if (today >= 2 || threeDay >= 5) return dates[i];
    }
    return null;
}

function trimDailyFrom(daily, startDate) {
    const dates = daily?.time || [];
    const index = Math.max(0, dates.findIndex(day => day >= startDate));
    const output = {};
    Object.entries(daily || {}).forEach(([key, value]) => {
        output[key] = Array.isArray(value) && value.length === dates.length ? value.slice(index) : value;
    });
    return output;
}

app.get('/api/weather/history', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const range = req.query.range === 'winter' ? 'winter' : '14';
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required.' });

    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 1);
    const requestedStart = range === 'winter'
        ? seasonScanStart(end)
        : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 13));

    const dailyVariables = [
        'snowfall_sum', 'rain_sum', 'precipitation_sum',
        'temperature_2m_max', 'temperature_2m_min',
        'wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant',
        'sunshine_duration', 'daylight_duration', 'cloud_cover_mean'
    ].join(',');

    const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lng),
        start_date: isoDate(requestedStart),
        end_date: isoDate(end),
        daily: dailyVariables,
        hourly: 'freezing_level_height',
        timezone: 'Europe/Madrid'
    });

    try {
        const response = await fetch(`https://historical-forecast-api.open-meteo.com/v1/forecast?${params.toString()}`);
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.reason || `Open-Meteo returned ${response.status}`);

        const freezingByDay = meanByDay(data.hourly?.time, data.hourly?.freezing_level_height);
        const dates = data.daily?.time || [];
        data.daily.freezing_level_height_mean = dates.map(day => freezingByDay[day] ?? null);

        let actualStart = isoDate(requestedStart);
        let startReason = range === '14' ? 'last 14 days' : '1 September scan start';
        if (range === 'winter' && dates.length) {
            const snowStart = findMeaningfulSnowStart(dates, data.daily.snowfall_sum || []);
            if (snowStart) {
                actualStart = snowStart;
                startReason = 'first meaningful snowfall (≥2 cm/day or ≥5 cm over 3 days)';
            } else {
                const fallbackNov = `${requestedStart.getUTCFullYear()}-11-01`;
                if (fallbackNov <= isoDate(end)) {
                    actualStart = fallbackNov;
                    startReason = '1 November fallback (no meaningful snowfall detected earlier)';
                }
            }
            data.daily = trimDailyFrom(data.daily, actualStart);
        }

        data.meta = {
            range,
            start: actualStart,
            end: isoDate(end),
            startReason,
            source: 'Open-Meteo Historical Forecast API'
        };
        delete data.hourly;
        delete data.hourly_units;
        res.json(data);
    } catch (error) {
        res.status(502).json({ error: 'Historical weather is temporarily unavailable.', details: error.message });
    }
});

function buildEuropeGrid() {
    const points = [];
    const step = 2;
    for (let lat = 35; lat <= 70; lat += step) {
        for (let lng = -12; lng <= 32; lng += step) points.push({ lat: Number(lat.toFixed(2)), lng: Number(lng.toFixed(2)) });
    }
    return points;
}

async function fetchCurrentWeatherBatch(points) {
    const params = new URLSearchParams({
        latitude: points.map(point => point.lat).join(','),
        longitude: points.map(point => point.lng).join(','),
        current: 'temperature_2m,wind_gusts_10m,precipitation',
        timezone: 'GMT',
        forecast_days: '1',
        cell_selection: 'nearest'
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.reason || `Open-Meteo returned ${response.status}`);
    return Array.isArray(data) ? data : [data];
}

app.get('/api/weather/current-grid', async (_req, res) => {
    const cacheKey = 'europe-2deg';
    const cached = weatherGridCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) return res.json(cached.data);

    try {
        const points = buildEuropeGrid();
        const batches = [];
        for (let i = 0; i < points.length; i += 80) batches.push(points.slice(i, i + 80));
        const results = [];
        for (const batch of batches) {
            const responses = await fetchCurrentWeatherBatch(batch);
            responses.forEach((item, index) => {
                const point = batch[index];
                if (!point || !item?.current) return;
                results.push({
                    lat: point.lat,
                    lng: point.lng,
                    temperature: Number(item.current.temperature_2m),
                    windGust: Number(item.current.wind_gusts_10m),
                    precipitation: Number(item.current.precipitation),
                    time: item.current.time || null
                });
            });
        }
        const payload = {
            extent: { south: 35, west: -12, north: 69, east: 32 },
            resolutionDegrees: 2,
            source: 'Open-Meteo current forecast grid',
            generatedAt: new Date().toISOString(),
            points: results
        };
        weatherGridCache.set(cacheKey, { timestamp: Date.now(), data: payload });
        res.json(payload);
    } catch (error) {
        res.status(502).json({ error: 'Current European weather grid is temporarily unavailable.', details: error.message });
    }
});

app.get('/api/weather/reverse', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required.' });

    try {
        res.json(await reverseGeocode(lat, lng, 12));
    } catch (error) {
        res.status(502).json({ error: 'Nearest-place lookup is temporarily unavailable.', details: error.message });
    }
});

app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

ensureDatabase().finally(() => {
    app.listen(PORT, () => console.log(`Avalanche Safety Server running on http://localhost:${PORT}`));
});
