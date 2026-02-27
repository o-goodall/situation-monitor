<script lang="ts">
  import { onMount, afterUpdate, onDestroy } from 'svelte';

  export let prices: { t: number; p: number }[] = [];
  export let height = 110;
  export let range: string = '1d';
  export let formatY: ((v: number) => string) | undefined = undefined;
  export let overlays: { prices: { t: number; p: number }[]; color: string; label?: string }[] = [];
  export let fillParent = false; // when true the canvas fills its CSS container height
  export let lineColor: string | null = null; // override auto green/red line color; must be #RRGGBB format

  let canvas: HTMLCanvasElement;

  /** Cached draw parameters — set by draw(), used by hover handlers */
  let _dp: {
    W: number; H: number;
    PAD_L: number; PAD_R: number; PAD_T: number; PAD_B: number;
    dW: number; dH: number; min: number; rng: number; lineColor: string;
  } | null = null;

  /** Hover overlay state */
  let hovX = 0;
  let hovY = 0;
  let hovVal = '';
  let hovDate = '';
  let hovLineC = '#22c55e';
  let hovVisible = false;

  function fmtLabel(ts: number): string {
    const d = new Date(ts);
    if (range === '1d') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (range === '5y' || range === 'max' || range === '1y') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function draw() {
    if (!canvas) return;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;
    if (prices.length < 2) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const ps = prices.map(({ p }) => p);

    // Compute Y range across main series + all overlays
    const allValues = [...ps, ...overlays.flatMap(o => o.prices.map(d => d.p))];
    const minRaw = Math.min(...allValues);
    const maxRaw = Math.max(...allValues);
    const padding = (maxRaw - minRaw) * 0.05 || 1;
    const min = minRaw - padding;
    const max = maxRaw + padding;
    const rng = max - min;

    const isUp = ps[ps.length - 1] >= ps[0];
    const autoLineColor = isUp ? '#22c55e' : '#ef4444';
    const resolvedLineColor = lineColor ?? autoLineColor;
    const autoFillBase = isUp ? 'rgba(34,197,94,' : 'rgba(239,68,68,';
    // If lineColor overridden, derive fill from it (expects #RRGGBB format)
    const resolvedFillBase = lineColor ? lineColor.replace(/^#/, '') : null;
    const fillBase = resolvedFillBase && resolvedFillBase.length === 6
      ? `rgba(${parseInt(resolvedFillBase.slice(0,2),16)},${parseInt(resolvedFillBase.slice(2,4),16)},${parseInt(resolvedFillBase.slice(4,6),16)},`
      : autoFillBase;

    const PAD_L = formatY ? 58 : 48, PAD_R = 10, PAD_T = 10, PAD_B = 22;
    const dW = W - PAD_L - PAD_R;
    const dH = H - PAD_T - PAD_B;

    const toX = (i: number, len: number) => PAD_L + (i / (len - 1)) * dW;
    const toY = (p: number) => PAD_T + (1 - (p - min) / rng) * dH;

    // Time-based X mapping used for overlays so timestamps align with BTC series
    const tMin = prices[0].t;
    const tMax = prices[prices.length - 1].t;
    const tRng = tMax - tMin || 1;
    const toXt = (t: number) => PAD_L + Math.max(0, Math.min(1, (t - tMin) / tRng)) * dW;

    // Adaptive X-axis tick count based on range and chart width
    const xCount = range === '1d' ? (W >= 400 ? 5 : 4) : (W >= 400 ? 7 : 5);

    // Subtle horizontal grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const y = PAD_T + frac * dH;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(W - PAD_R, y);
      ctx.stroke();
    }

    // Subtle vertical grid lines at X tick positions (skip first and last)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i < xCount - 1; i++) {
      const frac = i / (xCount - 1);
      const x = PAD_L + frac * dW;
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, PAD_T + dH);
      ctx.stroke();
    }

    // Zero line when overlays are active (% comparison mode)
    if (overlays.length > 0 && min < 0 && max > 0) {
      const zy = toY(0);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_L, zy);
      ctx.lineTo(W - PAD_R, zy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Y-axis price labels — scale font down on narrow charts (below MIN_LABEL_WIDTH px)
    const MIN_LABEL_WIDTH = 200;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `${9 * Math.min(1, W / MIN_LABEL_WIDTH)}px monospace`;
    ctx.textAlign = 'right';
    const defaultFormatter = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(0)}`;
    const fmtPrice = formatY ?? defaultFormatter;
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const v = maxRaw - frac * (maxRaw - minRaw);
      const y = PAD_T + frac * dH + (frac === 0 ? 5 : frac === 1 ? 4 : 4);
      ctx.fillText(fmtPrice(v), PAD_L - 4, y);
    }

    // X-axis time labels — adaptive count, edge-aligned to prevent overflow
    ctx.font = `${9 * Math.min(1, W / MIN_LABEL_WIDTH)}px monospace`;
    for (let i = 0; i < xCount; i++) {
      const frac = i / (xCount - 1);
      const dataIdx = Math.round(frac * (prices.length - 1));
      const x = PAD_L + frac * dW;
      const isLast = i === xCount - 1;
      const label = isLast ? 'Now' : fmtLabel(prices[dataIdx].t);
      ctx.textAlign = i === 0 ? 'left' : isLast ? 'right' : 'center';
      ctx.fillText(label, x, H - 5);
    }
    ctx.textAlign = 'center';

    // Gradient fill under main line
    ctx.beginPath();
    prices.forEach(({ p }, i) => {
      const x = toX(i, prices.length), y = toY(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(toX(prices.length - 1, prices.length), PAD_T + dH);
    ctx.lineTo(PAD_L, PAD_T + dH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + dH);
    grad.addColorStop(0, fillBase + (overlays.length > 0 ? '0.12)' : '0.22)'));
    grad.addColorStop(1, fillBase + '0.01)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Main price line
    ctx.beginPath();
    prices.forEach(({ p }, i) => {
      const x = toX(i, prices.length), y = toY(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = resolvedLineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowBlur = 3;
    ctx.shadowColor = resolvedLineColor;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Overlay series lines (no fill) — use time-based X so timestamps align with BTC
    for (const overlay of overlays) {
      if (overlay.prices.length < 2) continue;
      ctx.beginPath();
      let moved = false;
      overlay.prices.forEach(({ t, p }) => {
        const x = toXt(t), y = toY(p);
        if (!moved) { ctx.moveTo(x, y); moved = true; }
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = overlay.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowBlur = 2;
      ctx.shadowColor = overlay.color;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Dot at latest price (main series — drawn on top)
    const lx2 = toX(prices.length - 1, prices.length);
    const ly2 = toY(ps[ps.length - 1]);
    ctx.beginPath();
    ctx.arc(lx2, ly2, 3, 0, Math.PI * 2);
    ctx.fillStyle = resolvedLineColor;
    ctx.shadowBlur = 4;
    ctx.shadowColor = resolvedLineColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Capture draw params for hover overlay (CSS-pixel coordinate space)
    _dp = { W, H, PAD_L, PAD_R, PAD_T, PAD_B, dW, dH, min, rng, lineColor: resolvedLineColor };
  }

  let resizeObserver: ResizeObserver | undefined;

  /** Shared hover computation — called by both mouse and touch handlers */
  function computeHover(clientX: number, clientY: number) {
    if (!_dp || prices.length < 2) { hovVisible = false; return; }
    const rect = canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    if (cx < _dp.PAD_L || cx > _dp.W - _dp.PAD_R) { hovVisible = false; return; }
    const idx = Math.max(0, Math.min(prices.length - 1,
      Math.round(((cx - _dp.PAD_L) / _dp.dW) * (prices.length - 1))));
    hovX = _dp.PAD_L + (idx / (prices.length - 1)) * _dp.dW;
    hovY = _dp.PAD_T + (1 - (prices[idx].p - _dp.min) / _dp.rng) * _dp.dH;
    const defaultFmt = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(2)}K` : `$${v.toFixed(2)}`;
    hovVal = (formatY ?? defaultFmt)(prices[idx].p);
    hovDate = fmtLabel(prices[idx].t);
    hovLineC = _dp.lineColor;
    hovVisible = true;
  }

  function onHover(e: MouseEvent) { computeHover(e.clientX, e.clientY); }
  function onLeave() { hovVisible = false; }
  function onTouch(e: TouchEvent) {
    if (!e.touches.length) return;
    computeHover(e.touches[0].clientX, e.touches[0].clientY);
  }

  onMount(() => {
    draw();
    resizeObserver = new ResizeObserver(() => draw());
    resizeObserver.observe(canvas);
  });

  afterUpdate(() => draw());

  onDestroy(() => resizeObserver?.disconnect());
