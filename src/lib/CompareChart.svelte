<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';

  export let btc:   { t: number; p: number }[] = [];
  export let sp500: { t: number; p: number }[] = [];
  export let gold:  { t: number; p: number }[] = [];
  export let range: '1D' | '1W' | '1Y' | '5Y' = '5Y';

  // ── Internal state ───────────────────────────────────────────
  let scaleMode: 'linear' | 'log' = 'log';
  let visible = { btc: true, sp500: true, gold: true };

  type SeriesKey = 'btc' | 'sp500' | 'gold';

  const SERIES_CFG: { key: SeriesKey; label: string; color: string; strokeWidth: number }[] = [
    { key: 'btc',   label: 'BTC',   color: '#f7931a', strokeWidth: 2.5 },
    { key: 'sp500', label: 'S&P',   color: '#888',    strokeWidth: 1.8 },
    { key: 'gold',  label: 'Gold',  color: '#c9a84c', strokeWidth: 1.8 },
  ];

  // ── Normalise to 100 at first data point ────────────────────
  function normalize(pts: { t: number; p: number }[]): { t: number; v: number }[] {
    if (!pts.length) return [];
    const base = pts[0].p;
    if (!base) return [];
    return pts.map(({ t, p }) => ({ t, v: (p / base) * 100 }));
  }

  $: normBtc   = normalize(btc);
  $: normSp500 = normalize(sp500);
  $: normGold  = normalize(gold);

  $: hasData = normBtc.length > 0 || normSp500.length > 0 || normGold.length > 0;

  // ── Performance badges ───────────────────────────────────────
  function lastValue(pts: { t: number; v: number }[]): number | null {
    return pts.length ? pts[pts.length - 1].v : null;
  }
  $: btcReturn   = lastValue(normBtc)   !== null ? lastValue(normBtc)!   - 100 : null;
  $: sp500Return = lastValue(normSp500) !== null ? lastValue(normSp500)! - 100 : null;
  $: goldReturn  = lastValue(normGold)  !== null ? lastValue(normGold)!  - 100 : null;

  function fmtReturn(v: number | null): string {
    if (v === null) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function returnColor(v: number | null): string {
    if (v === null || v === 0) return 'rgba(255,255,255,0.55)';
    return v > 0 ? '#22c55e' : '#ef4444';
  }

  // ── Tooltip state ────────────────────────────────────────────
  let tooltip: {
    x: number; y: number; visible: boolean;
    date: string;
    btc: number | null; sp500: number | null; gold: number | null;
    btcRet: number | null; sp500Ret: number | null; goldRet: number | null;
  } = { x: 0, y: 0, visible: false, date: '', btc: null, sp500: null, gold: null, btcRet: null, sp500Ret: null, goldRet: null };

  // ── D3 chart ─────────────────────────────────────────────────
  let svgEl: SVGSVGElement;
  let containerEl: HTMLDivElement;
  let resizeObserver: ResizeObserver | undefined;
  let w = 600, h = 200;
  const margin = { top: 14, right: 16, bottom: 30, left: 46 };

  function fmtDate(t: number): string {
    const d = new Date(t);
    if (range === '1D') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (range === '1Y' || range === '5Y') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function draw() {
    if (!svgEl || !containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    w = rect.width || 600;
    h = rect.height || 200;

    const iW = w - margin.left - margin.right;
    const iH = h - margin.top - margin.bottom;
    if (iW <= 0 || iH <= 0) return;

    // Collect all timestamps for x domain
    const allTimes = [
      ...(visible.btc   ? normBtc   : []),
      ...(visible.sp500 ? normSp500 : []),
      ...(visible.gold  ? normGold  : []),
    ].map(d => d.t);

    const allValues = [
      ...(visible.btc   ? normBtc   : []),
      ...(visible.sp500 ? normSp500 : []),
      ...(visible.gold  ? normGold  : []),
    ].map(d => d.v);

    if (!allTimes.length || !allValues.length) return;

    const xDomain: [Date, Date] = [new Date(d3.min(allTimes)!), new Date(d3.max(allTimes)!)];
    const yMin = d3.min(allValues)!;
    const yMax = d3.max(allValues)!;
    const yPad = (yMax - yMin) * 0.06 || 1;

    const xScale = d3.scaleTime().domain(xDomain).range([0, iW]);

    // For log scale: use a clean domain starting at a safe minimum (> 0)
    const logYMin = Math.max(1, yMin * 0.9);
    const logYMax = yMax * 1.1;
    const yScale = scaleMode === 'log'
      ? d3.scaleLog().domain([logYMin, logYMax]).range([iH, 0]).clamp(true)
      : d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([iH, 0]);

    // For log scale, use power-of-2 tick candidates centred around 100 (the baseline)
    const LOG_TICK_CANDIDATES = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const yTickValues = scaleMode === 'log'
      ? LOG_TICK_CANDIDATES.filter(v => v >= logYMin && v <= logYMax)
      : null;

    // Build SVG structure
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Gridlines — horizontal (aligned with Y tick positions)
    const yTicks = yTickValues ?? yScale.ticks(5);
    g.append('g').attr('class', 'grid-h')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0).attr('x2', iW)
      .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
      .attr('stroke', 'rgba(255,255,255,0.06)').attr('stroke-width', 1);

    // Gridlines — vertical
    const xTicks = xScale.ticks(w >= 500 ? 6 : 4);
    g.append('g').attr('class', 'grid-v')
      .selectAll('line')
      .data(xTicks)
      .join('line')
      .attr('x1', d => xScale(d)).attr('x2', d => xScale(d))
      .attr('y1', 0).attr('y2', iH)
      .attr('stroke', 'rgba(255,255,255,0.04)').attr('stroke-width', 1);

    // 100 baseline — dashed reference line (start = breakeven)
    if (yScale(100) >= 0 && yScale(100) <= iH) {
      g.append('line')
        .attr('x1', 0).attr('x2', iW)
        .attr('y1', yScale(100)).attr('y2', yScale(100))
        .attr('stroke', 'rgba(255,255,255,0.18)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 4');
    }

    // Y axis — format log ticks as "×N" multiples of 100, or plain numbers
    const fmtYTick = (d: d3.NumberValue): string => {
      const v = +d;
      if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
      return `${v.toFixed(0)}`;
    };

    const yAxisBuilder = d3.axisLeft(yScale).tickSize(0).tickFormat(fmtYTick);
    if (yTickValues) yAxisBuilder.tickValues(yTickValues);
    else yAxisBuilder.ticks(5);

    g.append('g').attr('class', 'y-axis')
      .call(yAxisBuilder)
      .call(ax => ax.select('.domain').remove())
      .call(ax => ax.selectAll('text')
        .attr('fill', 'rgba(255,255,255,0.35)')
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('x', -4)
      );

    // Y axis label
    g.append('text')
      .attr('transform', `rotate(-90)`)
      .attr('x', -iH / 2)
      .attr('y', -margin.left + 10)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.22)')
      .attr('font-size', '8px')
      .attr('font-family', 'monospace')
      .text('Indexed (100 = start)');

    // X axis labels
    g.append('g').attr('class', 'x-axis')
      .attr('transform', `translate(0,${iH})`)
      .call(
        d3.axisBottom(xScale)
          .ticks(w >= 500 ? 6 : 4)
          .tickSize(0)
          .tickFormat(d => fmtDate((d as Date).getTime()))
      )
      .call(ax => ax.select('.domain').remove())
      .call(ax => ax.selectAll('text')
        .attr('fill', 'rgba(255,255,255,0.35)')
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('dy', '1.2em')
      );

    // Line generator (monotone for smooth curves)
    const lineGen = d3.line<{ t: number; v: number }>()
      .x(d => xScale(new Date(d.t)))
      .y(d => yScale(d.v))
      .curve(d3.curveMonotoneX)
      .defined(d => isFinite(d.v) && d.v > 0);

    // Draw each series
    for (const cfg of SERIES_CFG) {
      if (!visible[cfg.key]) continue;
      const data = cfg.key === 'btc' ? normBtc : cfg.key === 'sp500' ? normSp500 : normGold;
      if (!data.length) continue;
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', cfg.color)
        .attr('stroke-width', cfg.strokeWidth)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('d', lineGen);
    }

    // Invisible hover overlay
    const bisectTime = d3.bisector((d: { t: number; v: number }) => d.t).left;

    g.append('rect')
      .attr('width', iW).attr('height', iH)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const hoverTime = xScale.invert(mx).getTime();

        const getVal = (pts: { t: number; v: number }[]) => {
          if (!pts.length) return null;
          const idx = Math.max(0, Math.min(pts.length - 1, bisectTime(pts, hoverTime, 1) - 1));
          return pts[idx]?.v ?? null;
        };

        const bv   = visible.btc   ? getVal(normBtc)   : null;
        const sv   = visible.sp500 ? getVal(normSp500) : null;
        const gv   = visible.gold  ? getVal(normGold)  : null;

        // Find closest timestamp for date display
        const refPts = normBtc.length ? normBtc : normSp500.length ? normSp500 : normGold;
        const idx = Math.max(0, Math.min(refPts.length - 1, bisectTime(refPts, hoverTime, 1) - 1));
        const dateTs = refPts[idx]?.t ?? hoverTime;

        // Position tooltip
        const svgRect = svgEl.getBoundingClientRect();
        const absX = event.clientX - svgRect.left;
        const absY = event.clientY - svgRect.top;
        const tipW = 160;
        const tipX = absX + tipW + 12 > w ? absX - tipW - 8 : absX + 12;

        tooltip = {
          visible: true,
          x: tipX,
          y: Math.max(0, absY - 20),
          date: new Date(dateTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          btc: bv, sp500: sv, gold: gv,
          btcRet: bv !== null ? bv - 100 : null,
          sp500Ret: sv !== null ? sv - 100 : null,
          goldRet: gv !== null ? gv - 100 : null,
        };
      })
      .on('mouseleave', () => { tooltip = { ...tooltip, visible: false }; });
  }

  function redraw() {
    // Small tick to ensure the DOM is settled before measuring
    requestAnimationFrame(draw);
  }

  onMount(() => {
    resizeObserver = new ResizeObserver(redraw);
    resizeObserver.observe(containerEl);
    redraw();
  });

  onDestroy(() => resizeObserver?.disconnect());

  // Redraw when data or visibility changes
  $: if (svgEl && (normBtc || normSp500 || normGold || visible || scaleMode)) redraw();
