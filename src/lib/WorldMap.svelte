<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Threat } from '$lib/settings';
  import type { ThreatEvent } from '../routes/api/events/+server';
  import { settings } from '$lib/store';

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

  const CONFLICT_COUNTRY_FILL = 'rgba(255,68,68,0.28)';

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

  /** Fetch static threat hotspots, honouring the user's disabled/custom settings */
  async function fetchThreats(): Promise<{ threats: Threat[]; conflictCountryIds: string[]; updatedAt: string }> {
    const threatSettings = $settings.threats;
    const params = new URLSearchParams();
    if (threatSettings.disabledIds.length > 0) {
      params.set('disabled', JSON.stringify(threatSettings.disabledIds));
    }
    if (threatSettings.customThreats.length > 0) {
      params.set('custom', JSON.stringify(threatSettings.customThreats));
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`/api/threats${query}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** Fetch live RSS-sourced events */
  async function fetchEvents(): Promise<{ events: ThreatEvent[]; updatedAt: string }> {
    const res = await fetch('/api/events');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function initMap() {
    mapLoading = true;
    mapError   = '';

    try {
      const [[d3, topojson], threatData, eventData] = await Promise.all([
        Promise.all([import('d3'), import('topojson-client')]),
        fetchThreats(),
        fetchEvents(),
      ]);
      d3Module = d3;

      const { threats, conflictCountryIds, updatedAt } = threatData;
      const conflictIds = new Set(conflictCountryIds);
      threatsUpdatedAt = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

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

      // Countries
      mapGroup.selectAll('path.wm-country')
        .data(countries.features)
        .enter().append('path')
        .attr('class', 'wm-country')
        .attr('d', path as unknown as string)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .attr('fill', (d: any) => conflictIds.has(String(d.id)) ? CONFLICT_COUNTRY_FILL : '#1e3248')
        .attr('stroke', 'none');

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

      // ── Static threat markers ───────────────────────────────────
      for (const h of threats) {
        const pos = projection([h.lon, h.lat]);
        if (!pos) continue;
        const [x, y] = pos;
        const col = THREAT_COLORS[h.level] ?? '#aaa';

        // pulse ring
        mapGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', 7)
          .attr('fill', col).attr('fill-opacity', 0.18).attr('class', 'wm-pulse')
          .attr('stroke', col).attr('stroke-width', 0.8).attr('stroke-opacity', 0.5);
        // inner dot
        mapGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', 3.5)
          .attr('fill', col);
        // label
        mapGroup.append('text')
          .attr('x', x + 6).attr('y', y + 4)
          .attr('fill', col).attr('font-size', '7.5px').attr('font-family', 'monospace')
          .attr('pointer-events', 'none')
          .text(h.name);
        // hit area
        mapGroup.append('circle').attr('cx', x).attr('cy', y).attr('r', 12)
          .attr('fill', 'transparent').attr('class', 'wm-hit')
          .on('mouseenter', (e: MouseEvent) => showTip(e, h.desc, col))
          .on('mousemove', moveTip)
          .on('mouseleave', hideTip);
      }

      mapLoading = false;
    } catch (err) {
      console.error('WorldMap init failed', err);
      mapError = 'Failed to load world map data.';
      mapLoading = false;
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

  onMount(() => { initMap(); });
  onDestroy(() => { /* cleanup handled by DOM removal */ });

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

    <div class="wm-legend">
      <div class="wm-leg-title">THREAT</div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#ff4444;"></span>Critical</div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#ff8800;"></span>High</div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#ffcc00;"></span>Elevated</div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:#00ff88;"></span>Monitored</div>
      <div class="wm-leg-sep"></div>
      <div class="wm-leg-row"><span class="wm-dot" style="background:linear-gradient(90deg,#0088ff,#ff8800,#ff2200);border-radius:2px;width:20px;height:7px;"></span>Live events</div>
      {#if threatsUpdatedAt}
        <div class="wm-leg-sep"></div>
        <div class="wm-leg-ts">Updated {threatsUpdatedAt}</div>
      {/if}
    </div>
  </div>

  {#if majorEvents.length > 0}
  <div class="wm-stories" aria-label="Major developing stories">
    <div class="wm-stories-head">
      <span class="wm-stories-title">MAJOR STORIES</span>
      <span class="wm-stories-badge">LIVE</span>
    </div>
    <div class="wm-stories-list">
      {#each majorEvents as ev}
        <a href={ev.link} target="_blank" rel="noopener noreferrer" class="wm-story" aria-label="{ev.title}">
          <span class="wm-story-dot" style="background:{EVENT_COLORS[ev.level] ?? '#888'};box-shadow:0 0 6px {EVENT_COLORS[ev.level] ?? '#888'};"></span>
          <div class="wm-story-body">
            <span class="wm-story-loc">{ev.location}</span>
            <span class="wm-story-title">{ev.title}</span>
          </div>
          <span class="wm-story-age">{ago(ev.pubDate)}</span>
        </a>
      {/each}
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
  }
  .wm-leg-title { font-size: .52rem; color: var(--t3); letter-spacing: .08em; margin-bottom: 2px; }
  .wm-leg-row { display: flex; align-items: center; gap: 5px; font-size: .56rem; color: #8ab; font-family: monospace; }
  .wm-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .wm-leg-sep { height: 1px; background: rgba(0,200,255,0.15); margin: 3px 0; }
  .wm-leg-ts { font-size: .48rem; color: var(--t3); font-family: monospace; }

  :global(.wm-pulse) { animation: wm-pulse 2.2s ease-in-out infinite; }
  @keyframes wm-pulse {
    0%, 100% { opacity: .25; }
    50%       { opacity: .65; }
  }
  :global(.wm-hit) { cursor: pointer; }

  /* ── MAJOR STORIES PANEL ────────────────────────────────── */
  .wm-stories {
    background: #0a1420;
    border: 1px solid rgba(0,200,255,0.18);
    border-top: none;
    border-radius: 0 0 10px 10px;
    padding: 10px 14px 12px;
  }
  .wm-stories-head {
    display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  }
  .wm-stories-title {
    font-size: .5rem; font-weight: 700; letter-spacing: .12em; color: rgba(0,200,255,0.6);
    font-family: monospace;
  }
  .wm-stories-badge {
    font-size: .48rem; font-weight: 700; letter-spacing: .1em;
    padding: 1px 6px; border-radius: 3px;
    border: 1px solid rgba(239,68,68,.4); background: rgba(239,68,68,.12); color: #f87171;
    animation: wm-badge-blink 2.2s ease-in-out infinite;
  }
  @keyframes wm-badge-blink { 0%,100%{opacity:1;} 50%{opacity:.5;} }

  .wm-stories-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }
  .wm-story {
    display: flex; align-items: flex-start; gap: 7px;
    padding: 7px 9px; border-radius: 6px;
    background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.06);
    text-decoration: none; transition: background .2s, border-color .2s;
    min-width: 0;
  }
  .wm-story:hover { background: rgba(0,200,255,.06); border-color: rgba(0,200,255,.2); }
  .wm-story-dot {
    width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 3px;
  }
  .wm-story-body {
    display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;
  }
  .wm-story-loc {
    font-size: .52rem; font-weight: 700; text-transform: uppercase; letter-spacing: .07em;
    color: rgba(0,200,255,.7); font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .wm-story-title {
    font-size: .62rem; color: #b8c8d8; line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .wm-story-age {
    font-size: .5rem; color: rgba(255,255,255,.3); font-family: monospace;
    flex-shrink: 0; margin-top: 2px; white-space: nowrap;
  }

  @media (max-width: 768px) {
    .wm-wrap { height: 340px; min-height: 340px; border-radius: 10px 10px 0 0; }
    .wm-stories-list { grid-template-columns: 1fr; }
  }
</style>
