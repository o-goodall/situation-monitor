<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Threat } from '$lib/settings';
  import type { ThreatEvent } from '../routes/api/events/+server';
  import type { GlobalThreatEvent } from '../routes/api/global-threats/+server';

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

  let mapContainer: HTMLDivElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let d3Module: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let svg: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mapGroup: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let projection: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let path: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let zoom: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let polyGroup: any = null; // separate SVG group for polymarket markers (re-rendered on prop change)

  const WIDTH = 900;
  const HEIGHT = 460;

  let tooltipContent: { title: string; color: string; lines: string[] } | null = null;
  let tooltipLeft = 0;
  let tooltipTop  = 0;
  let tooltipVisible = false;

  let mapLoading = true;
  let mapError = '';
  let threatsUpdatedAt = '';
  let majorEvents: ThreatEvent[] = [];
  let legendMinimized = false;
  let legendAutoHideTimer: ReturnType<typeof setTimeout> | null = null;
  const LEGEND_AUTO_HIDE_DELAY_MS = 1500;

  // Live-refresh state — threats are re-fetched every 5 minutes to keep
  // country colours and hotspot markers up to date without reloading the page.
  const THREAT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let countryPaths: any = null; // D3 selection retained for live colour updates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let threatGroup: any = null; // Dedicated SVG group for hotspot markers
  let countryLevelMap = new Map<string, string>(); // countryId → ThreatLevel

  const MAX_MAJOR_EVENTS = 8;

  const THREAT_COLORS: Record<string, string> = {
    critical: '#ff4444',
    high:     '#ff8800',
    elevated: '#ffcc00',
    low:      '#00ff88',
    info:     '#00ccff',
  };

  const EVENT_COLORS: Record<string, string> = {
    critical: '#ff2200',
    high:     '#ff8800',
    elevated: '#ffcc00',
    low:      '#0088ff',
  };

  /** Colour scheme for global-threat markers keyed by severity (casualty-based) */
  const GLOBAL_THREAT_COLORS: Record<string, string> = {
    major:  '#ff2200',   // 200+ casualties — red
    medium: '#ffaa00',   // 50–199 casualties — orange/amber
    minor:  '#00cc44',   // <50 casualties / keyword only — green
  };

  /** Semi-transparent fills matching GLOBAL_THREAT_COLORS for country shading */
  const GLOBAL_THREAT_COUNTRY_FILLS: Record<string, string> = {
    major:  'rgba(255,34,0,0.32)',
    medium: 'rgba(255,170,0,0.25)',
    minor:  'rgba(0,204,68,0.15)',
  };

  /** Maps global-threat location names to ISO 3166-1 numeric country IDs (topojson) */
  const LOCATION_TO_ISO_ID: Record<string, string> = {
    'Ukraine': '804', 'Gaza': '275', 'Palestine': '275', 'Israel': '376',
    'Syria': '760', 'Yemen': '887', 'Sudan': '729', 'Somalia': '706',
    'Afghanistan': '004', 'Iraq': '368', 'Iran': '364', 'Myanmar': '104',
    'Ethiopia': '231', 'DR Congo': '180', 'Mali': '466', 'Burkina Faso': '854',
    'Nigeria': '566', 'Libya': '434', 'Haiti': '332', 'Lebanon': '422',
    'Pakistan': '586', 'India': '356', 'Kashmir': '356', 'North Korea': '408',
    'Taiwan': '158', 'Cameroon': '120', 'Mozambique': '508', 'South Sudan': '728',
    'Colombia': '170', 'Mexico': '484', 'Venezuela': '862', 'Chad': '148',
    'Central African Republic': '140',
  };

  /** ISO numeric ID → global-threat severity (highest for that country) */
  let globalThreatCountryFills = new Map<string, string>();

  /** IDs of global-threat events the user has already hovered (persisted in localStorage) */
  const SEEN_KEY = 'wm-seen-global-threats';
  function loadSeenIds(): Set<string> {
    if (typeof localStorage === 'undefined') return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
  }
  function markEventSeen(id: string, seenIds: Set<string>) {
    seenIds.add(id);
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seenIds])); } catch { /* ignore */ }
    }
  }
  let seenEventIds = new Set<string>();

  /** Semi-transparent country fill colours keyed by threat level */
  const COUNTRY_THREAT_FILLS: Record<string, string> = {
    critical: 'rgba(255,68,68,0.35)',
    high:     'rgba(255,136,0,0.28)',
    elevated: 'rgba(255,204,0,0.18)',
    low:      'rgba(0,255,136,0.12)',
    info:     'rgba(0,204,255,0.10)',
  };

  function getCountryFill(level: string): string {
    return COUNTRY_THREAT_FILLS[level] ?? COUNTRY_THREAT_FILLS.elevated;
  }

  /** Returns the fill for a country, preferring global-threat severity when available */
  function getCountryFillById(id: string): string {
    const gtSeverity = globalThreatCountryFills.get(id);
    if (gtSeverity) return GLOBAL_THREAT_COUNTRY_FILLS[gtSeverity] ?? GLOBAL_THREAT_COUNTRY_FILLS.minor;
    const level = countryLevelMap.get(id);
    return level ? getCountryFill(level) : '#1e3248';
  }

  /** Priority order for threat levels (higher = more severe) */
  const LEVEL_PRIORITY: Record<string, number> = { critical: 4, high: 3, elevated: 2, low: 1, info: 0 };

  /** Builds a countryId → highest ThreatLevel map, keeping the most severe level per country */
  function buildCountryLevelMap(threats: Threat[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const t of threats) {
      if (!t.countryId) continue;
      const existing = map.get(t.countryId);
      if (!existing || (LEVEL_PRIORITY[t.level] ?? 0) > (LEVEL_PRIORITY[existing] ?? 0)) {
        map.set(t.countryId, t.level as string);
      }
    }
    return map;
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

  /** Fetch live threat hotspots (ACLED when configured, static fallback otherwise) */
  async function fetchThreats(): Promise<{ threats: Threat[]; conflictCountryIds: string[]; updatedAt: string }> {
    const res = await fetch('/api/threats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** Fetch live RSS-sourced events */
  async function fetchEvents(): Promise<{ events: ThreatEvent[]; updatedAt: string }> {
    const res = await fetch('/api/events');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** Fetch serious global conflict events from trusted RSS sources */
  async function fetchGlobalThreats(): Promise<{ events: GlobalThreatEvent[]; updatedAt: string }> {
    const res = await fetch('/api/global-threats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function initMap() {
    mapLoading = true;
    mapError   = '';

    try {
      const [[d3, topojson], threatData, eventData, globalThreatData] = await Promise.all([
        Promise.all([import('d3'), import('topojson-client')]),
        fetchThreats(),
        fetchEvents(),
        fetchGlobalThreats().catch(() => ({ events: [] as GlobalThreatEvent[], updatedAt: '' })),
      ]);
      d3Module = d3;

      // Load seen-event IDs from localStorage so "New" badges reflect fresh visits
      seenEventIds = loadSeenIds();

      const { threats, updatedAt } = threatData;
      // Build a map from ISO numeric country ID → highest threat level so country
      // fills can be coloured by severity rather than a single flat conflict colour.
      countryLevelMap = buildCountryLevelMap(threats);
      threatsUpdatedAt = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      // Build global-threat country fill map: ISO ID → highest severity from global events
      // Deduplicate to one event per country (highest severity) for both fills and markers.
      const SEVERITY_RANK: Record<string, number> = { major: 2, medium: 1, minor: 0 };
      const countryEventMap = new Map<string, GlobalThreatEvent>();
      for (const gev of globalThreatData.events) {
        const existing = countryEventMap.get(gev.location);
        if (!existing || (SEVERITY_RANK[gev.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
          countryEventMap.set(gev.location, gev);
        }
      }
      globalThreatCountryFills = new Map<string, string>();
      for (const [location, gev] of countryEventMap) {
        const isoId = LOCATION_TO_ISO_ID[location];
        if (isoId) globalThreatCountryFills.set(isoId, gev.severity);
      }
      const dedupedGlobalEvents = Array.from(countryEventMap.values());

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

      // World atlas from local static asset (avoids CDN round-trip)
      const world = await fetch('/countries-110m.json').then(r => r.json());
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
      mapGroup.selectAll('path.wm-country')
        .data(countries.features)
        .enter().append('path')
        .attr('class', 'wm-country')
        .attr('d', path as unknown as string)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .attr('fill', (d: any) => getCountryFillById(String(d.id)))
        .attr('stroke', 'none');

      // Retain selection so live refreshes can update fills in-place
      countryPaths = mapGroup.selectAll('path.wm-country');

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
      // Skip events whose geocoded position is too close to an existing threat marker
      // (within ~3° in both lat and lon) to avoid visual overlap.
      const MIN_MARKER_DISTANCE_DEGREES = 3;
      const isNearThreat = (lat: number, lon: number) =>
        threats.some(h => Math.abs(h.lat - lat) < MIN_MARKER_DISTANCE_DEGREES && Math.abs(h.lon - lon) < MIN_MARKER_DISTANCE_DEGREES);

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

      // ── Global conflict event markers (from trusted RSS sources) ───
      // One marker per country (highest severity); color: red/orange/green per severity.
      for (const gev of dedupedGlobalEvents) {
        const pos = projection([gev.lon, gev.lat]);
        if (!pos) continue;
        const [x, y] = pos;
        const col = GLOBAL_THREAT_COLORS[gev.severity] ?? '#00cc44';
        const r = gev.severity === 'major' ? 5.5 : gev.severity === 'medium' ? 4 : 3;

        // Outer glow ring
        mapGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 4)
          .attr('fill', col).attr('fill-opacity', 0.10)
          .attr('stroke', col).attr('stroke-width', 0.6).attr('stroke-opacity', 0.35)
          .attr('class', 'wm-pulse');
        // Core dot
        mapGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r)
          .attr('fill', col).attr('fill-opacity', 0.7);

        // "New" badge — shown until the user hovers; tracks seen state in localStorage
        const isNew = !seenEventIds.has(gev.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let badgeGroup: any = null;
        if (isNew) {
          badgeGroup = mapGroup.append('g').attr('class', 'wm-new-badge')
            .attr('transform', `translate(${x + r + 1},${y - r - 5})`);
          badgeGroup.append('rect').attr('x', 0).attr('y', -7).attr('width', 20).attr('height', 8)
            .attr('rx', 2).attr('fill', '#22c55e').attr('fill-opacity', 0.92);
          badgeGroup.append('text').attr('x', 10).attr('y', -1)
            .attr('fill', '#fff').attr('font-size', '5.5px').attr('font-family', 'monospace')
            .attr('font-weight', 'bold').attr('text-anchor', 'middle')
            .attr('pointer-events', 'none').text('NEW');
        }

        // Hit area with tooltip
        const tipLines: string[] = [gev.title];
        if (gev.casualties !== null) tipLines.push(`Casualties: ~${gev.casualties}`);
        if (gev.summary) tipLines.push(gev.summary.slice(0, 120));
        tipLines.push(`Source: ${gev.source} · ${new Date(gev.pubDate).toLocaleDateString()}`);
        mapGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', r + 6)
          .attr('fill', 'transparent').attr('class', 'wm-hit')
          .on('mouseenter', (e: MouseEvent) => {
            if (badgeGroup) { badgeGroup.remove(); badgeGroup = null; markEventSeen(gev.id, seenEventIds); }
            showTip(e, gev.location, col, tipLines);
          })
          .on('mousemove', moveTip)
          .on('mouseleave', hideTip)
          .on('click', () => window.open(gev.link, '_blank', 'noopener,noreferrer'));
      }

      // ── Threat hotspot markers (in a dedicated group for live re-renders) ──
      threatGroup = mapGroup.append('g').attr('id', 'wm-threats-group');
      renderThreatMarkers(threats);

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

  /** Clears and redraws all threat hotspot markers into the dedicated threat group */
  function renderThreatMarkers(threats: Threat[]) {
    if (!threatGroup || !projection) return;
    threatGroup.selectAll('*').remove();

    for (const h of threats) {
      const pos = projection([h.lon, h.lat]);
      if (!pos) continue;
      const [x, y] = pos;
      const col = THREAT_COLORS[h.level] ?? '#aaa';

      // pulse ring
      threatGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', 7)
        .attr('fill', col).attr('fill-opacity', 0.18).attr('class', 'wm-pulse')
        .attr('stroke', col).attr('stroke-width', 0.8).attr('stroke-opacity', 0.5);
      // inner dot
      threatGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', 3.5)
        .attr('fill', col);
      // label
      threatGroup.append('text')
        .attr('x', x + 6).attr('y', y + 4)
        .attr('fill', col).attr('font-size', '7.5px').attr('font-family', 'monospace')
        .attr('pointer-events', 'none')
        .text(h.name);
      // hit area — tooltip shows risk level, direction and score when available
      const tipLines: string[] = [];
      if (h.direction && h.accelerationPct !== undefined) {
        const accelStr = h.accelerationPct !== 0
          ? ` (${h.accelerationPct > 0 ? '+' : ''}${h.accelerationPct}% vs prior week)`
          : '';
        tipLines.push(`Trend: ${h.direction} ${h.direction === '↑' ? 'Rising' : h.direction === '↓' ? 'Cooling' : 'Stable'}${accelStr}`);
      }
      if (h.score !== undefined) tipLines.push(`Score: ${h.score}`);
      threatGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', 12)
        .attr('fill', 'transparent').attr('class', 'wm-hit')
        .on('mouseenter', (e: MouseEvent) => showTip(e, h.desc, col, tipLines))
        .on('mousemove', moveTip)
        .on('mouseleave', hideTip);
    }
  }

  /**
   * Re-fetches live threat data and updates country fills + hotspot markers
   * in-place, without tearing down and rebuilding the whole map.
   */
  async function refreshThreats() {
    if (!countryPaths || !threatGroup || !projection) return;
    try {
      const { threats, updatedAt } = await fetchThreats();

      // Rebuild country-level map from latest data, keeping highest severity per country
      countryLevelMap = buildCountryLevelMap(threats);

      // Update every country fill to reflect the new threat levels
      countryPaths.attr('fill', (d: { id: unknown }) => getCountryFillById(String(d.id)));

      // Re-render hotspot markers with latest positions + levels
      renderThreatMarkers(threats);

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
</script>

<div class="wm-outer">
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
      <div class="wm-leg-row"><span class="wm-dot" style="background:#ff4444;"></span>Critical</div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#ff8800;"></span>High</div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#ffcc00;"></span>Elevated</div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#00ff88;"></span>Monitored</div>
      <div class="wm-leg-row wm-leg-row--sub"><span class="wm-dot wm-dot--sq" style="background:rgba(255,34,0,0.32);"></span><span class="wm-leg-sub">Country shaded by conflict</span></div>
      <div class="wm-leg-sep"></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:linear-gradient(90deg,#0088ff,#ff8800,#ff2200);border-radius:2px;width:20px;height:7px;"></span>Live events</div>
      <div class="wm-leg-sep"></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#ff2200;"></span><span>Major conflict (200+)</span></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#ffaa00;"></span><span>Medium (50–199)</span></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#00cc44;"></span><span>Minor (&lt;50)</span></div>
      {#if polymarketThreats.length > 0}
        <div class="wm-leg-row"><span class="wm-dot" style="background:none;border:1px solid #f59e0b;transform:rotate(45deg);border-radius:1px;width:7px;height:7px;flex-shrink:0;"></span><span style="color:#f59e0b;">Market signals</span></div>
      {/if}
      {#if threatsUpdatedAt}
        <div class="wm-leg-sep"></div>
        <div class="wm-leg-ts">Updated {threatsUpdatedAt}</div>
      {/if}
      {/if}
    </button>
  </div>

  {#if majorEvents.length > 0}
  <div class="wm-stories" aria-label="Major developing stories">
    <div class="wm-ticker-label">
      <span class="wm-stories-title">BREAKING</span>
      <span class="wm-stories-badge">LIVE</span>
    </div>
    <div class="wm-ticker-track" aria-live="polite">
      <div class="wm-ticker-reel">
        {#each [...majorEvents, ...majorEvents] as ev, i}
          <a href={ev.link} target="_blank" rel="noopener noreferrer" class="wm-story" aria-label="{ev.title}" aria-hidden={i >= majorEvents.length ? 'true' : undefined}>
            <span class="wm-story-dot" style="background:{EVENT_COLORS[ev.level] ?? '#888'};box-shadow:0 0 5px {EVENT_COLORS[ev.level] ?? '#888'};"></span>
            <span class="wm-story-loc">{ev.location}</span>
            <span class="wm-story-title">{ev.title}</span>
            <span class="wm-story-age">{ago(ev.pubDate)}</span>
            <span class="wm-story-sep" aria-hidden="true">◆</span>
          </a>
        {/each}
      </div>
    </div>
  </div>
  {/if}
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
    height: calc(100vh - 300px);
    min-height: 460px;
    background: #0d1b2a;
    border-radius: 10px 10px 0 0;
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

  :global(.wm-pulse) { animation: wm-pulse 2.2s ease-in-out infinite; }
  @keyframes wm-pulse {
    0%, 100% { opacity: .25; }
    50%       { opacity: .65; }
  }
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

  /* ── MAJOR STORIES TICKER ───────────────────────────────── */
  .wm-stories {
    --ticker-duration: 40s;
    background: #0a1420;
    border: 1px solid rgba(0,200,255,0.18);
    border-top: none;
    border-radius: 0 0 10px 10px;
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
      height: calc(100svh - 230px);
      min-height: 300px;
      max-height: 700px;
      border-radius: 10px 10px 0 0;
    }
    .wm-story-title { max-width: 200px; }
  }
</style>
