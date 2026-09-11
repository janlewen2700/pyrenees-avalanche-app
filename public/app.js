document.addEventListener('DOMContentLoaded', () => {

    // 1. Navigation Tab Switching Logic
    const navButtons = document.querySelectorAll('.nav-btn');
    const pageViews = document.querySelectorAll('.page-view');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            navButtons.forEach(b => b.classList.remove('active'));
            pageViews.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPage = document.getElementById(btn.dataset.page);
            targetPage.classList.add('active');

            // Trigger Leaflet map resize fix when switching tabs
            if (btn.dataset.page === 'page1' && map1) map1.invalidateSize();
            if (btn.dataset.page === 'page2' && map2) map2.invalidateSize();
        });
    });

    // Disclaimer Modal Dismissal
    document.getElementById('accept-disclaimer-btn').addEventListener('click', () => {
        document.getElementById('disclaimer-modal').classList.add('hidden');
    });

    // Close Observation Modal
    document.querySelector('.close-modal').addEventListener('click', () => {
        document.getElementById('log-modal').classList.add('hidden');
    });

    // ==========================================
    // PAGE 1: AVALANCHE & OBSERVATIONS MAP
    // ==========================================
    const pyreneesCoords = [42.6986, 0.7981]; // Val d'Aran / Central Pyrenees
    const map1 = L.map('map-avalanche').setView(pyreneesCoords, 9);

    // Add Topographic Basemap
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: 'OpenTopoMap | ICGC'
    }).addTo(map1);

    let bulletinLayer, observationsLayer;

    // Helper: Returns color hex based on EAWS Danger Rating (0-5)
    function getDangerColor(level) {
        switch (level) {
            case 1: return '#50b848'; // Low
            case 2: return '#fff200'; // Moderate
            case 3: return '#f7931e'; // Considerable
            case 4: return '#ed1c24'; // High
            case 5: return '#a61c1c'; // Very High
            default: return '#888888'; // 0 = Unissued / Out of season (Gray)
        }
    }

    // Load Official Forecast Bulletin Overlay
    fetch('/api/bulletin')
        .then(res => res.json())
        .then(data => {
            bulletinLayer = L.geoJSON(data, {
                style: (feature) => ({
                    fillColor: getDangerColor(feature.properties.danger_level),
                    weight: 2,
                    opacity: 1,
                    color: '#ffffff',
                    fillOpacity: 0.45
                }),
                onEachFeature: (feature, layer) => {
                    const p = feature.properties;
                    const dangerText = p.danger_level === 0
                        ? 'GRAY - Out of Season / Unissued'
                        : `Level ${p.danger_level}`;
                    
                    layer.bindPopup(`
                        <strong>${p.region}</strong><br>
                        Hazard Level: <strong>${dangerText}</strong><br>
                        Primary Problem: ${p.primary_problem}<br>
                        <em>Issued: ${p.issued_at || 'N/A'}</em>
                    `);
                }
            }).addTo(map1);
        });

    // Load Citizen Observations
    function loadObservations() {
        if (observationsLayer) map1.removeLayer(observationsLayer);

        fetch('/api/observations')
            .then(res => res.json())
            .then(data => {
                observationsLayer = L.geoJSON(data, {
                    pointToLayer: (feature, latlng) => {
                        const type = feature.properties.type;
                        let color = '#0088ff';
                        if (type === 'avalanche') color = '#ff4d4d';
                        if (type === 'accident') color = '#000000';

                        return L.circleMarker(latlng, {
                            radius: 8,
                            fillColor: color,
                            color: '#fff',
                            weight: 2,
                            fillOpacity: 0.9
                        });
                    },
                    onEachFeature: (feature, layer) => {
                        const p = feature.properties;
                        const d = p.details;
                        layer.bindPopup(`
                            <strong>${p.type.toUpperCase()}</strong> (${p.season_year})<br>
                            Aspect: ${d.aspect || 'N/A'} | Elev: ${d.elevation || 'N/A'}m<br>
                            Slope: ${d.slope || 'N/A'}° | Weak Layer: ${d.weakLayer || 'N/A'}cm<br>
                            <p>${d.notes}</p>
                        `);
                    }
                }).addTo(map1);
            });
    }
    loadObservations();

    // Map Click -> Open Modal Form to Log Observation
    map1.on('click', (e) => {
        document.getElementById('form-lat').value = e.latlng.lat;
        document.getElementById('form-lng').value = e.latlng.lng;
        document.getElementById('log-modal').classList.remove('hidden');
    });

    // Form Submission Handler
    document.getElementById('observation-form').addEventListener('submit', (e) => {
        e.preventDefault();

        const payload = {
            type: document.getElementById('form-type').value,
            lat: document.getElementById('form-lat').value,
            lng: document.getElementById('form-lng').value,
            season_year: new Date().getFullYear(),
            details: {
                aspect: document.getElementById('form-aspect').value,
                elevation: document.getElementById('form-elevation').value,
                slope: document.getElementById('form-slope').value,
                weakLayer: document.getElementById('form-weak-layer').value,
                notes: document.getElementById('form-notes').value
            }
        };

        fetch('/api/observations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(result => {
            if (result.success) {
                document.getElementById('log-modal').classList.add('hidden');
                document.getElementById('observation-form').reset();
                loadObservations(); // Refresh map pins
            }
        });
    });

    // ==========================================
    // PAGE 2: WEATHER & HISTORICAL ANALYSIS
    // ==========================================
    const map2 = L.map('map-weather').setView(pyreneesCoords, 9);
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 }).addTo(map2);

    let weatherChart = null;

    map2.on('click', (e) => {
        const lat = e.latlng.lat.toFixed(4);
        const lng = e.latlng.lng.toFixed(4);

        // Fetch 14-day history + 3-day forecast from Open-Meteo API
        const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=snowfall_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max&past_days=14&forecast_days=3&timezone=Europe%2FMadrid`;

        fetch(meteoUrl)
            .then(res => res.json())
            .then(data => {
                const dates = data.daily.time;
                const snow = data.daily.snowfall_sum;
                const tempMax = data.daily.temperature_2m_max;
                const tempMin = data.daily.temperature_2m_min;

                const total14DaySnow = snow.reduce((a, b) => a + b, 0).toFixed(1);

                document.getElementById('weather-details').innerHTML = `
                    <strong>Coords:</strong> ${lat}, ${lng}<br>
                    <strong>14-Day Accumulated Snowfall:</strong> ${total14DaySnow} cm<br>
                    <strong>Recent High:</strong> ${tempMax[13]} °C | <strong>Low:</strong> ${tempMin[13]} °C
                `;

                // Render Chart.js Graph
                const ctx = document.getElementById('weatherChart').getContext('2d');
                if (weatherChart) weatherChart.destroy();

                weatherChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: dates.map(d => d.slice(5)), // Format MM-DD
                        datasets: [
                            {
                                label: 'Snowfall (cm)',
                                data: snow,
                                backgroundColor: '#0088ff',
                                yAxisID: 'y'
                            },
                            {
                                label: 'Max Temp (°C)',
                                data: tempMax,
                                borderColor: '#ff4d4d',
                                type: 'line',
                                yAxisID: 'y1'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        scales: {
                            y: { position: 'left', title: { display: true, text: 'Snow (cm)' } },
                            y1: { position: 'right', title: { display: true, text: 'Temp (°C)' }, grid: { drawOnChartArea: false } }
                        }
                    }
                });
            });
    });
});
