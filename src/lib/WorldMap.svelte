<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
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

  // Live-refresh state — threats are re-fetched every 5 minutes to keep
  // country colours and hotspot markers up to date without reloading the page.
  const THREAT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let countryPaths: D3Selection<SVGPathElement, GeoJSON.Feature, SVGGElement, unknown> | null = null; // D3 selection retained for live colour updates

  const MAX_MAJOR_EVENTS = 8;

  const EVENT_COLORS: Record<string, string> = {
    critical: '#ff2200',
    high:     '#ff8800',
    elevated: '#ffcc00',
    low:      '#0088ff',
  };

  /** Wikipedia conflict severity → solid colour for pings/markers */
  const WIKI_SEVERITY_COLORS: Record<string, string> = {
    Extreme:   '#8B0000',   // Major wars ≥10,000 casualties
    High:      '#FF4500',   // Minor wars 1,000–9,999
    Turbulent: '#FFA500',   // Conflicts 100–999
    Low:       '#FFD580',   // Skirmishes/clashes 1–99
  };

  /** Wikipedia conflict severity → solid colour fill for country shading */
  const WIKI_SEVERITY_FILLS: Record<string, string> = {
    Extreme:   '#8B0000',   // Major wars ≥10,000 casualties
    High:      '#FF4500',   // Minor wars 1,000–9,999
    Turbulent: '#FFA500',   // Conflicts 100–999
    Low:       '#FFD580',   // Skirmishes 1–99
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

  /** Returns the fill for a country based on Wikipedia conflict severity */
  function getCountryFillById(id: string): string {
    if (id === trendingIsoId) return 'rgba(255,20,20,0.55)'; // trending: strong red
    const wikiSev = wikiConflictCountryFills.get(id);
    if (wikiSev) return WIKI_SEVERITY_FILLS[wikiSev] ?? '#ccc';
    return '#ccc';
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

    try {
      const [[d3, topojson], eventData, globalThreatData, conflictsData] = await Promise.all([
        Promise.all([import('d3'), import('topojson-client')]),
        fetchEvents(),
        fetchGlobalThreats().catch(() => ({ threats: [] as CountryThreat[], updatedAt: '' })),
        _conflictApiCache !== null
          ? Promise.resolve(_conflictApiCache)
          : fetch('/api/conflicts').then(r => r.json()).catch(() => []) as Promise<Array<{ conflict: string; countries: string[]; severity: string }>>,
      ]);
      if (_conflictApiCache === null) _conflictApiCache = conflictsData;
      d3Module = d3;

      // Load seen-country keys from localStorage so "New" badges reflect fresh visits
      seenCountries = loadSeenIds();

      // Build Wikipedia conflict fill map: ISO ID → severity
      // Seed from static data first so colours always show, then apply live API data (higher severity wins).
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

      // Build global-threat map for trending detection only
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
      threatsUpdatedAt = globalThreatData.updatedAt ? new Date(globalThreatData.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      // Store major events (critical + high only) for the story panel
      majorEvents = eventData.events.filter(e => e.level === 'critical' || e.level === 'high').slice(0, MAX_MAJOR_EVENTS);

      const svgEl = mapContainer?.querySelector('svg');
      if (!svgEl) return;

      // Clear any previous render only after successful data fetch
      svgEl.innerHTML = '';

      svg = d3.select(svgEl).attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
      mapGroup = svg.append('g').attr('id', 'wm-group');

      // Zoom/pan — no scroll-wheel zoom, allow touch pinch
      zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([1, 8])
        .filter((event: Event) => {
          if (event.type === 'wheel')   return false;
          if (event.type === 'dblclick') return false;
          return true;
        })
        .on('zoom', (event: { transform: { toString(): string } }) => {
          mapGroup.attr('transform', event.transform.toString());
        });
      svg.call(zoom);

      // Projection — natural earth for nice aesthetics
      projection = d3.geoNaturalEarth1()
        .scale(165)
        .translate([WIDTH / 2, HEIGHT / 2 + 20]);
      path = d3.geoPath().projection(projection);

      // World atlas from local static asset (avoids CDN round-trip); cached in memory after first load
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

      // Ocean background
      mapGroup.append('path')
        .datum({ type: 'Sphere' })
        .attr('d', path as unknown as string)
        .attr('fill', '#0d1b2a')
        .attr('stroke', 'none');

      // Countries — shaded by live threat level so severity is immediately visible
      mapGroup.selectAll<SVGPathElement, GeoJSON.Feature>('path.wm-country')
        .data(countries.features)
        .enter().append('path')
        .attr('class', (d: GeoJSON.Feature) => String(d.id ?? '') === trendingIsoId ? 'wm-country wm-country--trending' : 'wm-country')
        .attr('d', path as unknown as string)
        .attr('fill', (d: GeoJSON.Feature) => getCountryFillById(String(d.id ?? '')))
        .attr('stroke', 'none');

      // Retain selection so live refreshes can update fills in-place
      countryPaths = mapGroup.selectAll<SVGPathElement, GeoJSON.Feature>('path.wm-country');

      // Country borders
      mapGroup.append('path')
        .datum(borders)
        .attr('d', path as unknown as string)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(0,200,255,0.35)')
        .attr('stroke-width', 0.4);

      // Graticule
      const grat = d3.geoGraticule().step([30, 30]);
      mapGroup.append('path')
        .datum(grat)
        .attr('d', path as unknown as string)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(0,200,255,0.12)')
        .attr('stroke-width', 0.3)
        .attr('stroke-dasharray', '2,2');

      // Day/night terminator (approximate)
      const terminatorPts = calcTerminator();
      if (terminatorPts.length > 0) {
        mapGroup.append('path')
          .datum({ type: 'Polygon', coordinates: [terminatorPts] } as GeoJSON.Polygon)
          .attr('d', path as unknown as string)
          .attr('fill', 'rgba(0,0,0,0.28)')
          .attr('stroke', 'none');
      }

      // ── Live RSS event markers ──────────────────────────────────
      // Skip events whose geocoded position is too close to a global threat marker
      // (within ~3° in both lat and lon) to avoid visual overlap.
      const MIN_MARKER_DISTANCE_DEGREES = 3;
      const isNearThreat = (lat: number, lon: number) =>
        globalThreatData.threats.some(h => Math.abs(h.lat - lat) < MIN_MARKER_DISTANCE_DEGREES && Math.abs(h.lon - lon) < MIN_MARKER_DISTANCE_DEGREES);

      for (const ev of eventData.events) {
        if (isNearThreat(ev.lat, ev.lon)) continue;
        const pos = projection([ev.lon, ev.lat]);
        if (!pos) continue;
        const [x, y] = pos;
        const col = EVENT_COLORS[ev.level] ?? '#0088ff';
        const r = 2.5 + ev.score * 3;   // size proportional to score

        mapGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 3)
          .attr('fill', col).attr('fill-opacity', 0.12)
          .attr('stroke', col).attr('stroke-width', 0.5).attr('stroke-opacity', 0.4);
        mapGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r)
          .attr('fill', col).attr('fill-opacity', 0.55);
        mapGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 4)
          .attr('fill', 'transparent').attr('class', 'wm-hit')
          .on('mouseenter', (e: MouseEvent) => showTip(e, ev.location, col, [ev.title]))
          .on('mousemove', moveTip)
          .on('mouseleave', hideTip);
      }

      // ── Global conflict event markers (one solid dot per country) ───
      // Rendered in a dedicated group so refreshThreats() can update them in-place.
      threatMarkerGroup = mapGroup.append('g').attr('id', 'wm-threat-group');

      renderThreatMarkers();

      // Create a dedicated group for polymarket markers (so they can be updated independently)
      polyGroup = mapGroup.append('g').attr('id', 'wm-poly-group');

      renderPolyMarkers();

      mapLoading = false;

      // On mobile, apply a slightly higher default zoom so the map is easier to read
      if (typeof window !== 'undefined' && window.innerWidth <= 768) {
        const s = 1.5;
        const w = mapContainer?.clientWidth  ?? 375;
        const h = mapContainer?.clientHeight ?? 320;
        svg.call(zoom.transform, d3Module.zoomIdentity
          .translate(w / 2 * (1 - s), h / 2 * (1 - s))
          .scale(s));
      }
    } catch (err) {
      console.error('WorldMap init failed', err);
      mapError = 'Failed to load world map data.';
      mapLoading = false;
    }
  }

  /** Renders (or re-renders) global conflict markers into the dedicated threat group */
  function renderThreatMarkers() {
    if (!threatMarkerGroup || !projection) return;
    threatMarkerGroup.selectAll('*').remove();

    for (const ct of threats) {
      if (ct.stories.length === 0) continue;
      const pos = projection([ct.lon, ct.lat]);
      if (!pos) continue;
      const [x, y] = pos;
      const isoId = LOCATION_TO_ISO_ID[ct.country];
      const wikiSev = isoId ? wikiConflictCountryFills.get(isoId) : null;
      const col = ct.isTrending ? '#ff2200' : (WIKI_SEVERITY_COLORS[wikiSev ?? ''] ?? '#ffffff');
      const r = wikiSev === 'Extreme' ? 5.5 : wikiSev === 'High' ? 4 : 3;

      // Trending country: pulsing red glow rings
      if (ct.isTrending) {
        threatMarkerGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 10)
          .attr('fill', 'none').attr('stroke', '#ff2200').attr('stroke-width', 1.5)
          .attr('class', 'wm-trending-ring wm-trending-ring--outer');
        threatMarkerGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 5)
          .attr('fill', 'none').attr('stroke', '#ff2200').attr('stroke-width', 1)
          .attr('class', 'wm-trending-ring');
      }

      // Solid core dot with white outline stroke for visibility on both light and dark backgrounds
      threatMarkerGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r)
        .attr('fill', col).attr('fill-opacity', 0.85)
        .attr('stroke', 'rgba(255,255,255,0.7)').attr('stroke-width', 0.8);

      // "New" badge — subtle circular dot in Bitcoin orange, disappears on hover
      const isNew = ct.hasNew && !seenCountries.has(ct.country);
      let badge: D3Selection<SVGCircleElement, unknown, SVGGElement, undefined> | null = null;
      if (isNew) {
        badge = threatMarkerGroup.append('circle')
          .attr('cx', x + r + 2).attr('cy', y - r - 2).attr('r', 3)
          .attr('fill', '#F7931A').attr('pointer-events', 'none');
      }

      // Hit area with tap/click navigation to /intel/[country]
      threatMarkerGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 6)
        .attr('fill', 'transparent').attr('class', 'wm-hit')
        .on('click', () => {
          if (badge) { badge.remove(); badge = null; markCountrySeen(ct.country, seenCountries); }
          goto(`/intel/${encodeURIComponent(ct.country)}`);
        })
        .on('mouseenter', (e: MouseEvent) => {
          const sevLabel = wikiSev ? ({ Extreme: 'Major war', High: 'Minor war', Turbulent: 'Conflict', Low: 'Skirmish' }[wikiSev] ?? wikiSev) : 'Active';
          const tipLines = [`Conflict: ${ct.isTrending ? '🔥 Trending (24 h)' : sevLabel}`, 'Click to view stories'];
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
    for (const m of polymarketThreats) {
      const geo = geolocateMarket(m.question);
      if (!geo) continue;
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
  });
  onDestroy(() => {
    if (legendAutoHideTimer) clearTimeout(legendAutoHideTimer);
    if (refreshTimer) clearInterval(refreshTimer);
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

    <svg class="wm-svg"></svg>

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
      <div class="wm-leg-row"><span class="wm-dot wm-dot--sq" style="background:rgba(139,0,0,0.45);"></span><span class="wm-leg-sub">Country fill = conflict severity</span></div>
      <div class="wm-leg-sep"></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:linear-gradient(90deg,#0088ff,#ff8800,#ff2200);border-radius:2px;width:20px;height:7px;"></span>Live events</div>
      <div class="wm-leg-sep"></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#8B0000;"></span><span>Major war ≥10k</span></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#FF4500;"></span><span>Minor war 1k–9.9k</span></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#FFA500;"></span><span>Conflict 100–999</span></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#FFD580;"></span><span>Skirmish &lt;100</span></div>
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

<style>
  .wm-outer {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .wm-wrap {
    position: relative;
    width: 100%;
    /* 300px = section top padding (48px) + section header (~80px) + tile padding (40px) + tile header (~60px) + footer gap (72px) */
    height: calc(100vh - 340px);
    min-height: 420px;
    background: #0d1b2a;
    border-radius: 0 0 10px 10px;
    overflow: hidden;
  }
  .wm-svg { width: 100%; height: 100%; display: block; }

  .wm-state {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px; z-index: 5;
    background: #0d1b2a;
  }
  .wm-state--error { color: #f43f5e; font-size: .75rem; }
  .wm-state-text { font-size: .72rem; color: var(--t3); }
  .wm-spinner {
    width: 22px; height: 22px; border-radius: 50%;
    border: 2px solid rgba(247,147,26,.2); border-top-color: var(--orange);
    animation: wm-spin .9s linear infinite;
  }
  @keyframes wm-spin { to { transform: rotate(360deg); } }

  .wm-tooltip {
    position: absolute; background: rgba(8,18,32,.97); border: 1px solid rgba(0,200,255,0.3);
    border-radius: 6px; padding: 6px 9px; font-size: .65rem; color: #ddd;
    max-width: 260px; pointer-events: none; z-index: 100;
    line-height: 1.5;
  }
  .wm-tip-line { opacity: .75; }

  .wm-zoom {
    position: absolute; bottom: 10px; right: 10px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .wm-zbtn {
    width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    background: rgba(8,18,32,.9); border: 1px solid rgba(0,200,255,0.25); border-radius: 5px;
    color: #6b8f9f; font-size: .9rem; cursor: pointer; transition: color .15s, border-color .15s;
  }
  .wm-zbtn:hover { color: #fff; border-color: rgba(0,200,255,0.6); }
  .wm-zbtn:disabled { opacity: .4; cursor: default; }

  .wm-legend {
    position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column;
    gap: 3px; background: rgba(8,18,32,.88); padding: 6px 9px; border-radius: 6px;
    border: 1px solid rgba(0,200,255,0.18);
    cursor: pointer; text-align: left;
    transition: padding .25s ease, gap .25s ease;
    overflow: hidden;
  }
  .wm-legend--min { gap: 0; padding: 5px 9px; }
  .wm-leg-expand { font-size: .55rem; color: rgba(0,200,255,0.5); margin-left: 4px; }
  .wm-leg-title { font-size: .52rem; color: var(--t3); letter-spacing: .08em; margin-bottom: 2px; display: flex; align-items: center; }
  .wm-legend--min .wm-leg-title { margin-bottom: 0; }
  .wm-leg-row { display: flex; align-items: center; gap: 5px; font-size: .56rem; color: #8ab; font-family: monospace; }
  .wm-leg-row--sub { opacity: .7; }
  .wm-leg-sub { font-size: .5rem; }
  .wm-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .wm-dot--sq { border-radius: 2px; }
  .wm-leg-sep { height: 1px; background: rgba(0,200,255,0.15); margin: 3px 0; }
  .wm-leg-ts { font-size: .48rem; color: var(--t3); font-family: monospace; }

  :global(.wm-hit) { cursor: pointer; }
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
  /* Trending country — pulsing red glow rings on the SVG marker */
  :global(.wm-trending-ring) {
    animation: wm-trending-ring-pulse 1.6s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  :global(.wm-trending-ring--outer) { animation: wm-trending-ring-pulse 1.6s ease-in-out infinite .4s; }
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
    border: 1px solid rgba(0,200,255,0.18);
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
    border-right: 1px solid rgba(0,200,255,0.18);
    height: 100%;
    background: rgba(0,200,255,0.05);
  }
  .wm-stories-title {
    font-size: .5rem; font-weight: 700; letter-spacing: .12em; color: rgba(0,200,255,0.6);
    font-family: monospace; white-space: nowrap;
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
  .wm-story:hover { background: rgba(0,200,255,.06); }
  .wm-story-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  }
  .wm-story-loc {
    font-size: .52rem; font-weight: 700; text-transform: uppercase; letter-spacing: .07em;
    color: rgba(0,200,255,.7); font-family: monospace; white-space: nowrap;
  }
  .wm-story-title {
    font-size: .62rem; color: #b8c8d8; white-space: nowrap;
    max-width: 320px; overflow: hidden; text-overflow: ellipsis;
  }
  .wm-story-age {
    font-size: .5rem; color: rgba(255,255,255,.3); font-family: monospace;
    flex-shrink: 0; white-space: nowrap;
  }
  .wm-story-sep {
    font-size: .45rem; color: rgba(0,200,255,.25); margin-left: 8px; flex-shrink: 0;
  }

  @media (max-width: 768px) {
    .wm-wrap {
      height: calc(100svh - 270px);
      min-height: 260px;
      max-height: 600px;
      border-radius: 0 0 10px 10px;
    }
    .wm-story-title { max-width: 200px; }
    :global(.wm-trending-ring) { animation-duration: 2.4s; }
    :global(.wm-trending-ring--outer) { animation-duration: 2.4s; }
  }

</style>
