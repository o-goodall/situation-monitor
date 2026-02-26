<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';

  export let prices: number[] = [];
  export let height = 48;
  export let opacity = 0.35; // opacity of the fill area under line

  let canvas: HTMLCanvasElement;

  function draw() {
    if (!canvas || prices.length < 2) return;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;

    // Hi-DPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    // Is the trend up or down over the window?
    const isUp = prices[prices.length - 1] >= prices[0];
    const lineColor = isUp ? '#22c55e' : '#ef4444';
    const fillColor = isUp ? 'rgba(34,197,94,' : 'rgba(239,68,68,';

    const pad = { top: 4, bottom: 4, left: 2, right: 2 };
    const drawW = W - pad.left - pad.right;
    const drawH = H - pad.top  - pad.bottom;

    const toX = (i: number) => pad.left + (i / (prices.length - 1)) * drawW;
    const toY = (p: number) => pad.top  + (1 - (p - min) / range)   * drawH;

    // Build path
    ctx.beginPath();
    prices.forEach((p, i) => {
      const x = toX(i), y = toY(p);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });

    // Stroke
    ctx.strokeStyle = lineColor;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.shadowBlur  = 6;
    ctx.shadowColor = lineColor;
    ctx.stroke();

    // Fill under line
    ctx.shadowBlur = 0;
    ctx.lineTo(toX(prices.length - 1), H);
    ctx.lineTo(toX(0), H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, H);
    grad.addColorStop(0, fillColor + (opacity * 0.9) + ')');
    grad.addColorStop(1, fillColor + '0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Dot at latest price
    const lx = toX(prices.length - 1);
    const ly = toY(prices[prices.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.shadowBlur = 8;
    ctx.shadowColor = lineColor;
    ctx.fill();
  }

  onMount(() => { draw(); });
  afterUpdate(() => { draw(); });
</script>

<canvas
  bind:this={canvas}
  class="sparkline"
  style="height:{height}px;"
  aria-hidden="true"
></canvas>

<style>
  .sparkline {
    display: block;
    width: 100%;
    pointer-events: none;
  }
</style>
