<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';

  export let prices: { t: number; p: number }[] = [];
  export let height = 110;
  export let range: string = '1d';
  export let formatY: ((v: number) => string) | undefined = undefined;
  export let overlays: { prices: { t: number; p: number }[]; color: string }[] = [];
  export let fillParent = false; // when true the canvas fills its CSS container height

  let canvas: HTMLCanvasElement;

  function fmtLabel(ts: number): string {
    const d = new Date(ts);
    if (range === '1d') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (range === '5y' || range === 'max') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
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
    const lineColor = isUp ? '#22c55e' : '#ef4444';
    const fillColor = isUp ? 'rgba(34,197,94,' : 'rgba(239,68,68,';

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

    // Subtle horizontal grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (const frac of [0, 0.5, 1]) {
      const y = PAD_T + frac * dH;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(W - PAD_R, y);
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
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${9 * Math.min(1, W / MIN_LABEL_WIDTH)}px monospace`;
    ctx.textAlign = 'right';
    const defaultFormatter = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(0)}`;
    const fmtPrice = formatY ?? defaultFormatter;
    ctx.fillText(fmtPrice(maxRaw), PAD_L - 4, PAD_T + 5);
    ctx.fillText(fmtPrice((maxRaw + minRaw) / 2), PAD_L - 4, PAD_T + dH / 2 + 4);
    ctx.fillText(fmtPrice(minRaw), PAD_L - 4, PAD_T + dH + 4);

    // X-axis time labels
    ctx.textAlign = 'center';
    ctx.fillText(fmtLabel(prices[0].t), PAD_L, H - 5);
    ctx.fillText(fmtLabel(prices[Math.floor(prices.length / 2)].t), PAD_L + dW / 2, H - 5);
    ctx.fillText('Now', W - PAD_R, H - 5);

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
    grad.addColorStop(0, fillColor + (overlays.length > 0 ? '0.12)' : '0.22)'));
    grad.addColorStop(1, fillColor + '0.01)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Main price line
    ctx.beginPath();
    prices.forEach(({ p }, i) => {
      const x = toX(i, prices.length), y = toY(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = overlays.length > 0 ? 2 : 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowBlur = 2;
    ctx.shadowColor = lineColor;
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
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowBlur = 2;
      ctx.shadowColor = overlay.color;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Dot at end of overlay line
      const last = overlay.prices[overlay.prices.length - 1];
      const ox = toXt(last.t);
      const oy = toY(last.p);
      ctx.beginPath();
      ctx.arc(ox, oy, 3, 0, Math.PI * 2);
      ctx.fillStyle = overlay.color;
      ctx.fill();
    }

    // Dot at latest price (main series — drawn on top)
    const lx = toX(prices.length - 1, prices.length);
    const ly = toY(ps[ps.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.shadowBlur = 4;
    ctx.shadowColor = lineColor;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  onMount(() => draw());
  afterUpdate(() => draw());
</script>

<canvas
  bind:this={canvas}
  style="width:100%;height:{fillParent ? '100%' : height+'px'};display:block;"
  aria-hidden="true"
></canvas>
