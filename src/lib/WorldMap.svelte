<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { NewsItem } from '$lib/store';

  export let newsItems: NewsItem[] = [];
  export let breakingLinks: Set<string> = new Set();

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
    { name: 'Ukraine', lat: 49.0, lon: 31.5, level: 'critical', desc: '⚔️ Russia–Ukraine War — Active conflict' },
    { name: 'Gaza', lat: 31.5, lon: 34.5, level: 'critical', desc: '⚔️ Gaza — Israel–Hamas conflict' },
    { name: 'Sudan', lat: 15.5, lon: 30.0, level: 'high', desc: '⚔️ Sudan — Civil war, humanitarian crisis' },
    { name: 'Myanmar', lat: 19.7, lon: 96.1, level: 'high', desc: '⚔️ Myanmar — Civil war & junta resistance' },
    { name: 'Taiwan Strait', lat: 24.0, lon: 120.0, level: 'elevated', desc: '⚠️ Taiwan Strait — China military pressure' },
    { name: 'Iran', lat: 32.0, lon: 53.0, level: 'elevated', desc: '⚠️ Iran — Nuclear program & regional proxy conflict' },
    { name: 'North Korea', lat: 40.0, lon: 127.0, level: 'elevated', desc: '⚠️ North Korea — Nuclear & missile program' },
    { name: 'Yemen', lat: 15.3, lon: 44.2, level: 'high', desc: '⚔️ Yemen — Houthi conflict & Red Sea attacks' },
    { name: 'Sahel', lat: 14.0, lon: 0.0, level: 'high', desc: '⚔️ Sahel — Mali, Burkina Faso, Niger coups & insurgency' },
    { name: 'Ethiopia', lat: 9.1, lon: 40.5, level: 'high', desc: '⚔️ Ethiopia — Tigray & Amhara conflicts' },
    { name: 'Haiti', lat: 18.9, lon: -72.3, level: 'high', desc: '⚔️ Haiti — Gang violence & state collapse' },
    { name: 'South China Sea', lat: 12.0, lon: 114.0, level: 'elevated', desc: '⚠️ South China Sea — Territorial disputes' },
  ];

  // ── GEOGRAPHIC KEYWORD MAP ───────────────────────────────────
  // Maps news title patterns to approximate [lat, lon] coordinates
  const GEO_MAP: [RegExp, [number, number]][] = [
    [/ukraine|kyiv|zelensky|kherson|donbas|bakhmut/i, [49.0, 31.5]],
    [/russia|moscow|putin|kremlin|siberia/i, [55.7, 37.6]],
    [/israel|gaza|hamas|tel aviv|jerusalem|west bank|idf/i, [31.5, 34.5]],
    [/iran|tehran|irgc|khamenei|hezbollah/i, [35.7, 51.4]],
    [/china|beijing|xi jinping|shanghai|hong kong/i, [39.9, 116.4]],
    [/taiwan|taipei/i, [25.0, 121.5]],
    [/north korea|pyongyang|kim jong/i, [39.0, 125.7]],
    [/south korea|seoul/i, [37.6, 127.0]],
    [/japan|tokyo|abe/i, [35.7, 139.7]],
    [/india|modi|delhi|mumbai|new delhi/i, [28.6, 77.2]],
    [/pakistan|islamabad|karachi/i, [33.7, 73.0]],
    [/afghanistan|kabul|taliban/i, [34.5, 69.2]],
    [/myanmar|burma|rangoon|naypyidaw/i, [19.7, 96.1]],
    [/saudi|riyadh|mbs|aramco/i, [24.7, 46.7]],
    [/yemen|houthi|sanaa/i, [15.3, 44.2]],
    [/turkey|ankara|erdogan|istanbul/i, [39.9, 32.9]],
    [/syria|damascus/i, [33.5, 36.3]],
    [/iraq|baghdad/i, [33.3, 44.4]],
    [/lebanon|beirut/i, [33.9, 35.5]],
    [/egypt|cairo|al-sisi/i, [30.1, 31.2]],
    [/libya|tripoli/i, [32.9, 13.2]],
    [/sudan|khartoum/i, [15.5, 32.6]],
    [/ethiopia|addis|tigray/i, [9.0, 38.7]],
    [/nigeria|abuja|lagos|boko haram/i, [9.1, 7.5]],
    [/somalia|mogadishu|al-shabaab/i, [2.0, 45.3]],
    [/democratic republic.*congo|drc|kinshasa/i, [-4.3, 15.3]],
    [/south africa|johannesburg|cape town/i, [-26.2, 28.1]],
    [/kenya|nairobi/i, [-1.3, 36.8]],
    [/mali|bamako|sahel/i, [12.7, -8.0]],
    [/haiti|port.*prince/i, [18.5, -72.3]],
    [/venezuela|caracas|maduro/i, [10.5, -66.9]],
    [/colombia|bogota/i, [4.7, -74.1]],
    [/brazil|brasilia|lula/i, [-15.8, -47.9]],
    [/argentina|buenos aires|milei/i, [-34.6, -58.4]],
    [/mexico|mexico city/i, [19.4, -99.1]],
    [/usa|washington|white house|congress|trump|biden|pentagon/i, [38.9, -77.0]],
    [/uk|britain|london|westminster/i, [51.5, -0.1]],
    [/france|paris|macron/i, [48.9, 2.4]],
    [/germany|berlin/i, [52.5, 13.4]],
    [/eu|european union|brussels/i, [50.8, 4.4]],
    [/nato|alliance/i, [50.8, 4.4]],
    [/un|united nations|security council/i, [40.7, -74.0]],
    [/australia|canberra|sydney/i, [-35.3, 149.1]],
    [/greenland|nuuk/i, [64.2, -51.7]],
    [/arctic|north pole/i, [90.0, 0.0]],
    [/south sudan|juba/i, [4.9, 31.6]],
    [/central african/i, [4.4, 18.6]],
  ];

  // Named type for geo-located news event
  interface GeoEvent { lat: number; lon: number; title: string; source: string; pubDate: string; link: string }

  // Map news items to geo-coordinates
  function newsToGeoEvents(items: NewsItem[]): GeoEvent[] {
    const events: GeoEvent[] = [];
    for (const item of items) {
      const text = item.title + ' ' + (item.description ?? '');
      for (const [re, [lat, lon]] of GEO_MAP) {
        if (re.test(text)) {
          // slight jitter so overlapping events don't stack exactly
          const jLat = lat + (Math.random() - 0.5) * 1.5;
          const jLon = lon + (Math.random() - 0.5) * 1.5;
          events.push({ lat: jLat, lon: jLon, title: item.title, source: item.source, pubDate: item.pubDate, link: item.link });
          break;
        }
      }
    }
    return events;
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
        .scale(148)
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
        .attr('fill', '#061a14')
        .attr('stroke', 'none');

      // Countries
      mapGroup.selectAll('path.wm-country')
        .data(countries.features)
        .enter().append('path')
        .attr('class', 'wm-country')
        .attr('d', path as unknown as string)
        .attr('fill', '#0d2e22')
        .attr('stroke', 'none');

      // Country borders
      mapGroup.append('path')
        .datum(borders)
        .attr('d', path as unknown as string)
        .attr('fill', 'none')
        .attr('stroke', '#1a5040')
        .attr('stroke-width', 0.4);

      // Graticule
      const grat = d3.geoGraticule().step([30, 30]);
      mapGroup.append('path')
        .datum(grat)
        .attr('d', path as unknown as string)
        .attr('fill', 'none')
        .attr('stroke', '#132e26')
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

      // Live news events
      drawNewsEvents(newsItems);

      mapLoading = false;
    } catch (err) {
      console.error('WorldMap init failed', err);
      mapError = 'Failed to load world map data.';
      mapLoading = false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let newsLayer: any = null;

  function drawNewsEvents(items: NewsItem[]) {
    if (!mapGroup || !projection) return;
    if (newsLayer) newsLayer.remove();
    newsLayer = mapGroup.append('g').attr('id', 'wm-news');

    const events = newsToGeoEvents(items);
    for (const ev of events) {
      const pos = projection([ev.lon, ev.lat]);
      if (!pos) continue;
      const [x, y] = pos;
      const isBreaking = breakingLinks.has(ev.link);
      const col = isBreaking ? '#ffe033' : '#00ccff';

      if (isBreaking) {
        // Outer expanding ping ring for breaking news
        newsLayer.append('circle').attr('cx', x).attr('cy', y).attr('r', 10)
          .attr('fill', 'none').attr('stroke', col).attr('stroke-width', 1.2)
          .attr('stroke-opacity', 0.7).attr('class', 'wm-breaking-ring');
      }
      newsLayer.append('circle').attr('cx', x).attr('cy', y).attr('r', isBreaking ? 3.5 : 2.8)
        .attr('fill', col).attr('fill-opacity', isBreaking ? 1 : 0.7);
      newsLayer.append('circle').attr('cx', x).attr('cy', y).attr('r', 8)
        .attr('fill', 'transparent').attr('class', 'wm-hit')
        .on('mouseenter', (e: MouseEvent) => {
          const lines = isBreaking
            ? ['🔴 BREAKING', `📰 ${ev.source}`, timeAgo(ev.pubDate)]
            : [`📰 ${ev.source}`, timeAgo(ev.pubDate)];
          showTip(e, ev.title, col, lines);
        })
        .on('mousemove', moveTip)
        .on('mouseleave', hideTip);
    }
  }

  function timeAgo(d: string): string {
    try {
      const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
      return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
    } catch { return ''; }
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

  // Re-draw news layer when newsItems or breakingLinks prop changes
  $: if (mapGroup && projection && (newsItems || breakingLinks)) {
    drawNewsEvents(newsItems);
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
    <div class="wm-leg-sep"></div>
    <div class="wm-leg-row"><span class="wm-dot" style="background:#00ccff;"></span>Live news</div>
    {#if breakingLinks.size > 0}
    <div class="wm-leg-row wm-leg-breaking"><span class="wm-dot wm-dot--breaking" style="background:#ffe033;"></span>Breaking</div>
    {/if}
  </div>
</div>

<style>
  .wm-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 2 / 1;
    min-height: 300px;
    background: #061a14;
    border-radius: 10px;
    overflow: hidden;
  }
  .wm-svg { width: 100%; height: 100%; display: block; }

  .wm-state {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px; z-index: 5;
    background: #061a14;
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
    position: absolute; background: rgba(6,10,8,.95); border: 1px solid #1a5040;
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
    background: rgba(6,26,20,.9); border: 1px solid #1a5040; border-radius: 5px;
    color: #6b8f80; font-size: .9rem; cursor: pointer; transition: color .15s, border-color .15s;
  }
  .wm-zbtn:hover { color: #fff; border-color: #2a8060; }

  .wm-legend {
    position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column;
    gap: 3px; background: rgba(6,26,20,.88); padding: 6px 9px; border-radius: 6px;
    border: 1px solid #1a4030;
  }
  .wm-leg-title { font-size: .52rem; color: var(--t3); letter-spacing: .08em; margin-bottom: 2px; }
  .wm-leg-row { display: flex; align-items: center; gap: 5px; font-size: .56rem; color: #8ab; font-family: monospace; }
  .wm-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .wm-leg-sep { height: 1px; background: #1a4030; margin: 3px 0; }

  :global(.wm-pulse) { animation: wm-pulse 2.2s ease-in-out infinite; }
  @keyframes wm-pulse {
    0%, 100% { opacity: .25; }
    50%       { opacity: .65; }
  }
  :global(.wm-hit) { cursor: pointer; }

  :global(.wm-breaking-ring) { animation: wm-breaking 1.4s ease-out infinite; }
  @keyframes wm-breaking {
    0%   { r: 5;  opacity: .9; }
    100% { r: 18; opacity: 0; }
  }
  .wm-leg-breaking { animation: wm-leg-blink 1.2s step-start infinite; }
  @keyframes wm-leg-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  .wm-dot--breaking { animation: wm-dot-pulse 1.2s ease-in-out infinite; box-shadow: 0 0 4px #ffe033; }
  @keyframes wm-dot-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
</style>
