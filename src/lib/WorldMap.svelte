<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Threat } from '$lib/settings';
  import type { ThreatEvent } from '../routes/api/events/+server';

  let mapContainer: HTMLDivElement;

  let mapLoading = true;
  let mapError = '';
  let threatsUpdatedAt = '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let leafletMap: any = null;

  const THREAT_COLORS: Record<string, string> = {
    critical: '#ff4444',
    high:     '#ff8800',
    elevated: '#ffcc00',
    low:      '#00ff88',
    info:     '#00ccff',
  };

  /** Fetch static threat hotspots */
  async function fetchThreats(): Promise<{ threats: Threat[]; updatedAt: string }> {
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

  async function initMap() {
    mapLoading = true;
    mapError   = '';

    try {
      // Dynamic imports — Leaflet is browser-only; load sequentially so that
      // window.L is set by Leaflet before leaflet.heat tries to access it as a global
      const L = await import('leaflet');
      await import('leaflet.heat');

      // Fetch both data sources in parallel
      const [threatData, eventData] = await Promise.all([
        fetchThreats(),
        fetchEvents(),
      ]);

      threatsUpdatedAt = threatData.updatedAt
        ? new Date(threatData.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

      // Destroy previous map instance if re-initialising
      if (leafletMap) {
        leafletMap.remove();
        leafletMap = null;
      }

      leafletMap = L.map(mapContainer, {
        center:            [20, 0],
        zoom:              2,
        minZoom:           2,
        maxZoom:           10,
        scrollWheelZoom:   false,
        zoomControl:       false,
        attributionControl: false,
      });

      // Dark tile layer — CartoDB Dark Matter (free, no API key)
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        {
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          subdomains:  'abcd',
          maxZoom:     19,
        }
      ).addTo(leafletMap);

      // ── Heatmap layer from live RSS events ─────────────────────
      const heatPoints: [number, number, number][] = eventData.events.map(e => [
        e.lat,
        e.lon,
        Math.min(1, e.score * 2),   // intensity 0–1
      ]);

      if (heatPoints.length > 0) {
        // leaflet.heat adds heatLayer to the global window.L, not to the ESM
        // module namespace — access it through the global after sequential load
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).L.heatLayer(heatPoints, {
          radius:    25,
          blur:      20,
          maxZoom:   10,
          gradient:  { 0.4: '#0088ff', 0.65: '#ff8800', 1.0: '#ff2200' },
        }).addTo(leafletMap);
      }

      // ── Static threat markers ───────────────────────────────────
      for (const h of threatData.threats) {
        const col = THREAT_COLORS[h.level] ?? '#aaa';

        const icon = L.divIcon({
          className: '',
          html: `<span style="
            display:block;width:10px;height:10px;border-radius:50%;
            background:${col};
            box-shadow:0 0 6px 2px ${col}88;
            animation:wm-pulse 2.2s ease-in-out infinite;
          "></span>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });

        L.marker([h.lat, h.lon], { icon })
          .bindTooltip(
            `<strong style="color:${col}">${h.name}</strong><br/><span style="font-size:.75em;opacity:.8">${h.desc}</span>`,
            { className: 'wm-leaflet-tip', direction: 'top', offset: [0, -6] }
          )
          .addTo(leafletMap);
      }

      mapLoading = false;
    } catch (err) {
      console.error('WorldMap init failed', err);
      mapError = 'Failed to load world map data.';
      mapLoading = false;
    }
  }

  function zoomIn()    { leafletMap?.zoomIn(); }
  function zoomOut()   { leafletMap?.zoomOut(); }
  function resetZoom() { leafletMap?.setView([20, 0], 2); }

  onMount(() => { initMap(); });
  onDestroy(() => { leafletMap?.remove(); leafletMap = null; });
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

<style>
  :global(.leaflet-container) {
    background: #0d1b2a !important;
    font-family: inherit;
  }
  :global(.wm-leaflet-tip) {
    background: rgba(8,18,32,.97) !important;
    border: 1px solid rgba(0,200,255,0.3) !important;
    border-radius: 6px !important;
    padding: 5px 8px !important;
    font-size: .65rem !important;
    color: #ddd !important;
    box-shadow: none !important;
  }
  :global(.wm-leaflet-tip::before) { display: none !important; }
  :global(.leaflet-tooltip-top::before) {
    border-top-color: rgba(0,200,255,0.3) !important;
  }

  .wm-wrap {
    position: relative;
    width: 100%;
    height: calc(100vh - 300px);
    min-height: 460px;
    background: #0d1b2a;
    border-radius: 10px;
    overflow: hidden;
  }

  .wm-state {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px; z-index: 500;
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

  .wm-zoom {
    position: absolute; bottom: 10px; right: 10px;
    display: flex; flex-direction: column; gap: 4px; z-index: 500;
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
    border: 1px solid rgba(0,200,255,0.18); z-index: 500;
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

  @media (max-width: 768px) {
    .wm-wrap { height: 400px; min-height: 400px; }
  }
</style>
