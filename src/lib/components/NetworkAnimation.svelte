<!--
  NetworkAnimation — GPU-friendly canvas background.
  Renders behind all tiles (z-index:-1).

  Particles:
    • Gold nodes    — small glowing gold dots, slowly drifting
    • BTC sparks    — slow gold dots travelling along node connections
    • Lightning sparks — fast cyan dots on short ephemeral paths with radial pulse on arrival
  Performance:
    • Particle pooling for BTC sparks and Lightning sparks
    • Throttled to 30 fps max
    • Reduced counts on mobile
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let canvas: HTMLCanvasElement;
  let animId: number;

  onMount(() => {
    const ctx = canvas.getContext('2d')!;
    let W = 0, H = 0;
    let mobile = false;

    // ── Colour constants ──────────────────────────────────────
    const ORANGE = 'rgba(247,147,26,';
    const AMBER  = 'rgba(255,180,60,';
    const CYAN   = 'rgba(0,220,255,';

    // ── Counts / thresholds ───────────────────────────────────
    const NODE_COUNT  = () => mobile ? 10 : 32;
    const CONN_DIST   = () => mobile ? 150 : 220;
    const POOL_SIZE   = () => mobile ? 15 : 40;

    // ── Resize ────────────────────────────────────────────────
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    function resize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
        mobile = window.innerWidth < 768;
        init();
      }, 200);
      if (!W) {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
        mobile = window.innerWidth < 768;
      }
    }

    // ══ Node ══════════════════════════════════════════════════
    class Node {
      x: number; y: number; baseX: number; baseY: number;
      driftAngle: number; driftSpeed: number; radius: number;
      constructor() {
        this.baseX = this.x = Math.random() * (W || window.innerWidth);
        this.baseY = this.y = Math.random() * (H || window.innerHeight);
        this.driftAngle = Math.random() * Math.PI * 2;
        this.driftSpeed = 0.001 + Math.random() * 0.002;
        this.radius     = 1.5 + Math.random() * 1.5;
      }
      update() {
        this.driftAngle += this.driftSpeed;
        this.x = this.baseX + Math.sin(this.driftAngle)        * 12;
        this.y = this.baseY + Math.cos(this.driftAngle * 0.7)  * 10;
      }
      draw() {
        // Outer glow
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius + 2, 0, Math.PI * 2);
        ctx.fillStyle = ORANGE + '0.07)';
        ctx.fill();
        // Core dot
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = ORANGE + '0.30)';
        ctx.fill();
      }
    }

    // ══ BtcSpark (gold — slow, along permanent connections) ═══
    class BtcSpark {
      from!: Node; to!: Node;
      progress!: number; speed!: number;
      hue!: string; size!: number;
      trail!: { x: number; y: number; a: number }[];
      active: boolean = false;

      reset(from: Node, to: Node) {
        this.from     = from;
        this.to       = to;
        this.progress = 0;
        this.speed    = 0.006 + Math.random() * 0.010;
        this.hue      = Math.random() < 0.65 ? 'o' : 'a';
        this.size     = 1.5 + Math.random() * 1.5;
        this.trail    = [];
        this.active   = true;
      }

      /** Returns true when the spark has reached its target. */
      update(): boolean {
        this.progress += this.speed;
        const x = this.from.x + (this.to.x - this.from.x) * this.progress;
        const y = this.from.y + (this.to.y - this.from.y) * this.progress;
        this.trail.push({ x, y, a: 1 });
        if (this.trail.length > 14) this.trail.shift();
        this.trail.forEach(t => (t.a *= 0.86));
        return this.progress >= 1;
      }

      draw() {
        const col = this.hue === 'o' ? ORANGE : AMBER;
        for (const t of this.trail) {
          ctx.beginPath();
          ctx.arc(t.x, t.y, this.size * t.a * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = col + (t.a * 0.28) + ')';
          ctx.fill();
        }
        const x = this.from.x + (this.to.x - this.from.x) * this.progress;
        const y = this.from.y + (this.to.y - this.from.y) * this.progress;
        ctx.beginPath();
        ctx.arc(x, y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = col + '0.75)';
        ctx.shadowBlur  = 7;
        ctx.shadowColor = col + '0.5)';
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // ══ LightningSpark (cyan — fast, ephemeral jagged path) ══
    class LightningSpark {
      path!: { x: number; y: number }[];
      progress!: number; speed!: number; size!: number;
      trail!: { x: number; y: number; a: number }[];
      active: boolean = false;

      reset(from: Node, to: Node) {
        // Build a slightly-jagged path between two nodes
        const steps  = 3 + Math.floor(Math.random() * 3);
        const path: { x: number; y: number }[] = [];
        for (let s = 0; s <= steps; s++) {
          const t    = s / steps;
          const jitter = (1 - Math.abs(t - 0.5) * 2) * 18;
          path.push({
            x: from.x + (to.x - from.x) * t + (Math.random() - 0.5) * jitter,
            y: from.y + (to.y - from.y) * t + (Math.random() - 0.5) * jitter,
          });
        }
        this.path     = path;
        this.progress = 0;
        this.speed    = 0.025 + Math.random() * 0.030;
        this.size     = 1 + Math.random() * 1;
        this.trail    = [];
        this.active   = true;
      }

      posAt(p: number): { x: number; y: number } {
        const total = this.path.length - 1;
        const idx   = Math.min(Math.floor(p * total), total - 1);
        const t     = p * total - idx;
        return {
          x: this.path[idx].x + (this.path[idx + 1].x - this.path[idx].x) * t,
          y: this.path[idx].y + (this.path[idx + 1].y - this.path[idx].y) * t,
        };
      }

      update(): boolean {
        this.progress += this.speed;
        const pos = this.posAt(Math.min(this.progress, 1));
        this.trail.push({ x: pos.x, y: pos.y, a: 1 });
        if (this.trail.length > 8) this.trail.shift();
        this.trail.forEach(t => (t.a *= 0.78));
        return this.progress >= 1;
      }

      draw() {
        for (const t of this.trail) {
          ctx.beginPath();
          ctx.arc(t.x, t.y, this.size * t.a * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = CYAN + (t.a * 0.22) + ')';
          ctx.fill();
        }
        const pos = this.posAt(Math.min(this.progress, 1));
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = CYAN + '0.85)';
        ctx.shadowBlur  = 8;
        ctx.shadowColor = CYAN + '0.6)';
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // ══ Ping (radial pulse on spark arrival) ═════════════════
    class Ping {
      x!: number; y!: number;
      radius!: number; maxRadius!: number; alpha!: number;
      col!: string;
      active: boolean = false;

      reset(x: number, y: number, col: string) {
        this.x = x; this.y = y;
        this.col       = col;
        this.radius    = 1.5;
        this.maxRadius = 20 + Math.random() * 14;
        this.alpha     = 0.65;
        this.active    = true;
      }

      update(): boolean {
        this.radius += 0.5;
        this.alpha  *= 0.952;
        return this.radius >= this.maxRadius || this.alpha < 0.02;
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.strokeStyle = this.col + this.alpha + ')';
        ctx.lineWidth   = 1;
        ctx.stroke();
      }
    }

    // ── Particle pools ────────────────────────────────────────
    let nodes:      Node[]           = [];
    let btcPool:    BtcSpark[]       = [];
    let ltgPool:    LightningSpark[] = [];
    let pingPool:   Ping[]           = [];

    function getBtcSpark(): BtcSpark | null {
      for (const s of btcPool) if (!s.active) return s;
      if (btcPool.length < POOL_SIZE()) { const s = new BtcSpark(); btcPool.push(s); return s; }
      return null;
    }
    function getLtgSpark(): LightningSpark | null {
      for (const s of ltgPool) if (!s.active) return s;
      if (ltgPool.length < POOL_SIZE()) { const s = new LightningSpark(); ltgPool.push(s); return s; }
      return null;
    }
    function getPing(): Ping | null {
      for (const p of pingPool) if (!p.active) return p;
      if (pingPool.length < 24) { const p = new Ping(); pingPool.push(p); return p; }
      return null;
    }

    // ── Init ──────────────────────────────────────────────────
    function init() {
      nodes    = [];
      btcPool.forEach(s => (s.active = false));
      ltgPool.forEach(s => (s.active = false));
      pingPool.forEach(p => (p.active = false));
      for (let i = 0; i < NODE_COUNT(); i++) nodes.push(new Node());
    }

    // ── Spawn helpers ─────────────────────────────────────────
    function pairNodes(): [Node, Node] | null {
      if (nodes.length < 2) return null;
      const a   = nodes[Math.floor(Math.random() * nodes.length)];
      const cd  = CONN_DIST();
      let best: Node | null = null, bestDist = Infinity;
      for (const n of nodes) {
        if (n === a) continue;
        const dx = n.x - a.x, dy = n.y - a.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < cd && d < bestDist) { best = n; bestDist = d; }
      }
      return best ? [a, best] : null;
    }

    function spawnBtcSpark(chainFrom?: Node) {
      const pair = chainFrom ? (() => {
        const cd = CONN_DIST(); let best: Node | null = null, bd = Infinity;
        for (const n of nodes) {
          if (n === chainFrom) continue;
          const dx = n.x - chainFrom.x, dy = n.y - chainFrom.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < cd && d < bd) { best = n; bd = d; }
        }
        return best ? [chainFrom, best] as [Node, Node] : null;
      })() : pairNodes();
      if (!pair) return;
      const s = getBtcSpark();
      if (s) s.reset(pair[0], pair[1]);
    }

    function spawnLightning() {
      const pair = pairNodes();
      if (!pair) return;
      const s = getLtgSpark();
      if (s) s.reset(pair[0], pair[1]);
    }

    // ── Throttled loop (≤30 fps) ──────────────────────────────
    let lastFrameTime = 0;
    const TARGET_INTERVAL = 1000 / 30;
    let btcTimer = 0;
    let ltgTimer = 0;

    function loop(now: number) {
      animId = requestAnimationFrame(loop);
      const delta = now - lastFrameTime;
      if (delta < TARGET_INTERVAL) return;
      lastFrameTime = now - (delta % TARGET_INTERVAL);

      ctx.clearRect(0, 0, W, H);

      // Draw faint connection lines between close nodes
      const cd = CONN_DIST();
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx   = nodes[i].x - nodes[j].x;
          const dy   = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < cd) {
            const a = (1 - dist / cd) * 0.038;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = ORANGE + a + ')';
            ctx.lineWidth   = 0.5;
            ctx.stroke();
          }
        }
      }

      // Update & draw nodes
      nodes.forEach(n => { n.update(); n.draw(); });

      // Spawn BTC sparks
      btcTimer++;
      const btcRate = mobile ? 120 : 50;
      if (btcTimer >= btcRate) {
        spawnBtcSpark();
        if (Math.random() < (mobile ? 0.10 : 0.20)) { spawnBtcSpark(); spawnBtcSpark(); }
        btcTimer = 0;
      }

      // Spawn Lightning sparks (less frequent than BTC)
      ltgTimer++;
      const ltgRate = mobile ? 200 : 90;
      if (ltgTimer >= ltgRate) {
        spawnLightning();
        if (Math.random() < (mobile ? 0.08 : 0.15)) spawnLightning();
        ltgTimer = 0;
      }

      // Update & draw BTC sparks
      for (const s of btcPool) {
        if (!s.active) continue;
        const done = s.update();
        s.draw();
        if (done) {
          s.active = false;
          const p = getPing();
          if (p) p.reset(s.to.x, s.to.y, ORANGE);
          // Chain with 50% probability on desktop, 25% on mobile
          if (Math.random() < (mobile ? 0.25 : 0.50)) spawnBtcSpark(s.to);
        }
      }

      // Update & draw Lightning sparks
      for (const s of ltgPool) {
        if (!s.active) continue;
        const done = s.update();
        s.draw();
        if (done) {
          s.active = false;
          const pos = s.posAt(1);
          const p   = getPing();
          if (p) p.reset(pos.x, pos.y, CYAN);
        }
      }

      // Update & draw pings
      for (const p of pingPool) {
        if (!p.active) continue;
        const done = p.update();
        p.draw();
        if (done) p.active = false;
      }
    }

    resize();
    init();
    animId = requestAnimationFrame(loop);
    window.addEventListener('resize', resize, { passive: true });

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  });

  onDestroy(() => {
    // cleanup is handled by the return value of onMount
  });
</script>

<canvas bind:this={canvas} id="net-canvas" aria-hidden="true"></canvas>

<style>
  canvas {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
    will-change: transform;
    transition: opacity 0.5s;
  }

  :global(html.light) canvas {
    opacity: 0.15;
  }
</style>
