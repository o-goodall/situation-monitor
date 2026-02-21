<script lang="ts">
  import '../app.css';
  import { onMount, onDestroy } from 'svelte';
  import { loadSettings } from '$lib/settings';
  import {
    settings, showSettings, saved, time, lightMode,
    btcPrice, prevPrice, priceFlash, priceHistory, btcBlock, btcFees,
    halvingBlocksLeft, halvingDays, halvingDate, halvingProgress,
    fearGreed, fearGreedLabel, difficultyChange, fundingRate, audUsd, dcaUpdated,
    markets, newsItems,
    goldPriceUsd, goldYtdPct, sp500Price, sp500YtdPct, cpiAnnual,
    gfNetWorth, gfTotalInvested, gfNetGainPct, gfNetGainYtdPct,
    gfTodayChangePct, gfHoldings, gfError, gfLoading, gfUpdated,
    persistSettings
  } from '$lib/store';

  let newKeyword = '', newSource = '';
  let clockInterval: ReturnType<typeof setInterval>;
  let intervals: ReturnType<typeof setInterval>[] = [];
  let scrolled = false;
  let mobileMenuOpen = false;
  let activeSection = 'signal';
  let settingsAnimating = false;
  let menuAnimating = false;

  function tick() {
    $time = new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  async function fetchBtc() {
    try {
      const d = await fetch('/api/bitcoin').then(r=>r.json());
      $prevPrice = $btcPrice;
      $btcPrice = d.price ?? 0;
      $btcBlock = d.blockHeight ?? 0;
      $btcFees = d.fees ?? {low:0,medium:0,high:0};
      if (d.halving) {
        $halvingBlocksLeft = d.halving.blocksRemaining;
        $halvingDays = d.halving.daysRemaining;
        $halvingDate = d.halving.estimatedDate;
        $halvingProgress = d.halving.progressPct;
      }
      if ($prevPrice && $btcPrice !== $prevPrice) {
        $priceFlash = $btcPrice > $prevPrice ? 'up' : 'down';
        setTimeout(() => $priceFlash = '', 1200);
      }
      // Rolling price history — keep last 60 data points
      if ($btcPrice > 0) {
        $priceHistory = [...$priceHistory.slice(-59), $btcPrice];
      }
    } catch {}
  }

  async function fetchDCA() {
    try {
      const d = await fetch('/api/dca').then(r=>r.json());
      $fearGreed = d.fearGreed; $fearGreedLabel = d.fearGreedLabel;
      $difficultyChange = d.difficultyChange; $fundingRate = d.fundingRate; $audUsd = d.audUsd;
      $dcaUpdated = new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});
    } catch {}
  }

  async function fetchPoly() {
    try {
      const kw = encodeURIComponent(JSON.stringify($settings.polymarket.keywords));
      $markets = (await fetch(`/api/polymarket?keywords=${kw}`).then(r=>r.json())).markets ?? [];
    } catch {}
  }

  async function fetchNews() {
    try {
      const src = encodeURIComponent(JSON.stringify($settings.news.sources));
      $newsItems = (await fetch(`/api/news?sources=${src}`).then(r=>r.json())).items ?? [];
    } catch {}
  }

  async function fetchMarkets() {
    try {
      const d = await fetch('/api/markets').then(r=>r.json());
      $goldPriceUsd = d.gold?.priceUsd ?? null; $goldYtdPct = d.gold?.ytdPct ?? null;
      $sp500Price = d.sp500?.price ?? null; $sp500YtdPct = d.sp500?.ytdPct ?? null;
      $cpiAnnual = d.cpiAnnual ?? null;
    } catch {}
  }

  async function fetchGhostfolio() {
    const token = $settings.ghostfolio?.token?.trim();
    if (!token) return;
    $gfLoading = true; $gfError = '';
    try {
      const d = await fetch(`/api/ghostfolio?token=${encodeURIComponent(token)}`).then(r=>r.json());
      if (d.error) { $gfError = d.error; }
      else {
        $gfNetWorth = d.netWorth; $gfTotalInvested = d.totalInvested;
        $gfNetGainPct = d.netGainPct; $gfNetGainYtdPct = d.netGainYtdPct;
        $gfTodayChangePct = d.todayChangePct; $gfHoldings = d.holdings ?? [];
        $gfUpdated = new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});
      }
    } catch { $gfError = 'Connection failed'; } finally { $gfLoading = false; }
  }

  function saveAll() {
    persistSettings($settings);
    fetchPoly(); fetchNews();
    if ($settings.ghostfolio?.token) fetchGhostfolio();
  }

  function handleAddKeyword() {
    if (newKeyword.trim()) { $settings.polymarket.keywords = [...$settings.polymarket.keywords, newKeyword.trim()]; newKeyword = ''; }
  }
  function removeKeyword(i:number) { $settings.polymarket.keywords = $settings.polymarket.keywords.filter((_,j)=>j!==i); }
  function handleAddSource() {
    if (newSource.trim()) { $settings.news.sources = [...$settings.news.sources, newSource.trim()]; newSource = ''; }
  }
  function removeSource(i:number) { $settings.news.sources = $settings.news.sources.filter((_,j)=>j!==i); }

  function handleScroll() {
    scrolled = window.scrollY > 40;
    // Track active section for nav highlight
    const sections = ['signal', 'portfolio', 'intel'];
    for (let i = sections.length - 1; i >= 0; i--) {
      const el = document.getElementById(sections[i]);
      if (el && el.getBoundingClientRect().top <= 120) {
        activeSection = sections[i];
        break;
      }
    }
  }
  function toggleMobileMenu() { mobileMenuOpen = !mobileMenuOpen; if (mobileMenuOpen) $showSettings = false; }
  function closeMobileMenu() { mobileMenuOpen = false; }

  function handleNavClick(section: string) {
    activeSection = section;
    closeMobileMenu();
  }

  // Apply light/dark mode to <html>
  $: if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('light', $lightMode);
  }

  onMount(() => {
    $settings = loadSettings();
    tick();
    clockInterval = setInterval(tick, 1000);
    fetchBtc(); fetchDCA(); fetchPoly(); fetchNews(); fetchMarkets();
    if ($settings.ghostfolio?.token) fetchGhostfolio();
    intervals = [
      setInterval(fetchBtc, 60000), setInterval(fetchDCA, 300000),
      setInterval(fetchPoly, 300000), setInterval(fetchNews, 300000),
      setInterval(fetchMarkets, 300000),
      setInterval(() => { if ($settings.ghostfolio?.token) fetchGhostfolio(); }, 300000),
    ];
    window.addEventListener('scroll', handleScroll, {passive:true});

    // ── NETWORK DATA PULSE ────────────────────────────────────
    // Subtle nodes with data transmissions flowing between them.
    // Small pings and flashing lines representing internet data flow.
    (function() {
      const canvas = document.getElementById('hornet-canvas') as HTMLCanvasElement;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      let W: number, H: number, animId: number;
      let nodes: Node[] = [];
      let transmissions: Transmission[] = [];
      let pings: Ping[] = [];

      const ORANGE = 'rgba(247,147,26,';
      const ELECTRIC = 'rgba(0,200,255,';
      const isMobile = () => window.innerWidth < 768;

      function getNodeCount() { return isMobile() ? 18 : 35; }

      function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
      }

      // Static-ish anchor nodes scattered across the screen
      class Node {
        x: number; y: number; baseX: number; baseY: number;
        radius: number; alpha: number; pulsePhase: number; pulseSpeed: number;
        hue: string; drift: number;
        constructor() {
          this.baseX = this.x = Math.random() * (W || window.innerWidth);
          this.baseY = this.y = Math.random() * (H || window.innerHeight);
          this.radius = 1.2 + Math.random() * 1.5;
          this.alpha = 0.08 + Math.random() * 0.18;
          this.pulsePhase = Math.random() * Math.PI * 2;
          this.pulseSpeed = 0.008 + Math.random() * 0.012;
          this.hue = Math.random() < 0.7 ? 'o' : 'e';
          this.drift = 0.15 + Math.random() * 0.25;
        }
        update(t: number) {
          // Very gentle drift around anchor point
          this.x = this.baseX + Math.sin(t * this.drift * 0.3 + this.pulsePhase) * 8;
          this.y = this.baseY + Math.cos(t * this.drift * 0.25 + this.pulsePhase * 1.3) * 6;
          this.pulsePhase += this.pulseSpeed;
        }
        draw() {
          const col = this.hue === 'o' ? ORANGE : ELECTRIC;
          const pulse = 0.5 + 0.5 * Math.sin(this.pulsePhase);
          const a = this.alpha * (0.6 + pulse * 0.4);
          // Soft glow
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.radius * 3, 0, Math.PI * 2);
          ctx.fillStyle = col + (a * 0.15) + ')';
          ctx.fill();
          // Core dot
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
          ctx.fillStyle = col + a + ')';
          ctx.fill();
        }
      }

      // Data packet traveling between two nodes
      class Transmission {
        fromNode: Node; toNode: Node; progress: number;
        speed: number; alpha: number; hue: string; alive: boolean;
        constructor(from: Node, to: Node) {
          this.fromNode = from;
          this.toNode = to;
          this.progress = 0;
          this.speed = 0.004 + Math.random() * 0.008;
          this.alpha = 0.12 + Math.random() * 0.2;
          this.hue = Math.random() < 0.65 ? 'o' : 'e';
          this.alive = true;
        }
        update() {
          this.progress += this.speed;
          if (this.progress >= 1) {
            this.alive = false;
            // Spawn a small ping at the destination
            pings.push(new Ping(this.toNode.x, this.toNode.y, this.hue));
          }
        }
        draw() {
          const col = this.hue === 'o' ? ORANGE : ELECTRIC;
          const fx = this.fromNode.x, fy = this.fromNode.y;
          const tx = this.toNode.x, ty = this.toNode.y;
          const p = this.progress;

          // Faint underlying line between nodes
          ctx.beginPath();
          ctx.moveTo(fx, fy); ctx.lineTo(tx, ty);
          ctx.strokeStyle = col + (this.alpha * 0.08) + ')';
          ctx.lineWidth = 0.5;
          ctx.stroke();

          // Traveling data packet (bright dot moving along the line)
          const px = fx + (tx - fx) * p;
          const py = fy + (ty - fy) * p;

          // Packet trail (short glowing segment behind the dot)
          const trailLen = 0.08;
          const tp = Math.max(0, p - trailLen);
          const tpx = fx + (tx - fx) * tp;
          const tpy = fy + (ty - fy) * tp;

          const grad = ctx.createLinearGradient(tpx, tpy, px, py);
          grad.addColorStop(0, col + '0)');
          grad.addColorStop(1, col + this.alpha + ')');
          ctx.beginPath();
          ctx.moveTo(tpx, tpy); ctx.lineTo(px, py);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.2;
          ctx.stroke();

          // Bright dot at head
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = col + (this.alpha * 1.4) + ')';
          ctx.shadowBlur = 6;
          ctx.shadowColor = col + '0.5)';
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // Small expanding ring when a data packet arrives
      class Ping {
        x: number; y: number; radius: number; maxRadius: number;
        alpha: number; hue: string; alive: boolean;
        constructor(x: number, y: number, hue: string) {
          this.x = x; this.y = y;
          this.radius = 2;
          this.maxRadius = 12 + Math.random() * 10;
          this.alpha = 0.3 + Math.random() * 0.15;
          this.hue = hue;
          this.alive = true;
        }
        update() {
          this.radius += 0.25;
          this.alpha *= 0.975;
          if (this.radius >= this.maxRadius || this.alpha < 0.01) this.alive = false;
        }
        draw() {
          const col = this.hue === 'o' ? ORANGE : ELECTRIC;
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
          ctx.strokeStyle = col + this.alpha + ')';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      let frameCount = 0;
      const spawnInterval = () => isMobile() ? 90 : 50; // frames between new transmissions

      function init() {
        nodes = [];
        transmissions = [];
        pings = [];
        const count = getNodeCount();
        for (let i = 0; i < count; i++) nodes.push(new Node());
      }

      function spawnTransmission() {
        if (nodes.length < 2) return;
        const a = nodes[Math.floor(Math.random() * nodes.length)];
        // Pick a destination — bias toward closer nodes for more natural look
        let best: Node | null = null;
        let bestDist = Infinity;
        for (let tries = 0; tries < 5; tries++) {
          const b = nodes[Math.floor(Math.random() * nodes.length)];
          if (b === a) continue;
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          // Prefer medium-distance connections (not too short, not too far)
          const ideal = Math.min(W, H) * 0.3;
          const score = Math.abs(d - ideal);
          if (score < bestDist) { bestDist = score; best = b; }
        }
        if (best) transmissions.push(new Transmission(a, best));
      }

      function loop() {
        ctx.clearRect(0, 0, W, H);
        frameCount++;
        const t = frameCount * 0.016; // approximate time

        // Draw faint grid lines connecting nearby nodes
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = isMobile() ? 180 : 240;
            if (dist < maxDist) {
              const a = (1 - dist / maxDist) * 0.03;
              ctx.beginPath();
              ctx.moveTo(nodes[i].x, nodes[i].y);
              ctx.lineTo(nodes[j].x, nodes[j].y);
              ctx.strokeStyle = ORANGE + a + ')';
              ctx.lineWidth = 0.3;
              ctx.stroke();
            }
          }
        }

        // Update & draw nodes
        nodes.forEach(n => { n.update(t); n.draw(); });

        // Spawn new transmissions periodically
        if (frameCount % spawnInterval() === 0) spawnTransmission();
        // Occasional burst — 2 packets at once
        if (frameCount % (spawnInterval() * 4) === 0) { spawnTransmission(); spawnTransmission(); }

        // Update & draw transmissions
        transmissions.forEach(tr => { tr.update(); tr.draw(); });
        transmissions = transmissions.filter(tr => tr.alive);

        // Update & draw pings
        pings.forEach(p => { p.update(); p.draw(); });
        pings = pings.filter(p => p.alive);

        animId = requestAnimationFrame(loop);
      }

      resize(); init(); loop();
      let resizeTimer: ReturnType<typeof setTimeout>;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { resize(); init(); }, 200);
      }, { passive: true });
    })();
  });

  onDestroy(() => {
    clearInterval(clockInterval);
    intervals.forEach(clearInterval);
    window.removeEventListener('scroll', handleScroll);
  });
