<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ThreatEvent } from '../routes/api/events/+server';
  import type { CountryThreat } from '../routes/api/global-threats/+server';
  import type { Selection as D3Selection, ZoomBehavior, GeoPath, GeoProjection } from 'd3';
  import staticConflictsData from '../../static/data/conflicts.json';

  export let polymarketThreats: { question: string; url: string; probability: number; topOutcome: string }[] = [];

  /** Maps geo-keywords in market questions to [lat, lon, locationLabel] */
  const POLY_GEO: [RegExp, number, number, string][] = [
    [/iran/i, 32.0, 53.0, 'Iran'],
    [/israel/i, 31.8, 35.2, 'Israel'],
    [/gaza/i, 31.5, 34.5, 'Gaza'],
    [/ukraine/i, 49.0, 31.5, 'Ukraine'],
    [/russia/i, 55.7, 37.6, 'Russia'],
    [/taiwan/i, 24.0, 121.0, 'Taiwan'],
    [/north korea/i, 40.0, 127.0, 'North Korea'],
    [/yemen/i, 15.3, 44.2, 'Yemen'],
    [/syria/i, 34.8, 38.5, 'Syria'],
    [/iraq/i, 33.3, 44.4, 'Iraq'],
    [/afghanistan/i, 34.5, 69.2, 'Afghanistan'],
    [/pakistan/i, 30.4, 69.3, 'Pakistan'],
    [/sudan/i, 15.5, 30.0, 'Sudan'],
    [/india/i, 20.6, 79.0, 'India'],
    [/south china sea/i, 12.0, 114.0, 'South China Sea'],
    [/lebanon/i, 33.9, 35.5, 'Lebanon'],
    [/hezbollah/i, 33.9, 35.5, 'Lebanon'],
    [/hamas/i, 31.5, 34.5, 'Gaza'],
    [/houthi|red sea/i, 15.3, 44.2, 'Yemen'],
    [/myanmar/i, 19.7, 96.1, 'Myanmar'],
    [/korea/i, 37.5, 127.0, 'Korea'],
    [/china/i, 35.9, 104.2, 'China'],
    [/venezu[e]?la/i, 6.4, -66.6, 'Venezuela'],
    [/ethiopia/i, 9.1, 40.5, 'Ethiopia'],
  ];

  function geolocateMarket(question: string): { lat: number; lon: number; label: string } | null {
    for (const [re, lat, lon, label] of POLY_GEO) {
      if (re.test(question)) return { lat, lon, label };
    }
    return null;
  }

  // Module-level caches to avoid re-fetching static data on every initMap() call
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _worldCache: any | null = null;
  let _conflictApiCache: Array<{ conflict: string; countries: string[]; severity: string }> | null = null;

  let mapContainer: HTMLDivElement;
  let d3Module: typeof import('d3') | null = null;
  let svg: D3Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  let mapGroup: D3Selection<SVGGElement, unknown, SVGSVGElement, undefined> | null = null;
  let projection: GeoProjection | null = null;
  let path: GeoPath | null = null;
  let zoom: ZoomBehavior<SVGSVGElement, unknown> | null = null;
  let polyGroup: D3Selection<SVGGElement, unknown, SVGGElement, undefined> | null = null; // separate SVG group for polymarket markers (re-rendered on prop change)
  let threatMarkerGroup: D3Selection<SVGGElement, unknown, SVGGElement, undefined> | null = null; // separate SVG group for global conflict markers (re-rendered on refresh)
  let eventGroup: D3Selection<SVGGElement, unknown, SVGGElement, undefined> | null = null; // separate SVG group for RSS event circles (rendered once in Phase 2)

  /** Incremented every time initMap() starts; Phase-2 callbacks check this to avoid acting on a stale map */
  let _mapGeneration = 0;

  const WIDTH = 900;
  const HEIGHT = 460;

  let tooltipContent: { title: string; color: string; lines: string[] } | null = null;
  let tooltipLeft = 0;
  let tooltipTop  = 0;
  let tooltipVisible = false;

  let mapLoading = true;
  let mapError = '';
  let threatsUpdatedAt = '';
  let threats: CountryThreat[] = [];
  let majorEvents: ThreatEvent[] = [];
  let legendMinimized = false;
  let legendAutoHideTimer: ReturnType<typeof setTimeout> | null = null;
  const LEGEND_AUTO_HIDE_DELAY_MS = 1500;

  // ── Country news modal state ───────────────────────────────────
  let modalOpen = false;
  let selectedCountry: (CountryThreat & { stories: CountryThreat['stories'] }) | null = null;
  let selectedMarkerEl: SVGGElement | null = null;
  let modalEl: HTMLDivElement | null = null;

  // Live-refresh state — threats are re-fetched every 5 minutes to keep
  // country colours and hotspot markers up to date without reloading the page.
  const THREAT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let countryPaths: D3Selection<SVGPathElement, GeoJSON.Feature, SVGGElement, unknown> | null = null; // D3 selection retained for live colour updates

  const MAX_MAJOR_EVENTS = 8;
  /** Inner bright-core radius as a fraction of the outer ping radius (produces a subtle highlight dot) */
  const PING_CORE_RATIO = 0.32;

  const EVENT_COLORS: Record<string, string> = {
    critical: '#ff2200',
    high:     '#ff8800',
    elevated: '#ffcc00',
    low:      '#0088ff',
  };

  // ── Design tokens (Bitcoin brand palette) ─────────────────
  const TOKEN = {
    ocean:              '#0d1b2a',
    land:               '#1e3248',
    borderStroke:       'rgba(255,255,255,0.28)',
    borderWidth:        0.65,
    sphereStroke:       'rgba(247,147,26,0.15)',
    sphereStrokeWidth:  0.8,
    graticule:          'rgba(247,147,26,0.06)',
    graticuleWidth:     0.3,
    graticuleDash:      '2,2',
    orange:             '#F7931A',
  } as const;

  /** Wikipedia conflict severity → solid colour for pings/markers (bright, always visible) */
  const WIKI_SEVERITY_COLORS: Record<string, string> = {
    Extreme:   '#F7931A',   // Full Bitcoin orange — Major wars ≥10,000
    High:      '#FF8C00',   // Bright orange — Minor wars 1,000–9,999
    Turbulent: '#FFAA33',   // Amber — Conflicts 100–999
    Low:       '#FFD580',   // Light gold — Skirmishes 1–99
  };

  /** Wikipedia conflict severity → muted fill for country background shading */
  const WIKI_SEVERITY_FILLS: Record<string, string> = {
    Extreme:   '#F7931A',   // Bitcoin orange — Major wars ≥10,000 (full intensity)
    High:      '#C46800',   // Rich amber — Minor wars 1,000–9,999
    Turbulent: '#7A3D00',   // Dark orange-brown — Conflicts 100–999
    Low:       '#4A2400',   // Very dark burnt sienna — Skirmishes 1–99
  };

  /** Ranking for de-duplication: higher = more severe */
  const WIKI_SEVERITY_RANK: Record<string, number> = { Extreme: 3, High: 2, Turbulent: 1, Low: 0 };

  /** Alias map: Wikipedia country names → LOCATION_TO_ISO_ID keys */
  const WIKI_COUNTRY_ALIAS: Record<string, string> = {
    'Democratic Republic of the Congo': 'DR Congo',
    'Republic of the Congo': 'Republic of Congo',
    'East Timor': 'Timor-Leste',
    'Nagorno-Karabakh': 'Armenia',
    'Ivory Coast': "Côte d'Ivoire",
    'United Arab Emirates': 'UAE',
    'Sahrawi Republic': 'Western Sahara',
  };

  /** Maps global-threat location names to ISO 3166-1 numeric country IDs (topojson) */
  const LOCATION_TO_ISO_ID: Record<string, string> = {
    // Extreme
    'Palestine': '275', 'Myanmar': '104', 'Syria': '760', 'Mexico': '484',
    'Nigeria': '566', 'Ecuador': '218', 'Brazil': '076', 'Haiti': '332',
    'Sudan': '729', 'Pakistan': '586',
    // High
    'Cameroon': '120', 'DR Congo': '180', 'Ukraine': '804', 'Colombia': '170',
    'Yemen': '887', 'India': '356', 'Guatemala': '320', 'Somalia': '706',
    'Lebanon': '422', 'Russia': '643', 'Bangladesh': '050', 'Ethiopia': '231',
    'Iraq': '368', 'Kenya': '404', 'South Sudan': '728', 'Honduras': '340',
    'Mali': '466', 'Jamaica': '388', 'Central African Republic': '140',
    'Burundi': '108', 'Philippines': '608', 'Afghanistan': '004',
    'Trinidad and Tobago': '780', 'Venezuela': '862', 'Libya': '434',
    'Niger': '562', 'Burkina Faso': '854', 'Puerto Rico': '630',
    'Mozambique': '508', 'Iran': '364', 'Uganda': '800', 'Israel': '376',
    'Peru': '604', 'Ghana': '288', 'Indonesia': '360', 'Chile': '152',
    'South Africa': '710', 'Nepal': '524', 'Belize': '084', 'Chad': '148',
    // World countries
    'United States': '840', 'Canada': '124', 'Cuba': '192', 'Dominican Republic': '214',
    'El Salvador': '222', 'Nicaragua': '558', 'Panama': '591', 'Costa Rica': '188',
    'Argentina': '032', 'Bolivia': '068', 'Paraguay': '600', 'Uruguay': '858',
    'Guyana': '328', 'Suriname': '740',
    'United Kingdom': '826', 'France': '250', 'Germany': '276', 'Spain': '724',
    'Italy': '380', 'Poland': '616', 'Serbia': '688', 'Kosovo': '383',
    'Moldova': '498', 'Belarus': '112', 'Georgia': '268', 'Azerbaijan': '031',
    'Armenia': '051', 'Turkey': '792', 'Greece': '300', 'Romania': '642',
    'Hungary': '348', 'Czech Republic': '203', 'Croatia': '191', 'Bosnia': '070',
    'Albania': '008', 'North Macedonia': '807', 'Bulgaria': '100',
    'Sweden': '752', 'Finland': '246', 'Norway': '578', 'Denmark': '208',
    'Netherlands': '528', 'Belgium': '056', 'Switzerland': '756', 'Austria': '040',
    'Portugal': '620',
    'Saudi Arabia': '682', 'Jordan': '400', 'Kuwait': '414', 'Qatar': '634',
    'Bahrain': '048', 'Oman': '512', 'UAE': '784',
    'Egypt': '818', 'Algeria': '012', 'Tunisia': '788', 'Morocco': '504',
    'Senegal': '686', 'Guinea': '324', "Côte d'Ivoire": '384', 'Liberia': '430',
    'Sierra Leone': '694', 'Togo': '768', 'Benin': '204', 'Tanzania': '834',
    'Rwanda': '646', 'Malawi': '454', 'Zambia': '894', 'Zimbabwe': '716',
    'Angola': '024', 'Namibia': '516', 'Botswana': '072', 'Lesotho': '426',
    'Eswatini': '748', 'Madagascar': '450', 'Djibouti': '262', 'Eritrea': '232',
    'Gambia': '270', 'Gabon': '266', 'Republic of Congo': '178',
    'Equatorial Guinea': '226', 'Guinea-Bissau': '624', 'Cape Verde': '132',
    'Mauritania': '478', 'Western Sahara': '732',
    'China': '156', 'Japan': '392', 'South Korea': '410', 'North Korea': '408',
    'Taiwan': '158', 'Vietnam': '704', 'Thailand': '764', 'Cambodia': '116',
    'Laos': '418', 'Malaysia': '458', 'Singapore': '702', 'Brunei': '096',
    'Timor-Leste': '626', 'Papua New Guinea': '598', 'Fiji': '242',
    'Sri Lanka': '144', 'Maldives': '462', 'Bhutan': '064',
    'Kazakhstan': '398', 'Uzbekistan': '860', 'Kyrgyzstan': '417',
    'Tajikistan': '762', 'Turkmenistan': '795', 'Mongolia': '496',
    'Australia': '036', 'New Zealand': '554',
    'Solomon Islands': '090', 'Vanuatu': '548', 'Samoa': '882', 'Tonga': '776',
  };

  /** ISO numeric ID → Wikipedia conflict severity (highest for that country) */
  let wikiConflictCountryFills = new Map<string, string>();
  /** ISO numeric ID → CLED-based global-threat severity (for trending detection only) */
  let globalThreatCountryFills = new Map<string, string>();
  /** ISO numeric ID of the currently trending country (for glow effect) */
  let trendingIsoId: string | null = null;

  /** Country names the user has already hovered (persisted in localStorage) */
  const SEEN_KEY = 'wm-seen-global-threats';
  function loadSeenIds(): Set<string> {
    if (typeof localStorage === 'undefined') return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
  }
  function markCountrySeen(country: string, seenIds: Set<string>) {
    seenIds.add(country);
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seenIds])); } catch { /* ignore */ }
    }
  }
  let seenCountries = new Set<string>();

  /** Default land fill for non-conflict countries — deep steel blue gives depth over the dark ocean */
  const LAND_FILL_DEFAULT = TOKEN.land;

  /** Returns the fill for a country based on Wikipedia conflict severity */
  function getCountryFillById(id: string): string {
    if (id === trendingIsoId) return 'rgba(255,20,20,0.55)'; // trending: strong red
    const wikiSev = wikiConflictCountryFills.get(id);
    if (wikiSev) return WIKI_SEVERITY_FILLS[wikiSev] ?? LAND_FILL_DEFAULT;
    return LAND_FILL_DEFAULT;
  }

  function showTip(e: MouseEvent, title: string, color: string, lines: string[] = []) {
    if (!mapContainer) return;
    const rect = mapContainer.getBoundingClientRect();
    tooltipContent = { title, color, lines };
    tooltipLeft = e.clientX - rect.left + 14;
    tooltipTop  = e.clientY - rect.top  - 10;
    tooltipVisible = true;
  }
  function moveTip(e: MouseEvent) {
    if (!mapContainer) return;
    const rect = mapContainer.getBoundingClientRect();
    tooltipLeft = e.clientX - rect.left + 14;
    tooltipTop  = e.clientY - rect.top  - 10;
  }
  function hideTip() { tooltipVisible = false; tooltipContent = null; }

  // ── Country news modal functions ───────────────────────────────
  /**
   * Opens the country news modal for `ct`, highlights the clicked SVG ping,
   * and pushes a `?country=` history entry for back-button / shareable-link support.
   */
  function openCountryModal(ct: CountryThreat, markerEl: SVGGElement | null = null, pushHistory = true) {
    // Sort stories newest first
    selectedCountry = { ...ct, stories: [...ct.stories].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) };
    // Highlight the clicked ping
    if (selectedMarkerEl) selectedMarkerEl.classList.remove('wm-ping--selected');
    selectedMarkerEl = markerEl;
    if (markerEl) markerEl.classList.add('wm-ping--selected');
    modalOpen = true;
    if (pushHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('country', ct.country);
      history.pushState({ smModal: true, country: ct.country }, '', url.toString());
    }
    // Move focus into modal on next frame
    requestAnimationFrame(() => modalEl?.focus());
  }

  function closeModal() {
    if (!modalOpen) return;
    modalOpen = false;
    selectedCountry = null;
    if (selectedMarkerEl) {
      selectedMarkerEl.classList.remove('wm-ping--selected');
      selectedMarkerEl = null;
    }
  }

  function handlePopState() {
    if (modalOpen) closeModal();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && modalOpen) {
      e.preventDefault();
      history.back();
    }
  }

  /** Svelte action: trap keyboard focus inside `node` while mounted */
  function trapFocus(node: HTMLElement) {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
    function getItems() { return [...node.querySelectorAll<HTMLElement>(sel)]; }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const items = getItems();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    }
    node.addEventListener('keydown', onKey);
    // Focus the node itself first so screen readers announce the dialog before tab-cycling
    node.focus();
    return { destroy() { node.removeEventListener('keydown', onKey); } };
  }

  function zoomIn()    { if (svg && zoom) svg.transition().duration(280).call(zoom.scaleBy, 1.5); }
  function zoomOut()   { if (svg && zoom) svg.transition().duration(280).call(zoom.scaleBy, 1/1.5); }
  function resetZoom() { if (svg && zoom && d3Module) svg.transition().duration(280).call(zoom.transform, d3Module.zoomIdentity); }

  /** Fetch live RSS-sourced events */
  async function fetchEvents(): Promise<{ events: ThreatEvent[]; updatedAt: string }> {
    const res = await fetch('/api/events');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** Fetch serious global conflict events from Al Jazeera RSS (aggregated by country) */
  async function fetchGlobalThreats(): Promise<{ threats: CountryThreat[]; updatedAt: string }> {
    const res = await fetch('/api/global-threats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function initMap() {
    mapLoading = true;
    mapError   = '';
    const myGeneration = ++_mapGeneration;

    try {
      // ── Phase 1: Geometry bootstrap ──────────────────────────────────────────
      // Import D3 + topojson (code-split), load world topology (cached after first
      // load), and render the complete base map using bundled seed conflict data.
      // The spinner disappears here — the map is visible before any API call.

      const [d3, topojson] = await Promise.all([
        import('d3'),
        import('topojson-client'),
      ]);
      d3Module = d3;
      seenCountries = loadSeenIds();

      // Seed fill map from bundled static data (zero network cost)
      wikiConflictCountryFills = new Map<string, string>();
      for (const entry of staticConflictsData as Array<{ conflict: string; countries: string[]; severity: string }>) {
        for (const rawCountry of entry.countries) {
          const country = WIKI_COUNTRY_ALIAS[rawCountry] ?? rawCountry;
          const isoId = LOCATION_TO_ISO_ID[country];
          if (!isoId) continue;
          const existingSev = wikiConflictCountryFills.get(isoId);
          if (!existingSev || (WIKI_SEVERITY_RANK[entry.severity] ?? -1) > (WIKI_SEVERITY_RANK[existingSev] ?? -1)) {
            wikiConflictCountryFills.set(isoId, entry.severity);
          }
        }
      }

      // World atlas — cached in memory after first load
      if (_worldCache === null) {
        const worldRes = await fetch('/countries-110m.json');
        if (!worldRes.ok) throw new Error(`Failed to load world topology: HTTP ${worldRes.status}`);
        _worldCache = await worldRes.json();
      }
      const world = _worldCache;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countries = topojson.feature(world, world.objects.countries as any) as unknown as GeoJSON.FeatureCollection;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const borders   = topojson.mesh(world, world.objects.countries as any, (a: any, b: any) => a !== b);

      const svgEl = mapContainer?.querySelector('svg');
      if (!svgEl) return;
      svgEl.innerHTML = '';

      svg = d3.select(svgEl).attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
      mapGroup = svg.append('g').attr('id', 'wm-group');

      // Zoom/pan — no scroll-wheel zoom, allow touch pinch
      zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([1, 8])
        .filter((event: Event) => {
          if (event.type === 'wheel')    return false;
          if (event.type === 'dblclick') return false;
          return true;
        })
        .on('zoom', (event: { transform: { toString(): string } }) => {
          mapGroup.attr('transform', event.transform.toString());
        });
      svg.call(zoom);

      // Projection — Natural Earth
      projection = d3.geoNaturalEarth1()
        .scale(165)
        .translate([WIDTH / 2, HEIGHT / 2 + 20]);
      path = d3.geoPath().projection(projection);

      // Ocean background
      mapGroup.append('path')
        .datum({ type: 'Sphere' })
        .attr('d', path as unknown as string)
        .attr('fill', TOKEN.ocean)
        .attr('stroke', 'none');

      // Sphere outline
      mapGroup.append('path')
        .datum({ type: 'Sphere' })
        .attr('d', path as unknown as string)
        .attr('fill', 'none')
        .attr('stroke', TOKEN.sphereStroke)
        .attr('stroke-width', TOKEN.sphereStrokeWidth)
        .attr('pointer-events', 'none');

      // Countries — rendered immediately with seed-data conflict fills
      mapGroup.selectAll<SVGPathElement, GeoJSON.Feature>('path.wm-country')
        .data(countries.features)
        .enter().append('path')
        .attr('class', 'wm-country')
        .attr('d', path as unknown as string)
        .attr('fill', (d: GeoJSON.Feature) => getCountryFillById(String(d.id ?? '')))
        .attr('stroke', 'none');

      // Retain selection for in-place fill updates
      countryPaths = mapGroup.selectAll<SVGPathElement, GeoJSON.Feature>('path.wm-country');

      // Country borders
      mapGroup.append('path')
        .datum(borders)
        .attr('d', path as unknown as string)
        .attr('fill', 'none')
        .attr('stroke', TOKEN.borderStroke)
        .attr('stroke-width', TOKEN.borderWidth);

      // Graticule
      const grat = d3.geoGraticule().step([30, 30]);
      mapGroup.append('path')
        .datum(grat)
        .attr('d', path as unknown as string)
        .attr('fill', 'none')
        .attr('stroke', TOKEN.graticule)
        .attr('stroke-width', TOKEN.graticuleWidth)
        .attr('stroke-dasharray', TOKEN.graticuleDash);

      // Day/night terminator
      const terminatorPts = calcTerminator();
      if (terminatorPts.length > 0) {
        mapGroup.append('path')
          .datum({ type: 'Polygon', coordinates: [terminatorPts] } as GeoJSON.Polygon)
          .attr('d', path as unknown as string)
          .attr('fill', 'rgba(0,0,0,0.18)')
          .attr('stroke', 'none');
      }

      // Pre-create marker groups (empty; populated in Phase 2) — order determines Z-layer
      eventGroup        = mapGroup.append('g').attr('id', 'wm-event-group');
      threatMarkerGroup = mapGroup.append('g').attr('id', 'wm-threat-group');
      polyGroup         = mapGroup.append('g').attr('id', 'wm-poly-group');

      // Mobile default zoom
      if (typeof window !== 'undefined' && window.innerWidth <= 768) {
        const s = 1.5;
        const w = mapContainer?.clientWidth  ?? 375;
        const h = mapContainer?.clientHeight ?? 320;
        svg.call(zoom.transform, d3Module.zoomIdentity
          .translate(w / 2 * (1 - s), h / 2 * (1 - s))
          .scale(s));
      }

      // ── Base map is now fully rendered ───────────────────────────────────────
      mapLoading = false;

      // ── Phase 2: fetch live data asynchronously ───────────────────────────────
      // Schedule after the current paint so the browser renders the base map first.
      requestAnimationFrame(() => _loadLiveData(myGeneration));

    } catch (err) {
      console.error('WorldMap init failed', err);
      mapError = 'Failed to load world map data.';
      mapLoading = false;
    }
  }

  /**
   * Phase 2 — fetch live conflict/event data and update the already-visible map.
   * Uses requestAnimationFrame between fill updates and marker rendering so each
   * step lands in its own frame and never blocks the main thread for long.
   */
  async function _loadLiveData(generation: number) {
    try {
      const [eventData, globalThreatData, conflictsData] = await Promise.all([
        fetchEvents(),
        fetchGlobalThreats().catch(() => ({ threats: [] as CountryThreat[], updatedAt: '' })),
        _conflictApiCache !== null
          ? Promise.resolve(_conflictApiCache)
          : fetch('/api/conflicts').then(r => r.json()).catch(() => []) as Promise<Array<{ conflict: string; countries: string[]; severity: string }>>,
      ]);

      // Abort if the map was re-initialised while we were awaiting
      if (generation !== _mapGeneration) return;

      if (_conflictApiCache === null) _conflictApiCache = conflictsData;

      // Rebuild fill map using both seed + live data (live data wins on conflicts)
      wikiConflictCountryFills = new Map<string, string>();
      for (const source of [staticConflictsData as Array<{ conflict: string; countries: string[]; severity: string }>, conflictsData]) {
        for (const entry of source) {
          for (const rawCountry of entry.countries) {
            const country = WIKI_COUNTRY_ALIAS[rawCountry] ?? rawCountry;
            const isoId = LOCATION_TO_ISO_ID[country];
            if (!isoId) continue;
            const existingSev = wikiConflictCountryFills.get(isoId);
            if (!existingSev || (WIKI_SEVERITY_RANK[entry.severity] ?? -1) > (WIKI_SEVERITY_RANK[existingSev] ?? -1)) {
              wikiConflictCountryFills.set(isoId, entry.severity);
            }
          }
        }
      }

      // Build global-threat map for trending detection
      globalThreatCountryFills = new Map<string, string>();
      trendingIsoId = null;
      for (const ct of globalThreatData.threats) {
        const isoId = LOCATION_TO_ISO_ID[ct.country];
        if (isoId) {
          globalThreatCountryFills.set(isoId, ct.severity);
          if (ct.isTrending) trendingIsoId = isoId;
        }
      }
      threats = globalThreatData.threats;
      threatsUpdatedAt = globalThreatData.updatedAt
        ? new Date(globalThreatData.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

      // Store major events for the ticker
      majorEvents = eventData.events.filter(e => e.level === 'critical' || e.level === 'high').slice(0, MAX_MAJOR_EVENTS);

      // Update country fills in-place (fill CSS transition makes this smooth)
      if (countryPaths) {
        countryPaths
          .attr('fill', (d: GeoJSON.Feature) => getCountryFillById(String(d.id ?? '')))
          .classed('wm-country--trending', (d: GeoJSON.Feature) => String(d.id ?? '') === trendingIsoId);
      }

      // Render markers in the next frame so the fill transition has started
      requestAnimationFrame(() => {

        // ── RSS event circles ─────────────────────────────────────────────────
        if (eventGroup && projection) {
          const MIN_MARKER_DISTANCE_DEGREES = 3;
          const isNearThreat = (lat: number, lon: number) =>
            globalThreatData.threats.some(h => Math.abs(h.lat - lat) < MIN_MARKER_DISTANCE_DEGREES && Math.abs(h.lon - lon) < MIN_MARKER_DISTANCE_DEGREES);

          for (const ev of eventData.events) {
            if (isNearThreat(ev.lat, ev.lon)) continue;
            const pos = projection([ev.lon, ev.lat]);
            if (!pos) continue;
            const [x, y] = pos;
            const col = EVENT_COLORS[ev.level] ?? '#0088ff';
            const r = 2.5 + ev.score * 3;

            eventGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 3)
              .attr('fill', col).attr('fill-opacity', 0.12)
              .attr('stroke', col).attr('stroke-width', 0.5).attr('stroke-opacity', 0.4);
            eventGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r)
              .attr('fill', col).attr('fill-opacity', 0.55);
            eventGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 4)
              .attr('fill', 'transparent').attr('class', 'wm-hit')
              .on('mouseenter', (e: MouseEvent) => showTip(e, ev.location, col, [ev.title]))
              .on('mousemove', moveTip)
              .on('mouseleave', hideTip);
          }
        }

        renderThreatMarkers();

        // URL param for shareable links — open modal if matching threat found
        const urlCountry = new URLSearchParams(window.location.search).get('country');
        if (urlCountry) {
          const ct = threats.find(t => t.country.toLowerCase() === urlCountry.toLowerCase());
          if (ct) {
            history.replaceState({}, '', window.location.pathname);
            openCountryModal(ct, null);
          }
        }
      });

    } catch (err) {
      console.error('WorldMap live data load failed', err);
      // Base map stays visible — don't set mapError
    }
  }

  /** Renders (or re-renders) global conflict markers into the dedicated threat group */
  function renderThreatMarkers() {
    if (!threatMarkerGroup || !projection) return;
    threatMarkerGroup.selectAll('*').remove();

    const renderedCountries = new Set<string>();
    for (const ct of threats) {
      if (ct.stories.length === 0) continue;
      // De-duplicate: skip if a marker for this country was already rendered
      if (renderedCountries.has(ct.country)) continue;
      renderedCountries.add(ct.country);
      const pos = projection([ct.lon, ct.lat]);
      if (!pos) continue;
      const [x, y] = pos;
      const isoId = LOCATION_TO_ISO_ID[ct.country];
      const wikiSev = isoId ? wikiConflictCountryFills.get(isoId) : null;
      const col = ct.isTrending ? '#ff2200' : (WIKI_SEVERITY_COLORS[wikiSev ?? ''] ?? '#ffffff');
      const r = wikiSev === 'Extreme' ? 5.5 : wikiSev === 'High' ? 4 : 3;

      // Wrap all elements for this ping in a group so the whole marker can be removed on click
      const markerGroup = threatMarkerGroup.append('g');

      // Trending country: pulsing red glow rings + subtle "!" indicator
      if (ct.isTrending) {
        markerGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 10)
          .attr('fill', 'none').attr('stroke', '#ff2200').attr('stroke-width', 1.5)
          .attr('class', 'wm-trending-ring wm-trending-ring--outer');
        markerGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 5)
          .attr('fill', 'none').attr('stroke', '#ff2200').attr('stroke-width', 1)
          .attr('class', 'wm-trending-ring');
        markerGroup.append('text')
          .attr('x', x + r + 3).attr('y', y - r + 1)
          .attr('fill', '#ff4400').attr('font-size', '8px').attr('font-weight', '900')
          .attr('font-family', 'monospace').attr('pointer-events', 'none')
          .text('!');
      }

      // Solid core dot with bitcoin-orange glow ring for visibility
      markerGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r)
        .attr('fill', col).attr('fill-opacity', 0.85)
        .attr('stroke', '#F7931A').attr('stroke-width', 0.8).attr('stroke-opacity', 0.65)
        .attr('class', 'wm-ping-glow');

      // Inner bright core — white highlight dot for high-DPI clarity
      markerGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', Math.max(0.8, r * PING_CORE_RATIO))
        .attr('fill', 'rgba(255,255,255,0.82)').attr('pointer-events', 'none');

      // "New" badge — subtle circular dot in Bitcoin orange
      const isNew = ct.hasNew && !seenCountries.has(ct.country);
      if (isNew) {
        markerGroup.append('circle')
          .attr('cx', x + r + 2).attr('cy', y - r - 2).attr('r', 3)
          .attr('fill', '#F7931A').attr('pointer-events', 'none');
      }

      // Hit area — click opens country news modal
      markerGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 6)
        .attr('fill', 'transparent').attr('class', 'wm-hit')
        .on('click', () => {
          if (isNew) markCountrySeen(ct.country, seenCountries);
          openCountryModal(ct, markerGroup.node() as SVGGElement);
        })
        .on('mouseenter', (e: MouseEvent) => {
          const sevLabel = wikiSev
            ? ({ Extreme: 'Major war', High: 'Minor war', Turbulent: 'Conflict', Low: 'Skirmish' }[wikiSev] ?? wikiSev)
            : ({ extreme: 'Critical', high: 'High alert', turbulent: 'Elevated' }[ct.severity] ?? 'Monitoring');
          const tipPrefix = wikiSev ? 'Conflict' : 'Activity';
          const tipLines = [`${tipPrefix}: ${ct.isTrending ? '🔥 Trending (24 h)' : sevLabel}`, 'Click to view stories'];
          showTip(e, ct.country, col, tipLines);
        })
        .on('mousemove', moveTip)
        .on('mouseleave', hideTip);
    }
  }

  /** Renders (or re-renders) polymarket threat markers into the dedicated poly group */
  function renderPolyMarkers() {
    if (!polyGroup || !projection) return;
    polyGroup.selectAll('*').remove();

    const POLY_MARKET_COLOR = '#f59e0b'; // amber
    const renderedPolyLabels = new Set<string>();
    for (const m of polymarketThreats) {
      const geo = geolocateMarket(m.question);
      if (!geo) continue;
      // De-duplicate: only render one diamond per geo location label
      if (renderedPolyLabels.has(geo.label)) continue;
      renderedPolyLabels.add(geo.label);
      const pos = projection([geo.lon, geo.lat]);
      if (!pos) continue;
      const [x, y] = pos;
      const size = 5 + (m.probability - 50) / 25; // size 5–9 based on probability

      // Draw a diamond (rotated square) in amber
      polyGroup.append('path')
        .attr('d', `M${x},${y - size} L${x + size},${y} L${x},${y + size} L${x - size},${y} Z`)
        .attr('fill', POLY_MARKET_COLOR).attr('fill-opacity', 0.75)
        .attr('class', 'wm-poly-pulse');
      // Outer ring
      polyGroup.append('path')
        .attr('d', `M${x},${y - size - 3} L${x + size + 3},${y} L${x},${y + size + 3} L${x - size - 3},${y} Z`)
        .attr('fill', 'none').attr('stroke', POLY_MARKET_COLOR).attr('stroke-width', 0.7)
        .attr('stroke-opacity', 0.4).attr('class', 'wm-poly-pulse');
      // Label
      polyGroup.append('text')
        .attr('x', x + size + 5).attr('y', y + 3)
        .attr('fill', POLY_MARKET_COLOR).attr('font-size', '7px').attr('font-family', 'monospace')
        .attr('pointer-events', 'none')
        .text(`${geo.label} ${m.probability}%`);
      // Hit area (click opens Polymarket in new tab)
      polyGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', 14)
        .attr('fill', 'transparent').attr('class', 'wm-hit')
        .on('mouseenter', (e: MouseEvent) => showTip(e, `◈ Market Signal: ${geo.label}`, POLY_MARKET_COLOR, [m.question, `Crowd: ${m.topOutcome} ${m.probability}%`, 'Trending on Polymarket — click to open']))
        .on('mousemove', moveTip)
        .on('mouseleave', hideTip)
        .on('click', () => window.open(m.url, '_blank', 'noopener,noreferrer'));
    }
  }

  // Re-render polymarket markers whenever the prop changes (after map is initialised)
  $: if (polyGroup) renderPolyMarkers();

  /**
   * Re-fetches live global threat data and updates country fills in-place,
   * without tearing down and rebuilding the whole map.
   */
  async function refreshThreats() {
    if (!countryPaths || !projection) return;
    try {
      const { threats: globalThreats, updatedAt } = await fetchGlobalThreats();

      // Rebuild global-threat country fill map and trending marker
      globalThreatCountryFills = new Map<string, string>();
      trendingIsoId = null;
      for (const ct of globalThreats) {
        const isoId = LOCATION_TO_ISO_ID[ct.country];
        if (isoId) {
          globalThreatCountryFills.set(isoId, ct.severity);
          if (ct.isTrending) trendingIsoId = isoId;
        }
      }
      threats = globalThreats;

      // Update every country fill and trending class to reflect the new threat levels
      countryPaths
        .attr('fill', (d: GeoJSON.Feature) => getCountryFillById(String(d.id ?? '')))
        .classed('wm-country--trending', (d: GeoJSON.Feature) => String(d.id ?? '') === trendingIsoId);

      // Re-render the conflict marker dots to reflect updated stories, trending and new badges
      renderThreatMarkers();

      threatsUpdatedAt = updatedAt
        ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
    } catch (err) {
      console.error('Threat refresh failed', err);
    }
  }

  function calcTerminator(): [number, number][] {
    const now = new Date();
    // Day of year (1-based): Jan 1 = 1, Dec 31 = 365/366
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const doy = Math.floor((now.getTime() - yearStart.getTime()) / 86400000) + 1;
    // Solar declination angle (degrees): approx formula, ±23.45° range
    const dec = -23.45 * Math.cos(((360 / 365) * (doy + 10) * Math.PI) / 180);
    // Hour angle at UTC midnight shifted to [−180, 180] longitude
    const ha  = (now.getUTCHours() + now.getUTCMinutes() / 60) * 15 - 180;
    const pts: [number, number][] = [];
    // Forward pass: compute sunrise longitude for each latitude
    for (let lat = -89; lat <= 89; lat += 2) {
      const td = Math.tan((dec * Math.PI) / 180);
      const tl = Math.tan((lat * Math.PI) / 180);
      const acos = -td * tl;
      // acos outside [−1,1] means polar day or polar night — push to edge
      if (acos < -1 || acos > 1) { pts.push([lat * dec > 0 ? -ha + 180 : -ha, lat]); continue; }
      pts.push([-ha + (Math.acos(acos) * 180) / Math.PI, lat]);
    }
    // Reverse pass: compute sunset longitude (closes the polygon)
    for (let lat = 89; lat >= -89; lat -= 2) {
      const td = Math.tan((dec * Math.PI) / 180);
      const tl = Math.tan((lat * Math.PI) / 180);
      const acos = -td * tl;
      if (acos < -1 || acos > 1) { pts.push([lat * dec > 0 ? -ha - 180 : -ha, lat]); continue; }
      pts.push([-ha - (Math.acos(acos) * 180) / Math.PI, lat]);
    }
    return pts;
  }

  onMount(() => {
    initMap();
    // Auto-minimize legend after LEGEND_AUTO_HIDE_DELAY_MS
    legendAutoHideTimer = setTimeout(() => { legendMinimized = true; }, LEGEND_AUTO_HIDE_DELAY_MS);
    // Periodically refresh live threat data (country colours + hotspot markers)
    refreshTimer = setInterval(refreshThreats, THREAT_REFRESH_INTERVAL_MS);
    // Back-button support: close modal when user navigates back
    window.addEventListener('popstate', handlePopState);
  });
  onDestroy(() => {
    if (legendAutoHideTimer) clearTimeout(legendAutoHideTimer);
    if (refreshTimer) clearInterval(refreshTimer);
    window.removeEventListener('popstate', handlePopState);
  });

  function ago(d: string): string {
    try {
      const MINS_PER_HOUR = 60;
      const MINS_PER_DAY = 1440;
      const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
      return m < MINS_PER_HOUR ? `${m}m` : m < MINS_PER_DAY ? `${Math.floor(m / MINS_PER_HOUR)}h` : `${Math.floor(m / MINS_PER_DAY)}d`;
    } catch { return ''; }
  }

  $: tickerItems = (() => {
    // Combine events and recent threat stories from all sources (BBC, Reuters, Al Jazeera)
    const seen = new Set<string>();
    const items: { link: string; location: string; title: string; summary: string; pubDate: string; dotColor: string; countrySlug: string }[] = [];
    for (const ev of majorEvents) {
      if (seen.has(ev.link)) continue;
      seen.add(ev.link);
      items.push({ link: ev.link, location: ev.location, title: ev.title, summary: '', pubDate: ev.pubDate, dotColor: EVENT_COLORS[ev.level] ?? '#888', countrySlug: '' });
    }
    const now24 = Date.now() - 24 * 60 * 60 * 1000;
    for (const ct of threats) {
      const isoId = LOCATION_TO_ISO_ID[ct.country];
      const wikiSev = isoId ? wikiConflictCountryFills.get(isoId) : null;
      const col = ct.isTrending ? '#ff2200' : (WIKI_SEVERITY_COLORS[wikiSev ?? ''] ?? '#ffffff');
      for (const s of ct.stories) {
        if (seen.has(s.link)) continue;
        if (new Date(s.date).getTime() < now24) continue;
        seen.add(s.link);
        items.push({ link: s.link, location: ct.country, title: s.title, summary: s.summary || s.title, pubDate: s.date, dotColor: col, countrySlug: ct.country });
      }
    }
    return items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()).slice(0, 30);
  })();
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="wm-outer">
  {#if tickerItems.length > 0}
  <div class="wm-stories" aria-label="Major developing stories">
    <div class="wm-ticker-label">
      <span class="wm-stories-title">BREAKING</span>
      <span class="wm-stories-badge">LIVE</span>
    </div>
    <div class="wm-ticker-track" aria-live="polite">
      <div class="wm-ticker-reel">
        {#each [...tickerItems, ...tickerItems] as item, i}
          <a href={item.countrySlug ? `/intel/${encodeURIComponent(item.countrySlug)}` : item.link} target={item.countrySlug ? '_self' : '_blank'} rel={item.countrySlug ? undefined : 'noopener noreferrer'} class="wm-story" aria-label="{item.title}" aria-hidden={i >= tickerItems.length ? 'true' : undefined}>
            <span class="wm-story-dot" style="background:{item.dotColor};box-shadow:0 0 5px {item.dotColor};"></span>
            <span class="wm-story-loc">{item.location}</span>
            <span class="wm-story-title">{item.summary || item.title}</span>
            <span class="wm-story-age">{ago(item.pubDate)}</span>
            <span class="wm-story-sep" aria-hidden="true">◆</span>
          </a>
        {/each}
      </div>
    </div>
  </div>
  {/if}

  <div class="wm-wrap" bind:this={mapContainer}>
    {#if mapLoading}
      <div class="wm-state">
        <span class="wm-spinner"></span>
        <span class="wm-state-text">Loading world map…</span>
      </div>
    {:else if mapError}
      <div class="wm-state wm-state--error">{mapError}</div>
    {/if}

    <!-- aria-hidden: D3 map is decorative/visual; the ticker and modal convey the same data to screen readers -->
    <svg class="wm-svg" class:wm-svg--loaded={!mapLoading} aria-hidden="true"></svg>

    {#if tooltipVisible && tooltipContent}
      <div class="wm-tooltip" style="left:{tooltipLeft}px;top:{tooltipTop}px;">
        <strong style="color:{tooltipContent.color};">{tooltipContent.title}</strong>
        {#each tooltipContent.lines as line}
          <br /><span class="wm-tip-line">{line}</span>
        {/each}
      </div>
    {/if}

    <div class="wm-zoom">
      <button class="wm-zbtn" on:click={zoomIn}  title="Zoom in">+</button>
      <button class="wm-zbtn" on:click={zoomOut} title="Zoom out">−</button>
      <button class="wm-zbtn" on:click={resetZoom} title="Reset view">⟲</button>
      <button class="wm-zbtn" on:click={initMap} title="Refresh threats" disabled={mapLoading}>↺</button>
    </div>

    <button class="wm-legend" class:wm-legend--min={legendMinimized} on:click={() => legendMinimized = !legendMinimized} title={legendMinimized ? 'Show threat key' : 'Hide threat key'} aria-label={legendMinimized ? 'Show threat key' : 'Hide threat key'} aria-expanded={!legendMinimized}>
      <div class="wm-leg-title">THREAT {#if legendMinimized}<span class="wm-leg-expand">▸</span>{:else}<span class="wm-leg-expand">▾</span>{/if}</div>
      {#if !legendMinimized}
      <div class="wm-leg-row"><span class="wm-dot wm-dot--sq" style="background:rgba(247,147,26,0.40);"></span><span class="wm-leg-sub">Country fill = conflict severity</span></div>
      <div class="wm-leg-sep"></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:linear-gradient(90deg,#4a2400,#7a3d00,#c46800,#f7931a);border-radius:2px;width:20px;height:7px;"></span>Conflict intensity</div>
      <div class="wm-leg-sep"></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#F7931A;"></span><span>Major war ≥10k</span></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#C46800;"></span><span>Minor war 1k–9.9k</span></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#7A3D00;"></span><span>Conflict 100–999</span></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#4A2400;"></span><span>Skirmish &lt;100</span></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#b91c1c;box-shadow:0 0 4px #b91c1c;"></span><span style="color:#ff6655;">Trending 24h</span></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#ffffff;border:1px solid rgba(255,255,255,0.4);"></span><span>News – no conflict data</span></div>
      {#if polymarketThreats.length > 0}
        <div class="wm-leg-row"><span class="wm-dot" style="background:none;border:1px solid #eab308;transform:rotate(45deg);border-radius:1px;width:7px;height:7px;flex-shrink:0;"></span><span style="color:#eab308;">Market signals</span></div>
      {/if}
      {#if threatsUpdatedAt}
        <div class="wm-leg-sep"></div>
        <div class="wm-leg-ts">Updated {threatsUpdatedAt}</div>
      {/if}
      {/if}
    </button>
  </div>

</div>

<!-- ── Country news modal ────────────────────────────────────── -->
{#if modalOpen && selectedCountry}
  <!-- Backdrop — click closes modal via history.back() -->
  <div class="wm-modal-backdrop" on:click={() => history.back()} aria-hidden="true"></div>

  <!-- Dialog panel -->
  {@const sevColor = selectedCountry.isTrending ? '#ff2200' : ({ extreme: '#b91c1c', high: '#f97316', turbulent: '#eab308' }[selectedCountry.severity] ?? '#888888')}
  {@const sevLabel = ({ extreme: 'Major conflict', high: 'High alert', turbulent: 'Conflict zone' }[selectedCountry.severity] ?? selectedCountry.severity)}
  <div
    class="wm-modal"
    role="dialog"
    aria-modal="true"
    aria-label="{selectedCountry.country} news"
    tabindex="-1"
    bind:this={modalEl}
    use:trapFocus
  >
    <!-- Header -->
    <div class="wm-modal-head">
      <div class="wm-modal-title-row">
        <h2 class="wm-modal-country">{selectedCountry.country}</h2>
        {#if selectedCountry.severity}
          <span class="wm-modal-badge" style="color:{sevColor};border-color:{sevColor}40;background:{sevColor}15;">
            {#if selectedCountry.isTrending}🔥 Trending · {/if}{sevLabel}
          </span>
        {/if}
      </div>
      <button class="wm-modal-close" on:click={() => history.back()} aria-label="Close">✕</button>
    </div>

    <!-- Stories list -->
    <div class="wm-modal-body">
      {#if selectedCountry.stories.length === 0}
        <p class="wm-modal-empty">No recent stories for this region. Check back later.</p>
      {:else}
        <p class="wm-modal-count">{selectedCountry.stories.length} recent {selectedCountry.stories.length === 1 ? 'story' : 'stories'} — most recent first</p>
        <div class="wm-modal-stories">
          {#each selectedCountry.stories as story}
            <a
              href={story.link}
              target="_blank"
              rel="noopener noreferrer"
              class="wm-modal-story"
              aria-label="{story.title}"
            >
              <div class="wm-modal-meta">
                <span class="wm-modal-source">{story.source}</span>
                <span class="wm-modal-age">{ago(story.date)}</span>
                {#if story.casualties !== null}
                  <span class="wm-modal-cas">~{story.casualties} casualties</span>
                {/if}
              </div>
              <p class="wm-modal-story-title">{story.title}</p>
              {#if story.summary}
                <p class="wm-modal-story-summary">{story.summary}</p>
              {/if}
            </a>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .wm-outer {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .wm-wrap {
    position: relative;
    width: 100%;
    /* clamp: at least 380px, grows with viewport, capped at 680px */
    height: clamp(380px, calc(100vh - 320px), 680px);
    background: #0d1b2a;
    border-radius: 0 0 10px 10px;
    overflow: hidden;
    /* Layout containment: prevent map reflows from affecting outer layout */
    contain: layout style paint;
  }
  .wm-svg {
    width: 100%; height: 100%; display: block;
    opacity: 0;
    transition: opacity 0.45s ease;
  }
  .wm-svg--loaded { opacity: 1; }

  .wm-state {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px; z-index: 5;
    background: #0d1b2a;
  }
  .wm-state--error { color: #f43f5e; font-size: .75rem; }
  .wm-state-text { font-size: .72rem; color: rgba(247,147,26,0.6); letter-spacing: .06em; text-transform: uppercase; font-family: 'Inter', system-ui, sans-serif; }
  .wm-spinner {
    width: 32px; height: 32px; border-radius: 50%;
    border: 2px solid rgba(247,147,26,.12); border-top-color: rgba(247,147,26,.7);
    animation: wm-spin .9s linear infinite;
    box-shadow: 0 0 12px rgba(247,147,26,.15);
  }
  @keyframes wm-spin { to { transform: rotate(360deg); } }

  .wm-tooltip {
    position: absolute;
    background: rgba(13,19,30,0.97);
    border: 1px solid rgba(247,147,26,0.35);
    border-radius: 8px;
    padding: 8px 12px;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: .72rem;
    font-weight: 500;
    color: rgba(255,255,255,0.92);
    max-width: 260px;
    pointer-events: none;
    z-index: 100;
    line-height: 1.5;
    box-shadow: 0 4px 16px rgba(0,0,0,0.55);
  }
  .wm-tip-line { opacity: .80; }

  .wm-zoom {
    position: absolute; bottom: 10px; right: 10px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .wm-zbtn {
    width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    background: rgba(13,19,30,.92); border: 1px solid rgba(247,147,26,0.28); border-radius: 5px;
    color: rgba(247,147,26,0.55); font-size: .9rem; cursor: pointer; transition: color .15s, border-color .15s, background .15s;
  }
  .wm-zbtn:hover { color: #F7931A; border-color: rgba(247,147,26,0.65); background: rgba(247,147,26,0.08); }
  .wm-zbtn:disabled { opacity: .4; cursor: default; }

  .wm-legend {
    position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column;
    gap: 4px; background: rgba(13,19,30,.94); padding: 7px 10px; border-radius: 6px;
    border: 1px solid rgba(247,147,26,0.25);
    cursor: pointer; text-align: left;
    transition: padding .25s ease, gap .25s ease;
    overflow: hidden;
  }
  .wm-legend--min { gap: 0; padding: 5px 10px; }
  .wm-leg-expand { font-size: .55rem; color: rgba(247,147,26,0.60); margin-left: 4px; }
  .wm-leg-title { font-size: .54rem; font-weight: 700; color: rgba(255,255,255,.80); letter-spacing: .10em; margin-bottom: 2px; display: flex; align-items: center; }
  .wm-legend--min .wm-leg-title { margin-bottom: 0; }
  .wm-leg-row { display: flex; align-items: center; gap: 5px; font-size: .58rem; color: rgba(255,255,255,.75); font-family: 'Inter', system-ui, sans-serif; }
  .wm-leg-row--sub { opacity: .7; }
  .wm-leg-sub { font-size: .52rem; }
  .wm-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .wm-dot--sq { border-radius: 2px; }
  .wm-leg-sep { height: 1px; background: rgba(247,147,26,0.18); margin: 3px 0; }
  .wm-leg-ts { font-size: .50rem; color: rgba(255,255,255,.45); font-family: 'Inter', system-ui, sans-serif; }

  :global(.wm-hit) { cursor: pointer; }
  /* Country hover — Bitcoin orange glow lift, GPU-friendly filter, smooth 150ms transition */
  /* fill transition: enables smooth color update when Phase 2 live data arrives */
  :global(.wm-country) { transition: fill 0.5s ease, filter 150ms ease; cursor: pointer; }
  :global(.wm-country:hover) { filter: brightness(1.5) drop-shadow(0 0 3px rgba(247,147,26,0.35)); }
  :global(.wm-poly-pulse) { animation: wm-poly-pulse 1.8s ease-in-out infinite; }
  @keyframes wm-poly-pulse {
    0%, 100% { opacity: .5; }
    50%       { opacity: 1; }
  }
  :global(.wm-new-badge) { animation: wm-new-badge-blink 1.6s ease-in-out infinite; }
  @keyframes wm-new-badge-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.55; }
  }
  /* Bitcoin-orange glow ring on conflict ping markers — static, no animation */
  :global(.wm-ping-glow) {
    filter: drop-shadow(0 0 2px rgba(247, 147, 26, 0.5));
  }
  /* Trending country — pulsing red glow rings on the SVG marker */
  :global(.wm-trending-ring) {
    animation: wm-trending-ring-pulse 1.6s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
    will-change: opacity, transform;
  }
  :global(.wm-trending-ring--outer) { animation: wm-trending-ring-pulse 1.6s ease-in-out infinite .4s; will-change: opacity, transform; }
  @keyframes wm-trending-ring-pulse {
    0%, 100% { transform: scale(1);   opacity: 0.8; }
    50%       { transform: scale(1.1); opacity: 0.15; }
  }
  /* Trending country fill — pulsing on the country shape (no drop-shadow filter) */
  :global(.wm-country--trending) {
    animation: wm-country-trending 1.8s ease-in-out infinite;
  }
  @keyframes wm-country-trending {
    0%, 100% { opacity: 0.75; }
    50%       { opacity: 1; }
  }

  /* ── MAJOR STORIES TICKER ───────────────────────────────── */
  .wm-stories {
    --ticker-duration: 200s;
    background: #0a1420;
    border: 1px solid rgba(247,147,26,0.20);
    border-bottom: none;
    border-radius: 10px 10px 0 0;
    display: flex;
    align-items: center;
    overflow: hidden;
    height: 38px;
  }
  .wm-ticker-label {
    display: flex; align-items: center; gap: 6px;
    padding: 0 12px; flex-shrink: 0;
    border-right: 1px solid rgba(247,147,26,0.18);
    height: 100%;
    background: rgba(247,147,26,0.05);
  }
  .wm-stories-title {
    font-size: .5rem; font-weight: 700; letter-spacing: .12em; color: rgba(247,147,26,0.75);
    font-family: 'Inter', system-ui, sans-serif; white-space: nowrap;
  }
  .wm-stories-badge {
    font-size: .48rem; font-weight: 700; letter-spacing: .1em;
    padding: 1px 6px; border-radius: 3px;
    border: 1px solid rgba(239,68,68,.4); background: rgba(239,68,68,.12); color: #f87171;
    animation: wm-badge-blink 2.2s ease-in-out infinite; white-space: nowrap;
  }
  @keyframes wm-badge-blink { 0%,100%{opacity:1;} 50%{opacity:.5;} }

  .wm-ticker-track {
    flex: 1; overflow: hidden; height: 100%;
    display: flex; align-items: center;
  }
  .wm-ticker-reel {
    display: flex; align-items: center; gap: 0;
    animation: wm-ticker-scroll var(--ticker-duration, 40s) linear infinite;
    will-change: transform;
    white-space: nowrap;
  }
  .wm-ticker-reel:hover { animation-play-state: paused; }
  @keyframes wm-ticker-scroll {
    0%   { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }

  .wm-story {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 0 16px; text-decoration: none;
    transition: background .2s;
    height: 38px; flex-shrink: 0;
  }
  .wm-story:hover { background: rgba(247,147,26,.06); }
  .wm-story-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  }
  .wm-story-loc {
    font-size: .52rem; font-weight: 700; text-transform: uppercase; letter-spacing: .07em;
    color: rgba(247,147,26,.80); font-family: 'Inter', system-ui, sans-serif; white-space: nowrap;
  }
  .wm-story-title {
    font-size: .62rem; color: #b8c8d8; white-space: nowrap;
    max-width: 320px; overflow: hidden; text-overflow: ellipsis;
  }
  .wm-story-age {
    font-size: .5rem; color: rgba(255,255,255,.45); font-family: monospace;
    flex-shrink: 0; white-space: nowrap;
  }
  .wm-story-sep {
    font-size: .45rem; color: rgba(247,147,26,.30); margin-left: 8px; flex-shrink: 0;
  }

  @media (max-width: 768px) {
    .wm-wrap {
      height: clamp(260px, calc(100svh - 270px), 580px);
      border-radius: 0 0 10px 10px;
    }
    .wm-story-title { max-width: 200px; }
    :global(.wm-trending-ring) { animation-duration: 2.4s; }
    :global(.wm-trending-ring--outer) { animation-duration: 2.4s; }
  }

  /* ── Country news modal ────────────────────────────────────── */
  .wm-modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(3px);
    z-index: 1000;
    animation: wm-backdrop-in 0.2s ease;
  }
  @keyframes wm-backdrop-in { from { opacity: 0; } to { opacity: 1; } }

  .wm-modal {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: min(92vw, 580px);
    max-height: min(82vh, 700px);
    background: rgba(9, 17, 30, 0.97);
    border: 1px solid rgba(247, 147, 26, 0.25);
    border-radius: 14px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 1001;
    outline: none;
    animation: wm-modal-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes wm-modal-in {
    from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }

  .wm-modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 20px 20px 14px;
    border-bottom: 1px solid rgba(247,147,26,0.14);
    flex-shrink: 0;
    background: rgba(9, 17, 30, 0.98);
  }
  .wm-modal-body {
    overflow-y: auto;
    overscroll-behavior: contain;
    flex: 1;
    scrollbar-width: thin;
    scrollbar-color: rgba(247,147,26,0.2) transparent;
  }
  .wm-modal-title-row {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 1;
  }
  .wm-modal-country {
    margin: 0; font-size: 1.25rem; font-weight: 700; color: rgba(255,255,255,.92);
    line-height: 1.2;
  }
  .wm-modal-badge {
    font-size: .58rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
    padding: 3px 8px; border-radius: 4px; border: 1px solid; white-space: nowrap;
  }
  .wm-modal-close {
    background: transparent; border: 1px solid rgba(255,255,255,.15); border-radius: 6px;
    color: rgba(255,255,255,.5); font-size: .9rem; width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; flex-shrink: 0; transition: color .15s, border-color .15s;
  }
  .wm-modal-close:hover { color: #fff; border-color: rgba(255,255,255,.4); }

  .wm-modal-count {
    padding: 10px 20px 4px; margin: 0;
    font-size: .65rem; color: rgba(255,255,255,.50); font-family: monospace;
  }
  .wm-modal-empty {
    padding: 24px 20px; margin: 0;
    font-size: .8rem; color: rgba(255,255,255,.4);
  }
  .wm-modal-stories {
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px 16px 20px;
  }
  .wm-modal-story {
    display: block; background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.07); border-radius: 10px;
    padding: 12px 14px; text-decoration: none;
    transition: background .2s, border-color .2s;
    -webkit-tap-highlight-color: transparent;
  }
  .wm-modal-story:hover { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.15); }
  .wm-modal-meta {
    display: flex; align-items: center; gap: 7px; margin-bottom: 6px; flex-wrap: wrap;
  }
  .wm-modal-source {
    font-size: .55rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
    color: rgba(247,147,26,.80); font-family: 'Inter', system-ui, sans-serif;
  }
  .wm-modal-age { font-size: .55rem; color: rgba(255,255,255,.3); font-family: monospace; }
  .wm-modal-cas { font-size: .55rem; color: #f87171; font-family: monospace; }
  .wm-modal-story-title {
    margin: 0 0 5px; font-size: .85rem; font-weight: 600;
    color: rgba(255,255,255,.88); line-height: 1.4;
  }
  .wm-modal-story-summary {
    margin: 0; font-size: .72rem; color: rgba(255,255,255,.58); line-height: 1.5;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }

  /* Highlighted ping while modal is open */
  :global(.wm-ping--selected circle) { filter: drop-shadow(0 0 5px #fff); }

  /* Mobile: sheet slides from bottom */
  @media (max-width: 768px) {
    .wm-modal {
      top: max(env(safe-area-inset-top, 0px) + 10px, 44px);
      bottom: 0; left: 0; right: 0;
      transform: none;
      width: 100%; max-width: none;
      max-height: none;
      border-radius: 16px 16px 0 0;
      border-bottom: none;
      animation: wm-modal-in-mobile 0.3s ease;
    }
    @keyframes wm-modal-in-mobile {
      from { transform: translateY(100%); }
      to   { transform: translateY(0); }
    }
  }

  /* Light mode */
  :global(.light-mode) .wm-modal {
    background: rgba(244, 245, 247, 0.98);
    border-color: rgba(0, 0, 0, 0.12);
  }
  :global(.light-mode) .wm-modal-head { background: rgba(244, 245, 247, 0.99); }
  :global(.light-mode) .wm-modal-country { color: rgba(0,0,0,.88); }
  :global(.light-mode) .wm-modal-story { background: rgba(0,0,0,.04); border-color: rgba(0,0,0,.08); }
  :global(.light-mode) .wm-modal-story:hover { background: rgba(0,0,0,.07); border-color: rgba(0,0,0,.14); }
  :global(.light-mode) .wm-modal-story-title { color: rgba(0,0,0,.85); }
  :global(.light-mode) .wm-modal-story-summary { color: rgba(0,0,0,.5); }

</style>