</script>

<div class="pc-wrap" style="height:{fillParent ? '100%' : height + 'px'}">
  <canvas
    bind:this={canvas}
    style="width:100%;height:100%;display:block;"
    aria-hidden="true"
    on:mousemove={onHover}
    on:mouseleave={onLeave}
    on:touchmove|passive={onTouch}
    on:touchend={onLeave}
  ></canvas>
  {#if hovVisible && _dp}
    <svg class="pc-overlay" aria-hidden="true">
      <line
        x1={hovX} y1={_dp.PAD_T} x2={hovX} y2={_dp.H - _dp.PAD_B}
        stroke="rgba(255,255,255,0.25)" stroke-width="1" stroke-dasharray="3 3"
      />
      <circle
        cx={hovX} cy={hovY} r="3.5"
        fill={hovLineC} stroke="rgba(0,0,0,0.35)" stroke-width="1.5"
      />
    </svg>
    <div
      class="pc-tooltip"
      style="left:{hovX}px;top:{hovY}px;transform:translate({hovX > _dp.W / 2 ? '-108%' : '8px'},-50%);"
    >
      <span class="pc-tt-date">{hovDate}</span>
      <span class="pc-tt-val">{hovVal}</span>
    </div>
  {/if}
</div>

<style>
  .pc-wrap {
    position: relative;
    display: block;
    width: 100%;
  }
  .pc-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .pc-tooltip {
    position: absolute;
    pointer-events: none;
    background: rgba(15,15,15,.92);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 5px;
    padding: 5px 8px;
    font-size: .62rem;
    white-space: nowrap;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 4px 12px rgba(0,0,0,.5);
    z-index: 10;
  }
  .pc-tt-date {
    display: block;
    color: rgba(255,255,255,.55);
    font-size: .56rem;
    margin-bottom: 2px;
    font-family: monospace;
  }
  .pc-tt-val {
    display: block;
    color: rgba(255,255,255,.9);
    font-weight: 700;
    font-family: monospace;
  }
</style>