</script>

<!-- ── Performance badges ────────────────────────────────────── -->
<div class="cc-badges" role="status" aria-label="Performance summary">
  {#each SERIES_CFG as cfg}
    {@const ret = cfg.key === 'btc' ? btcReturn : cfg.key === 'sp500' ? sp500Return : goldReturn}
    <span
      class="cc-badge"
      style="--c:{cfg.color};--rc:{returnColor(ret)}"
      title="{cfg.label} indexed return since chart start"
    >
      <span class="cc-badge-dot" style="background:{cfg.color};"></span>
      {cfg.label}
      <span class="cc-badge-ret" style="color:{returnColor(ret)}">{fmtReturn(ret)}</span>
    </span>
  {/each}
</div>

<!-- ── Legend ───────────────────────────────────────────────── -->
<div class="cc-legend" role="group" aria-label="Toggle series visibility">
  {#each SERIES_CFG as cfg}
    <button
      class="cc-leg-btn"
      class:cc-leg-btn--off={!visible[cfg.key]}
      on:click={() => { visible = { ...visible, [cfg.key]: !visible[cfg.key] }; }}
      aria-pressed={visible[cfg.key]}
      aria-label="Toggle {cfg.label}"
      title="Toggle {cfg.label}"
    >
      <span class="cc-leg-line" style="background:{cfg.color};opacity:{visible[cfg.key]?1:0.28};width:{cfg.strokeWidth*4}px;"></span>
      <span class="cc-leg-label" style="color:{visible[cfg.key]?cfg.color:'rgba(255,255,255,0.3)'};">{cfg.label}</span>
    </button>
  {/each}

  <button
    class="cc-scale-btn"
    on:click={() => { scaleMode = scaleMode === 'linear' ? 'log' : 'linear'; }}
    title="Toggle linear/log scale"
    aria-label="Scale: {scaleMode}"
  >
    {scaleMode === 'linear' ? 'LOG' : 'LIN'}
  </button>
</div>

<!-- ── Chart ────────────────────────────────────────────────── -->
<div class="cc-wrap" bind:this={containerEl}>
  {#if !hasData}
    <p class="cc-empty">Chart data unavailable — please try again later.</p>
  {/if}
  <svg bind:this={svgEl} aria-label="Multi-asset indexed performance chart"></svg>

  <!-- Tooltip -->
  {#if tooltip.visible}
    <div
      class="cc-tooltip"
      style="left:{tooltip.x}px;top:{tooltip.y}px;"
      role="tooltip"
      aria-live="polite"
    >
      <p class="cc-tt-date">{tooltip.date}</p>
      {#each SERIES_CFG as cfg}
        {@const val = cfg.key === 'btc' ? tooltip.btc : cfg.key === 'sp500' ? tooltip.sp500 : tooltip.gold}
        {@const ret = cfg.key === 'btc' ? tooltip.btcRet : cfg.key === 'sp500' ? tooltip.sp500Ret : tooltip.goldRet}
        {#if val !== null && visible[cfg.key]}
          <div class="cc-tt-row">
            <span class="cc-tt-dot" style="background:{cfg.color};"></span>
            <span class="cc-tt-label">{cfg.label}</span>
            <span class="cc-tt-val">{val.toFixed(1)}</span>
            <span class="cc-tt-ret" style="color:{returnColor(ret)}">{fmtReturn(ret)}</span>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  /* ── Badges ─────────────────────────────────────────────── */
  .cc-badges {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .cc-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    font-size: .6rem;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 3px;
    color: rgba(255,255,255,.7);
  }
  .cc-badge-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .cc-badge-ret {
    font-weight: 800;
    letter-spacing: .02em;
  }

  /* ── Legend ─────────────────────────────────────────────── */
  .cc-legend {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .cc-leg-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    font-size: .6rem;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 3px;
    cursor: pointer;
    transition: border-color .2s, opacity .2s;
    font-family: inherit;
    color: rgba(255,255,255,.6);
  }
  .cc-leg-btn:hover { border-color: rgba(255,255,255,.2); }
  .cc-leg-btn:focus-visible { outline: 2px solid rgba(247,147,26,.6); outline-offset: 2px; }
  .cc-leg-btn--off { opacity: .45; }
  .cc-leg-line {
    display: inline-block;
    height: 2px;
    border-radius: 2px;
    flex-shrink: 0;
    transition: opacity .2s;
  }
  .cc-leg-label { font-size: .6rem; font-weight: 700; letter-spacing: .05em; }
  .cc-scale-btn {
    margin-left: auto;
    padding: 3px 8px;
    font-size: .58rem;
    font-weight: 700;
    letter-spacing: .07em;
    text-transform: uppercase;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 3px;
    cursor: pointer;
    color: rgba(255,255,255,.45);
    font-family: inherit;
    transition: background .2s, color .2s;
  }
  .cc-scale-btn:hover { background: rgba(255,255,255,.08); color: rgba(255,255,255,.75); }
  .cc-scale-btn:focus-visible { outline: 2px solid rgba(247,147,26,.6); outline-offset: 2px; }

  /* ── Chart wrapper ──────────────────────────────────────── */
  .cc-wrap {
    position: relative;
    width: 100%;
    height: 160px;
  }
  .cc-wrap svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .cc-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: .66rem;
    color: rgba(255,255,255,.35);
    pointer-events: none;
  }

  /* ── Tooltip ────────────────────────────────────────────── */
  .cc-tooltip {
    position: absolute;
    pointer-events: none;
    background: rgba(15,15,15,.92);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 6px;
    padding: 8px 10px;
    min-width: 148px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 4px 16px rgba(0,0,0,.5);
    z-index: 10;
  }
  .cc-tt-date {
    font-size: .62rem;
    color: rgba(255,255,255,.55);
    font-weight: 600;
    margin: 0 0 6px;
    letter-spacing: .04em;
  }
  .cc-tt-row {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 4px;
    font-size: .62rem;
  }
  .cc-tt-row:last-child { margin-bottom: 0; }
  .cc-tt-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .cc-tt-label {
    color: rgba(255,255,255,.55);
    flex: 1;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .cc-tt-val {
    color: rgba(255,255,255,.85);
    font-weight: 700;
    font-family: monospace;
  }
  .cc-tt-ret {
    font-weight: 700;
    font-family: monospace;
    min-width: 44px;
    text-align: right;
  }
</style>
