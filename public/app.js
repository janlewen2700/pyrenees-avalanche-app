document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    document.querySelectorAll('.mountain-photo img').forEach(img => {
        const missing = () => { img.hidden = true; img.parentElement.querySelector('.photo-empty').hidden = false; };
        img.addEventListener('error', missing);
        if (img.complete && img.naturalWidth === 0) missing();
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const pyreneesCoords = [42.55, 1.25];
    const charts = {};
    let pendingReport = null;
    let selectedWeatherPoint = null;
    let weatherMarker = null;
    let radarLayer = null;
    let bulletinProviders = [];
    let currentWeatherHistory = null;
    let lastWeatherPlace = null;
    let lastForecastStatus = null;
    let lastRadarTime = null;
    let localizationRuntimeReady = false;
    const observationFeatureById = new Map();
    let pendingPhotos = [];
    let pendingAutoTerrain = null;
    let reportSketchMap = null;
    let reportSketchCrownLayer = null;
    let reportSketchPathLayer = null;
    let reportSketchLocationMarker = null;
    let reportSketchMode = null;
    const reportSketchPoints = { crown: [], path: [] };
    let mapBeta = null;
    let terrainBetaGridLayer = null;
    let terrainBetaSurfaceLayer = null;
    let terrainBetaMarker = null;
    let terrainBetaRequestController = null;
    let terrainBetaRequestSerial = 0;
    const historyLayersMain = {};
    const historyLayersBeta = {};

    function getObserverToken() {
        try {
            let token = localStorage.getItem('pan-observer-token-v1');
            if (!token) {
                token = window.crypto?.randomUUID?.() || `pan-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
                localStorage.setItem('pan-observer-token-v1', token);
            }
            return token;
        } catch (_error) {
            return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
    }
    const observerToken = getObserverToken();

    const escapeHtml = value => String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    function showToast(message, isError = false) {
        const toast = $('toast');
        toast.textContent = message;
        toast.classList.toggle('error', isError);
        toast.classList.remove('hidden');
        window.setTimeout(() => toast.classList.add('hidden'), 4500);
    }



    function isMobileLayout() { return window.matchMedia('(max-width: 900px)').matches; }
    function closeMobileDrawers() {
        document.querySelectorAll('.map-sidebar.mobile-open').forEach(sidebar => sidebar.classList.remove('mobile-open'));
        document.body.classList.remove('drawer-open');
    }
    function openMobileDrawer(pageId) {
        if (!isMobileLayout()) return;
        const page = $(pageId);
        const sidebar = page?.querySelector('.map-sidebar');
        if (!sidebar) return;
        closeMobileDrawers();
        sidebar.classList.add('mobile-open');
        document.body.classList.add('drawer-open');
    }
    document.querySelectorAll('.sidebar-close-btn').forEach(button => button.addEventListener('click', closeMobileDrawers));

    const I18N = {
      en: {
        'Avalanche Hazard':'Avalanche Hazard','Weather & Snow History':'Weather & Snow History','Learn & Rescue':'Learn & Rescue','Who we are':'Who we are',
        'Layer controls':'Layer controls','Official Pyrenees BPA regions':'Official Pyrenees BPA regions','Mapped avalanche terrain (ICGC)':'Mapped avalanche terrain (ICGC)',
        'Avalanches':'Avalanches','Accidents / incidents':'Accidents / incidents','Current season reports':'Current season reports','Official avalanche bulletin':'Official avalanche bulletin',
        'Bulletin provider':'Bulletin provider','Open bulletin':'Open bulletin','Current PDF':'Current PDF','Weather & snowpack history':'Weather & snowpack history',
        'Last 14 days':'Last 14 days','Season history':'Season history','Live weather layers':'Live weather layers','Temperature':'Temperature','Wind gust':'Wind gust','Precipitation':'Precipitation','Weather radar':'Weather radar',
        'Safety & Liability Warning':'Safety & Liability Warning','I Understand & Agree':'I Understand & Agree','Log Field Observation':'Log Field Observation','Preview report':'Preview report','Preview report':'Preview report',
        'Report title':'Report title','Type of observation':'Type of observation','Aspect':'Aspect','Elevation (m)':'Elevation (m)','Slope angle (°)':'Slope angle (°)','Avalanche size':'Avalanche size','Character':'Character','Trigger':'Trigger',
        'People involved':'People involved','Total group':'Total group','Fully buried':'Fully buried','Partly buried':'Partly buried','Caught, not buried':'Caught, not buried','Injured':'Injured','Fatalities':'Fatalities',
        'Snowpack & stability test':'Snowpack & stability test','Snowpack depth (cm)':'Snowpack depth (cm)','Weak-layer depth (cm)':'Weak-layer depth (cm)','Test type':'Test type','Test result':'Test result','Notes & field description':'Notes & field description',
        'Back to edit':'Back to edit','Confirm & publish':'Confirm & publish','Daily process':'Daily process','Avalanche basics':'Avalanche basics','Snowpack':'Snowpack','Stability tests':'Stability tests','Terrain & decisions':'Terrain & decisions','Reading the bulletin':'Reading the bulletin','Equipment':'Equipment','Companion rescue':'Companion rescue','Rescue contacts':'Rescue contacts','Resources':'Resources'
      },
      ca: {
        'Avalanche Hazard':'Perill d’allaus','Weather & Snow History':'Temps i historial de neu','Learn & Rescue':'Aprendre i rescat','Who we are':'Qui som',
        'Layer controls':'Controls de capes','Official Pyrenees BPA regions':'Regions BPA oficials dels Pirineus','Mapped avalanche terrain (ICGC)':'Terreny d’allaus cartografiat (ICGC)',
        'Avalanches':'Allaus','Accidents / incidents':'Accidents / incidents','Current season reports':'Informes de la temporada actual','Official avalanche bulletin':'Butlletí oficial d’allaus',
        'Bulletin provider':'Servei del butlletí','Open bulletin':'Obrir butlletí','Current PDF':'PDF actual','Weather & snowpack history':'Historial meteorològic i del mantell',
        'Last 14 days':'Últims 14 dies','Season history':'Historial de temporada','Live weather layers':'Capes meteorològiques en directe','Temperature':'Temperatura','Wind gust':'Ratxa de vent','Precipitation':'Precipitació','Weather radar':'Radar meteorològic',
        'Safety & Liability Warning':'Avís de seguretat i responsabilitat','I Understand & Agree':'Ho entenc i hi estic d’acord','Log Field Observation':'Registrar observació de camp','Preview report':'Previsualitzar informe',
        'Report title':'Títol de l’informe','Type of observation':'Tipus d’observació','Aspect':'Orientació','Elevation (m)':'Altitud (m)','Slope angle (°)':'Inclinació (°)','Avalanche size':'Mida de l’allau','Character':'Tipus','Trigger':'Desencadenant',
        'People involved':'Persones implicades','Total group':'Total del grup','Fully buried':'Totalment enterrats','Partly buried':'Parcialment enterrats','Caught, not buried':'Atrapats no enterrats','Injured':'Ferits','Fatalities':'Víctimes mortals',
        'Snowpack & stability test':'Mantell nival i test d’estabilitat','Snowpack depth (cm)':'Gruix del mantell (cm)','Weak-layer depth (cm)':'Profunditat capa feble (cm)','Test type':'Tipus de test','Test result':'Resultat del test','Notes & field description':'Notes i descripció de camp',
        'Back to edit':'Tornar a editar','Confirm & publish':'Confirmar i publicar','Daily process':'Procés diari','Avalanche basics':'Conceptes bàsics','Snowpack':'Mantell nival','Stability tests':'Tests d’estabilitat','Terrain & decisions':'Terreny i decisions','Reading the bulletin':'Llegir el butlletí','Equipment':'Equipament','Companion rescue':'Autorescat','Rescue contacts':'Contactes de rescat','Resources':'Recursos'
      },
      es: {
        'Avalanche Hazard':'Peligro de aludes','Weather & Snow History':'Tiempo e historial de nieve','Learn & Rescue':'Aprender y rescate','Who we are':'Quiénes somos',
        'Layer controls':'Control de capas','Official Pyrenees BPA regions':'Regiones BPA oficiales de los Pirineos','Mapped avalanche terrain (ICGC)':'Terreno de aludes cartografiado (ICGC)',
        'Avalanches':'Aludes','Accidents / incidents':'Accidentes / incidentes','Current season reports':'Informes de la temporada actual','Official avalanche bulletin':'Boletín oficial de aludes',
        'Bulletin provider':'Servicio del boletín','Open bulletin':'Abrir boletín','Current PDF':'PDF actual','Weather & snowpack history':'Historial meteorológico y del manto',
        'Last 14 days':'Últimos 14 días','Season history':'Historial de temporada','Live weather layers':'Capas meteorológicas en directo','Temperature':'Temperatura','Wind gust':'Racha de viento','Precipitation':'Precipitación','Weather radar':'Radar meteorológico',
        'Safety & Liability Warning':'Aviso de seguridad y responsabilidad','I Understand & Agree':'Entiendo y acepto','Log Field Observation':'Registrar observación de campo','Preview report':'Previsualizar informe',
        'Report title':'Título del informe','Type of observation':'Tipo de observación','Aspect':'Orientación','Elevation (m)':'Altitud (m)','Slope angle (°)':'Pendiente (°)','Avalanche size':'Tamaño del alud','Character':'Tipo','Trigger':'Desencadenante',
        'People involved':'Personas implicadas','Total group':'Total del grupo','Fully buried':'Totalmente enterrados','Partly buried':'Parcialmente enterrados','Caught, not buried':'Atrapados no enterrados','Injured':'Heridos','Fatalities':'Fallecidos',
        'Snowpack & stability test':'Manto nivoso y test de estabilidad','Snowpack depth (cm)':'Espesor del manto (cm)','Weak-layer depth (cm)':'Profundidad de capa débil (cm)','Test type':'Tipo de test','Test result':'Resultado del test','Notes & field description':'Notas y descripción de campo',
        'Back to edit':'Volver a editar','Confirm & publish':'Confirmar y publicar','Daily process':'Proceso diario','Avalanche basics':'Conceptos básicos','Snowpack':'Manto nivoso','Stability tests':'Tests de estabilidad','Terrain & decisions':'Terreno y decisiones','Reading the bulletin':'Leer el boletín','Equipment':'Equipo','Companion rescue':'Autorescate','Rescue contacts':'Contactos de rescate','Resources':'Recursos'
      },
      fr: {
        'Avalanche Hazard':'Risque d’avalanche','Weather & Snow History':'Météo et historique neige','Learn & Rescue':'Apprendre et secours','Who we are':'Qui sommes-nous',
        'Layer controls':'Contrôle des couches','Official Pyrenees BPA regions':'Régions officielles de bulletin des Pyrénées','Mapped avalanche terrain (ICGC)':'Terrain avalancheux cartographié (ICGC)',
        'Avalanches':'Avalanches','Accidents / incidents':'Accidents / incidents','Current season reports':'Rapports de la saison','Official avalanche bulletin':'Bulletin avalanche officiel',
        'Bulletin provider':'Service du bulletin','Open bulletin':'Ouvrir le bulletin','Current PDF':'PDF actuel','Weather & snowpack history':'Historique météo et manteau neigeux',
        'Last 14 days':'14 derniers jours','Season history':'Historique de saison','Live weather layers':'Couches météo en direct','Temperature':'Température','Wind gust':'Rafales','Precipitation':'Précipitations','Weather radar':'Radar météo',
        'Safety & Liability Warning':'Avertissement sécurité et responsabilité','I Understand & Agree':'Je comprends et j’accepte','Log Field Observation':'Ajouter une observation terrain','Preview report':'Prévisualiser le rapport',
        'Report title':'Titre du rapport','Type of observation':'Type d’observation','Aspect':'Orientation','Elevation (m)':'Altitude (m)','Slope angle (°)':'Inclinaison (°)','Avalanche size':'Taille de l’avalanche','Character':'Type','Trigger':'Déclenchement',
        'People involved':'Personnes impliquées','Total group':'Taille du groupe','Fully buried':'Ensevelis totalement','Partly buried':'Ensevelis partiellement','Caught, not buried':'Emportés non ensevelis','Injured':'Blessés','Fatalities':'Décès',
        'Snowpack & stability test':'Manteau neigeux et test de stabilité','Snowpack depth (cm)':'Épaisseur du manteau (cm)','Weak-layer depth (cm)':'Profondeur couche fragile (cm)','Test type':'Type de test','Test result':'Résultat du test','Notes & field description':'Notes et description terrain',
        'Back to edit':'Retour à l’édition','Confirm & publish':'Confirmer et publier','Daily process':'Routine quotidienne','Avalanche basics':'Bases avalanche','Snowpack':'Manteau neigeux','Stability tests':'Tests de stabilité','Terrain & decisions':'Terrain et décisions','Reading the bulletin':'Lire le bulletin','Equipment':'Équipement','Companion rescue':'Secours en autonomie','Rescue contacts':'Contacts secours','Resources':'Ressources'
      },
      de: {
        'Avalanche Hazard':'Lawinengefahr','Weather & Snow History':'Wetter- und Schneeverlauf','Learn & Rescue':'Lernen & Rettung','Who we are':'Über uns',
        'Layer controls':'Ebenensteuerung','Official Pyrenees BPA regions':'Offizielle Lawinenwarnregionen der Pyrenäen','Mapped avalanche terrain (ICGC)':'Kartiertes Lawinengelände (ICGC)',
        'Avalanches':'Lawinen','Accidents / incidents':'Unfälle / Vorfälle','Current season reports':'Meldungen der aktuellen Saison','Official avalanche bulletin':'Offizieller Lawinenlagebericht',
        'Bulletin provider':'Warndienst','Open bulletin':'Bulletin öffnen','Current PDF':'Aktuelles PDF','Weather & snowpack history':'Wetter- und Schneedeckenverlauf',
        'Last 14 days':'Letzte 14 Tage','Season history':'Saisonverlauf','Live weather layers':'Live-Wetterebenen','Temperature':'Temperatur','Wind gust':'Windböe','Precipitation':'Niederschlag','Weather radar':'Wetterradar',
        'Safety & Liability Warning':'Sicherheits- und Haftungshinweis','I Understand & Agree':'Ich verstehe und stimme zu','Log Field Observation':'Feldbeobachtung melden','Preview report':'Bericht prüfen',
        'Report title':'Berichtstitel','Type of observation':'Beobachtungstyp','Aspect':'Exposition','Elevation (m)':'Höhe (m)','Slope angle (°)':'Hangneigung (°)','Avalanche size':'Lawinengröße','Character':'Typ','Trigger':'Auslösung',
        'People involved':'Beteiligte Personen','Total group':'Gruppengröße','Fully buried':'Ganzverschüttete','Partly buried':'Teilverschüttete','Caught, not buried':'Mitgerissen, nicht verschüttet','Injured':'Verletzte','Fatalities':'Todesfälle',
        'Snowpack & stability test':'Schneedecke & Stabilitätstest','Snowpack depth (cm)':'Schneehöhe (cm)','Weak-layer depth (cm)':'Tiefe Schwachschicht (cm)','Test type':'Testtyp','Test result':'Testergebnis','Notes & field description':'Notizen und Geländebeschreibung',
        'Back to edit':'Zurück bearbeiten','Confirm & publish':'Bestätigen & veröffentlichen','Daily process':'Tagesablauf','Avalanche basics':'Lawinen-Grundlagen','Snowpack':'Schneedecke','Stability tests':'Stabilitätstests','Terrain & decisions':'Gelände & Entscheidungen','Reading the bulletin':'Bulletin lesen','Equipment':'Ausrüstung','Companion rescue':'Kameradenrettung','Rescue contacts':'Rettungskontakte','Resources':'Ressourcen'
      },
      it: {
        'Avalanche Hazard':'Pericolo valanghe','Weather & Snow History':'Meteo e storico neve','Learn & Rescue':'Imparare e soccorso','Who we are':'Chi siamo',
        'Layer controls':'Controllo livelli','Official Pyrenees BPA regions':'Regioni ufficiali bollettino Pirenei','Mapped avalanche terrain (ICGC)':'Terreno valanghivo mappato (ICGC)',
        'Avalanches':'Valanghe','Accidents / incidents':'Incidenti','Current season reports':'Segnalazioni della stagione','Official avalanche bulletin':'Bollettino valanghe ufficiale',
        'Bulletin provider':'Servizio bollettino','Open bulletin':'Apri bollettino','Current PDF':'PDF attuale','Weather & snowpack history':'Storico meteo e manto nevoso',
        'Last 14 days':'Ultimi 14 giorni','Season history':'Storico stagione','Live weather layers':'Livelli meteo live','Temperature':'Temperatura','Wind gust':'Raffica di vento','Precipitation':'Precipitazione','Weather radar':'Radar meteo',
        'Safety & Liability Warning':'Avviso sicurezza e responsabilità','I Understand & Agree':'Ho capito e accetto','Log Field Observation':'Inserisci osservazione sul campo','Preview report':'Anteprima rapporto',
        'Report title':'Titolo rapporto','Type of observation':'Tipo di osservazione','Aspect':'Esposizione','Elevation (m)':'Quota (m)','Slope angle (°)':'Pendenza (°)','Avalanche size':'Dimensione valanga','Character':'Tipo','Trigger':'Innesco',
        'People involved':'Persone coinvolte','Total group':'Totale gruppo','Fully buried':'Completamente sepolti','Partly buried':'Parzialmente sepolti','Caught, not buried':'Coinvolti non sepolti','Injured':'Feriti','Fatalities':'Decessi',
        'Snowpack & stability test':'Manto nevoso e test di stabilità','Snowpack depth (cm)':'Altezza neve (cm)','Weak-layer depth (cm)':'Profondità strato debole (cm)','Test type':'Tipo di test','Test result':'Risultato test','Notes & field description':'Note e descrizione sul campo',
        'Back to edit':'Torna alla modifica','Confirm & publish':'Conferma e pubblica','Daily process':'Processo quotidiano','Avalanche basics':'Basi sulle valanghe','Snowpack':'Manto nevoso','Stability tests':'Test di stabilità','Terrain & decisions':'Terreno e decisioni','Reading the bulletin':'Leggere il bollettino','Equipment':'Attrezzatura','Companion rescue':'Autosoccorso','Rescue contacts':'Contatti soccorso','Resources':'Risorse'
      }
    };
    const LANGUAGE_META = {ca:['','Català'], oc:['','Aranés'], eu:['','Euskara'], es:['🇪🇸','Español'], fr:['🇫🇷','Français'], en:['🇬🇧','English']};


    const EXTRA_TRANSLATIONS = {
      ca: {'Plan the day':'Planificar el dia','Avalanche fundamentals':'Fonaments dels allaus','Read the snowpack':'Llegir el mantell nival','Field tests':'Tests de camp','Terrain & decisions':'Terreny i decisions','Read the BPA / BERA':'Llegir el BPA / BERA','Companion rescue':'Autorescat','Emergency contacts':'Contactes d’emergència','Further learning':'Continuar aprenent','Learn before you commit to terrain':'Aprèn abans de comprometre’t amb el terreny','A European direction':'Una direcció europea','Official sources come first':'Primer, les fonts oficials'},
      es: {'Plan the day':'Planificar el día','Avalanche fundamentals':'Fundamentos de los aludes','Read the snowpack':'Leer el manto nivoso','Field tests':'Tests de campo','Terrain & decisions':'Terreno y decisiones','Read the BPA / BERA':'Leer el BPA / BERA','Companion rescue':'Autorescate','Emergency contacts':'Contactos de emergencia','Further learning':'Seguir aprendiendo','Learn before you commit to terrain':'Aprende antes de comprometerte con el terreno','A European direction':'Una dirección europea','Official sources come first':'Las fuentes oficiales primero'},
      fr: {'Plan the day':'Planifier la journée','Avalanche fundamentals':'Principes des avalanches','Read the snowpack':'Lire le manteau neigeux','Field tests':'Tests de terrain','Terrain & decisions':'Terrain et décisions','Read the BPA / BERA':'Lire le BPA / BERA','Companion rescue':'Secours en autonomie','Emergency contacts':'Contacts d’urgence','Further learning':'Pour aller plus loin','Learn before you commit to terrain':'Apprendre avant de s’engager dans le terrain','A European direction':'Une direction européenne','Official sources come first':'Les sources officielles d’abord'},
      de: {'Plan the day':'Tag planen','Avalanche fundamentals':'Lawinen-Grundlagen','Read the snowpack':'Schneedecke lesen','Field tests':'Feldtests','Terrain & decisions':'Gelände & Entscheidungen','Read the BPA / BERA':'Lawinenbulletin lesen','Companion rescue':'Kameradenrettung','Emergency contacts':'Notfallkontakte','Further learning':'Weiterlernen','Learn before you commit to terrain':'Lernen, bevor du dich ins Gelände begibst','A European direction':'Eine europäische Ausrichtung','Official sources come first':'Offizielle Quellen zuerst'},
      it: {'Plan the day':'Pianificare la giornata','Avalanche fundamentals':'Fondamenti sulle valanghe','Read the snowpack':'Leggere il manto nevoso','Field tests':'Test sul campo','Terrain & decisions':'Terreno e decisioni','Read the BPA / BERA':'Leggere il bollettino','Companion rescue':'Autosoccorso','Emergency contacts':'Contatti di emergenza','Further learning':'Approfondimenti','Learn before you commit to terrain':'Impara prima di impegnarti nel terreno','A European direction':'Una direzione europea','Official sources come first':'Prima le fonti ufficiali'}
    };
    Object.entries(EXTRA_TRANSLATIONS).forEach(([lang, values]) => Object.assign(I18N[lang], values));
    Object.keys(EXTRA_TRANSLATIONS.ca).forEach(key => { if (!(key in I18N.en)) I18N.en[key] = key; });
    const HUB_LABEL_TRANSLATIONS = {"en": {"Start here": "Start here", "Read the BPA": "Read the BPA", "Rescue by area": "Rescue by area", "Further learning": "Further learning"}, "ca": {"Start here": "Comença aquí", "Read the BPA": "Llegir el BPA", "Rescue by area": "Rescat per zona", "Further learning": "Continuar aprenent"}, "es": {"Start here": "Empieza aquí", "Read the BPA": "Leer el BPA", "Rescue by area": "Rescate por zona", "Further learning": "Seguir aprendiendo"}, "fr": {"Start here": "Commencer ici", "Read the BPA": "Lire le BPA", "Rescue by area": "Secours par zone", "Further learning": "Pour aller plus loin"}, "de": {"Start here": "Hier starten", "Read the BPA": "Bulletin lesen", "Rescue by area": "Rettung nach Gebiet", "Further learning": "Weiterlernen"}, "it": {"Start here": "Inizia qui", "Read the BPA": "Leggere il bollettino", "Rescue by area": "Soccorso per area", "Further learning": "Approfondimenti"}};
    Object.entries(HUB_LABEL_TRANSLATIONS).forEach(([lang, values]) => Object.assign(I18N[lang], values));
    Object.entries(window.PAN_TRANSLATIONS || {}).forEach(([lang, values]) => {
        if (!I18N[lang]) I18N[lang] = {};
        Object.assign(I18N[lang], values);
        Object.keys(values).forEach(key => { if (!(key in I18N.en)) I18N.en[key] = key; });
    });
    delete I18N.de; delete I18N.it;
    let currentLanguage = localStorage.getItem('pan-language') || 'en';
    if (!I18N[currentLanguage]) currentLanguage = 'en';
    const LANGUAGE_LOCALES = { ca:'ca-ES', oc:'oc-ES', eu:'eu-ES', es:'es-ES', fr:'fr-FR', en:'en-GB'};
    function t(source, vars = {}) {
        const dict = I18N[currentLanguage] || I18N.en;
        let text = dict[source] || I18N.en[source] || source;
        return String(text).replace(/\{(\w+)\}/g, (_match, key) => vars[key] ?? `{${key}}`);
    }
    function translatedDateTime(value) {
        try { return new Date(value).toLocaleString(LANGUAGE_LOCALES[currentLanguage] || 'en-GB'); }
        catch (_error) { return new Date(value).toLocaleString(); }
    }
    function translateStaticText(lang) {
        const dict = I18N[lang] || I18N.en;
        currentLanguage = lang;
        document.documentElement.lang = lang;
        document.querySelectorAll('[data-i18n-source]').forEach(node => {
            const source = node.dataset.i18nSource;
            node.textContent = dict[source] || source;
        });
        document.querySelectorAll('[data-i18n-placeholder-source]').forEach(node => {
            const source = node.dataset.i18nPlaceholderSource;
            node.placeholder = dict[source] || source;
        });
        document.querySelectorAll('[data-i18n-aria-source]').forEach(node => {
            const source = node.dataset.i18nAriaSource;
            node.setAttribute('aria-label', dict[source] || source);
        });
        document.querySelectorAll('[data-i18n-title-source]').forEach(node => {
            const source = node.dataset.i18nTitleSource;
            node.title = dict[source] || source;
        });
        document.querySelectorAll('.language-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.lang === lang));
        const active = LANGUAGE_META[lang] || LANGUAGE_META.en;
        const current = $('current-language');
        if (current) {
            current.replaceChildren();
            if (lang === 'oc') {
                const flag = document.createElement('img'); flag.className = 'regional-flag'; flag.src = '/assets/flags/aran.svg'; flag.alt = ''; current.append(flag);
            } else if (lang === 'ca' || lang === 'eu') {
                const flag = document.createElement('span'); flag.className = lang === 'ca' ? 'senyera-flag' : 'basque-flag'; flag.setAttribute('aria-hidden', 'true'); current.append(flag);
            }
            current.append(document.createTextNode(` ${active[0]} ${active[1]}`));
        }
        const translationStatus = $('translation-status');
        translationStatus.hidden = !['oc','eu'].includes(lang);
        translationStatus.textContent = lang === 'oc' ? 'Aranés: traduccion parciau en revision. Tèxtes non tradusits en anglés.' : 'Euskara: itzulpen partziala, berrikusten. Itzuli gabeko testuak ingelesez.';
        localStorage.setItem('pan-language', lang);
        if (localizationRuntimeReady) {
            if (currentWeatherHistory) renderWeatherCharts(currentWeatherHistory);
            if (lastWeatherPlace && selectedWeatherPoint && currentWeatherHistory) renderWeatherDetails(currentWeatherHistory, lastWeatherPlace);
            if (pendingReport && !$('preview-step').classList.contains('hidden')) $('report-preview').innerHTML = previewHtml(pendingReport);
            if (lastForecastStatus) renderForecastStatus(lastForecastStatus);
            if (lastRadarTime) $('radar-status').textContent = t('Radar frame: {time}', { time: translatedDateTime(lastRadarTime) });
            loadObservations();
        }
    }
    function prepareStaticTranslations() {
        const dictKeys = new Set(Object.keys(I18N.en));
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => {
            const parent = node.parentElement;
            if (!parent || parent.closest('script, style, .language-switcher')) return;
            const raw = node.nodeValue; const trimmed = raw.trim();
            if (!trimmed || !dictKeys.has(trimmed)) return;
            if (parent.tagName === 'OPTION') {
                if (!parent.hasAttribute('value')) parent.setAttribute('value', trimmed);
                parent.dataset.i18nSource = trimmed;
                parent.textContent = trimmed;
                return;
            }
            if (parent.childNodes.length === 1 && ['TITLE'].includes(parent.tagName)) {
                parent.dataset.i18nSource = trimmed;
                return;
            }
            const span=document.createElement('span'); span.dataset.i18nSource=trimmed; span.textContent=trimmed; parent.replaceChild(span,node);
        });
        document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
            if (dictKeys.has(el.placeholder)) el.dataset.i18nPlaceholderSource = el.placeholder;
        });
        document.querySelectorAll('[aria-label]').forEach(el => {
            const source = el.getAttribute('aria-label');
            if (dictKeys.has(source)) el.dataset.i18nAriaSource = source;
        });
        document.querySelectorAll('[title]').forEach(el => {
            const source = el.getAttribute('title');
            if (dictKeys.has(source)) el.dataset.i18nTitleSource = source;
        });
        translateStaticText(currentLanguage);
    }
    document.querySelectorAll('.language-btn').forEach(btn => btn.addEventListener('click', () => {
        translateStaticText(btn.dataset.lang);
        $('language-menu')?.classList.add('hidden');
        $('language-menu-btn')?.setAttribute('aria-expanded', 'false');
    }));
    $('language-menu-btn')?.addEventListener('click', event => {
        event.stopPropagation();
        const menu = $('language-menu');
        const willOpen = menu.classList.contains('hidden');
        menu.classList.toggle('hidden');
        $('language-menu-btn').setAttribute('aria-expanded', String(willOpen));
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.language-switcher')) {
            $('language-menu')?.classList.add('hidden');
            $('language-menu-btn')?.setAttribute('aria-expanded', 'false');
        }
    });
    async function fetchJson(url, options = {}) {
        const response = await fetch(url, options);
        let data = null;
        try { data = await response.json(); } catch (_error) { /* no-op */ }
        if (!response.ok) throw new Error(data?.error || data?.details || `Request failed (${response.status})`);
        return data;
    }

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            $(btn.dataset.page).classList.add('active');
            closeMobileDrawers();
            if (btn.dataset.page === 'page1') window.setTimeout(() => map1.invalidateSize(), 0);
            if (btn.dataset.page === 'page2') window.setTimeout(() => {
                map2.invalidateSize();
                if (!selectedWeatherPoint) map2.setView(pyreneesCoords, 8);
            }, 0);
            if (btn.dataset.page === 'page-beta') {
                $('terrain-disclaimer-modal')?.classList.remove('hidden');
                window.setTimeout(() => mapBeta?.invalidateSize(), 0);
            }
        });
    });

    $('accept-disclaimer-btn').addEventListener('click', () => $('disclaimer-modal').classList.add('hidden'));
    $('accept-terrain-disclaimer-btn')?.addEventListener('click', () => $('terrain-disclaimer-modal').classList.add('hidden'));
    document.querySelector('.close-modal').addEventListener('click', closeReportModal);

    function closeReportModal() {
        $('log-modal').classList.add('hidden');
        $('form-step').classList.remove('hidden');
        $('preview-step').classList.add('hidden');
        $('submit-error').classList.add('hidden');
        pendingReport = null;
    }

    // PAGE 1 ---------------------------------------------------------------
    const map1 = L.map('map-avalanche').setView(pyreneesCoords, 8);
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: '&copy; OpenTopoMap contributors'
    }).addTo(map1);

    const icgcWmsUrl = 'https://geoserveis.icgc.cat/geoserver/nivoallaus/wms';
    map1.createPane('forecastPane');
    map1.getPane('forecastPane').style.zIndex = 330;

    const dangerColors = {
        1: '#50b848',
        2: '#fff200',
        3: '#f7931e',
        4: '#ed1c24',
        5: '#a61c1c'
    };

    function forecastRegionStyle(feature) {
        const danger = Number(feature?.properties?.danger_level);
        const hasCurrentDanger = Number.isFinite(danger) && danger >= 1 && danger <= 5;
        return {
            pane: 'forecastPane',
            color: '#05080b',
            weight: 3.0,
            opacity: 0.98,
            fillColor: hasCurrentDanger ? dangerColors[danger] : '#8a949f',
            fillOpacity: hasCurrentDanger ? 0.44 : 0.28
        };
    }

    function forecastRegionPopup(feature, latlng) {
        const p = feature.properties || {};
        const danger = Number(p.danger_level);
        const hasDanger = Number.isFinite(danger) && danger >= 1 && danger <= 5;
        const dangerText = hasDanger ? t('EAWS danger {danger} / 5', { danger }) : t('No current machine-readable BPA rating');
        return `
            <div class="forecast-region-popup">
                <strong>${escapeHtml(p.name || p.region_id || t('Avalanche warning region'))}</strong><br>
                <span class="pill forecast-danger-${hasDanger ? danger : 0}">${escapeHtml(dangerText)}</span><br>
                <small>${escapeHtml(p.provider_label || t('Official warning service'))} · ${escapeHtml(p.region_id || '')}${p.danger_date ? ` · ${escapeHtml(p.danger_date)}` : ''}</small>
                <div class="popup-actions">
                    <button class="popup-btn log-report-here" data-lat="${Number(latlng.lat)}" data-lng="${Number(latlng.lng)}">${escapeHtml(t('Log report here'))}</button>
                    <a class="popup-btn" href="${escapeHtml(p.bulletin_url || '#')}" target="_blank" rel="noopener">${escapeHtml(t('Open official bulletin'))}</a>
                </div>
            </div>`;
    }

    const forecastZones = L.geoJSON(null, {
        pane: 'forecastPane',
        style: forecastRegionStyle,
        onEachFeature(feature, layer) {
            layer.on('click', event => {
                if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
                const p = feature.properties || {};
                const provider = bulletinProviders.find(item => item.id === p.provider_id);
                if (provider) setBulletinProvider({ ...provider, url: p.bulletin_url || provider.url }, `${p.name || p.region_id} → ${provider.label}`);
                layer.bindPopup(forecastRegionPopup(feature, event.latlng), { maxWidth: 390 }).openPopup(event.latlng);
            });
        }
    }).addTo(map1);

    function renderForecastStatus(status) {
        if (!status) return;
        if (status.error) {
            $('bpa-region-status').textContent = t('Could not load official warning-region polygons: {error}', { error: status.error });
            return;
        }
        $('bpa-region-status').textContent = t('{total} Pyrenees warning regions · {coloured} with a current normalized rating · {gray} gray (no current machine-readable rating) · {date}', status);
    }

    async function loadForecastRegions() {
        try {
            const data = await fetchJson('/api/avalanche/regions');
            forecastZones.clearLayers();
            forecastZones.addData(data);
            const features = data.features || [];
            const coloured = features.filter(feature => Number(feature.properties?.danger_level) >= 1).length;
            const gray = features.length - coloured;
            lastForecastStatus = { total: features.length, coloured, gray, date: data.date };
            renderForecastStatus(lastForecastStatus);
        } catch (error) {
            lastForecastStatus = { error: error.message };
            renderForecastStatus(lastForecastStatus);
        }
    }

    const avalancheTerrain = L.tileLayer.wms(icgcWmsUrl, {
        layers: 'zonesallaus', format: 'image/png', transparent: true, version: '1.1.1', opacity: 0.70,
        attribution: 'ICGC mapped avalanche terrain'
    });
    const cataloniaHistoricalLayer = L.tileLayer.wms(icgcWmsUrl, {
        layers: 'zonesallaus,enquestes,observacions', format: 'image/png', transparent: true, version: '1.1.1', opacity: 0.62,
        attribution: 'ICGC avalanche inventory / historical mapped zones'
    });

    function historicalGeoJsonLayer(geojson, label) {
        return L.geoJSON(geojson, {
            style: () => ({ color: '#7a2d73', weight: 2, opacity: .8, fillColor: '#b25ba8', fillOpacity: .16 }),
            pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: 4, color: '#7a2d73', weight: 2, fillColor: '#fff', fillOpacity: .9 }),
            onEachFeature(feature, layer) {
                const p = feature.properties || {};
                const title = p.name || p.nom || p.site || p.id || label;
                layer.bindPopup(`<strong>${escapeHtml(title)}</strong><br><small>${escapeHtml(label)} · historical inventory context, not a current danger forecast.</small>`);
            }
        });
    }

    function syncHistoricalToggle(id, layer, map) {
        const input = $(id);
        if (!input || !layer || !map) return;
        input.disabled = false;
        if (input.checked && !map.hasLayer(layer)) layer.addTo(map);
        input.addEventListener('change', event => {
            if (event.target.checked) layer.addTo(map); else map.removeLayer(layer);
        });
    }

    async function loadHistoricalDatasets() {
        const messages = ['Catalunya: live ICGC inventory'];
        try {
            const response = await fetchJson('/api/historical-avalanches');

            // Andorra: prefer streaming the official WMS so the repository does not redistribute the data.
            let andorraReady = false;
            try {
                const config = await fetchJson('/api/andorra-avalanche-wms');
                const namedLayers = (config.layers || []).map(layer => layer.name).filter(Boolean);
                if (config.available && config.url && namedLayers.length) {
                    const options = {
                        layers: namedLayers.join(','), format: 'image/png', transparent: true, version: '1.1.1', opacity: 0.58,
                        attribution: 'Govern d\'Andorra · official avalanche WMS'
                    };
                    historyLayersMain.andorra = L.tileLayer.wms(config.url, options);
                    historyLayersBeta.andorra = L.tileLayer.wms(config.url, { ...options, opacity: 0.50 });
                    syncHistoricalToggle('toggle-history-andorra', historyLayersMain.andorra, map1);
                    syncHistoricalToggle('toggle-beta-andorra-history', historyLayersBeta.andorra, mapBeta);
                    messages.push(`Andorra: live official WMS (${namedLayers.length} layer${namedLayers.length === 1 ? '' : 's'})`);
                    andorraReady = true;
                }
            } catch (_error) {
                // Fall back to a locally installed, licence-cleared normalized import below.
            }

            for (const key of ['france','andorra','spain']) {
                if (key === 'andorra' && andorraReady) continue;
                const item = response.datasets?.[key];
                if (item?.available && item.geojson) {
                    historyLayersMain[key] = historicalGeoJsonLayer(item.geojson, item.label || key);
                    historyLayersBeta[key] = historicalGeoJsonLayer(item.geojson, item.label || key);
                    syncHistoricalToggle(`toggle-history-${key}`, historyLayersMain[key], map1);
                    syncHistoricalToggle(`toggle-beta-${key}-history`, historyLayersBeta[key], mapBeta);
                    messages.push(`${item.label}: ${item.featureCount} features`);
                } else {
                    $(`toggle-history-${key}`)?.setAttribute('disabled', 'disabled');
                    $(`toggle-beta-${key}-history`)?.setAttribute('disabled', 'disabled');
                    messages.push(`${item?.label || key}: ${key === 'andorra' ? 'official WMS unavailable; import not installed' : 'import not installed'}`);
                }
            }
            if ($('historical-layer-status')) $('historical-layer-status').textContent = messages.join(' · ');
        } catch (error) {
            if ($('historical-layer-status')) $('historical-layer-status').textContent = `Historical imports unavailable: ${error.message}`;
        }
    }

    const observationGroups = {
        avalanche: L.layerGroup().addTo(map1),
        accident: L.layerGroup().addTo(map1),
        reports: L.layerGroup().addTo(map1)
    };

    const markerPriority = { avalanche: 5, accident: 4, test: 3, snowpack: 2, trip_report: 1 };
    const markerSymbols = { avalanche: '🏔️', accident: '🚨', test: '🧪', snowpack: '🔎', trip_report: '🎿' };
    const markerLabelKeys = { avalanche: 'Avalanche', accident: 'Incident', test: 'Stability test', snowpack: 'Snowpack', trip_report: 'Trip report' };
    const markerLabel = kind => t(markerLabelKeys[kind] || 'Field report');

    function reportMarkerKind(feature) {
        const type = feature.properties?.type;
        const test = feature.properties?.details?.snowpackTest;
        if (type === 'avalanche') return 'avalanche';
        if (type === 'accident') return 'accident';
        if (test?.type) return 'test';
        if (type === 'snowpack') return 'snowpack';
        return 'trip_report';
    }

    function reportSeverity(feature) {
        const type = feature.properties?.type;
        const people = feature.properties?.details?.people || {};
        if (Number(people.fatalities || 0) > 0) return 'mortality';
        const incidentCount = Number(people.fullyBuried || 0) + Number(people.partlyBuried || 0) + Number(people.caughtNotBuried || 0) + Number(people.injured || 0);
        if (type === 'accident' || incidentCount > 0) return 'incident';
        return 'info';
    }

    function groupSeverity(features) {
        const severities = features.map(reportSeverity);
        if (severities.includes('mortality')) return 'mortality';
        if (severities.includes('incident')) return 'incident';
        return 'info';
    }

    function dominantKind(features) {
        return features
            .map(reportMarkerKind)
            .sort((a, b) => (markerPriority[b] || 0) - (markerPriority[a] || 0))[0] || 'trip_report';
    }

    function markerIcon(kind, severity, count) {
        const countBadge = count > 1 ? `<span class="marker-count">${count}</span>` : '';
        return L.divIcon({
            className: 'observation-marker-shell',
            html: `<div class="observation-marker marker-${escapeHtml(severity)} marker-kind-${escapeHtml(kind)}">${escapeHtml(markerSymbols[kind] || '●')}${countBadge}</div>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
            popupAnchor: [0, -16]
        });
    }

    function reportEntryHtml(feature) {
        const p = feature.properties || {};
        const d = p.details || {};
        const people = d.people || {};
        const kind = reportMarkerKind(feature);
        const severity = reportSeverity(feature);
        const buried = Number(people.fullyBuried || 0) + Number(people.partlyBuried || 0);
        const dateLabel = d.observedAt ? translatedDateTime(d.observedAt) : (p.created_at ? translatedDateTime(p.created_at) : '—');
        return `
            <div class="popup-report-entry">
                <div><strong>${escapeHtml(d.title || markerLabel(kind) || p.type || t('Field report'))}</strong></div>
                <span class="pill">${escapeHtml(markerLabel(kind) || p.type || '')}</span>
                <span class="pill severity-pill severity-${escapeHtml(severity)}">${escapeHtml(severity === 'mortality' ? t('Fatality') : severity === 'incident' ? t('Incident') : t('Information'))}</span>
                <p class="popup-summary-note">${escapeHtml(d.notes || '')}</p>
                <small>${escapeHtml(dateLabel)} · ${escapeHtml(t('injured'))} ${escapeHtml(people.injured || 0)} · ${escapeHtml(t('fatalities'))} ${escapeHtml(people.fatalities || 0)}${buried ? ` · ${escapeHtml(t('buried'))} ${buried}` : ''}</small>
                <div><button class="popup-btn view-report-btn" data-report-id="${escapeHtml(p.id)}" type="button">${escapeHtml(t('View full report'))}</button></div>
                ${p.can_delete ? `<div><button class="delete-observation popup-delete-btn" data-id="${escapeHtml(p.id)}" type="button">${escapeHtml(t('Delete my report'))}</button></div>` : ''}
            </div>`;
    }

    function groupedPopupHtml(features) {
        const heading = features.length > 1 ? `<strong>${features.length} ${escapeHtml(t('reports at this point'))}</strong>` : '';
        return `<div class="popup-report-list">${heading}${features.map(reportEntryHtml).join('<hr>')}</div>`;
    }

    function addObservationGeometry(feature) {
        const geometry = feature.properties?.details?.avalancheGeometry;
        if (!geometry || feature.properties?.type !== 'avalanche') return;
        if (geometry.path?.type === 'Polygon' && Array.isArray(geometry.path.coordinates?.[0])) {
            const latlngs = geometry.path.coordinates[0].map(([lng, lat]) => [lat, lng]);
            L.polygon(latlngs, { color: '#c45a20', weight: 2, fillColor: '#ef7c3b', fillOpacity: .18, bubblingMouseEvents: false })
                .bindTooltip('Reported avalanche path / extent')
                .addTo(observationGroups.avalanche);
        }
        if (geometry.crown?.type === 'LineString' && Array.isArray(geometry.crown.coordinates)) {
            const latlngs = geometry.crown.coordinates.map(([lng, lat]) => [lat, lng]);
            L.polyline(latlngs, { color: '#b4232c', weight: 4, opacity: .92, bubblingMouseEvents: false })
                .bindTooltip('Reported avalanche crown / release line')
                .addTo(observationGroups.avalanche);
        }
    }

    async function loadObservations() {
        Object.values(observationGroups).forEach(group => group.clearLayers());
        try {
            const data = await fetchJson('/api/observations', { headers: { 'X-Observer-Token': observerToken } });
            const grouped = new Map();
            observationFeatureById.clear();
            (data.features || []).forEach(feature => {
                observationFeatureById.set(String(feature.properties?.id), feature);
                const [lng, lat] = feature.geometry.coordinates;
                const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(feature);
            });

            grouped.forEach(features => {
                features.forEach(addObservationGeometry);
                const [lng, lat] = features[0].geometry.coordinates;
                const kind = dominantKind(features);
                const severity = groupSeverity(features);
                const marker = L.marker([lat, lng], { icon: markerIcon(kind, severity, features.length) })
                    .bindPopup(groupedPopupHtml(features), { maxWidth: 380 });
                const layerGroup = kind === 'avalanche' ? observationGroups.avalanche : kind === 'accident' ? observationGroups.accident : observationGroups.reports;
                marker.addTo(layerGroup);
            });
        } catch (error) {
            showToast(t('Could not load observations: {error}', { error: error.message }), true);
        }
    }

    function bindLayerToggle(id, layer, map) {
        $(id).addEventListener('change', event => {
            if (event.target.checked) layer.addTo(map); else map.removeLayer(layer);
        });
    }
    bindLayerToggle('toggle-forecast-zones', forecastZones, map1);
    bindLayerToggle('toggle-avalanche-terrain', avalancheTerrain, map1);
    bindLayerToggle('toggle-history-catalonia', cataloniaHistoricalLayer, map1);
    bindLayerToggle('toggle-avalanches', observationGroups.avalanche, map1);
    bindLayerToggle('toggle-accidents', observationGroups.accident, map1);
    bindLayerToggle('toggle-reports', observationGroups.reports, map1);

    async function updateStorageStatus() {
        try {
            const health = await fetchJson('/api/health');
            $('storage-status').textContent = health.storage === 'postgresql-postgis'
                ? t('✓ Reports persist in PostgreSQL/PostGIS. Reports created in this browser can be deleted from their marker popup.')
                : t('⚠ Local JSON fallback is active. Reports survive local reloads, but Render deployments need DATABASE_URL for durable storage.');
        } catch (_error) {
            $('storage-status').textContent = t('⚠ Could not verify report storage.');
        }
    }

    async function loadBulletinProviders() {
        try {
            const data = await fetchJson('/api/bulletins');
            bulletinProviders = data.providers || [];
            $('bulletin-provider-select').innerHTML = bulletinProviders.map(provider => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.label)}</option>`).join('');
            setBulletinProvider(bulletinProviders.find(provider => provider.id === 'icgc') || bulletinProviders[0]);
        } catch (error) {
            $('bulletin-selection-note').textContent = t('Could not load bulletin list: {error}', { error: error.message });
        }
    }

    function setBulletinProvider(provider, note = '') {
        if (!provider) {
            $('official-bulletin-link').classList.add('hidden');
            $('official-pdf-link').classList.add('hidden');
            $('bulletin-selection-note').textContent = note || t('No bulletin source is configured for this point.');
            return;
        }
        const select = $('bulletin-provider-select');
        if ([...select.options].some(option => option.value === provider.id)) select.value = provider.id;
        $('official-bulletin-link').href = provider.url;
        $('official-bulletin-link').classList.remove('hidden');
        if (provider.pdfUrl) {
            $('official-pdf-link').href = provider.pdfUrl;
            $('official-pdf-link').classList.remove('hidden');
        } else {
            $('official-pdf-link').classList.add('hidden');
        }
        $('bulletin-selection-note').textContent = note || t('{provider} selected.', { provider: provider.label });
    }

    $('bulletin-provider-select').addEventListener('change', event => {
        setBulletinProvider(bulletinProviders.find(provider => provider.id === event.target.value));
    });

    function clearReportSketchLayers() {
        if (!reportSketchMap) return;
        [reportSketchCrownLayer, reportSketchPathLayer, reportSketchLocationMarker].forEach(layer => { if (layer) reportSketchMap.removeLayer(layer); });
        reportSketchCrownLayer = null;
        reportSketchPathLayer = null;
        reportSketchLocationMarker = null;
    }

    function resetAvalancheSketch() {
        reportSketchPoints.crown.length = 0;
        reportSketchPoints.path.length = 0;
        reportSketchMode = null;
        if (reportSketchMap) clearReportSketchLayers();
        document.querySelectorAll('#draw-crown-btn, #draw-path-btn').forEach(button => button.classList.remove('active-draw-tool'));
        if ($('sketch-status')) $('sketch-status').textContent = 'Select a drawing tool, then tap points on the map. Crown needs at least 2 points; path needs at least 3.';
    }

    function renderAvalancheSketch() {
        if (!reportSketchMap) return;
        if (reportSketchCrownLayer) reportSketchMap.removeLayer(reportSketchCrownLayer);
        if (reportSketchPathLayer) reportSketchMap.removeLayer(reportSketchPathLayer);
        reportSketchCrownLayer = reportSketchPoints.crown.length > 1
            ? L.polyline(reportSketchPoints.crown, { color: '#b4232c', weight: 5, opacity: .95 }).addTo(reportSketchMap)
            : reportSketchPoints.crown.length === 1 ? L.circleMarker(reportSketchPoints.crown[0], { radius: 5, color: '#b4232c', fillOpacity: 1 }).addTo(reportSketchMap) : null;
        reportSketchPathLayer = reportSketchPoints.path.length >= 3
            ? L.polygon(reportSketchPoints.path, { color: '#c45a20', weight: 3, fillColor: '#f28a49', fillOpacity: .24 }).addTo(reportSketchMap)
            : reportSketchPoints.path.length > 0 ? L.polyline(reportSketchPoints.path, { color: '#c45a20', weight: 3, dashArray: '6 5' }).addTo(reportSketchMap) : null;
        if ($('sketch-status')) $('sketch-status').textContent = `Crown: ${reportSketchPoints.crown.length} point(s) · path: ${reportSketchPoints.path.length} point(s)${reportSketchMode ? ` · drawing ${reportSketchMode}` : ''}.`;
    }

    function ensureReportSketchMap(lat, lng) {
        const container = $('report-avalanche-map');
        if (!container) return;
        if (!reportSketchMap) {
            reportSketchMap = L.map(container, { zoomControl: true, attributionControl: false }).setView([lat, lng], 15);
            L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 }).addTo(reportSketchMap);
            reportSketchMap.on('click', event => {
                if (!reportSketchMode) {
                    $('sketch-status').textContent = 'Choose “Draw crown line” or “Draw avalanche path” first.';
                    return;
                }
                reportSketchPoints[reportSketchMode].push(event.latlng);
                renderAvalancheSketch();
            });
        }
        reportSketchMap.setView([lat, lng], Math.max(reportSketchMap.getZoom(), 15));
        if (reportSketchLocationMarker) reportSketchMap.removeLayer(reportSketchLocationMarker);
        reportSketchLocationMarker = L.circleMarker([lat, lng], { radius: 5, color: '#146f9c', weight: 2, fillColor: '#fff', fillOpacity: 1 })
            .bindTooltip('Report location / release-point reference')
            .addTo(reportSketchMap);
        window.setTimeout(() => reportSketchMap.invalidateSize(), 80);
    }

    function setSketchMode(mode) {
        reportSketchMode = mode;
        $('draw-crown-btn')?.classList.toggle('active-draw-tool', mode === 'crown');
        $('draw-path-btn')?.classList.toggle('active-draw-tool', mode === 'path');
        renderAvalancheSketch();
    }

    function serializeAvalancheGeometry() {
        if (value('form-type') !== 'avalanche') return null;
        const crownCoordinates = reportSketchPoints.crown.map(point => [Number(point.lng.toFixed(6)), Number(point.lat.toFixed(6))]);
        const pathCoordinates = reportSketchPoints.path.map(point => [Number(point.lng.toFixed(6)), Number(point.lat.toFixed(6))]);
        const geometry = {};
        if (crownCoordinates.length >= 2) geometry.crown = { type: 'LineString', coordinates: crownCoordinates };
        if (pathCoordinates.length >= 3) {
            const closed = pathCoordinates.slice();
            const first = closed[0], last = closed[closed.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) closed.push(first.slice());
            geometry.path = { type: 'Polygon', coordinates: [closed] };
        }
        return Object.keys(geometry).length ? geometry : null;
    }

    function updateReportTypeUi() {
        const type = value('form-type');
        const avalancheFieldsRequired = ['avalanche', 'accident'].includes(type);
        ['form-avalanche-size', 'form-character', 'form-trigger'].forEach(id => { if ($(id)) $(id).required = avalancheFieldsRequired; });
        document.querySelectorAll('.avalanche-required-mark').forEach(mark => mark.classList.toggle('hidden', !avalancheFieldsRequired));
        const showSketch = type === 'avalanche';
        $('avalanche-sketch-section')?.classList.toggle('hidden', !showSketch);
        if (showSketch) {
            const lat = Number(value('form-lat')), lng = Number(value('form-lng'));
            if (Number.isFinite(lat) && Number.isFinite(lng)) window.setTimeout(() => ensureReportSketchMap(lat, lng), 60);
        }
    }

    $('draw-crown-btn')?.addEventListener('click', () => setSketchMode('crown'));
    $('draw-path-btn')?.addEventListener('click', () => setSketchMode('path'));
    $('undo-sketch-btn')?.addEventListener('click', () => {
        if (reportSketchMode && reportSketchPoints[reportSketchMode].length) reportSketchPoints[reportSketchMode].pop();
        else if (reportSketchPoints.path.length) reportSketchPoints.path.pop();
        else if (reportSketchPoints.crown.length) reportSketchPoints.crown.pop();
        renderAvalancheSketch();
    });
    $('clear-sketch-btn')?.addEventListener('click', () => { reportSketchPoints.crown.length = 0; reportSketchPoints.path.length = 0; renderAvalancheSketch(); });
    $('form-type')?.addEventListener('change', updateReportTypeUi);

    function localDateTimeInputValue(date = new Date()) {
        const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return shifted.toISOString().slice(0, 16);
    }

    let terrainRequestId = 0;
    const terrainEdited = new Set();
    ['form-elevation','form-slope','form-aspect'].forEach(id => $(id).addEventListener('input', () => terrainEdited.add(id)));
    async function autoFillReportTerrain(lat, lng) {
        const requestId = ++terrainRequestId;
        terrainEdited.clear();
        ['form-elevation','form-slope','form-aspect'].forEach(id => { $(id).value = ''; });
        pendingAutoTerrain = null;
        if ($('form-location-summary')) $('form-location-summary').textContent = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)} · deriving terrain…`;
        if ($('auto-terrain-note')) $('auto-terrain-note').innerHTML = '<strong>Deriving elevation, slope and aspect from the mapped point…</strong> You can overwrite the values with a better field measurement.';
        try {
            const terrain = await fetchJson(`/api/terrain/point?lat=${Number(lat).toFixed(6)}&lng=${Number(lng).toFixed(6)}`);
            if (requestId !== terrainRequestId) return;
            pendingAutoTerrain = terrain;
            if (!terrainEdited.has('form-elevation') && Number.isFinite(terrain.elevationM)) $('form-elevation').value = Math.round(Number(terrain.elevationM));
            if (!terrainEdited.has('form-slope') && Number.isFinite(terrain.slopeDeg)) $('form-slope').value = Number(terrain.slopeDeg).toFixed(1);
            if (!terrainEdited.has('form-aspect') && Number.isFinite(terrain.aspectDeg)) {
                const aspect = compassAspect(Number(terrain.aspectDeg));
                if ([...$('form-aspect').options].some(option => option.value === aspect)) $('form-aspect').value = aspect;
            }
            if ($('form-location-summary')) $('form-location-summary').textContent = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)} · ${terrain.sourceLabel || terrain.source || 'terrain model'}`;
            if ($('auto-terrain-note')) $('auto-terrain-note').innerHTML = `<strong>Terrain auto-filled from ${escapeHtml(terrain.sourceLabel || terrain.source || 'available terrain data')}.</strong> Model resolution: ${escapeHtml(terrain.nominalResolutionM ?? 'unknown')} m. Correct these values if your field measurement is better.`;
        } catch (error) {
            if (requestId !== terrainRequestId) return;
            if ($('form-location-summary')) $('form-location-summary').textContent = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
            if ($('auto-terrain-note')) $('auto-terrain-note').innerHTML = `<strong>Automatic terrain lookup was unavailable.</strong> Terrain remains unknown. You may add measurements under Extra terrain parameters. ${escapeHtml(error.message)}`;
        }
    }

    function openReportModal(lat, lng) {
        $('form-lat').value = lat;
        $('form-lng').value = lng;
        if ($('form-observed-at')) $('form-observed-at').value = localDateTimeInputValue();
        pendingAutoTerrain = null;
        resetAvalancheSketch();
        $('log-modal').classList.remove('hidden');
        $('form-step').classList.remove('hidden');
        $('preview-step').classList.add('hidden');
        updateReportTypeUi();
        autoFillReportTerrain(lat, lng);
    }

    map1.on('click', async event => {
        const { lat, lng } = event.latlng;
        let resolved = null;
        try {
            resolved = await fetchJson(`/api/bulletins/resolve?lat=${lat}&lng=${lng}`);
            if (resolved.provider) setBulletinProvider({ ...resolved.provider, url: resolved.bulletinUrl || resolved.provider.url }, `${resolved.zone || resolved.place?.town || resolved.provider.label} → ${resolved.provider.label}`);
        } catch (_error) {
            // Reporting remains available even if external bulletin services are unreachable.
        }
        const provider = resolved?.provider;
        const zoneLabel = resolved?.zone || resolved?.place?.town || t('Selected mountain location');
        const bulletinAction = provider
            ? `<a class="popup-btn" href="${escapeHtml(resolved.bulletinUrl || provider.url)}" target="_blank" rel="noopener">${escapeHtml(t('Open {provider}', { provider: provider.label }))}</a>`
            : `<span class="popup-note">${escapeHtml(t('No configured official bulletin for this point.'))}</span>`;
        L.popup()
            .setLatLng(event.latlng)
            .setContent(`
                <strong>${escapeHtml(zoneLabel)}</strong><br>
                <small>${lat.toFixed(5)}, ${lng.toFixed(5)}</small>
                <div class="popup-actions">
                    <button class="popup-btn log-report-here" data-lat="${lat}" data-lng="${lng}">${escapeHtml(t('Log report here'))}</button>
                    ${bulletinAction}
                </div>`)
            .openOn(map1);
    });

    $('map-avalanche').addEventListener('click', async event => {
        const logButton = event.target.closest('.log-report-here');
        if (logButton) {
            openReportModal(Number(logButton.dataset.lat), Number(logButton.dataset.lng));
            return;
        }
        const deleteButton = event.target.closest('.delete-observation');
        if (!deleteButton) return;
        const id = Number(deleteButton.dataset.id);
        if (!Number.isInteger(id) || !window.confirm(t('Delete this report? This cannot be undone.'))) return;
        try {
            await fetchJson(`/api/observations/${id}`, { method: 'DELETE', headers: { 'X-Observer-Token': observerToken } });
            map1.closePopup();
            await loadObservations();
            showToast(t('Your report was deleted.'));
        } catch (error) {
            showToast(t('Could not delete report: {error}', { error: error.message }), true);
        }
    });

    document.querySelectorAll('input[name="report-mode"]').forEach(input => {
        input.addEventListener('change', () => {
            $('slow-fields').classList.toggle('hidden-fieldset', input.value !== 'slow' || !input.checked);
        });
    });

    function value(id) { return $(id).value; }
    function numberOrNull(id) { const n = Number(value(id)); return value(id) === '' || !Number.isFinite(n) ? null : n; }

    function currentSeasonYear(value = null) {
        const now = value ? new Date(value) : new Date();
        return now.getMonth() >= 10 ? now.getFullYear() + 1 : now.getFullYear();
    }

    function observedAtIso() {
        const raw = value('form-observed-at');
        if (!raw) return null;
        const date = new Date(raw);
        return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }

    function buildReportPayload() {
        const reportMode = document.querySelector('input[name="report-mode"]:checked').value;
        const people = {
            groupSize: numberOrNull('form-group-size') || 0,
            fullyBuried: numberOrNull('form-fully-buried') || 0,
            partlyBuried: numberOrNull('form-partly-buried') || 0,
            caughtNotBuried: numberOrNull('form-caught') || 0,
            injured: numberOrNull('form-injured') || 0,
            fatalities: numberOrNull('form-fatalities') || 0
        };
        const details = {
            reportMode,
            title: value('form-title').trim(),
            observedAt: observedAtIso(),
            observationSource: value('form-observation-source'),
            locationConfidence: value('form-location-confidence'),
            locationMethod: 'map_click',
            autoTerrain: pendingAutoTerrain ? { ...pendingAutoTerrain } : null,
            terrainOverrides: [...terrainEdited],
            aspect: value('form-aspect'),
            elevation: numberOrNull('form-elevation'),
            slope: numberOrNull('form-slope'),
            avalancheSize: value('form-avalanche-size'),
            avalancheCharacter: value('form-character'),
            trigger: value('form-trigger'),
            slabThickness: numberOrNull('form-slab-thickness'),
            slabWidth: numberOrNull('form-slab-width'),
            runLength: numberOrNull('form-run-length'),
            people,
            notes: value('form-notes').trim(),
            photos: pendingPhotos.slice(0, 3),
            snowLayers: collectSnowLayers(),
            avalancheGeometry: serializeAvalancheGeometry()
        };
        if (reportMode === 'slow') {
            details.snowpack = {
                depth: numberOrNull('form-snow-depth'),
                weakLayerDepth: numberOrNull('form-weak-layer'),
                whumpfing: value('form-whumpf'),
                cracking: value('form-cracking')
            };
            details.snowpackTest = {
                type: value('form-test-type'),
                result: value('form-test-result'),
                fracture: value('form-fracture'),
                failureDepth: numberOrNull('form-failure-depth'),
                crystal: value('form-crystal')
            };
        }
        return {
            type: value('form-type'),
            lat: Number(value('form-lat')),
            lng: Number(value('form-lng')),
            season_year: currentSeasonYear(details.observedAt),
            details
        };
    }

    function previewHtml(payload) {
        const d = payload.details;
        const people = d.people;
        const test = d.snowpackTest || {};
        const typeKey = payload.type === 'avalanche' ? 'Avalanche' : payload.type === 'accident' ? 'Incident' : payload.type === 'snowpack' ? 'Snowpack' : 'Trip report';
        return `
            <h3>${escapeHtml(d.title)}</h3>
            <p><span class="pill">${escapeHtml(t(typeKey))}</span></p>
            <dl class="preview-grid">
                <dt>Observed</dt><dd>${escapeHtml(d.observedAt ? translatedDateTime(d.observedAt) : '—')}</dd>
                <dt>${escapeHtml(t('Location'))}</dt><dd>${payload.lat.toFixed(5)}, ${payload.lng.toFixed(5)} · ${escapeHtml(d.locationConfidence || '—')}</dd>
                <dt>${escapeHtml(t('Terrain'))}</dt><dd>${escapeHtml(d.aspect)} · ${escapeHtml(d.elevation ?? '—')} m · ${escapeHtml(d.slope ?? '—')}°</dd>
                <dt>${escapeHtml(t('Avalanche'))}</dt><dd>${escapeHtml(t('Size'))} ${escapeHtml(d.avalancheSize || '—')} · ${escapeHtml(t(d.avalancheCharacter || '—'))} · ${escapeHtml(t(d.trigger || '—'))}</dd>
                <dt>${escapeHtml(t('Dimensions'))}</dt><dd>${escapeHtml(d.slabThickness ?? '—')} cm · ${escapeHtml(d.slabWidth ?? '—')} m · ${escapeHtml(d.runLength ?? '—')} m</dd>
                <dt>${escapeHtml(t('People'))}</dt><dd>${escapeHtml(t('Group'))} ${people.groupSize}; ${escapeHtml(t('fully buried'))} ${people.fullyBuried}; ${escapeHtml(t('partly buried'))} ${people.partlyBuried}; ${escapeHtml(t('caught'))} ${people.caughtNotBuried}; ${escapeHtml(t('injured'))} ${people.injured}; ${escapeHtml(t('fatalities'))} ${people.fatalities}</dd>
                ${d.avalancheGeometry ? `<dt>Avalanche mapping</dt><dd>${d.avalancheGeometry.crown ? 'Crown line included' : 'No crown line'} · ${d.avalancheGeometry.path ? 'path/extent included' : 'no path polygon'}</dd>` : ''}
                ${d.reportMode === 'slow' ? `<dt>${escapeHtml(t('Snow test:'))}</dt><dd>${escapeHtml(t(test.type || 'No test'))} · ${escapeHtml(t(test.result || '—'))} · ${escapeHtml(t(test.fracture || '—'))} · ${escapeHtml(t('failure depth'))} ${escapeHtml(test.failureDepth ?? '—')} cm · ${escapeHtml(t(test.crystal || '—'))}</dd>` : ''}
            </dl>
            <p>${escapeHtml(d.notes)}</p>`;
    }

    $('observation-form').addEventListener('submit', event => {
        event.preventDefault();
        pendingReport = buildReportPayload();
        if (!pendingReport.details.title || !pendingReport.details.notes) return;
        $('report-preview').innerHTML = previewHtml(pendingReport);
        $('form-step').classList.add('hidden');
        $('preview-step').classList.remove('hidden');
    });

    $('edit-report-btn').addEventListener('click', () => {
        $('preview-step').classList.add('hidden');
        $('form-step').classList.remove('hidden');
    });

    $('confirm-report-btn').addEventListener('click', async () => {
        if (!pendingReport) return;
        const button = $('confirm-report-btn');
        button.disabled = true;
        button.textContent = t('Publishing…');
        try {
            const result = await fetchJson('/api/observations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Observer-Token': observerToken },
                body: JSON.stringify(pendingReport)
            });
            closeReportModal();
            $('observation-form').reset();
            pendingPhotos = [];
            pendingAutoTerrain = null;
            resetAvalancheSketch();
            updateReportTypeUi();
            if ($('photo-preview')) $('photo-preview').innerHTML = '';
            if ($('snow-layer-editor')) $('snow-layer-editor').innerHTML = '';
            await loadObservations();
            showToast(result.storage === 'postgresql-postgis' ? t('Report published. You can delete it later from its marker popup in this browser.') : t('Report saved to local fallback storage.'));
        } catch (error) {
            $('preview-step').classList.add('hidden');
            $('form-step').classList.remove('hidden');
            $('submit-error').textContent = t('Could not publish: {error}', { error: error.message });
            $('submit-error').classList.remove('hidden');
        } finally {
            button.disabled = false;
            button.textContent = t('Confirm & publish');
        }
    });

    // v4 report UX ---------------------------------------------------------
    document.querySelectorAll('.mobile-map-menu').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            openMobileDrawer(button.dataset.drawerPage);
        });
    });

    function collectSnowLayers() {
        return [...document.querySelectorAll('.snow-layer-row')].map(row => ({
            thicknessCm: Number(row.querySelector('.layer-thickness')?.value) || null,
            grain: row.querySelector('.layer-grain')?.value || '',
            hardness: row.querySelector('.layer-hardness')?.value || '',
            weak: Boolean(row.querySelector('.layer-weak')?.checked)
        })).filter(layer => layer.thicknessCm || layer.grain || layer.hardness || layer.weak);
    }

    function addSnowLayer(layer = {}) {
        const editor = $('snow-layer-editor');
        if (!editor) return;
        const row = document.createElement('div');
        row.className = 'snow-layer-row';
        row.innerHTML = `
            <label>Thickness (cm)<input class="layer-thickness" type="number" min="1" max="500" value="${escapeHtml(layer.thicknessCm || '')}"></label>
            <label>Snow / grain<select class="layer-grain"><option value="">Unknown</option><option>New snow</option><option>Rounded grains</option><option>Facets</option><option>Surface hoar</option><option>Depth hoar</option><option>Crust</option><option>Melt forms</option><option>Graupel</option><option>Other</option></select></label>
            <label>Hardness<select class="layer-hardness"><option value="">Unknown</option><option>Fist</option><option>4 fingers</option><option>1 finger</option><option>Pencil</option><option>Knife</option><option>Ice</option></select></label>
            <label class="layer-weak-wrap"><input class="layer-weak" type="checkbox"> Unstable layer</label>
            <button class="layer-remove" type="button" aria-label="Remove layer">×</button>`;
        if (layer.grain) row.querySelector('.layer-grain').value = layer.grain;
        if (layer.hardness) row.querySelector('.layer-hardness').value = layer.hardness;
        row.querySelector('.layer-weak').checked = Boolean(layer.weak);
        row.querySelector('.layer-remove').addEventListener('click', () => row.remove());
        editor.appendChild(row);
    }
    $('add-snow-layer-btn')?.addEventListener('click', () => addSnowLayer());

    async function resizePhoto(file) {
        if (!file.type.startsWith('image/')) return null;
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        const image = await new Promise((resolve, reject) => {
            const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = dataUrl;
        });
        const maxSide = 1400;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', .78);
    }

    $('form-photos')?.addEventListener('change', async event => {
        const files = [...event.target.files].slice(0, 3);
        pendingPhotos = [];
        $('photo-preview').innerHTML = '<span class="muted">Preparing photos…</span>';
        try {
            pendingPhotos = (await Promise.all(files.map(resizePhoto))).filter(Boolean);
            $('photo-preview').innerHTML = pendingPhotos.map(src => `<img src="${src}" alt="Report photo preview">`).join('');
        } catch (error) {
            pendingPhotos = [];
            $('photo-preview').innerHTML = '';
            showToast(t('Could not prepare one of the photos.'), true);
        }
    });

    function validateReportPayload(payload) {
        const d = payload.details || {};
        const missing = [];
        if (!d.title) missing.push('report title');
        if (!d.observedAt) missing.push('observation date/time');
        if (!d.notes) missing.push('field description');
        if (!d.aspect) missing.push('aspect');
        if (!Number.isFinite(d.elevation)) missing.push('elevation');
        if (!Number.isFinite(d.slope)) missing.push('slope angle');
        if (['avalanche','accident'].includes(payload.type)) {
            if (!d.avalancheSize) missing.push('avalanche size');
            if (!d.avalancheCharacter) missing.push('avalanche character');
            if (!d.trigger) missing.push('trigger');
        }
        if (missing.length) return `Please complete the essential fields: ${missing.join(', ')}.`;
        return '';
    }

    function snowProfileHtml(layers) {
        if (!Array.isArray(layers) || !layers.length) return '';
        const total = layers.reduce((sum, layer) => sum + (Number(layer.thicknessCm) || 0), 0) || layers.length;
        const blocks = layers.map((layer, index) => {
            const h = Math.max(7, ((Number(layer.thicknessCm) || total / layers.length) / total) * 100);
            return `<div class="snow-profile-layer ${layer.weak ? 'is-weak' : ''}" style="height:${h}%" title="${escapeHtml(layer.grain || 'Unknown')} · ${escapeHtml(layer.hardness || 'Unknown')}">${escapeHtml(layer.grain || `Layer ${index + 1}`)}</div>`;
        }).join('');
        const legend = layers.map((layer,index) => `<div><strong>${index+1}.</strong> ${escapeHtml(layer.thicknessCm ?? '—')} cm · ${escapeHtml(layer.grain || 'Unknown')} · ${escapeHtml(layer.hardness || 'Unknown')}${layer.weak ? ' · <strong>suspected unstable layer</strong>' : ''}</div>`).join('');
        return `<div class="report-section"><h4>Snow profile</h4><div class="snow-profile"><div class="snow-profile-column">${blocks}</div><div class="snow-profile-legend">${legend}</div></div></div>`;
    }

    function fullReportHtml(feature) {
        const p = feature.properties || {}, d = p.details || {}, people = d.people || {}, snow = d.snowpack || {}, test = d.snowpackTest || {};
        const photos = Array.isArray(d.photos) ? d.photos : [];
        const photosHtml = photos.length ? `<div class="report-section"><h4>Photos</h4><div class="report-photo-grid">${photos.map(src => `<a href="${src}" download="field-report-photo.jpg" target="_blank" rel="noopener"><img src="${src}" alt="Field report photo"></a>`).join('')}</div><p class="muted">Open an image to view or save the full resized copy.</p></div>` : '';
        const avalancheGeometryHtml = d.avalancheGeometry ? `<div class="report-section"><h4>Avalanche mapping</h4><p>${d.avalancheGeometry.crown ? 'A crown / release line was mapped.' : 'No crown line was mapped.'} ${d.avalancheGeometry.path ? 'An approximate avalanche path / affected extent was mapped.' : 'No path polygon was mapped.'} The geometry is displayed with the report on the main avalanche map.</p></div>` : '';
        return `<div class="report-detail-header"><span class="eyebrow">FIELD OBSERVATION</span><h2>${escapeHtml(d.title || 'Field report')}</h2><div class="report-detail-meta"><span class="pill">${escapeHtml(markerLabel(reportMarkerKind(feature)))}</span><span class="pill">${escapeHtml(d.observedAt ? translatedDateTime(d.observedAt) : (p.created_at ? translatedDateTime(p.created_at) : '—'))}</span></div></div>
        <div class="report-summary-table">
          <div class="k">Observed</div><div class="v">${escapeHtml(d.observedAt ? translatedDateTime(d.observedAt) : '—')}</div>
          <div class="k">Location</div><div class="v">${feature.geometry.coordinates[1].toFixed(5)}, ${feature.geometry.coordinates[0].toFixed(5)} · ${escapeHtml(d.locationConfidence || '—')}</div>
          <div class="k">Observation source</div><div class="v">${escapeHtml(d.observationSource || '—')}</div>
          <div class="k">Terrain</div><div class="v">${escapeHtml(d.aspect || '—')} · ${escapeHtml(d.elevation ?? '—')} m · ${escapeHtml(d.slope ?? '—')}°</div>
          <div class="k">Avalanche</div><div class="v">Size ${escapeHtml(d.avalancheSize || '—')} · ${escapeHtml(d.avalancheCharacter || '—')} · ${escapeHtml(d.trigger || '—')}</div>
          <div class="k">Crown dimensions</div><div class="v">Depth ${escapeHtml(d.slabThickness ?? '—')} cm · width ${escapeHtml(d.slabWidth ?? '—')} m · run ${escapeHtml(d.runLength ?? '—')} m</div>
          <div class="k">People</div><div class="v">Group ${escapeHtml(people.groupSize ?? 0)} · fully buried ${escapeHtml(people.fullyBuried ?? 0)} · partly buried ${escapeHtml(people.partlyBuried ?? 0)} · injured ${escapeHtml(people.injured ?? 0)} · fatalities ${escapeHtml(people.fatalities ?? 0)}</div>
          <div class="k">Snowpack</div><div class="v">Depth ${escapeHtml(snow.depth ?? '—')} cm · weak layer depth ${escapeHtml(snow.weakLayerDepth ?? '—')} cm · whumpf ${escapeHtml(snow.whumpfing || '—')} · cracking ${escapeHtml(snow.cracking || '—')}</div>
          <div class="k">Stability test</div><div class="v">${escapeHtml(test.type || '—')} · ${escapeHtml(test.result || '—')} · ${escapeHtml(test.fracture || '—')} · failure ${escapeHtml(test.failureDepth ?? '—')} cm · ${escapeHtml(test.crystal || '—')}</div>
        </div>
        <div class="report-section"><h4>Field description</h4><p>${escapeHtml(d.notes || '—').replaceAll('\n','<br>')}</p></div>
        ${avalancheGeometryHtml}${snowProfileHtml(d.snowLayers)}${photosHtml}`;
    }

    function openFullReport(id) {
        const feature = observationFeatureById.get(String(id));
        if (!feature) return;
        $('report-detail-content').innerHTML = fullReportHtml(feature);
        $('report-detail-modal').classList.remove('hidden');
    }
    $('close-report-detail')?.addEventListener('click', () => $('report-detail-modal').classList.add('hidden'));
    $('report-detail-modal')?.addEventListener('click', event => { if (event.target === $('report-detail-modal')) $('report-detail-modal').classList.add('hidden'); });
    $('map-avalanche').addEventListener('click', event => {
        const viewButton = event.target.closest('.view-report-btn');
        if (viewButton) openFullReport(viewButton.dataset.reportId);
    });

    // replace minimal HTML required-validation with avalanche-aware validation.
    const reportForm = $('observation-form');
    reportForm?.addEventListener('submit', event => {
        const payload = buildReportPayload();
        const validationMessage = validateReportPayload(payload);
        if (!validationMessage) return;
        event.preventDefault(); event.stopImmediatePropagation();
        $('submit-error').textContent = validationMessage;
        $('submit-error').classList.remove('hidden');
    }, true);

    loadObservations();
    updateStorageStatus();
    prepareStaticTranslations();
    loadBulletinProviders();
    loadForecastRegions();
    window.setInterval(loadForecastRegions, 15 * 60 * 1000);

    // TERRAIN BETA ----------------------------------------------------------
    mapBeta = L.map('map-terrain-beta').setView(pyreneesCoords, 9);
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: '&copy; OpenTopoMap contributors'
    }).addTo(mapBeta);
    terrainBetaGridLayer = L.layerGroup().addTo(mapBeta);
    const betaIcgcHistoryLayer = L.tileLayer.wms(icgcWmsUrl, {
        layers: 'zonesallaus,enquestes,observacions',
        format: 'image/png', transparent: true, version: '1.1.1', opacity: .58,
        attribution: 'ICGC avalanche inventory / mapped zones'
    });
    $('toggle-beta-icgc-history')?.addEventListener('change', event => {
        if (event.target.checked) betaIcgcHistoryLayer.addTo(mapBeta); else mapBeta.removeLayer(betaIcgcHistoryLayer);
    });
    // Load licence-compatible local historical imports for France, Andorra and the Spanish Pyrenees.
    loadHistoricalDatasets();

    function terrainAdvisoryColor(score) {
        const value = Number(score) || 0;
        if (value < .25) return '#5aa85f';
        if (value < .45) return '#d9c73d';
        if (value < .65) return '#e98a2f';
        if (value < .82) return '#cf4238';
        return '#721b27';
    }

    function compassAspect(deg) {
        if (!Number.isFinite(Number(deg))) return 'flat / undefined';
        const labels = ['N','NE','E','SE','S','SW','W','NW'];
        return labels[Math.round(Number(deg) / 45) % 8];
    }

    function renderTerrainBetaStatus(data) {
        const b = data.bulletin || {};
        const w = data.weather || {};
        const danger = b.dangerLevel ? `EAWS ${escapeHtml(b.dangerLevel)} / 5` : 'No current machine-readable rating';
        $('terrain-beta-status').innerHTML = `
            <div class="terrain-status-grid">
                <div><span>Official region</span><strong>${escapeHtml(b.regionName || 'Unknown')}</strong></div>
                <div><span>Official danger</span><strong>${escapeHtml(danger)}</strong></div>
                <div><span>Snow · 72 h</span><strong>${escapeHtml(w.snow72Cm ?? '—')} cm</strong></div>
                <div><span>Rain · 24 h</span><strong>${escapeHtml(w.rain24Mm ?? '—')} mm</strong></div>
                <div><span>Max wind · 24 h</span><strong>${escapeHtml(w.maxWind24Kmh ?? '—')} km/h</strong></div>
                <div><span>Dominant wind</span><strong>${escapeHtml(w.dominantWindDirectionDeg ?? '—')}°</strong></div>
                <div><span>Terrain source</span><strong>${escapeHtml(data.dem?.sourceLabel || data.dem?.source || '—')}</strong></div>
                <div><span>Terrain sample</span><strong>${escapeHtml(data.dem?.effectiveSampleSpacingM ?? data.dem?.nominalResolutionM ?? '—')} m</strong></div>
            </div>
            <p class="terrain-model-note">Generated: ${escapeHtml(data.generatedAt || 'Unknown')} · Bulletin date: ${escapeHtml(b.dangerDate || 'Unknown')}</p>
            ${data.dem?.warning ? `<p class="terrain-critical-warning">${escapeHtml(data.dem.warning)}</p>` : ''}
            <p class="terrain-model-note">${escapeHtml(data.dem?.note || '')}</p>
            <p class="terrain-model-note"><strong>How to read this:</strong> purple shows the experimental local terrain/weather signal. Official danger is separate above. This is a hand-built heuristic, not a trained model, probability or safe-route assessment. Historical overlays are contextual and are not yet model inputs.</p>`;
    }

    function renderTerrainCells(data) {
        terrainBetaGridLayer.clearLayers();
        if (terrainBetaSurfaceLayer) { mapBeta.removeLayer(terrainBetaSurfaceLayer); terrainBetaSurfaceLayer = null; }
        const cells = data.cells || [];
        const n = Number(data.gridSize) || Math.round(Math.sqrt(cells.length));
        if (!cells.length || !n) return;

        // Paint a continuous-looking surface from the regular analysis grid.
        // The underlying values remain cell-based; bilinear interpolation is visual only.
        const canvas = document.createElement('canvas');
        const size = 640; canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const image = ctx.createImageData(size, size);
        const rgb = hex => { const h=hex.replace('#',''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; };
        const colorStops = [[0,[241,238,246]],[.25,[215,181,216]],[.45,[189,128,189]],[.65,[153,73,163]],[.82,[118,36,137]],[1,[73,0,106]]];
        const scoreAt = (r,c) => Number(cells[Math.max(0,Math.min(n-1,r))*n + Math.max(0,Math.min(n-1,c))]?.localTerrainScore)||0;
        const colorAt = v => {
            for (let i=1;i<colorStops.length;i++) {
                if (v<=colorStops[i][0]) { const [a,ca]=colorStops[i-1], [b,cb]=colorStops[i]; const t=(v-a)/Math.max(.0001,b-a); return ca.map((x,j)=>Math.round(x+(cb[j]-x)*t)); }
            } return colorStops.at(-1)[1];
        };
        for (let y=0;y<size;y++) {
            const gy=(1-y/(size-1))*(n-1), r0=Math.floor(gy), r1=Math.min(n-1,r0+1), ty=gy-r0;
            for (let x=0;x<size;x++) {
                const gx=x/(size-1)*(n-1), c0=Math.floor(gx), c1=Math.min(n-1,c0+1), tx=gx-c0;
                const a=scoreAt(r0,c0)*(1-tx)+scoreAt(r0,c1)*tx;
                const b=scoreAt(r1,c0)*(1-tx)+scoreAt(r1,c1)*tx;
                const [rr,gg,bb]=colorAt(a*(1-ty)+b*ty); const i=(y*size+x)*4;
                image.data[i]=rr; image.data[i+1]=gg; image.data[i+2]=bb; image.data[i+3]=168;
            }
        }
        ctx.putImageData(image,0,0);
        const halfLat=Math.abs(Number(data.cellStep?.lat)||0)/2, halfLng=Math.abs(Number(data.cellStep?.lng)||0)/2;
        const lats=cells.map(c=>c.lat), lngs=cells.map(c=>c.lng);
        const bounds=[[Math.min(...lats)-halfLat,Math.min(...lngs)-halfLng],[Math.max(...lats)+halfLat,Math.max(...lngs)+halfLng]];
        terrainBetaSurfaceLayer=L.imageOverlay(canvas.toDataURL('image/png'), bounds, {opacity:.82, interactive:false, className:'terrain-smooth-surface'}).addTo(mapBeta);
    }

    async function analyzeTerrainAt(lat, lng) {
        const radiusKm = Number($('terrain-radius')?.value) || 10;
        const serial = ++terrainBetaRequestSerial;
        if (terrainBetaSurfaceLayer) { mapBeta.removeLayer(terrainBetaSurfaceLayer); terrainBetaSurfaceLayer = null; }
        terrainBetaGridLayer.clearLayers();
        if (terrainBetaRequestController) terrainBetaRequestController.abort();
        terrainBetaRequestController = new AbortController();
        $('terrain-beta-status').innerHTML = '<p><strong>Updating terrain layer…</strong><br><span class="muted">Loading route-scale topography first; weather and bulletin context are added to the same surface.</span></p>';
        if (terrainBetaMarker) mapBeta.removeLayer(terrainBetaMarker);
        terrainBetaMarker = L.circleMarker([lat, lng], { radius: 6, color: '#17384a', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(mapBeta);
        try {
            const response = await fetch(`/api/terrain/analyze?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&radiusKm=${radiusKm}&grid=41`, {signal:terrainBetaRequestController.signal});
            const data = await response.json().catch(()=>({}));
            if (!response.ok) throw new Error(data.details || data.error || `HTTP ${response.status}`);
            if (serial !== terrainBetaRequestSerial) return;
            renderTerrainCells(data); renderTerrainBetaStatus(data);
            const cellLat=Math.abs(Number(data.cellStep?.lat)||0), cellLng=Math.abs(Number(data.cellStep?.lng)||0);
            const lats=data.cells.map(c=>c.lat), lngs=data.cells.map(c=>c.lng);
            if (lats.length) mapBeta.fitBounds([[Math.min(...lats)-cellLat,Math.min(...lngs)-cellLng],[Math.max(...lats)+cellLat,Math.max(...lngs)+cellLng]], {padding:[20,20]});
        } catch (error) {
            if (error.name === 'AbortError') return;
            if (serial !== terrainBetaRequestSerial) return;
            $('terrain-beta-status').innerHTML = `<div class="terrain-critical-warning"><strong>Could not build the terrain layer.</strong><br>${escapeHtml(error.message)}</div>`;
        }
    }

    mapBeta.on('click', event => analyzeTerrainAt(event.latlng.lat, event.latlng.lng));
    $('analyze-terrain-centre')?.addEventListener('click', () => {
        const centre = mapBeta.getCenter();
        analyzeTerrainAt(centre.lat, centre.lng);
    });

    // PAGE 2 ---------------------------------------------------------------
    const map2 = L.map('map-weather').setView(pyreneesCoords, 8);
    map2.createPane('radarPane');
    map2.getPane('radarPane').style.zIndex = 450;
    map2.getPane('radarPane').style.pointerEvents = 'none';

    const weatherBaseLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        opacity: 0.80,
        attribution: '&copy; OpenTopoMap contributors'
    }).addTo(map2);

    function updateBaseMapContrast() {
        const radarOn = $('toggle-radar').checked && radarLayer && map2.hasLayer(radarLayer);
        weatherBaseLayer.setOpacity(radarOn ? 0.28 : 0.82);
    }

    async function loadRadar() {
        try {
            const manifest = await fetchJson('https://api.rainviewer.com/public/weather-maps.json');
            const frames = manifest.radar?.past || [];
            const latest = frames.at(-1);
            if (!latest) throw new Error(t('No radar frame is available.'));
            if (radarLayer) map2.removeLayer(radarLayer);
            radarLayer = L.tileLayer(`${manifest.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`, {
                tileSize: 256,
                opacity: 0.90,
                maxNativeZoom: 7,
                maxZoom: 17,
                attribution: 'Weather radar: RainViewer',
                pane: 'radarPane'
            });
            if ($('toggle-radar').checked) radarLayer.addTo(map2);
            lastRadarTime = latest.time * 1000;
            $('radar-status').textContent = t('Radar frame: {time}', { time: translatedDateTime(lastRadarTime) });
            updateBaseMapContrast();
        } catch (error) {
            $('radar-status').textContent = t('Radar unavailable: {error}', { error: error.message });
        }
    }

    $('toggle-radar').addEventListener('change', event => {
        if (radarLayer) {
            if (event.target.checked) radarLayer.addTo(map2); else map2.removeLayer(radarLayer);
        }
        updateBaseMapContrast();
    });
    // Live model surfaces are intentionally disabled in v4.2; radar remains the only map overlay.
    loadRadar();
    localizationRuntimeReady = true;

    function destroyChart(name) {
        if (charts[name]) { charts[name].destroy(); charts[name] = null; }
    }

    function makeChart(name, canvasId, config) {
        destroyChart(name);
        charts[name] = new Chart($(canvasId).getContext('2d'), config);
    }

    function baseChartOptions(yTitle) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            elements: { point: { radius: 0, hoverRadius: 3 }, line: { borderWidth: 2, tension: 0.18 } },
            plugins: { legend: { labels: { color: '#dbe7f3' } } },
            scales: {
                x: { ticks: { color: '#93a7ba', maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,.05)' } },
                y: { ticks: { color: '#93a7ba' }, grid: { color: 'rgba(255,255,255,.08)' }, title: { display: true, text: yTitle, color: '#93a7ba' } }
            }
        };
    }

    function renderWeatherCharts(data) {
        const d = data.daily;
        const labels = d.time.map(date => date.slice(5));
        const sunshineH = (d.sunshine_duration || []).map(v => v == null ? null : v / 3600);
        const daylightH = (d.daylight_duration || []).map(v => v == null ? null : v / 3600);
        const nonSunshineDaylight = daylightH.map((v, i) => v == null || sunshineH[i] == null ? null : Math.max(0, v - sunshineH[i]));

        makeChart('precip', 'precipChart', {
            type: 'line', data: { labels, datasets: [
                { label: t('Snowfall (cm)'), data: d.snowfall_sum, borderColor: '#9bdcff', backgroundColor: 'transparent', spanGaps: true },
                { label: t('Rain (mm)'), data: d.rain_sum, borderColor: '#4389ff', backgroundColor: 'transparent', spanGaps: true }
            ] }, options: baseChartOptions('cm / mm')
        });
        makeChart('temp', 'tempChart', {
            type: 'line', data: { labels, datasets: [
                { label: t('Max °C'), data: d.temperature_2m_max, borderColor: '#ff756d', backgroundColor: 'transparent', spanGaps: true },
                { label: t('Min °C'), data: d.temperature_2m_min, borderColor: '#70b7ff', backgroundColor: 'transparent', spanGaps: true }
            ] }, options: baseChartOptions('°C')
        });
        makeChart('wind', 'windChart', {
            type: 'line', data: { labels, datasets: [
                { label: t('Max wind (km/h)'), data: d.wind_speed_10m_max, borderColor: '#7ee787', backgroundColor: 'transparent', spanGaps: true },
                { label: t('Max gust (km/h)'), data: d.wind_gusts_10m_max, borderColor: '#ffb35c', backgroundColor: 'transparent', spanGaps: true }
            ] }, options: baseChartOptions('km/h')
        });
        makeChart('sun', 'sunChart', {
            type: 'line', data: { labels, datasets: [
                { label: t('Sunshine (h)'), data: sunshineH, borderColor: '#ffd866', backgroundColor: 'transparent', spanGaps: true },
                { label: t('Non-sunshine daylight (h, cloud proxy)'), data: nonSunshineDaylight, borderColor: '#9aa8b8', backgroundColor: 'transparent', spanGaps: true },
                { label: t('Mean cloud cover (%)'), data: d.cloud_cover_mean, borderColor: '#ad84ff', backgroundColor: 'transparent', yAxisID: 'y1', spanGaps: true }
            ] }, options: {
                ...baseChartOptions(t('hours')),
                scales: {
                    ...baseChartOptions(t('hours')).scales,
                    y1: { position: 'right', min: 0, max: 100, ticks: { color: '#93a7ba' }, grid: { drawOnChartArea: false }, title: { display: true, text: t('% cloud'), color: '#93a7ba' } }
                }
            }
        });
        makeChart('freezing', 'freezingChart', {
            type: 'line', data: { labels, datasets: [
                { label: t('Mean 0°C isotherm (m a.s.l.)'), data: d.freezing_level_height_mean, borderColor: '#67e0e5', backgroundColor: 'transparent', spanGaps: true }
            ] }, options: baseChartOptions(t('metres a.s.l.'))
        });
    }

    function renderWeatherDetails(weather, place) {
        if (!weather || !selectedWeatherPoint) return;
        const { lat, lng } = selectedWeatherPoint;
        const d = weather.daily;
        const snow = (d.snowfall_sum || []).reduce((sum, v) => sum + (Number(v) || 0), 0);
        const rain = (d.rain_sum || []).reduce((sum, v) => sum + (Number(v) || 0), 0);
        $('weather-details').innerHTML = `
            <strong>${escapeHtml(place?.town || t('Nearest town unavailable'))}</strong><br>
            <span>${lat.toFixed(5)}, ${lng.toFixed(5)}</span><br>
            <small>${escapeHtml(weather.meta.start)} → ${escapeHtml(weather.meta.end)}</small><br>
            <small>${escapeHtml(t(weather.meta.startReason || ''))}</small><br>
            <strong>${escapeHtml(t('Snow:'))}</strong> ${snow.toFixed(1)} cm · <strong>${escapeHtml(t('Rain:'))}</strong> ${rain.toFixed(1)} mm`;
    }

    async function loadWeatherForSelectedPoint() {
        if (!selectedWeatherPoint) return;
        const { lat, lng } = selectedWeatherPoint;
        const range = document.querySelector('input[name="weather-range"]:checked').value;
        $('weather-details').innerHTML = `<p><em>${escapeHtml(t('Loading weather history…'))}</em></p>`;
        try {
            const [weather, place] = await Promise.all([
                fetchJson(`/api/weather/history?lat=${lat}&lng=${lng}&range=${range}`),
                fetchJson(`/api/weather/reverse?lat=${lat}&lng=${lng}`).catch(() => ({ town: t('Nearest town unavailable') }))
            ]);
            currentWeatherHistory = weather;
            lastWeatherPlace = place;
            renderWeatherDetails(weather, place);
            renderWeatherCharts(weather);
        } catch (error) {
            currentWeatherHistory = null;
            lastWeatherPlace = null;
            $('weather-details').innerHTML = `<p class="form-error">${escapeHtml(t('Could not load weather: {error}', { error: error.message }))}</p>`;
        }
    }

    map2.on('click', event => {
        selectedWeatherPoint = { lat: Number(event.latlng.lat.toFixed(5)), lng: Number(event.latlng.lng.toFixed(5)) };
        if (weatherMarker) map2.removeLayer(weatherMarker);
        weatherMarker = L.marker(event.latlng).addTo(map2);
        loadWeatherForSelectedPoint();
    });

    document.querySelectorAll('input[name="weather-range"]').forEach(input => {
        input.addEventListener('change', loadWeatherForSelectedPoint);
    });


    document.querySelectorAll('.hub-menu-btn').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.hub-menu-btn').forEach(item => item.classList.remove('active'));
            document.querySelectorAll('.hub-panel').forEach(panel => panel.classList.remove('active'));
            button.classList.add('active');
            const panel = $(button.dataset.hubTarget);
            if (panel) panel.classList.add('active');
        });
    });
});
