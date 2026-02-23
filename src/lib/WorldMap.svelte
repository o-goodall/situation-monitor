<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

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

  // ── THREAT LEVELS ────────────────────────────────────────────
  const THREAT_COLORS: Record<string, string> = {
    critical: '#ff4444',
    high:     '#ff8800',
    elevated: '#ffcc00',
    low:      '#00ff88',
    info:     '#00ccff',
  };

  // ── HARDCODED GLOBAL HOTSPOTS ────────────────────────────────
  const HOTSPOTS = [
    // ── ACTIVE CONFLICTS ────────────────────────────────────────
    { name: 'Ukraine', lat: 49.0, lon: 31.5, level: 'critical', desc: '⚔️ Russia–Ukraine War — Active conflict' },
    { name: 'Gaza', lat: 31.5, lon: 34.5, level: 'critical', desc: '⚔️ Gaza — Israel–Hamas conflict' },
    { name: 'Sudan', lat: 15.5, lon: 30.0, level: 'high', desc: '⚔️ Sudan — Civil war, humanitarian crisis' },
    { name: 'Myanmar', lat: 19.7, lon: 96.1, level: 'high', desc: '⚔️ Myanmar — Civil war & junta resistance' },
    { name: 'Taiwan Strait', lat: 24.0, lon: 120.0, level: 'elevated', desc: '⚠️ Taiwan Strait — China military pressure' },
    { name: 'Iran', lat: 32.0, lon: 53.0, level: 'high', desc: '⚔️ Iran — Nuclear program, regional proxy conflict & Israel strikes' },
    { name: 'North Korea', lat: 40.0, lon: 127.0, level: 'elevated', desc: '⚠️ North Korea — Nuclear & missile program' },
    { name: 'Yemen', lat: 15.3, lon: 44.2, level: 'high', desc: '⚔️ Yemen — Houthi conflict & Red Sea attacks' },
    { name: 'Sahel', lat: 14.0, lon: 0.0, level: 'high', desc: '⚔️ Sahel — Mali, Burkina Faso, Niger coups & insurgency' },
    { name: 'Ethiopia', lat: 9.1, lon: 40.5, level: 'elevated', desc: '⚠️ Ethiopia — Amhara conflict & ongoing instability' },
    { name: 'Haiti', lat: 18.9, lon: -72.3, level: 'high', desc: '⚔️ Haiti — Gang violence & state collapse' },
    { name: 'South China Sea', lat: 12.0, lon: 114.0, level: 'elevated', desc: '⚠️ South China Sea — Territorial disputes' },
    { name: 'Syria', lat: 34.8, lon: 38.5, level: 'elevated', desc: '⚠️ Syria — Post-Assad transition, HTS rule & fragile stability' },
    // ── MONETARY POLICY / CURRENCY DEBASEMENT ───────────────────
    { name: 'Fed / QE', lat: 38.9, lon: -77.0, level: 'elevated', desc: '💰 US Federal Reserve — Balance sheet expansion, QE risk & dollar debasement monitor' },
    { name: 'BoJ / QE', lat: 35.7, lon: 139.7, level: 'high', desc: '💰 Bank of Japan — Yield curve control, yen debasement & aggressive QE' },
    { name: 'ECB / QE', lat: 50.1, lon: 8.7, level: 'elevated', desc: '💰 ECB (Frankfurt) — Eurozone debt monetisation, APP/PEPP & balance sheet risk' },
    { name: 'BoE / QE', lat: 51.5, lon: -0.1, level: 'elevated', desc: '💰 Bank of England — UK gilt purchases, QE & sterling debasement monitor' },
    // ── SURVEILLANCE / DIGITAL CONTROL ──────────────────────────
    { name: 'Digital Control', lat: 39.9, lon: 116.4, level: 'high', desc: '👁️ China — Social credit system, internet censorship, app bans & mass surveillance' },
    { name: 'Online Safety', lat: 51.52, lon: -0.08, level: 'elevated', desc: '👁️ UK — Online Safety Act, age verification mandates & surveillance expansion' },
    { name: 'Social Media Ban', lat: -35.3, lon: 149.1, level: 'elevated', desc: '👁️ Australia — Social media ban for under-16s, digital ID push & eSafety powers' },
    { name: 'Digital ID / DSA', lat: 50.85, lon: 4.35, level: 'elevated', desc: '👁️ EU — Digital Services Act, eID wallet & online speech regulation' },
  ];

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

  // ── MAIN INITIALISATION ──────────────────────────────────────
  async function initMap() {
    mapLoading = true;
    mapError   = '';
    try {
      const [d3, topojson] = await Promise.all([
        import('d3'),
        import('topojson-client'),
      ]);
      d3Module = d3;

      const svgEl = mapContainer?.querySelector('svg');
      if (!svgEl) return;

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

      // World atlas from CDN
      const world = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r => r.json());
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
        .attr('fill', '#1e3248')
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

      // Hotspots
      for (const h of HOTSPOTS) {
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
</script>

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
  </div>

  <div class="wm-legend">
    <div class="wm-leg-title">THREAT</div>
    <div class="wm-leg-row"><span class="wm-dot" style="background:#ff4444;"></span>Critical</div>
    <div class="wm-leg-row"><span class="wm-dot" style="background:#ff8800;"></span>High</div>
    <div class="wm-leg-row"><span class="wm-dot" style="background:#ffcc00;"></span>Elevated</div>
    <div class="wm-leg-row"><span class="wm-dot" style="background:#00ff88;"></span>Monitored</div>
  </div>
</div>

<style>
  .wm-wrap {
    position: relative;
    width: 100%;
    /* 260px = section top padding (48px) + section header (~80px) + tile padding (40px) + tile header (~60px) + footer gap (32px) */
    height: calc(100vh - 260px);
    min-height: 460px;
    background: #0d1b2a;
    border-radius: 10px;
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

  .wm-legend {
    position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column;
    gap: 3px; background: rgba(8,18,32,.88); padding: 6px 9px; border-radius: 6px;
    border: 1px solid rgba(0,200,255,0.18);
  }
  .wm-leg-title { font-size: .52rem; color: var(--t3); letter-spacing: .08em; margin-bottom: 2px; }
  .wm-leg-row { display: flex; align-items: center; gap: 5px; font-size: .56rem; color: #8ab; font-family: monospace; }
  .wm-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .wm-leg-sep { height: 1px; background: rgba(0,200,255,0.15); margin: 3px 0; }

  :global(.wm-pulse) { animation: wm-pulse 2.2s ease-in-out infinite; }
  @keyframes wm-pulse {
    0%, 100% { opacity: .25; }
    50%       { opacity: .65; }
  }
  :global(.wm-hit) { cursor: pointer; }

  @media (max-width: 768px) {
    .wm-wrap { height: 400px; min-height: 400px; }
  }
</style>
