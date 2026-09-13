const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const dedicatedPublicDir = path.join(ROOT, 'public');
const hasDedicatedPublicDir = fs.existsSync(dedicatedPublicDir);
const publicDir = hasDedicatedPublicDir ? dedicatedPublicDir : ROOT;
const fallbackDataFile = process.env.LOCAL_DATA_FILE || path.join(ROOT, 'data', 'observations.json');
const ANDORRA_AVALANCHE_WMS_URL = 'https://www.ideandorra.ad/Serveis/wms_allaus/wms';
const HISTORICAL_DATASETS = {
    france: { file: path.join(ROOT, 'data', 'historical', 'france-clpa-epa.geojson'), label: 'France · CLPA/EPA', sourceUrl: 'https://www.avalanches.fr/' },
    andorra: { file: path.join(ROOT, 'data', 'historical', 'andorra-allaus.geojson'), label: 'Andorra · official avalanche cadastre', sourceUrl: ANDORRA_AVALANCHE_WMS_URL },
    spain: { file: path.join(ROOT, 'data', 'historical', 'spain-pyrenees-avalanches.geojson'), label: 'Spanish Pyrenees · regional historical imports', sourceUrl: 'https://idearagon.aragon.es/' }
};

app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use('/assets', express.static(path.join(ROOT, 'assets'), { maxAge: '1h' }));
if (hasDedicatedPublicDir) {
    app.use(express.static(publicDir));
} else {
    app.get('/app.js', (_req, res) => res.sendFile(path.join(ROOT, 'app.js')));
    app.get('/style.css', (_req, res) => res.sendFile(path.join(ROOT, 'style.css')));
    app.get('/translations.js', (_req, res) => res.sendFile(path.join(ROOT, 'translations.js')));
    app.get('/hazard-model.js', (_req, res) => res.sendFile(path.join(ROOT, 'hazard-model.js')));
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
const avalancheRegionCache = new Map();
const avalancheGeometryCache = new Map();
const terrainAnalysisCache = new Map();

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
    { code: 'ES-CT-L', providerId: 'lauegi', filter: false, priority: 60 },
    { code: 'ES-CT', providerId: 'icgc', filter: false, priority: 50 },
    { code: 'ES-AR', providerId: 'spain', filter: false, priority: 40 },
    { code: 'ES', providerId: 'spain', filter: true, priority: 20 },
    { code: 'AD', providerId: 'andorra', filter: false, priority: 60 },
    { code: 'FR', providerId: 'france', filter: true, priority: 40 }
];

async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'PyreneesAvalancheNetwork/4.2 (citizen-science project)' }
        });
        if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function fetchTextWithTimeout(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'PyreneesAvalancheNetwork/4.2 (citizen-science project)' }
        });
        if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
        return await response.text();
    } finally {
        clearTimeout(timer);
    }
}

function collectNamedWmsLayers(layerNode, output = []) {
    if (!layerNode) return output;
    if (Array.isArray(layerNode)) {
        layerNode.forEach(layer => collectNamedWmsLayers(layer, output));
        return output;
    }
    if (typeof layerNode !== 'object') return output;
    const hasChildren = Boolean(layerNode.Layer);
    if (layerNode.Name && !hasChildren) {
        output.push({
            name: String(layerNode.Name),
            title: String(layerNode.Title || layerNode.Name),
            queryable: String(layerNode['@_queryable'] ?? '0') === '1'
        });
    }
    if (hasChildren) collectNamedWmsLayers(layerNode.Layer, output);
    return output;
}

