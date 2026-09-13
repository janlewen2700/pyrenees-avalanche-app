/*
 * Experimental terrain hazard / exposure helpers.
 * IMPORTANT: not an operational avalanche forecast.
 *
 * v0.2 keeps two ideas separate:
 *  - localTerrainScore: terrain/weather susceptibility and connected-terrain exposure
 *  - advisoryScore: conservative display score that cannot fall below the current
 *    official regional danger floor when a current rating is available.
 */
(function (global) {
    const MODEL_VERSION = '0.3-beta';

    const FEATURE_SCHEMA = Object.freeze({
        terrain: ['slopeDeg', 'aspectDeg', 'elevationM', 'planCurvature', 'profileCurvature', 'curvatureIndex', 'terrainRuggedness', 'forestFraction', 'distanceToRidgeM', 'startZonePotential'],
        connectedTerrain: ['overheadStartZoneFraction', 'maxUpslopeAngleDeg', 'runoutExposure', 'terrainTrapScore'],
        weather: ['snow24hCm', 'snow72hCm', 'rain24hMm', 'tempTrend12hC', 'maxTemp24hC', 'windSpeed24hKmh', 'windDirectionDeg', 'solarRadiation24h'],
        bulletin: ['regionalDangerLevel', 'problemNewSnow', 'problemWindSlab', 'problemPersistent', 'problemWetSnow', 'problemGliding', 'aspectElevationMatch'],
        observations: ['recentAvalancheCount', 'recentWhumpfCount', 'recentCrackCount', 'recentPropagatingTestCount', 'observationConfidence']
    });

    function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

    function slopeReleasePotential(slopeDeg) {
        const s = Number(slopeDeg);
        if (!Number.isFinite(s) || s < 25) return 0;
        if (s < 30) return ((s - 25) / 5) * 0.4;
        if (s <= 45) return 0.4 + ((s - 30) / 15) * 0.6;
        if (s <= 55) return 1 - ((s - 45) / 10) * 0.35;
        return 0.35;
    }

    function officialDangerFloor(level) {
        return ({ 1: 0.12, 2: 0.28, 3: 0.48, 4: 0.70, 5: 0.88 })[Number(level)] || 0;
    }

    function transparentBaseline(features = {}) {
        const slope = slopeReleasePotential(features.slopeDeg);
        const startZone = clamp01(features.startZonePotential ?? slope);
        const overhead = clamp01(features.overheadStartZoneFraction);
        const runout = clamp01(features.runoutExposure);
        const trap = clamp01(features.terrainTrapScore);
        const snow = clamp01((Number(features.snow72hCm) || 0) / 35);
        const rain = clamp01((Number(features.rain24hMm) || 0) / 18);
        const wind = clamp01((Number(features.windLoading) || 0));
        const warming = clamp01((Number(features.warmingScore) || 0));
        const obs = clamp01((Number(features.recentAvalancheCount) || 0) / 3 + (Number(features.recentWhumpfCount) || 0) / 5);
        const weather = clamp01(0.34 * snow + 0.18 * rain + 0.32 * wind + 0.16 * warming);

        const localRelease = clamp01((0.35 * slope + 0.65 * startZone) * (0.46 + 0.54 * weather) + 0.10 * obs);
        const connectedExposure = clamp01(Math.max(overhead, runout) * (0.50 + 0.50 * weather) + 0.10 * trap);
        const localTerrainScore = Math.max(localRelease, connectedExposure);
        const floor = officialDangerFloor(features.regionalDangerLevel);
        return {
            modelVersion: MODEL_VERSION,
            localTerrainScore,
            advisoryScore: Math.max(localTerrainScore, floor),
            officialFloor: floor,
            localReleasePotential: localRelease,
            connectedTerrainExposure: connectedExposure,
            status: 'development-only',
            warning: 'Unvalidated decision-support proxy. Never use it to downgrade an official avalanche bulletin or declare an individual slope safe.'
        };
    }

    global.PANHazardModel = { MODEL_VERSION, FEATURE_SCHEMA, clamp01, slopeReleasePotential, officialDangerFloor, transparentBaseline };
})(window);
