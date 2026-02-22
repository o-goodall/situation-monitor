<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';

  export let prices: { t: number; p: number }[] = [];
  export let height = 110;
  export let range: string = '1d';
  export let formatY: ((v: number) => string) | undefined = undefined;

  let canvas: HTMLCanvasElement;

  function fmtLabel(ts: number): string {
    const d = new Date(ts);
    if (range === '1d') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
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
    const minRaw = Math.min(...ps);
    const maxRaw = Math.max(...ps);
    const padding = (maxRaw - minRaw) * 0.05 || 1;
    const min = minRaw - padding;
    const max = maxRaw + padding;
    const rng = max - min;

    const isUp = ps[ps.length - 1] >= ps[0];
    const lineColor = isUp ? '#22c55e' : '#ef4444';
    const fillColor = isUp ? 'rgba(34,197,94,' : 'rgba(239,68,68,';

    const PAD_L = 48, PAD_R = 10, PAD_T = 10, PAD_B = 22;
    const dW = W - PAD_L - PAD_R;
    const dH = H - PAD_T - PAD_B;

    const toX = (i: number) => PAD_L + (i / (prices.length - 1)) * dW;
    const toY = (p: number) => PAD_T + (1 - (p - min) / rng) * dH;

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

    // Gradient fill under line
    ctx.beginPath();
    prices.forEach(({ p }, i) => {
      const x = toX(i), y = toY(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(toX(prices.length - 1), PAD_T + dH);
    ctx.lineTo(PAD_L, PAD_T + dH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + dH);
    grad.addColorStop(0, fillColor + '0.22)');
    grad.addColorStop(1, fillColor + '0.01)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Price line
    ctx.beginPath();
    prices.forEach(({ p }, i) => {
      const x = toX(i), y = toY(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowBlur = 5;
    ctx.shadowColor = lineColor;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Dot at latest price
    const lx = toX(prices.length - 1);
    const ly = toY(ps[ps.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.shadowBlur = 8;
    ctx.shadowColor = lineColor;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  onMount(() => draw());
  afterUpdate(() => draw());
</script>

<canvas
  bind:this={canvas}
  style="width:100%;height:{height}px;display:block;"
  aria-hidden="true"
></canvas>