async function postJsonWithTimeout(url, body, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'User-Agent': 'PyreneesAvalancheNetwork/4.2 (citizen-science project)',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(body)
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

function geometryRepresentativePoint(geometry) {
    const pairs = flattenCoordinatePairs(geometry?.coordinates || []);
    if (!pairs.length) return null;
    const avg = pairs.reduce((acc, pair) => [acc[0] + pair[0], acc[1] + pair[1]], [0, 0]).map(value => value / pairs.length);
    if (pointInGeometry(avg[0], avg[1], geometry)) return { lng: avg[0], lat: avg[1] };
    const first = pairs[0];
    return { lng: first[0], lat: first[1] };
}

function removeLowerPriorityOverlappingRegions(features) {
    return features.filter(feature => {
        const p = feature.properties || {};
        const point = geometryRepresentativePoint(feature.geometry);
        if (!point) return true;
        return !features.some(other => {
            if (other === feature) return false;
            const op = other.properties || {};
            if (op.provider_id !== p.provider_id) return false;
            const otherPriority = Number(op.source_priority || 0);
            const thisPriority = Number(p.source_priority || 0);
            if (otherPriority <= thisPriority) return false;
            return pointInGeometry(point.lng, point.lat, other.geometry);
        });
    });
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
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) return cached.data;

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
                    source_priority: source.priority || 0,
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
        features: removeLowerPriorityOverlappingRegions([...featuresById.values()])
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

    const d = body.details;
    const requiredText = [['title','Report title'], ['aspect','Aspect'], ['notes','Field description'], ['observedAt','Observation date/time']];
    for (const [key, label] of requiredText) {
        if (!String(d[key] || '').trim()) return { error: `${label} is required.` };
    }
    const observedMs = Date.parse(String(d.observedAt || ''));
    if (!Number.isFinite(observedMs)) return { error: 'Observation date/time is invalid.' };
    if (observedMs > Date.now() + 60 * 60 * 1000) return { error: 'Observation date/time cannot be in the future.' };
    if (!Number.isFinite(Number(d.elevation))) return { error: 'Elevation is required.' };
    if (!Number.isFinite(Number(d.slope))) return { error: 'Slope angle is required.' };
    if (['avalanche', 'accident'].includes(body.type)) {
        if (!String(d.avalancheSize || '').trim()) return { error: 'Avalanche size is required for avalanche/incident reports.' };
        if (!String(d.avalancheCharacter || '').trim()) return { error: 'Avalanche character is required for avalanche/incident reports.' };
        if (!String(d.trigger || '').trim()) return { error: 'Trigger is required for avalanche/incident reports.' };
    }
    if (Array.isArray(d.photos) && d.photos.length > 3) return { error: 'A maximum of 3 photos is allowed.' };
    if (Array.isArray(d.photos) && d.photos.some(photo => typeof photo !== 'string' || !photo.startsWith('data:image/'))) return { error: 'Invalid photo payload.' };
    const avalancheGeometry = d.avalancheGeometry;
    if (avalancheGeometry && typeof avalancheGeometry === 'object') {
        const coordinateSets = [];
        if (avalancheGeometry.crown?.type === 'LineString') coordinateSets.push(avalancheGeometry.crown.coordinates);
        if (avalancheGeometry.path?.type === 'Polygon') coordinateSets.push(...(avalancheGeometry.path.coordinates || []));
        for (const coords of coordinateSets) {
            if (!Array.isArray(coords) || coords.length > 250) return { error: 'Avalanche geometry is too large.' };
            for (const pair of coords) {
                if (!Array.isArray(pair) || pair.length < 2 || !Number.isFinite(Number(pair[0])) || !Number.isFinite(Number(pair[1]))) return { error: 'Invalid avalanche geometry.' };
                if (Number(pair[0]) < -180 || Number(pair[0]) > 180 || Number(pair[1]) < -90 || Number(pair[1]) > 90) return { error: 'Avalanche geometry coordinates are out of range.' };
            }
        }
    }
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

async function readOptionalGeoJson(file) {
    try {
        const raw = await fsp.readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) return parsed;
        throw new Error('Expected a GeoJSON FeatureCollection.');
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

app.get('/api/andorra-avalanche-wms', async (_req, res) => {
    try {
        const capabilitiesUrl = `${ANDORRA_AVALANCHE_WMS_URL}?SERVICE=WMS&REQUEST=GetCapabilities`;
        const xml = await fetchTextWithTimeout(capabilitiesUrl, 15000);
        const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
        const parsed = parser.parse(xml);
        const documentRoot = parsed.WMS_Capabilities || parsed.WMT_MS_Capabilities || parsed;
        const rootLayer = documentRoot?.Capability?.Layer;
        const layers = collectNamedWmsLayers(rootLayer, []);
        const uniqueLayers = [...new Map(layers.map(layer => [layer.name, layer])).values()];
        if (!uniqueLayers.length) throw new Error('No named layers were returned by the official WMS capabilities document.');
        res.json({
            available: true,
            url: ANDORRA_AVALANCHE_WMS_URL,
            layers: uniqueLayers,
            source: 'Govern d\'Andorra / IDE Andorra',
            usageNote: 'Streamed from the official service; not redistributed by this repository.'
        });
    } catch (error) {
        res.status(502).json({ available: false, error: error.message });
    }
});

app.get('/api/historical-avalanches', async (_req, res) => {
    const datasets = {};
    for (const [key, config] of Object.entries(HISTORICAL_DATASETS)) {
        try {
            const geojson = await readOptionalGeoJson(config.file);
            datasets[key] = {
                available: Boolean(geojson), label: config.label, sourceUrl: config.sourceUrl,
                featureCount: geojson?.features?.length || 0,
                geojson
            };
        } catch (error) {
            datasets[key] = { available: false, label: config.label, sourceUrl: config.sourceUrl, error: error.message, geojson: null };
        }
    }
    res.json({
        generatedAt: new Date().toISOString(),
        note: 'Catalonia is streamed directly from the ICGC WMS. Other inventories are exposed here only after a licence-compatible GeoJSON import is installed locally.',
        datasets
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
    const observedDate = new Date(details.observedAt);
    const seasonYear = Number(req.body.season_year) || getSeasonYear(Number.isFinite(observedDate.getTime()) ? observedDate : new Date());
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
        const response = await fetch(source, { headers: { 'User-Agent': 'PyreneesAvalancheNetwork/4.2' } });
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
        headers: { 'User-Agent': process.env.NOMINATIM_USER_AGENT || 'PyreneesAvalancheNetwork/4.2 (citizen-science project)' }
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



// TERRAIN BETA -------------------------------------------------------------
// Conservative, transparent prototype: a 90 m DEM + current bulletin + recent
// weather. This is deliberately not a slope-level avalanche forecast.
function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function circularDifferenceDeg(a, b) {
    const diff = Math.abs((((Number(a) - Number(b)) % 360) + 540) % 360 - 180);
    return Number.isFinite(diff) ? diff : 180;
}

function slopeReleasePotential(slopeDeg) {
    const s = Number(slopeDeg);
    if (!Number.isFinite(s) || s < 25) return 0;
    if (s < 30) return ((s - 25) / 5) * 0.4;
    if (s <= 45) return 0.4 + ((s - 30) / 15) * 0.6;
    if (s <= 55) return 1 - ((s - 45) / 10) * 0.35;
    return 0.35;
}

function officialDangerFloor(level) {
    const floors = { 1: 0.12, 2: 0.28, 3: 0.48, 4: 0.70, 5: 0.88 };
    return floors[Number(level)] || 0;
}

function buildTerrainGrid(lat, lng, radiusKm, gridSize) {
    const latRadius = radiusKm / 110.574;
    const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
    const lngRadius = radiusKm / (111.320 * cosLat);
    const latStep = (latRadius * 2) / (gridSize - 1);
    const lngStep = (lngRadius * 2) / (gridSize - 1);
    const points = [];
    for (let row = 0; row < gridSize; row += 1) {
        const pointLat = lat - latRadius + row * latStep;
        for (let col = 0; col < gridSize; col += 1) {
            const pointLng = lng - lngRadius + col * lngStep;
            points.push({ row, col, lat: pointLat, lng: pointLng });
        }
    }
    return { points, latStep, lngStep, latRadius, lngRadius, gridSize, centre: { lat, lng }, radiusKm };
}

async function fetchElevationPoints(points) {
    const output = [];
    for (let i = 0; i < points.length; i += 100) {
        const batch = points.slice(i, i + 100);
        const params = new URLSearchParams({
            latitude: batch.map(point => point.lat.toFixed(6)).join(','),
            longitude: batch.map(point => point.lng.toFixed(6)).join(',')
        });
        const data = await fetchJsonWithTimeout(`https://api.open-meteo.com/v1/elevation?${params.toString()}`, 16000);
        const elevations = Array.isArray(data?.elevation) ? data.elevation : [];
        batch.forEach((point, index) => output.push({ ...point, elevationM: Number(elevations[index]) }));
    }
    return output;
}

async function fetchFranceRgeElevationPoints(points) {
    const output = [];
    const url = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
    for (let i = 0; i < points.length; i += 4500) {
        const batch = points.slice(i, i + 4500);
        const data = await postJsonWithTimeout(url, {
            lon: batch.map(point => point.lng.toFixed(7)).join('|'),
            lat: batch.map(point => point.lat.toFixed(7)).join('|'),
            resource: 'ign_rge_alti_wld', delimiter: '|', indent: 'false', measures: 'false', zonly: 'true'
        }, 30000);
        const elevations = Array.isArray(data?.elevations) ? data.elevations : [];
        batch.forEach((point, index) => {
            const raw = Number(elevations[index]);
            output.push({ ...point, elevationM: Number.isFinite(raw) && raw > -90000 ? raw : NaN });
        });
    }
    if (output.some(point => !Number.isFinite(point.elevationM))) throw new Error('French RGE ALTI returned gaps in this analysis window.');
    return output;
}

// WGS84 -> UTM, sufficient for the Catalan WCS request envelope.
function wgs84ToUtm(lat, lng, zone = 31) {
    const a = 6378137.0, eccSquared = 0.00669438, k0 = 0.9996;
    const latRad = lat * Math.PI / 180;
    const lonRad = lng * Math.PI / 180;
    const lonOrigin = (zone - 1) * 6 - 180 + 3;
    const lonOriginRad = lonOrigin * Math.PI / 180;
    const eccPrimeSquared = eccSquared / (1 - eccSquared);
    const N = a / Math.sqrt(1 - eccSquared * Math.sin(latRad) ** 2);
    const T = Math.tan(latRad) ** 2;
    const C = eccPrimeSquared * Math.cos(latRad) ** 2;
    const A = Math.cos(latRad) * (lonRad - lonOriginRad);
    const M = a * ((1 - eccSquared / 4 - 3 * eccSquared ** 2 / 64 - 5 * eccSquared ** 3 / 256) * latRad
        - (3 * eccSquared / 8 + 3 * eccSquared ** 2 / 32 + 45 * eccSquared ** 3 / 1024) * Math.sin(2 * latRad)
        + (15 * eccSquared ** 2 / 256 + 45 * eccSquared ** 3 / 1024) * Math.sin(4 * latRad)
        - (35 * eccSquared ** 3 / 3072) * Math.sin(6 * latRad));
    let easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * eccPrimeSquared) * A ** 5 / 120) + 500000;
    let northing = k0 * (M + N * Math.tan(latRad) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * eccPrimeSquared) * A ** 6 / 720));
    if (lat < 0) northing += 10000000;
    return { easting, northing, zone };
}

function parseArcGrid(text) {
    const lines = String(text).trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const header = {};
    let dataStart = 0;
    for (let i = 0; i < Math.min(lines.length, 10); i += 1) {
        const parts = lines[i].split(/\s+/);
        const key = String(parts[0] || '').toLowerCase();
        if (['ncols','nrows','xllcorner','yllcorner','xllcenter','yllcenter','cellsize','nodata_value','dx','dy'].includes(key)) {
            header[key] = Number(parts[1]); dataStart = i + 1;
        } else if (header.ncols && header.nrows) break;
    }
    const ncols = Number(header.ncols), nrows = Number(header.nrows);
    if (!Number.isInteger(ncols) || !Number.isInteger(nrows)) throw new Error('Could not parse ICGC ArcGrid response.');
    const values = lines.slice(dataStart).flatMap(line => line.split(/\s+/).map(Number));
    if (values.length < ncols * nrows) throw new Error('ICGC terrain response was incomplete.');
    return { header, ncols, nrows, values: values.slice(0, ncols * nrows) };
}

async function fetchIcgcElevationSurface(grid) {
    const corners = [
        [grid.centre.lat - grid.latRadius, grid.centre.lng - grid.lngRadius],
        [grid.centre.lat - grid.latRadius, grid.centre.lng + grid.lngRadius],
        [grid.centre.lat + grid.latRadius, grid.centre.lng - grid.lngRadius],
        [grid.centre.lat + grid.latRadius, grid.centre.lng + grid.lngRadius]
    ].map(([lat, lng]) => wgs84ToUtm(lat, lng, 31));
    const xs = corners.map(item => item.easting), ys = corners.map(item => item.northing);
    const params = new URLSearchParams({
        SERVICE: 'WCS', REQUEST: 'GetCoverage', VERSION: '1.0.0', CRS: 'EPSG:25831',
        COVERAGE: 'icc:met', WIDTH: String(grid.gridSize), HEIGHT: String(grid.gridSize),
        FORMAT: 'ArcGrid', EXCEPTIONS: 'XML', BBOX: `${Math.min(...xs)},${Math.min(...ys)},${Math.max(...xs)},${Math.max(...ys)}`
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(`https://geoserveis.icgc.cat/icc_mdt/wcs/service?${params.toString()}`, { signal: controller.signal, headers: { 'User-Agent': 'PyreneesAvalancheNetwork/4.2' } });
        if (!response.ok) throw new Error(`ICGC WCS returned ${response.status}`);
        const text = await response.text();
        if (/ExceptionReport|ServiceException/i.test(text)) throw new Error('ICGC WCS rejected the terrain request.');
        const raster = parseArcGrid(text);
        const output = [];
        for (const point of grid.points) {
            const rasterRow = raster.nrows - 1 - Math.round(point.row * (raster.nrows - 1) / Math.max(1, grid.gridSize - 1));
            const rasterCol = Math.round(point.col * (raster.ncols - 1) / Math.max(1, grid.gridSize - 1));
            const elevation = Number(raster.values[rasterRow * raster.ncols + rasterCol]);
            output.push({ ...point, elevationM: elevation });
        }
        if (output.some(point => !Number.isFinite(point.elevationM) || point.elevationM < -500)) throw new Error('ICGC WCS returned invalid terrain values.');
        return output;
    } finally { clearTimeout(timer); }
}

function providerTerrainConfig(providerId, radiusKm, requestedDisplaySize = 41) {
    // Route-scale analyses deliberately separate source resolution from live sampling.
    // Full 5 m / 1 m terrain is precomputed offline by terrain_pipeline; live requests
    // use a bounded analysis grid so a 10 km radius view remains responsive.
    if (providerId === 'france') {
        const analysisSize = radiusKm >= 7.5 ? 101 : 121;
        return { source: 'IGN France RGE ALTI', sourceLabel: 'IGN RGE ALTI', nominalResolutionM: 1, analysisSize, displaySize: requestedDisplaySize, method: 'route-scale-live-sampling', precomputeRecommended: true };
    }
    if (providerId === 'icgc' || providerId === 'lauegi') {
        // ICGC WCS limits a request to 35,805 pixels; 189² = 35,721.
        const analysisSize = radiusKm >= 7.5 ? 189 : 161;
        return { source: 'ICGC Digital Terrain Model WCS (5 m source)', sourceLabel: 'ICGC terrain WCS', nominalResolutionM: 5, analysisSize, displaySize: requestedDisplaySize, method: 'WCS-route-scale-sampling', precomputeRecommended: true };
    }
    return { source: 'Open-Meteo Elevation / Copernicus DEM fallback', sourceLabel: 'Copernicus DEM fallback', nominalResolutionM: 90, analysisSize: 61, displaySize: requestedDisplaySize, method: 'fallback', precomputeRecommended: true };
}

async function fetchTerrainSurface(grid, providerId) {
    if (providerId === 'france') return fetchFranceRgeElevationPoints(grid.points);
    if (providerId === 'icgc' || providerId === 'lauegi') return fetchIcgcElevationSurface(grid);
    return fetchElevationPoints(grid.points);
}

function terrainMetricSurface(elevationPoints, gridSize, latStep, lngStep) {
    const byIndex = Array.from({ length: gridSize }, () => Array(gridSize));
    elevationPoints.forEach(point => { byIndex[point.row][point.col] = point; });
    const middleLat = elevationPoints[Math.floor(elevationPoints.length / 2)]?.lat || 42.5;
    const dy = Math.max(1, Math.abs(latStep) * 110574);
    const dx = Math.max(1, Math.abs(lngStep) * 111320 * Math.cos(middleLat * Math.PI / 180));
    const terrain = [];
    for (let row = 0; row < gridSize; row += 1) {
        for (let col = 0; col < gridSize; col += 1) {
            const point = byIndex[row][col];
            const left = byIndex[row][Math.max(0, col - 1)]?.elevationM ?? point.elevationM;
            const right = byIndex[row][Math.min(gridSize - 1, col + 1)]?.elevationM ?? point.elevationM;
            const down = byIndex[Math.max(0, row - 1)][col]?.elevationM ?? point.elevationM;
            const up = byIndex[Math.min(gridSize - 1, row + 1)][col]?.elevationM ?? point.elevationM;
            const xSpan = col === 0 || col === gridSize - 1 ? dx : dx * 2;
            const ySpan = row === 0 || row === gridSize - 1 ? dy : dy * 2;
            const dzdx = (Number(right) - Number(left)) / xSpan;
            const dzdy = (Number(up) - Number(down)) / ySpan;
            const slopeDeg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180 / Math.PI;
            const aspectDeg = slopeDeg < 2 ? null : (Math.atan2(dzdx, -dzdy) * 180 / Math.PI + 360) % 360;
            const d2x = (Number(left) - 2 * Number(point.elevationM) + Number(right)) / Math.max(1, dx * dx);
            const d2y = (Number(down) - 2 * Number(point.elevationM) + Number(up)) / Math.max(1, dy * dy);
            const curvatureRaw = -(d2x + d2y); // positive proxy = locally convex terrain
            const curvatureIndex = Math.tanh(curvatureRaw * 35);
            const slopePotential = slopeReleasePotential(slopeDeg);
            const startZonePotential = clamp01(slopePotential * (0.82 + 0.18 * Math.max(0, curvatureIndex)));
            terrain.push({ ...point, slopeDeg, aspectDeg, curvatureRaw, curvatureIndex, slopePotential, startZonePotential });
        }
    }
    return { terrain, dx, dy };
}

function sampleMetricSurface(metricSurface, analysisSize, displaySize) {
    const byIndex = Array.from({ length: analysisSize }, () => Array(analysisSize));
    metricSurface.forEach(point => { byIndex[point.row][point.col] = point; });
    const sampled = [];
    for (let row = 0; row < displaySize; row += 1) {
        const sourceRow = Math.round(row * (analysisSize - 1) / Math.max(1, displaySize - 1));
        for (let col = 0; col < displaySize; col += 1) {
            const sourceCol = Math.round(col * (analysisSize - 1) / Math.max(1, displaySize - 1));
            sampled.push({ ...byIndex[sourceRow][sourceCol], row, col });
        }
    }
    return sampled;
}

function bearingDegrees(lat1, lng1, lat2, lng2) {
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dl = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function sumFinite(values) {
    return values.reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
}

function meanFinite(values) {
    const good = values.map(Number).filter(Number.isFinite);
    return good.length ? good.reduce((sum, value) => sum + value, 0) / good.length : 0;
}

function vectorMeanWindDirection(directions, speeds) {
    let x = 0, y = 0, weight = 0;
    directions.forEach((direction, index) => {
        const deg = Number(direction);
        const speed = Math.max(1, Number(speeds[index]) || 0);
        if (!Number.isFinite(deg)) return;
        const rad = deg * Math.PI / 180;
        x += Math.sin(rad) * speed;
        y += Math.cos(rad) * speed;
        weight += speed;
    });
    if (!weight) return null;
    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}

async function fetchTerrainWeatherSummary(lat, lng) {
    const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lng),
        hourly: 'snowfall,rain,temperature_2m,wind_speed_10m,wind_direction_10m,shortwave_radiation',
        past_days: '3',
        forecast_days: '1',
        timezone: 'GMT'
    });
    const data = await fetchJsonWithTimeout(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, 16000);
    const times = data?.hourly?.time || [];
    const nowMs = Date.now();
    const indices72 = [], indices24 = [];
    times.forEach((time, index) => {
        const ms = new Date(`${time}Z`).getTime();
        if (!Number.isFinite(ms) || ms > nowMs + 60 * 60 * 1000) return;
        if (ms >= nowMs - 72 * 60 * 60 * 1000) indices72.push(index);
        if (ms >= nowMs - 24 * 60 * 60 * 1000) indices24.push(index);
    });
    const pick = (key, indices) => indices.map(index => data.hourly?.[key]?.[index]);
    const snow72Cm = sumFinite(pick('snowfall', indices72));
    const rain24Mm = sumFinite(pick('rain', indices24));
    const wind24 = pick('wind_speed_10m', indices24).map(Number).filter(Number.isFinite);
    const windDir24 = pick('wind_direction_10m', indices24);
    const maxWind24Kmh = wind24.length ? Math.max(...wind24) : 0;
    const dominantWindDirectionDeg = vectorMeanWindDirection(windDir24, wind24);
    const temps24 = pick('temperature_2m', indices24).map(Number).filter(Number.isFinite);
    const maxTemp24C = temps24.length ? Math.max(...temps24) : 0;
    const latest6 = temps24.slice(-6);
    const previous6 = temps24.slice(-12, -6);
    const tempTrend12hC = latest6.length && previous6.length ? meanFinite(latest6) - meanFinite(previous6) : 0;
    const solar24WhM2 = sumFinite(pick('shortwave_radiation', indices24));
    return {
        snow72Cm: Number(snow72Cm.toFixed(1)),
        rain24Mm: Number(rain24Mm.toFixed(1)),
        maxWind24Kmh: Number(maxWind24Kmh.toFixed(1)),
        dominantWindDirectionDeg: dominantWindDirectionDeg == null ? null : Number(dominantWindDirectionDeg.toFixed(0)),
        maxTemp24C: Number(maxTemp24C.toFixed(1)),
        tempTrend12hC: Number(tempTrend12hC.toFixed(1)),
        solar24WhM2: Number(solar24WhM2.toFixed(0)),
        source: 'Open-Meteo forecast/history window'
    };
}

function deriveTerrainCells(elevationPoints, analysisGridSize, analysisLatStep, analysisLngStep, weather, regionalDangerLevel, displayGridSize) {
    const metrics = terrainMetricSurface(elevationPoints, analysisGridSize, analysisLatStep, analysisLngStep);
    const terrain = sampleMetricSurface(metrics.terrain, analysisGridSize, displayGridSize);
    const terrainByIndex = Array.from({ length: displayGridSize }, () => Array(displayGridSize));
    terrain.forEach(point => { terrainByIndex[point.row][point.col] = point; });

    const middleLat = terrain[Math.floor(terrain.length / 2)]?.lat || 42.5;
    const displayLatStep = analysisLatStep * (analysisGridSize - 1) / Math.max(1, displayGridSize - 1);
    const displayLngStep = analysisLngStep * (analysisGridSize - 1) / Math.max(1, displayGridSize - 1);
    const dy = Math.abs(displayLatStep) * 110574;
    const dx = Math.abs(displayLngStep) * 111320 * Math.cos(middleLat * Math.PI / 180);

    const windSpeedFactor = clamp01((weather.maxWind24Kmh - 10) / 45);
    const leeAspect = weather.dominantWindDirectionDeg == null ? null : (weather.dominantWindDirectionDeg + 180) % 360;
    const snowFactor = clamp01(weather.snow72Cm / 35);
    const rainFactor = clamp01(weather.rain24Mm / 18);
    const warmFactor = clamp01(Math.max(0, weather.tempTrend12hC) / 6 + Math.max(0, weather.maxTemp24C) / 12);
    const officialFloor = officialDangerFloor(regionalDangerLevel);
    const searchCells = Math.max(2, Math.min(8, Math.round(850 / Math.max(dx, dy, 1))));

    terrain.forEach(point => {
        const leeMatch = leeAspect == null || point.aspectDeg == null
            ? 0
            : clamp01((1 + Math.cos(circularDifferenceDeg(point.aspectDeg, leeAspect) * Math.PI / 180)) / 2);
        const windLoading = windSpeedFactor * leeMatch;
        const southness = point.aspectDeg == null ? 0 : clamp01((1 + Math.cos(circularDifferenceDeg(point.aspectDeg, 180) * Math.PI / 180)) / 2);
        const warming = warmFactor * southness;
        const weatherInstability = clamp01(0.34 * snowFactor + 0.18 * rainFactor + 0.32 * windLoading + 0.16 * warming);

        let overheadExposure = 0;
        let overheadMaxSlope = 0;
        let runoutExposure = 0;
        for (let rr = Math.max(0, point.row - searchCells); rr <= Math.min(displayGridSize - 1, point.row + searchCells); rr += 1) {
            for (let cc = Math.max(0, point.col - searchCells); cc <= Math.min(displayGridSize - 1, point.col + searchCells); cc += 1) {
                if (rr === point.row && cc === point.col) continue;
                const other = terrainByIndex[rr][cc];
                const rowDelta = rr - point.row, colDelta = cc - point.col;
                const distanceM = Math.sqrt((rowDelta * dy) ** 2 + (colDelta * dx) ** 2);
                if (distanceM > 1000 || other.elevationM < point.elevationM + 20 || other.slopeDeg < 25 || other.slopeDeg > 58) continue;
                const verticalAngle = Math.atan2(other.elevationM - point.elevationM, Math.max(1, distanceM)) * 180 / Math.PI;
                const proximity = clamp01(1 - distanceM / 1000);
                const angleFactor = clamp01((verticalAngle - 3) / 20);
                const candidate = other.startZonePotential * (0.35 + 0.65 * proximity) * (0.45 + 0.55 * angleFactor);
                overheadExposure = Math.max(overheadExposure, candidate);
                overheadMaxSlope = Math.max(overheadMaxSlope, other.slopeDeg);

                // Crude runout-corridor proxy: a potential release area above the cell,
                // with the target lying approximately in the release area's downslope aspect.
                if (other.aspectDeg != null && verticalAngle >= 7) {
                    const downhillBearing = bearingDegrees(other.lat, other.lng, point.lat, point.lng);
                    const alignment = clamp01((1 + Math.cos(circularDifferenceDeg(downhillBearing, other.aspectDeg) * Math.PI / 180)) / 2);
                    const alphaFactor = clamp01((verticalAngle - 6) / 14);
                    runoutExposure = Math.max(runoutExposure, other.startZonePotential * alignment * alphaFactor * (0.5 + 0.5 * proximity));
                }
            }
        }

        const localRelease = clamp01(point.startZonePotential * (0.44 + 0.56 * weatherInstability));
        const connectedExposure = clamp01(Math.max(overheadExposure, runoutExposure) * (0.48 + 0.52 * weatherInstability));
        const localTerrainScore = Math.max(localRelease, connectedExposure);
        const advisoryScore = Math.max(localTerrainScore, officialFloor);
        point.windLoading = windLoading;
        point.weatherInstability = weatherInstability;
        point.localRelease = localRelease;
        point.overheadExposure = overheadExposure;
        point.runoutExposure = runoutExposure;
        point.overheadMaxSlopeDeg = overheadMaxSlope;
        point.localTerrainScore = localTerrainScore;
        point.officialFloor = officialFloor;
        point.advisoryScore = advisoryScore;
    });
    return { cells: terrain, displayLatStep, displayLngStep, sourceDxM: metrics.dx, sourceDyM: metrics.dy };
}

async function terrainPointSummary(lat, lng, providerId) {
    const highRes = providerTerrainConfig(providerId, 0.025, 9);
    const analysisSize = highRes.method === 'fallback' ? 5 : 11;
    const radiusKm = highRes.method === 'fallback' ? 0.12 : 0.025;
    const grid = buildTerrainGrid(lat, lng, radiusKm, analysisSize);
    const points = await fetchTerrainSurface(grid, providerId);
    const { terrain, dx, dy } = terrainMetricSurface(points, analysisSize, grid.latStep, grid.lngStep);
    const centre = terrain[Math.floor(terrain.length / 2)];
    return {
        lat, lng,
        elevationM: Number(centre.elevationM.toFixed(1)),
        slopeDeg: Number(centre.slopeDeg.toFixed(1)),
        aspectDeg: centre.aspectDeg == null ? null : Number(centre.aspectDeg.toFixed(0)),
        curvatureIndex: Number(centre.curvatureIndex.toFixed(3)),
        source: highRes.source,
        sourceLabel: highRes.sourceLabel,
        nominalResolutionM: highRes.nominalResolutionM,
        effectiveSampleSpacingM: Number(Math.max(dx, dy).toFixed(1)),
        method: highRes.method
    };
}

app.get('/api/terrain/point', async (req, res) => {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required.' });
    try {
        const region = await resolveAvalancheRegion(lat, lng).catch(() => null);
        const providerId = region?.properties?.provider_id || null;
        const result = await terrainPointSummary(lat, lng, providerId);
        res.json(result);
    } catch (error) {
        try {
            const grid = buildTerrainGrid(lat, lng, 0.12, 5);
            const points = await fetchElevationPoints(grid.points);
            const { terrain, dx, dy } = terrainMetricSurface(points, 5, grid.latStep, grid.lngStep);
            const centre = terrain[Math.floor(terrain.length / 2)];
            res.json({ lat, lng, elevationM: Number(centre.elevationM.toFixed(1)), slopeDeg: Number(centre.slopeDeg.toFixed(1)), aspectDeg: centre.aspectDeg == null ? null : Number(centre.aspectDeg.toFixed(0)), curvatureIndex: Number(centre.curvatureIndex.toFixed(3)), source: 'Open-Meteo Elevation / Copernicus DEM fallback', sourceLabel: 'Copernicus DEM fallback', nominalResolutionM: 90, effectiveSampleSpacingM: Number(Math.max(dx,dy).toFixed(1)), method: 'fallback', warning: error.message });
        } catch (fallbackError) {
            res.status(502).json({ error: 'Terrain lookup unavailable.', details: fallbackError.message });
        }
    }
});

app.get('/api/terrain/analyze', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Math.max(5, Math.min(10, Number(req.query.radiusKm) || 10));
    let displayGridSize = Math.max(15, Math.min(31, Math.round(Number(req.query.grid) || 25)));
    if (displayGridSize % 2 === 0) displayGridSize += 1;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required.' });
    if (lat < PYRENEES_BBOX.south - 1 || lat > PYRENEES_BBOX.north + 1 || lng < PYRENEES_BBOX.west - 1 || lng > PYRENEES_BBOX.east + 1) {
        return res.status(400).json({ error: 'Terrain Beta is currently limited to the Pyrenees prototype area.' });
    }

    const key = [lat.toFixed(3), lng.toFixed(3), radiusKm.toFixed(1), displayGridSize, 'v43'].join(':');
    const cached = terrainAnalysisCache.get(key);
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) return res.json(cached.data);

    try {
        const [region, weather] = await Promise.all([
            resolveAvalancheRegion(lat, lng).catch(() => null),
            fetchTerrainWeatherSummary(lat, lng)
        ]);
        const providerId = region?.properties?.provider_id || null;
        let demConfig = providerTerrainConfig(providerId, radiusKm, displayGridSize);
        let analysisGrid = buildTerrainGrid(lat, lng, radiusKm, demConfig.analysisSize);
        let elevationPoints;
        let sourceWarning = null;
        try {
            elevationPoints = await fetchTerrainSurface(analysisGrid, providerId);
        } catch (highResError) {
            sourceWarning = `High-resolution source unavailable for this request: ${highResError.message}`;
            demConfig = providerTerrainConfig(null, radiusKm, displayGridSize);
            analysisGrid = buildTerrainGrid(lat, lng, radiusKm, demConfig.analysisSize);
            elevationPoints = await fetchElevationPoints(analysisGrid.points);
        }

        const regionalDangerLevel = Number(region?.properties?.danger_level) || null;
        const derived = deriveTerrainCells(
            elevationPoints, analysisGrid.gridSize, analysisGrid.latStep, analysisGrid.lngStep,
            weather, regionalDangerLevel, displayGridSize
        );
        const cells = derived.cells;
        const payload = {
            status: 'experimental-decision-support',
            generatedAt: new Date().toISOString(),
            centre: { lat, lng },
            radiusKm,
            gridSize: displayGridSize,
            analysisGridSize: analysisGrid.gridSize,
            cellStep: { lat: derived.displayLatStep, lng: derived.displayLngStep },
            dem: {
                source: demConfig.source,
                sourceLabel: demConfig.sourceLabel,
                nominalResolutionM: demConfig.nominalResolutionM,
                effectiveSampleSpacingM: Number(Math.max(derived.sourceDxM, derived.sourceDyM).toFixed(1)),
                method: demConfig.method,
                warning: sourceWarning,
                note: demConfig.method === 'fallback'
                    ? 'Fallback terrain resolution is not suitable for route-level decisions.'
                    : 'The live route-scale view samples the best configured source at bounded resolution for speed. Full-resolution static terrain should be precomputed once with terrain_pipeline and used for research/training; browser rendering is smoothly resampled.'
            },
            weather,
            bulletin: region ? {
                regionId: region.properties?.region_id || null,
                regionName: region.properties?.name || null,
                provider: region.properties?.provider_label || null,
                dangerLevel: regionalDangerLevel,
                dangerDate: region.properties?.danger_date || null,
                bulletinUrl: region.properties?.bulletin_url || null
            } : null,
            policy: {
                officialFloorApplied: Boolean(regionalDangerLevel),
                explanation: 'The displayed advisory index is never below the current official regional danger floor. Local terrain/weather can only raise it. Local release susceptibility and exposure are returned separately.',
                warning: 'Experimental and unvalidated. It does not declare individual slopes safe and must not replace the official bulletin, field observations, training, or professional judgement.'
            },
            cells: cells.map(cell => ({
                lat: Number(cell.lat.toFixed(6)), lng: Number(cell.lng.toFixed(6)),
                elevationM: Math.round(cell.elevationM),
                slopeDeg: Number(cell.slopeDeg.toFixed(1)),
                aspectDeg: cell.aspectDeg == null ? null : Number(cell.aspectDeg.toFixed(0)),
                curvatureIndex: Number(cell.curvatureIndex.toFixed(3)),
                startZonePotential: Number(cell.startZonePotential.toFixed(3)),
                windLoading: Number(cell.windLoading.toFixed(3)),
                weatherInstability: Number(cell.weatherInstability.toFixed(3)),
                localRelease: Number(cell.localRelease.toFixed(3)),
                overheadExposure: Number(cell.overheadExposure.toFixed(3)),
                runoutExposure: Number(cell.runoutExposure.toFixed(3)),
                overheadMaxSlopeDeg: Number(cell.overheadMaxSlopeDeg.toFixed(1)),
                localTerrainScore: Number(cell.localTerrainScore.toFixed(3)),
                officialFloor: Number(cell.officialFloor.toFixed(3)),
                advisoryScore: Number(cell.advisoryScore.toFixed(3))
            }))
        };
        terrainAnalysisCache.set(key, { timestamp: Date.now(), data: payload });
        res.json(payload);
    } catch (error) {
        res.status(502).json({ error: 'Terrain analysis is temporarily unavailable.', details: error.message });
    }
});

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

app.get('/LICENSE', (_req, res) => res.type('text/plain').sendFile(path.join(ROOT, 'LICENSE')));
app.get('/MEDIA_LICENSE.md', (_req, res) => res.type('text/markdown').sendFile(path.join(ROOT, 'MEDIA_LICENSE.md')));
app.get('/NOTICE.md', (_req, res) => res.type('text/markdown').sendFile(path.join(ROOT, 'NOTICE.md')));

app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

ensureDatabase().finally(() => {
    app.listen(PORT, () => console.log(`Avalanche Safety Server running on http://localhost:${PORT}`));
});
