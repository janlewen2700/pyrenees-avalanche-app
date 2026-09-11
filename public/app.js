document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const pyreneesCoords = [42.55, 1.25];
    const europeBounds = L.latLngBounds([[35, -12], [70, 32]]);
    const charts = {};
    const weatherLayers = {};
    let currentWeatherGrid = null;
    let weatherValueLabels = null;
    let pendingReport = null;
    let selectedWeatherPoint = null;
    let weatherMarker = null;
    let radarLayer = null;
    let bulletinProviders = [];
    let currentWeatherHistory = null;
    let lastWeatherPlace = null;
    let lastForecastStatus = null;
    let lastWeatherGridStatus = null;
    let lastRadarTime = null;
    let localizationRuntimeReady = false;

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
    const LANGUAGE_META = { en:['🇬🇧','English'], ca:['🟨🟥','Català'], es:['🇪🇸','Español'], fr:['🇫🇷','Français'], de:['🇩🇪','Deutsch'], it:['🇮🇹','Italiano'] };


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
    let currentLanguage = localStorage.getItem('pan-language') || 'en';
    if (!I18N[currentLanguage]) currentLanguage = 'en';
    const LANGUAGE_LOCALES = { en:'en-GB', ca:'ca-ES', es:'es-ES', fr:'fr-FR', de:'de-DE', it:'it-IT' };
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
        if (current) current.textContent = `${active[0]} ${active[1]}`;
        localStorage.setItem('pan-language', lang);
        if (localizationRuntimeReady) {
            if (currentWeatherHistory) renderWeatherCharts(currentWeatherHistory);
            if (lastWeatherPlace && selectedWeatherPoint && currentWeatherHistory) renderWeatherDetails(currentWeatherHistory, lastWeatherPlace);
            if (pendingReport && !$('preview-step').classList.contains('hidden')) $('report-preview').innerHTML = previewHtml(pendingReport);
            if (lastForecastStatus) renderForecastStatus(lastForecastStatus);
            if (lastWeatherGridStatus) renderWeatherGridStatus(lastWeatherGridStatus);
            if (lastRadarTime) $('radar-status').textContent = t('Radar frame: {time}', { time: translatedDateTime(lastRadarTime) });
            applyWeatherOverlay();
            loadObservations();
        }
    }
    function prepareStaticTranslations() {
        const dictKeys = new Set(Object.keys(I18N.en));
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node => {
            const parent = node.parentElement;
            if (!parent || parent.closest('#page3')) return;
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
            if (el.closest('#page3')) return;
            if (dictKeys.has(el.placeholder)) el.dataset.i18nPlaceholderSource = el.placeholder;
        });
        document.querySelectorAll('[aria-label]').forEach(el => {
            if (el.closest('#page3')) return;
            const source = el.getAttribute('aria-label');
            if (dictKeys.has(source)) el.dataset.i18nAriaSource = source;
        });
        document.querySelectorAll('[title]').forEach(el => {
            if (el.closest('#page3')) return;
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
                if (!selectedWeatherPoint) map2.fitBounds(europeBounds, { padding: [8, 8] });
            }, 0);
        });
    });

    $('accept-disclaimer-btn').addEventListener('click', () => $('disclaimer-modal').classList.add('hidden'));
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
            fillOpacity: hasCurrentDanger ? 0.62 : 0.48
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
                openMobileDrawer('page1');
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

    const observationGroups = {
        avalanche: L.layerGroup().addTo(map1),
        accident: L.layerGroup().addTo(map1),
        reports: L.layerGroup().addTo(map1)
    };

    const markerPriority = { avalanche: 5, accident: 4, test: 3, snowpack: 2, trip_report: 1 };
    const markerSymbols = { avalanche: '▲', accident: '!', test: 'T', snowpack: '❄', trip_report: '●' };
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
        const test = d.snowpackTest || {};
        const kind = reportMarkerKind(feature);
        const severity = reportSeverity(feature);
        const buried = Number(people.fullyBuried || 0) + Number(people.partlyBuried || 0);
        return `
            <div class="popup-report-entry">
                <div><strong>${escapeHtml(d.title || markerLabel(kind) || p.type || t('Field report'))}</strong></div>
                <span class="pill">${escapeHtml(markerLabel(kind) || p.type || '')}</span>
                <span class="pill severity-pill severity-${escapeHtml(severity)}">${escapeHtml(severity === 'mortality' ? t('Fatality') : severity === 'incident' ? t('Incident') : t('Information'))}</span>
                <p>${escapeHtml(d.notes || '')}</p>
                <small>${escapeHtml(t('Aspect'))} ${escapeHtml(d.aspect || '—')} · ${escapeHtml(t('Elev.'))} ${escapeHtml(d.elevation ?? '—')} m · ${escapeHtml(t('Slope'))} ${escapeHtml(d.slope ?? '—')}°</small><br>
                ${d.avalancheSize ? `<small>${escapeHtml(t('Avalanche size'))} ${escapeHtml(d.avalancheSize)} · ${escapeHtml(t(d.avalancheCharacter || ''))} · ${escapeHtml(t(d.trigger || ''))}</small><br>` : ''}
                ${(buried || Number(people.injured || 0) || Number(people.fatalities || 0)) ? `<small><strong>${escapeHtml(t('People:'))}</strong> ${escapeHtml(t('buried'))} ${buried}, ${escapeHtml(t('injured'))} ${escapeHtml(people.injured || 0)}, ${escapeHtml(t('fatalities'))} ${escapeHtml(people.fatalities || 0)}</small><br>` : ''}
                ${test.type ? `<small><strong>${escapeHtml(t('Snow test:'))}</strong> ${escapeHtml(t(test.type))} · ${escapeHtml(t(test.result || 'result n/a'))} · ${escapeHtml(t(test.fracture || 'fracture n/a'))} · ${escapeHtml(t('down'))} ${escapeHtml(test.failureDepth ?? '—')} cm</small>` : ''}
                ${p.can_delete ? `<div><button class="delete-observation popup-delete-btn" data-id="${escapeHtml(p.id)}" type="button">${escapeHtml(t('Delete my report'))}</button></div>` : ''}
            </div>`;
    }

    function groupedPopupHtml(features) {
        const heading = features.length > 1 ? `<strong>${features.length} ${escapeHtml(t('reports at this point'))}</strong>` : '';
        return `<div class="popup-report-list">${heading}${features.map(reportEntryHtml).join('<hr>')}</div>`;
    }

    async function loadObservations() {
        Object.values(observationGroups).forEach(group => group.clearLayers());
        try {
            const data = await fetchJson('/api/observations', { headers: { 'X-Observer-Token': observerToken } });
            const grouped = new Map();
            (data.features || []).forEach(feature => {
                const [lng, lat] = feature.geometry.coordinates;
                const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(feature);
            });

            grouped.forEach(features => {
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

    function openReportModal(lat, lng) {
        $('form-lat').value = lat;
        $('form-lng').value = lng;
        $('log-modal').classList.remove('hidden');
        $('form-step').classList.remove('hidden');
        $('preview-step').classList.add('hidden');
    }

    map1.on('click', async event => {
        const { lat, lng } = event.latlng;
        openMobileDrawer('page1');
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

    function currentSeasonYear() {
        const now = new Date();
        return now.getMonth() >= 10 ? now.getFullYear() + 1 : now.getFullYear();
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
            notes: value('form-notes').trim()
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
            season_year: currentSeasonYear(),
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
                <dt>${escapeHtml(t('Location'))}</dt><dd>${payload.lat.toFixed(5)}, ${payload.lng.toFixed(5)}</dd>
                <dt>${escapeHtml(t('Terrain'))}</dt><dd>${escapeHtml(d.aspect)} · ${escapeHtml(d.elevation ?? '—')} m · ${escapeHtml(d.slope ?? '—')}°</dd>
                <dt>${escapeHtml(t('Avalanche'))}</dt><dd>${escapeHtml(t('Size'))} ${escapeHtml(d.avalancheSize || '—')} · ${escapeHtml(t(d.avalancheCharacter || '—'))} · ${escapeHtml(t(d.trigger || '—'))}</dd>
                <dt>${escapeHtml(t('Dimensions'))}</dt><dd>${escapeHtml(d.slabThickness ?? '—')} cm · ${escapeHtml(d.slabWidth ?? '—')} m · ${escapeHtml(d.runLength ?? '—')} m</dd>
                <dt>${escapeHtml(t('People'))}</dt><dd>${escapeHtml(t('Group'))} ${people.groupSize}; ${escapeHtml(t('fully buried'))} ${people.fullyBuried}; ${escapeHtml(t('partly buried'))} ${people.partlyBuried}; ${escapeHtml(t('caught'))} ${people.caughtNotBuried}; ${escapeHtml(t('injured'))} ${people.injured}; ${escapeHtml(t('fatalities'))} ${people.fatalities}</dd>
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
            $('slow-fields').classList.add('hidden-fieldset');
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

    loadObservations();
    updateStorageStatus();
    prepareStaticTranslations();
    loadBulletinProviders();
    loadForecastRegions();
    window.setInterval(loadForecastRegions, 15 * 60 * 1000);

    // PAGE 2 ---------------------------------------------------------------
    const map2 = L.map('map-weather').setView([50, 10], 4);
    map2.createPane('weatherSurfacePane');
    map2.getPane('weatherSurfacePane').style.zIndex = 410;
    map2.getPane('weatherSurfacePane').style.pointerEvents = 'none';
    map2.createPane('weatherLabelPane');
    map2.getPane('weatherLabelPane').style.zIndex = 470;
    map2.getPane('weatherLabelPane').style.pointerEvents = 'none';
    map2.createPane('radarPane');
    map2.getPane('radarPane').style.zIndex = 450;
    map2.getPane('radarPane').style.pointerEvents = 'none';

    const weatherBaseLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        opacity: 0.80,
        attribution: '&copy; OpenTopoMap contributors'
    }).addTo(map2);
    weatherValueLabels = L.layerGroup().addTo(map2);

    function updateBaseMapContrast() {
        const overlay = document.querySelector('input[name="weather-overlay"]:checked')?.value || 'none';
        const radarOn = $('toggle-radar').checked && radarLayer && map2.hasLayer(radarLayer);
        weatherBaseLayer.setOpacity(overlay === 'none' && !radarOn ? 0.82 : 0.20);
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

    const WEATHER_SCALES = {
        temperature: {
            key: 'temperature', unit: '°C', decimals: 0,
            stops: [[-25, '#2b2c7c'], [-12, '#315bff'], [0, '#42c8ff'], [10, '#f3ef9b'], [20, '#ffb14e'], [30, '#ef5b35'], [40, '#a71928']],
            alpha: 0.78
        },
        gust: {
            key: 'windGust', unit: 'km/h', decimals: 0,
            stops: [[0, '#eef7ff'], [20, '#8adcf8'], [40, '#42a5d8'], [60, '#f1d55b'], [90, '#f0833a'], [120, '#c83737'], [160, '#6e1f5f']],
            alpha: 0.78
        },
        precipitation: {
            key: 'precipitation', unit: 'mm', decimals: 1,
            stops: [[0, '#dff7ff'], [0.2, '#9fe3ff'], [0.5, '#58b8ff'], [1, '#397ee8'], [3, '#5551c8'], [6, '#8e3bb4'], [10, '#d12d88']],
            alpha: 0.84
        }
    };

    function hexToRgb(hex) {
        const value = String(hex).replace('#', '');
        const full = value.length === 3 ? value.split('').map(char => char + char).join('') : value;
        return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
    }

    function colorForWeatherValue(type, value) {
        const scale = WEATHER_SCALES[type];
        if (!scale || !Number.isFinite(value)) return 'rgba(0,0,0,0)';
        if (type === 'precipitation' && value <= 0.02) return 'rgba(0,0,0,0)';
        const stops = scale.stops;
        let lower = stops[0], upper = stops.at(-1);
        for (let i = 0; i < stops.length - 1; i += 1) {
            if (value >= stops[i][0] && value <= stops[i + 1][0]) { lower = stops[i]; upper = stops[i + 1]; break; }
        }
        if (value <= stops[0][0]) lower = upper = stops[0];
        if (value >= stops.at(-1)[0]) lower = upper = stops.at(-1);
        const ratio = upper[0] === lower[0] ? 0 : (value - lower[0]) / (upper[0] - lower[0]);
        const a = hexToRgb(lower[1]), b = hexToRgb(upper[1]);
        const rgb = a.map((channel, index) => Math.round(channel + (b[index] - channel) * ratio));
        let alpha = scale.alpha;
        if (type === 'gust' && value < 15) alpha = 0.52;
        if (type === 'precipitation' && value < 0.2) alpha = 0.52;
        return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
    }

    function prepareWeatherGrid(data, type) {
        const scale = WEATHER_SCALES[type];
        const points = (data.points || []).filter(point => Number.isFinite(point[scale.key]));
        const lats = [...new Set(points.map(point => Number(point.lat)))].sort((a, b) => a - b);
        const lngs = [...new Set(points.map(point => Number(point.lng)))].sort((a, b) => a - b);
        const lookup = new Map(points.map(point => [`${Number(point.lat).toFixed(4)},${Number(point.lng).toFixed(4)}`, Number(point[scale.key]) ]));
        return { type, points, lats, lngs, lookup, step: Number(data.resolutionDegrees) || 2 };
    }

    function interpolatedGridValue(grid, lat, lng) {
        if (!grid?.lats?.length || !grid?.lngs?.length) return null;
        const south = grid.lats[0], north = grid.lats.at(-1), west = grid.lngs[0], east = grid.lngs.at(-1);
        if (lat < south || lat > north || lng < west || lng > east) return null;
        const step = grid.step;
        const latPos = (lat - south) / step;
        const lngPos = (lng - west) / step;
        const i0 = Math.max(0, Math.min(grid.lats.length - 1, Math.floor(latPos)));
        const j0 = Math.max(0, Math.min(grid.lngs.length - 1, Math.floor(lngPos)));
        const i1 = Math.min(grid.lats.length - 1, i0 + 1);
        const j1 = Math.min(grid.lngs.length - 1, j0 + 1);
        const lat0 = grid.lats[i0], lat1 = grid.lats[i1], lng0 = grid.lngs[j0], lng1 = grid.lngs[j1];
        const key = (a, b) => `${Number(a).toFixed(4)},${Number(b).toFixed(4)}`;
        const q00 = grid.lookup.get(key(lat0, lng0));
        const q10 = grid.lookup.get(key(lat1, lng0));
        const q01 = grid.lookup.get(key(lat0, lng1));
        const q11 = grid.lookup.get(key(lat1, lng1));
        const available = [q00, q10, q01, q11].filter(Number.isFinite);
        if (!available.length) return null;
        if (![q00, q10, q01, q11].every(Number.isFinite) || lat1 === lat0 || lng1 === lng0) {
            return available.reduce((sum, value) => sum + value, 0) / available.length;
        }
        const ty = (lat - lat0) / (lat1 - lat0);
        const tx = (lng - lng0) / (lng1 - lng0);
        const westValue = q00 * (1 - ty) + q10 * ty;
        const eastValue = q01 * (1 - ty) + q11 * ty;
        return westValue * (1 - tx) + eastValue * tx;
    }

    function makeWeatherSurfaceLayer(data, type) {
        const grid = prepareWeatherGrid(data, type);
        const WeatherGridLayer = L.GridLayer.extend({
            createTile(coords) {
                const tile = L.DomUtil.create('canvas', 'leaflet-tile weather-surface-tile');
                const size = this.getTileSize();
                tile.width = size.x;
                tile.height = size.y;
                const ctx = tile.getContext('2d');
                const pixelBlock = 4;
                const origin = L.point(coords.x * size.x, coords.y * size.y);
                for (let y = 0; y < size.y; y += pixelBlock) {
                    for (let x = 0; x < size.x; x += pixelBlock) {
                        const latlng = this._map.unproject(origin.add([x + pixelBlock / 2, y + pixelBlock / 2]), coords.z);
                        const value = interpolatedGridValue(grid, latlng.lat, latlng.lng);
                        if (!Number.isFinite(value)) continue;
                        ctx.fillStyle = colorForWeatherValue(type, value);
                        ctx.fillRect(x, y, pixelBlock, pixelBlock);
                    }
                }
                return tile;
            }
        });
        const layer = new WeatherGridLayer({ pane: 'weatherSurfacePane', tileSize: 256, updateWhenZooming: false, keepBuffer: 2 });
        layer.weatherGrid = grid;
        return layer;
    }

    function formatWeatherLabel(type, value) {
        if (!Number.isFinite(value)) return '';
        if (type === 'temperature') return `${Math.round(value)}°`;
        if (type === 'gust') return `${Math.round(value)}<small> km/h</small>`;
        if (type === 'precipitation') return `${value < 1 ? value.toFixed(1) : value.toFixed(0)}<small> mm</small>`;
        return String(value);
    }

    function renderWeatherValueLabels() {
        if (!weatherValueLabels) return;
        weatherValueLabels.clearLayers();
        const type = document.querySelector('input[name="weather-overlay"]:checked')?.value || 'none';
        if (type === 'none' || !currentWeatherGrid) return;
        const scale = WEATHER_SCALES[type];
        const bounds = map2.getBounds().pad(0.08);
        const zoom = map2.getZoom();
        const stride = zoom <= 4 ? 2 : 1;
        (currentWeatherGrid.points || []).forEach((point, index) => {
            if (index % stride !== 0 || !bounds.contains([point.lat, point.lng])) return;
            const value = Number(point[scale.key]);
            if (!Number.isFinite(value)) return;
            if (type === 'precipitation' && value <= 0.02) return;
            const icon = L.divIcon({
                className: 'weather-value-icon',
                html: `<span>${formatWeatherLabel(type, value)}</span>`,
                iconSize: [58, 22],
                iconAnchor: [29, 11]
            });
            L.marker([point.lat, point.lng], { icon, interactive: false, pane: 'weatherLabelPane' }).addTo(weatherValueLabels);
        });
    }

    function weatherLegendHtml(type) {
        if (type === 'temperature') return '<div class="legend-gradient temp-gradient"></div><div class="legend-range"><span>−25°C</span><span>10°C</span><span>40°C+</span></div>';
        if (type === 'gust') return '<div class="legend-gradient gust-gradient"></div><div class="legend-range"><span>0</span><span>60</span><span>160+ km/h</span></div>';
        if (type === 'precipitation') return `<div class="legend-gradient precip-gradient"></div><div class="legend-range"><span>${escapeHtml(t('dry'))}</span><span>3</span><span>10+ mm</span></div>`;
        return `<span class="status-note">${escapeHtml(t('Model overlay off.'))}</span>`;
    }

    function applyWeatherOverlay() {
        Object.values(weatherLayers).forEach(layer => {
            if (layer && map2.hasLayer(layer)) map2.removeLayer(layer);
        });
        const type = document.querySelector('input[name="weather-overlay"]:checked')?.value || 'none';
        if (type !== 'none' && weatherLayers[type]) weatherLayers[type].addTo(map2);
        $('weather-overlay-legend').innerHTML = weatherLegendHtml(type);
        renderWeatherValueLabels();
        updateBaseMapContrast();
    }

    function renderWeatherGridStatus(status) {
        if (!status) return;
        if (status.error) {
            $('weather-overlay-status').textContent = t('Current weather overlay unavailable: {error}', { error: status.error });
            return;
        }
        $('weather-overlay-status').textContent = t('Interpolated current model surface from {count} Open-Meteo samples · {resolution}° grid · updated {time}. Values are model samples, not weather stations.', {
            count: status.count,
            resolution: status.resolution,
            time: translatedDateTime(status.generatedAt)
        });
    }

    async function loadCurrentWeatherGrid() {
        try {
            const data = await fetchJson('/api/weather/current-grid');
            currentWeatherGrid = data;
            weatherLayers.temperature = makeWeatherSurfaceLayer(data, 'temperature');
            weatherLayers.gust = makeWeatherSurfaceLayer(data, 'gust');
            weatherLayers.precipitation = makeWeatherSurfaceLayer(data, 'precipitation');
            lastWeatherGridStatus = { count: data.points?.length || 0, resolution: data.resolutionDegrees, generatedAt: data.generatedAt };
            renderWeatherGridStatus(lastWeatherGridStatus);
            applyWeatherOverlay();
        } catch (error) {
            lastWeatherGridStatus = { error: error.message };
            renderWeatherGridStatus(lastWeatherGridStatus);
        }
    }

    $('toggle-radar').addEventListener('change', event => {
        if (radarLayer) {
            if (event.target.checked) radarLayer.addTo(map2); else map2.removeLayer(radarLayer);
        }
        updateBaseMapContrast();
    });
    document.querySelectorAll('input[name="weather-overlay"]').forEach(input => input.addEventListener('change', applyWeatherOverlay));
    map2.on('moveend zoomend', renderWeatherValueLabels);

    loadCurrentWeatherGrid();
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
        openMobileDrawer('page2');
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