</script>

<canvas id="hornet-canvas" aria-hidden="true" style="will-change:transform;"></canvas>

<!-- ══ HEADER ════════════════════════════════════════════════ -->
<header class="hdr" class:hdr--scrolled={scrolled}>

  <!-- Brand — always left -->
  <a href="/" class="brand">
    <div class="globe-wrap" aria-hidden="true">
      <div class="globe">
        <div class="wire w-eq"></div><div class="wire w-lg1"></div>
        <div class="wire w-lg2"></div><div class="wire w-lt1"></div><div class="wire w-lt2"></div>
        <div class="ping ping-1"></div><div class="ping ping-2"></div>
        <div class="ping ping-3"></div><div class="ping ping-4"></div><div class="ping ping-5"></div>
      </div>
    </div>
    <span class="brand-name">
      <span class="b-gl">gl</span><span class="b-4">4</span><span class="b-nce">nce</span><span class="b-dot">.</span>
    </span>
  </a>

  <!-- Desktop nav — left-aligned after brand (Electric Xtra style) -->
  <nav class="page-nav desktop-only">
    <a href="#signal"    class="nav-link" class:nav-link--active={activeSection==='signal'}>₿ Signal</a>
    <a href="#portfolio" class="nav-link" class:nav-link--active={activeSection==='portfolio'}>↗ Portfolio</a>
    <a href="#intel"     class="nav-link" class:nav-link--active={activeSection==='intel'}>◈ Intel</a>
  </nav>

  <!-- Spacer pushes right controls to far right on desktop -->
  <div class="hdr-spacer"></div>

  <!-- Desktop right controls -->
  <div class="hdr-right desktop-only">
    <span class="hdr-clock">{$time}</span>

    <!-- Dark/Light mode toggle -->
    <button class="mode-toggle btn-ghost" on:click={() => $lightMode = !$lightMode}
      aria-label="Toggle {$lightMode ? 'dark' : 'light'} mode" title="Toggle light/dark mode">
      {#if $lightMode}
        <!-- Moon icon for dark mode -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      {:else}
        <!-- Sun icon for light mode -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      {/if}
    </button>

    <!-- Settings gear -->
    <button class="btn-ghost settings-btn" class:settings-btn--on={$showSettings}
      on:click={() => { $showSettings = !$showSettings; mobileMenuOpen = false; }} aria-label="Settings">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>
  </div>

  <!-- Mobile burger — only visible on small screens -->
  <button class="burger mobile-only" on:click={toggleMobileMenu} aria-label="Menu"
    class:burger--open={mobileMenuOpen}>
    <span></span><span></span><span></span>
  </button>

</header>

<!-- ══ SETTINGS DRAWER (desktop) ══════════════════════════════ -->
{#if $showSettings}
<div class="drawer">
  <div class="drawer-inner">
    <div class="dg"><p class="dg-hd">DCA Stack</p>
      <div class="dfields">
        <label class="df"><span class="dlbl">Start date</span><input type="date" bind:value={$settings.dca.startDate} class="dinp"/></label>
        <label class="df"><span class="dlbl">Daily AUD</span><input type="number" bind:value={$settings.dca.dailyAmount} class="dinp"/></label>
        <label class="df"><span class="dlbl">BTC held</span><input type="number" step="0.00000001" bind:value={$settings.dca.btcHeld} class="dinp"/></label>
        <label class="df"><span class="dlbl">Goal BTC</span><input type="number" step="0.001" bind:value={$settings.dca.goalBtc} class="dinp"/></label>
      </div>
    </div>
    <div class="dg"><p class="dg-hd">Watchlist <span class="dhint">pinned in markets</span></p>
      <div class="dtags">{#each $settings.polymarket.keywords as kw,i}<span class="dtag">{kw}<button on:click={()=>removeKeyword(i)} class="dtag-x">×</button></span>{/each}</div>
      <div class="dinp-row"><input bind:value={newKeyword} on:keydown={(e)=>e.key==='Enter'&&handleAddKeyword()} placeholder="Add keyword…" class="dinp"/><button on:click={handleAddKeyword} class="btn-ghost" style="white-space:nowrap;">Add</button></div>
    </div>
    <div class="dg"><p class="dg-hd">News RSS</p>
      <div class="dsrcs">{#each $settings.news.sources as src,i}<div class="dsrc"><span class="dsrc-url">{src}</span><button on:click={()=>removeSource(i)} class="dtag-x">×</button></div>{/each}</div>
      <div class="dinp-row"><input type="url" bind:value={newSource} on:keydown={(e)=>e.key==='Enter'&&handleAddSource()} placeholder="https://…" class="dinp"/><button on:click={handleAddSource} class="btn-ghost" style="white-space:nowrap;">Add</button></div>
    </div>
    <div class="dg"><p class="dg-hd">Ghostfolio <span class="dhint">token stored locally</span></p>
      <div class="dfields" style="max-width:500px;">
        <label class="df" style="flex:3;"><span class="dlbl">Security token</span><input type="password" bind:value={$settings.ghostfolio.token} placeholder="your-security-token" class="dinp"/></label>
        <label class="df"><span class="dlbl">Currency</span><input bind:value={$settings.ghostfolio.currency} placeholder="AUD" class="dinp" style="max-width:80px;"/></label>
      </div>
    </div>
    <button on:click={saveAll} class="btn-primary" class:d-save--ok={$saved}>{$saved?'✓ Saved':'Save Settings'}</button>
  </div>
</div>
{/if}

<!-- ══ MOBILE FULL-SCREEN MENU ════════════════════════════════ -->
{#if mobileMenuOpen}
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="mobile-menu" on:click|self={closeMobileMenu}>
  <div class="mobile-menu-panel">
    <!-- Nav links -->
    <nav class="mobile-nav">
      <a href="#signal"    class="mobile-nav-link" class:mobile-nav-link--active={activeSection==='signal'} on:click={() => handleNavClick('signal')}>₿ Signal</a>
      <a href="#portfolio" class="mobile-nav-link" class:mobile-nav-link--active={activeSection==='portfolio'} on:click={() => handleNavClick('portfolio')}>↗ Portfolio</a>
      <a href="#intel"     class="mobile-nav-link" class:mobile-nav-link--active={activeSection==='intel'} on:click={() => handleNavClick('intel')}>◈ Intel</a>
    </nav>

    <div class="mobile-divider"></div>

    <!-- Theme toggle -->
    <button class="mobile-theme-toggle" on:click={() => { $lightMode = !$lightMode; }}>
      <span class="mobile-menu-icon">{$lightMode ? '☀' : '☾'}</span>
      {$lightMode ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
    </button>

    <div class="mobile-divider"></div>

    <!-- Settings inline in mobile menu -->
    <p class="mobile-section-title">Settings</p>
    <div class="mobile-settings">
      <div class="dg"><p class="dg-hd">DCA Stack</p>
        <div class="dfields">
          <label class="df"><span class="dlbl">Start date</span><input type="date" bind:value={$settings.dca.startDate} class="dinp"/></label>
          <label class="df"><span class="dlbl">Daily AUD</span><input type="number" bind:value={$settings.dca.dailyAmount} class="dinp"/></label>
          <label class="df"><span class="dlbl">BTC held</span><input type="number" step="0.00000001" bind:value={$settings.dca.btcHeld} class="dinp"/></label>
          <label class="df"><span class="dlbl">Goal BTC</span><input type="number" step="0.001" bind:value={$settings.dca.goalBtc} class="dinp"/></label>
        </div>
      </div>
      <div class="dg"><p class="dg-hd">Ghostfolio Token</p>
        <label class="df"><span class="dlbl">Security token</span><input type="password" bind:value={$settings.ghostfolio.token} placeholder="your-security-token" class="dinp"/></label>
      </div>
      <button on:click={() => { saveAll(); closeMobileMenu(); }} class="btn-primary" style="width:100%;">{$saved?'✓ Saved':'Save Settings'}</button>
    </div>
  </div>
</div>
{/if}

<!-- ══ PAGE ═══════════════════════════════════════════════════ -->
<main class="page-wrap"><slot /></main>

<!-- ══ FOOTER ════════════════════════════════════════════════ -->
<footer class="site-footer">
  <span class="footer-brand">gl<span style="color:var(--orange);">4</span>nce.</span>
  <span class="footer-sources">mempool.space · alternative.me · binance · exchangerate-api · ghostfol.io · worldbank</span>
</footer>

<style>
  /* Canvas */
  #hornet-canvas { position:fixed; inset:0; width:100%; height:100%; z-index:-1; pointer-events:none; transition:opacity .5s; }
  :global(html.light) #hornet-canvas { opacity:0.25; }

  /* ── HEADER ──────────────────────────────────────────────── */
  .hdr {
    position:fixed; top:0; left:0; right:0; z-index:300;
    display:flex; align-items:center; gap:0;
    height:64px; padding:0 32px;
    background:rgba(10,10,10,0.82);
    backdrop-filter:blur(20px) saturate(180%);
    -webkit-backdrop-filter:blur(20px) saturate(180%);
    border-bottom:1px solid rgba(247,147,26,0.12);
    transition:height .3s, background .3s, box-shadow .3s;
  }
  .hdr--scrolled {
    height:52px;
    background:rgba(10,10,10,0.96);
    box-shadow:0 4px 28px rgba(247,147,26,0.15);
    border-bottom-color:rgba(247,147,26,0.22);
  }

  /* Brand + nav sit together on the LEFT */
  .brand { display:flex; align-items:center; gap:11px; text-decoration:none; flex-shrink:0; margin-right:28px; }

  /* Desktop nav — immediately after brand, left-aligned (Electric Xtra style) */
  .page-nav { display:flex; gap:4px; flex-shrink:0; }
  .nav-link {
    padding:8px 16px; border-radius:3px;
    font-family:'Orbitron',monospace; font-size:.65rem; font-weight:700;
    color:rgba(255,255,255,.5); text-decoration:none;
    text-transform:uppercase; letter-spacing:.08em;
    position:relative; border:1px solid transparent;
    transition:all .25s ease; white-space:nowrap;
  }
  .nav-link::after {
    content:''; position:absolute; bottom:0; left:0; width:0; height:2px;
    background:linear-gradient(90deg,#f7931a,#00c8ff);
    box-shadow:0 0 8px rgba(247,147,26,.7); transition:width .3s ease;
  }
  .nav-link:hover { color:rgba(255,255,255,.9); border-color:rgba(247,147,26,.3); box-shadow:inset 0 0 12px rgba(247,147,26,.08); }
  .nav-link:hover::after { width:100%; }
  .nav-link--active { color:rgba(255,255,255,.85); border-color:rgba(247,147,26,.18); }
  .nav-link--active::after { width:100%; }

  /* Spacer pushes clock/settings to far right */
  .hdr-spacer { flex:1; }

  /* Right controls */
  .hdr-right { display:flex; align-items:center; gap:10px; flex-shrink:0; }
  .hdr-clock { font-size:.7rem; font-weight:500; color:rgba(255,255,255,.22); font-variant-numeric:tabular-nums; letter-spacing:.07em; margin-right:4px; }
  .mode-toggle { padding:7px 10px; display:flex; align-items:center; justify-content:center; }
  .settings-btn { padding:7px 11px; }
  .settings-btn--on { border-color:rgba(247,147,26,.4)!important; color:var(--orange)!important; }

  /* ── GLOBE ───────────────────────────────────────────────── */
  .globe-wrap { width:30px; height:30px; position:relative; flex-shrink:0; }
  .globe {
    width:100%; height:100%; position:relative; border-radius:50%;
    background:radial-gradient(circle at 38% 35%, rgba(247,147,26,.28) 0%, rgba(247,147,26,.06) 55%, transparent 75%);
    box-shadow:0 0 0 1px rgba(247,147,26,.32),0 0 14px rgba(247,147,26,.35),inset 0 0 8px rgba(247,147,26,.1);
    overflow:hidden;
  }
  .wire { position:absolute; border:1px solid rgba(247,147,26,.2); border-radius:50%; top:50%; left:50%; transform:translate(-50%,-50%); pointer-events:none; }
  .w-eq{width:100%;height:28%} .w-lg1{width:52%;height:100%} .w-lg2{width:22%;height:100%}
  .w-lt1{width:80%;height:20%;top:28%} .w-lt2{width:80%;height:20%;top:70%}
  .ping { position:absolute; left:0; right:0; height:2px; background:linear-gradient(90deg,transparent 8%,rgba(247,147,26,.9) 35%,rgba(255,200,80,1) 50%,rgba(247,147,26,.9) 65%,transparent 92%); border-radius:1px; top:-2px; animation:pingDrop 2.5s linear infinite; opacity:0; box-shadow:0 0 4px rgba(247,147,26,.6); }
  .ping-1{animation-delay:0s}.ping-2{animation-delay:.5s}.ping-3{animation-delay:1s}.ping-4{animation-delay:1.5s}.ping-5{animation-delay:2s}
  @keyframes pingDrop{0%{top:-2px;opacity:0}4%{top:2%;opacity:1}24%{top:98%;opacity:.9}28%{top:102%;opacity:0}100%{top:102%;opacity:0}}

  /* ── WORDMARK ────────────────────────────────────────────── */
  .brand-name { font-family:'Orbitron',monospace; font-weight:900; font-size:1rem; letter-spacing:.06em; line-height:1; }
  .b-gl,.b-nce { color:rgba(234,234,234,.92); }
  .b-4 { color:var(--orange); text-shadow:0 0 14px rgba(247,147,26,.8),0 0 28px rgba(247,147,26,.4); animation:fourGlow 3s ease-in-out infinite; display:inline-block; }
  .b-dot { color:var(--orange); opacity:.7; }
  @keyframes fourGlow{0%,100%{text-shadow:0 0 12px rgba(247,147,26,.8),0 0 24px rgba(247,147,26,.4)}50%{text-shadow:0 0 20px rgba(247,147,26,1),0 0 44px rgba(247,147,26,.5),0 0 70px rgba(247,147,26,.18)}}

  /* ── BURGER (mobile only) ────────────────────────────────── */
  .burger {
    display:none; flex-direction:column; justify-content:center; gap:5px;
    width:36px; height:36px; padding:6px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
    border-radius:3px; cursor:pointer; transition:border-color .2s;
  }
  .burger span {
    display:block; height:2px; width:100%; background:rgba(255,255,255,.7);
    border-radius:1px; transition:all .25s ease; transform-origin:center;
  }
  .burger:hover { border-color:rgba(247,147,26,.4); }
  .burger--open span:nth-child(1) { transform:translateY(7px) rotate(45deg); }
  .burger--open span:nth-child(2) { opacity:0; transform:scaleX(0); }
  .burger--open span:nth-child(3) { transform:translateY(-7px) rotate(-45deg); }

  /* ── RESPONSIVE VISIBILITY ───────────────────────────────── */
  .desktop-only { display:flex; }
  .mobile-only  { display:none; }

  @media (max-width:768px) {
    .hdr { height:54px; padding:0 16px; }
    .hdr--scrolled { height:46px; }
    .desktop-only { display:none !important; }
    .mobile-only  { display:flex !important; }
    .brand { margin-right:auto; }
    .brand-name { font-size:.88rem; }
    .globe-wrap { width:26px; height:26px; }
  }

  /* ── MOBILE FULL-SCREEN MENU ─────────────────────────────── */
  .mobile-menu {
    position:fixed; inset:0; z-index:400;
    background:rgba(0,0,0,.55); backdrop-filter:blur(4px);
    animation:fadeIn .2s ease;
  }
  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  .mobile-menu-panel {
    position:absolute; top:54px; left:0; right:0;
    background:rgba(10,10,10,.97); backdrop-filter:blur(28px);
    border-bottom:1px solid rgba(247,147,26,.2);
    padding:0 0 24px; max-height:calc(100vh - 54px); overflow-y:auto;
    animation:slideDown .25s ease;
  }
  @keyframes slideDown { from{opacity:0;transform:translateY(-12px)} to{opacity:1;transform:translateY(0)} }
  .mobile-nav { display:flex; flex-direction:column; padding:8px 0; }
  .mobile-nav-link {
    display:flex; align-items:center; padding:16px 24px;
    font-family:'Orbitron',monospace; font-size:.78rem; font-weight:700;
    color:rgba(255,255,255,.7); text-decoration:none;
    text-transform:uppercase; letter-spacing:.1em;
    border-bottom:1px solid rgba(255,255,255,.04);
    transition:all .2s;
  }
  .mobile-nav-link:hover { color:var(--orange); background:rgba(247,147,26,.06); padding-left:32px; }
  .mobile-nav-link--active { color:var(--orange); background:rgba(247,147,26,.04); border-left:2px solid var(--orange); }
  .mobile-divider { height:1px; background:linear-gradient(90deg,transparent,rgba(247,147,26,.25),transparent); margin:4px 0; }
  .mobile-theme-toggle {
    display:flex; align-items:center; gap:14px; width:100%;
    padding:16px 24px; background:none; border:none;
    color:rgba(255,255,255,.6); font-family:'Orbitron',monospace;
    font-size:.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.1em;
    cursor:pointer; transition:all .2s;
  }
  .mobile-theme-toggle:hover { color:var(--orange); background:rgba(247,147,26,.06); }
  .mobile-menu-icon { font-size:1.1rem; width:20px; text-align:center; }
  .mobile-section-title {
    padding:12px 24px 8px; font-family:'Orbitron',monospace;
    font-size:.6rem; font-weight:700; color:rgba(247,147,26,.7);
    text-transform:uppercase; letter-spacing:.15em;
  }
  .mobile-settings { padding:0 16px; display:flex; flex-direction:column; gap:18px; }

  /* ── SETTINGS DRAWER (desktop) ───────────────────────────── */
  .drawer { background:rgba(8,8,8,.97); backdrop-filter:blur(24px); border-bottom:1px solid rgba(247,147,26,.15); position:relative; z-index:200; animation:slideDown .25s ease; }
  .drawer-inner { max-width:900px; margin:0 auto; padding:28px 24px; display:flex; flex-direction:column; gap:22px; }
  .dg-hd { font-size:.72rem; font-weight:600; color:rgba(255,255,255,.5); margin-bottom:12px; display:flex; align-items:center; gap:8px; font-family:'Orbitron',monospace; letter-spacing:.06em; text-transform:uppercase; }
  .dhint { font-size:.62rem; color:rgba(255,255,255,.2); font-weight:400; font-family:'Inter',sans-serif; text-transform:none; letter-spacing:0; }
  .dfields { display:flex; gap:10px; flex-wrap:wrap; }
  .df { display:flex; flex-direction:column; gap:5px; flex:1; min-width:100px; }
  .dlbl { font-size:.58rem; color:rgba(255,255,255,.25); font-weight:500; text-transform:uppercase; letter-spacing:.1em; }
  .dinp { width:100%; background:rgba(255,255,255,.04); border:1px solid rgba(255,94,0,.22); border-radius:3px; padding:10px 12px; color:#eaeaea; font-family:'Inter',sans-serif; font-size:.82rem; transition:border-color .2s,box-shadow .2s; }
  .dinp:focus { outline:none; border-color:var(--orange); box-shadow:0 0 0 2px rgba(247,147,26,.15),0 0 16px rgba(247,147,26,.2); }
  .dtags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
  .dtag { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; background:rgba(247,147,26,.07); border:1px solid rgba(247,147,26,.2); border-radius:3px; font-size:.68rem; color:rgba(255,255,255,.55); }
  .dtag-x { background:none; border:none; color:rgba(255,255,255,.25); cursor:pointer; font-size:1rem; padding:0; line-height:1; transition:color .15s; }
  .dtag-x:hover { color:var(--dn); }
  .dinp-row { display:flex; gap:8px; }
  .dsrcs { max-height:68px; overflow-y:auto; margin-bottom:8px; }
  .dsrc { display:flex; justify-content:space-between; align-items:center; padding:3px 0; font-size:.62rem; color:rgba(255,255,255,.25); }
  .dsrc-url { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:300px; }
  .d-save--ok { background:linear-gradient(45deg,#22c55e,#15803d)!important; }

  /* ── PAGE WRAP ───────────────────────────────────────────── */
  .page-wrap { padding-top:64px; min-height:100vh; }
  @media (max-width:768px) { .page-wrap { padding-top:54px; } }

  /* ── FOOTER ──────────────────────────────────────────────── */
  .site-footer { border-top:1px solid rgba(247,147,26,.12); padding:18px 32px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; background:rgba(0,0,0,.5); }
  .footer-brand { font-family:'Orbitron',monospace; font-size:.62rem; font-weight:900; color:rgba(255,255,255,.25); letter-spacing:.1em; }
  .footer-sources { font-size:.56rem; color:rgba(255,255,255,.14); }
  @media (max-width:600px) { .site-footer { padding:14px 16px; justify-content:center; } .footer-sources { display:none; } }

  /* ── LIGHT MODE ──────────────────────────────────────────── */
  :global(html.light) { --bg:#f0f0f0; --bg2:#e8e8e8; --glass-bg:rgba(255,255,255,.65); --glass-bg2:rgba(255,255,255,.8); --glass-bd:rgba(0,0,0,.1); --glass-bd2:rgba(0,0,0,.16); --t1:#181818; --t2:#555; --t3:#ccc; }
  :global(html.light) body { background:#eaeaea; color:#181818; }
  :global(html.light) body::before { background: radial-gradient(circle at 15% 85%,rgba(247,147,26,.14) 0%,transparent 42%), radial-gradient(circle at 85% 10%,rgba(0,180,255,.07) 0%,transparent 42%); }
  :global(html.light) .hdr { background:rgba(245,245,245,.88); border-bottom-color:rgba(247,147,26,.2); }
  :global(html.light) .hdr--scrolled { background:rgba(240,240,240,.97); }
  :global(html.light) .b-gl,:global(html.light) .b-nce { color:rgba(20,20,20,.9); }
  :global(html.light) .hdr-clock { color:rgba(0,0,0,.4); }
  :global(html.light) .nav-link { color:rgba(0,0,0,.55); }
  :global(html.light) .nav-link:hover { color:rgba(0,0,0,.9); border-color:rgba(247,147,26,.4); }
  :global(html.light) .nav-link--active { color:rgba(0,0,0,.85); border-color:rgba(247,147,26,.3); }
  :global(html.light) .drawer { background:rgba(245,245,245,.98); border-bottom-color:rgba(247,147,26,.2); }
  :global(html.light) .dinp { background:rgba(0,0,0,.04); border-color:rgba(247,94,0,.25); color:#181818; }
  :global(html.light) .dg-hd { color:rgba(0,0,0,.6); }
  :global(html.light) .dlbl { color:rgba(0,0,0,.4); }
  :global(html.light) .site-footer { background:rgba(230,230,230,.8); border-top-color:rgba(247,147,26,.2); }
  :global(html.light) .footer-brand { color:rgba(0,0,0,.35); }
  :global(html.light) .footer-sources { color:rgba(0,0,0,.25); }
  :global(html.light) .mobile-menu-panel { background:rgba(245,245,245,.98); }
  :global(html.light) .mobile-nav-link { color:rgba(0,0,0,.7); }
  :global(html.light) .mobile-theme-toggle { color:rgba(0,0,0,.6); }
  :global(html.light) .mobile-section-title { color:rgba(247,147,26,.85); }
  :global(html.light) .btn-ghost { color:rgba(0,0,0,.45); border-color:rgba(0,0,0,.1); }
  :global(html.light) .btn-ghost:hover { color:var(--orange); }

  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  :global(.blink){animation:blink 2s step-end infinite;}
</style>
