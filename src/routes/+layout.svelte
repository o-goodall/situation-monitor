<script lang="ts">
  import '../app.css';
  import { onMount, onDestroy } from 'svelte';
  import { loadSettings, getEnabledFeedUrls } from '$lib/settings';
  import {
    settings, showSettings, saved, time, lightMode, activeSection,
    btcPrice, prevPrice, priceFlash, priceHistory, btcBlock, btcFees,
    halvingBlocksLeft, halvingDays, halvingDate, halvingProgress,
    latestBlock, mempoolStats,
    fearGreed, fearGreedLabel, difficultyChange, fundingRate, audUsd, dcaUpdated,
    markets, newsItems,
    goldPriceUsd, goldYtdPct, sp500Price, sp500YtdPct, cpiAnnual, btcYtdPct,
    gfNetWorth, gfTotalInvested, gfNetGainPct, gfNetGainYtdPct,
    gfTodayChangePct, gfHoldings, gfError, gfLoading, gfUpdated,
    gfDividendTotal, gfDividendYtd, gfCash, gfAnnualizedPct, gfFirstOrderDate, gfOrdersCount,
    persistSettings, fxRates, btcWsConnected, btcMa200, btcHashrate
  } from '$lib/store';

  let newKeyword = '', newSource = '', newSourceName = '';
  let clockInterval: ReturnType<typeof setInterval>;
  let intervals: ReturnType<typeof setInterval>[] = [];
  let scrolled = false;
  let mobileMenuOpen = false;
  let sectionObserver: IntersectionObserver | null = null;

  function navigateTo(section: 'signal' | 'portfolio' | 'intel') {
    $activeSection = section;
    mobileMenuOpen = false;
    if (typeof window !== 'undefined') {
      const el = document.getElementById(section);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function toggleLightMode() {
    $lightMode = !$lightMode;
    try { localStorage.setItem('sm_lightMode', String($lightMode)); } catch {}
  }

  // ── BINANCE WEBSOCKET — real-time BTC price ───────────────────
  // Uses the free, public, no-auth Binance aggTrade stream.
  // Each message delivers the latest executed trade price.
  const PRICE_HISTORY_SIZE = 60;          // rolling sparkline data points
  const HISTORY_UPDATE_INTERVAL_MS = 10_000; // push to history at most every 10 s
  const DAY_MS = 24 * 60 * 60 * 1000;   // milliseconds in one day

  let priceWs: WebSocket | null = null;
  let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let wsReconnectDelay = 2000; // ms, doubles on each failure (max 30s)
  let lastHistoryUpdate = 0;   // timestamp of last price-history push
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  function connectPriceWs() {
    if (typeof WebSocket === 'undefined') return;
    try {
      priceWs = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');

      priceWs.onopen = () => {
        $btcWsConnected = true;
        wsReconnectDelay = 2000; // reset backoff on success
      };

      priceWs.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          const price = parseFloat(msg.p);
          if (isNaN(price) || price <= 0) return;

          const prev = $btcPrice;
          $btcPrice = price;

          // Flash animation on direction change — 3 s debounced
          if (prev > 0 && price !== prev) {
            $priceFlash = price > prev ? 'up' : 'down';
            if (flashTimer) clearTimeout(flashTimer);
            flashTimer = setTimeout(() => { $priceFlash = ''; flashTimer = null; }, 3000);
          }

          // Add to rolling history at most once every HISTORY_UPDATE_INTERVAL_MS
          const now = Date.now();
          if (now - lastHistoryUpdate >= HISTORY_UPDATE_INTERVAL_MS) {
            lastHistoryUpdate = now;
            $priceHistory = [...$priceHistory.slice(-(PRICE_HISTORY_SIZE - 1)), price];
          }
        } catch {}
      };

      priceWs.onerror = () => {
        $btcWsConnected = false;
      };

      priceWs.onclose = () => {
        $btcWsConnected = false;
        priceWs = null;
        // Reconnect with exponential backoff (cap at 30 s)
        wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30_000);
        wsReconnectTimer = setTimeout(connectPriceWs, wsReconnectDelay);
      };
    } catch {
      $btcWsConnected = false;
    }
  }

  function disconnectPriceWs() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (priceWs) { priceWs.onclose = null; priceWs.close(); priceWs = null; }
    $btcWsConnected = false;
  }

  function tick() {
    $time = new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  async function fetchBtc() {
    try {
      const d = await fetch('/api/bitcoin').then(r=>r.json());
      // If WebSocket is connected, skip overwriting the real-time price
      if (!$btcWsConnected && d.price) {
        $prevPrice = $btcPrice;
        $btcPrice = d.price;
        if ($prevPrice && $btcPrice !== $prevPrice) {
          $priceFlash = $btcPrice > $prevPrice ? 'up' : 'down';
          if (flashTimer) clearTimeout(flashTimer);
          flashTimer = setTimeout(() => { $priceFlash = ''; flashTimer = null; }, 3000);
        }
        if ($btcPrice > 0) $priceHistory = [...$priceHistory.slice(-(PRICE_HISTORY_SIZE - 1)), $btcPrice];
      }
      $btcBlock = d.blockHeight ?? 0;
      $btcFees = d.fees ?? {low:0,medium:0,high:0};
      if (d.halving) {
        $halvingBlocksLeft = d.halving.blocksRemaining;
        $halvingDays = d.halving.daysRemaining;
        $halvingDate = d.halving.estimatedDate;
        $halvingProgress = d.halving.progressPct;
      }
      if (d.latestBlock) $latestBlock = d.latestBlock;
      if (d.mempool) $mempoolStats = d.mempool;
    } catch {}
  }

  async function fetchDCA() {
    try {
      const d = await fetch('/api/dca').then(r=>r.json());
      $fearGreed = d.fearGreed; $fearGreedLabel = d.fearGreedLabel;
      $difficultyChange = d.difficultyChange; $fundingRate = d.fundingRate; $audUsd = d.audUsd;
      if (typeof d.hashrate === 'number') $btcHashrate = parseFloat((d.hashrate / 1e18).toFixed(2));
      if (d.fxRates && typeof d.fxRates === 'object') $fxRates = d.fxRates;
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
      const urls = getEnabledFeedUrls($settings.news);
      const src = encodeURIComponent(JSON.stringify(urls));
      $newsItems = (await fetch(`/api/news?sources=${src}`).then(r=>r.json())).items ?? [];
    } catch {}
  }

  async function fetchMarkets() {
    try {
      const ytdStart = `${new Date().getFullYear()}-01-01`;
      const url = `/api/markets?since=${encodeURIComponent(ytdStart)}`;
      const d = await fetch(url).then(r=>r.json());
      $goldPriceUsd = d.gold?.priceUsd ?? null; $goldYtdPct = d.gold?.ytdPct ?? null;
      $sp500Price = d.sp500?.price ?? null; $sp500YtdPct = d.sp500?.ytdPct ?? null;
      $cpiAnnual = d.cpiAnnual ?? null;
      $btcYtdPct = d.btc?.ytdPct ?? null;
    } catch {}
  }

  async function fetchMa200() {
    try {
      const d = await fetch('/api/bitcoin/ma200').then(r=>r.json());
      $btcMa200 = d.ma200 ?? null;
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
        $gfDividendTotal = d.dividendTotal ?? null;
        $gfDividendYtd   = d.dividendYtd   ?? null;
        $gfCash          = d.cash          ?? null;
        $gfAnnualizedPct = d.annualizedPerformancePct ?? null;
        $gfFirstOrderDate = d.firstOrderDate ?? null;
        $gfOrdersCount   = d.ordersCount   ?? null;
        $gfUpdated = new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});
      }
    } catch { $gfError = 'Connection failed'; } finally { $gfLoading = false; }
  }

  function saveAll() {
    persistSettings($settings);
    fetchPoly(); fetchNews(); fetchMarkets();
    if ($settings.ghostfolio?.token) fetchGhostfolio();
  }

  function handleAddKeyword() {
    if (newKeyword.trim()) { $settings.polymarket.keywords = [...$settings.polymarket.keywords, newKeyword.trim()]; newKeyword = ''; }
  }
  function removeKeyword(i:number) { $settings.polymarket.keywords = $settings.polymarket.keywords.filter((_,j)=>j!==i); }
  function handleAddSource() {
    if (newSource.trim()) {
      const name = newSourceName.trim() || (() => { try { return new URL(newSource.trim()).hostname.replace('www.','').replace('feeds.',''); } catch { return 'Custom'; } })();
      $settings.news.customFeeds = [...$settings.news.customFeeds, { url: newSource.trim(), name, enabled: true }];
      newSource = ''; newSourceName = '';
    }
  }
  function removeSource(i:number) { $settings.news.customFeeds = $settings.news.customFeeds.filter((_,j)=>j!==i); }
  function toggleDefaultFeed(i:number) { $settings.news.defaultFeeds[i].enabled = !$settings.news.defaultFeeds[i].enabled; $settings.news.defaultFeeds = [...$settings.news.defaultFeeds]; }
  function toggleCustomFeed(i:number) { $settings.news.customFeeds[i].enabled = !$settings.news.customFeeds[i].enabled; $settings.news.customFeeds = [...$settings.news.customFeeds]; }

  function handleScroll() { scrolled = window.scrollY > 40; }
  function toggleMobileMenu() { mobileMenuOpen = !mobileMenuOpen; if (mobileMenuOpen) $showSettings = false; }
  function closeMobileMenu() { mobileMenuOpen = false; }

  // Apply light/dark mode to <html>
  $: if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('light', $lightMode);
  }

  onMount(() => {
    $settings = loadSettings();
    // Restore light mode preference
    try { const lm = localStorage.getItem('sm_lightMode'); if (lm !== null) $lightMode = lm === 'true'; } catch {}
    tick();
    clockInterval = setInterval(tick, 1000);
    fetchBtc(); fetchDCA(); fetchPoly(); fetchNews(); fetchMarkets(); fetchMa200();
    if ($settings.ghostfolio?.token) fetchGhostfolio();
    // Start WebSocket for real-time price; keep 60s poll for block/fee/mempool data
    connectPriceWs();
    intervals = [
      setInterval(fetchBtc, 60000), setInterval(fetchDCA, 300000),
      setInterval(fetchPoly, 300000), setInterval(fetchNews, 300000),
      setInterval(fetchMarkets, 60000),
      setInterval(fetchMa200, DAY_MS), // refresh MA200 once per day
      setInterval(() => { if ($settings.ghostfolio?.token) fetchGhostfolio(); }, 300000),
    ];
    window.addEventListener('scroll', handleScroll, {passive:true});

    // ── INTERSECTION OBSERVER — track active section on scroll ─
    const sectionIds: Array<'signal' | 'portfolio' | 'intel'> = ['signal', 'portfolio', 'intel'];
    sectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
            $activeSection = entry.target.id as 'signal' | 'portfolio' | 'intel';
          }
        }
      },
      { threshold: 0.3 }
    );
    // Wait for the next animation frame so the page sections are rendered before observing
    requestAnimationFrame(() => {
      sectionIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && sectionObserver) sectionObserver.observe(el);
      });
    });


    // Subtle network visualization: semi-static anchor nodes with faint
    // connections, data packets traveling between them, and expanding pings.
    (function() {
      const canvas = document.getElementById('net-canvas') as HTMLCanvasElement;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      let W: number, H: number, animId: number;
      const ORANGE = 'rgba(247,147,26,';
      const ELECTRIC = 'rgba(0,200,255,';

      function isMobile() { return window.innerWidth < 768; }
      const NODE_COUNT = () => isMobile() ? 16 : 32;
      const CONN_DIST = () => isMobile() ? 180 : 220;

      let resizeTimer: any;
      function resize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; init(); }, 200);
        if (!W) { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
      }

      class Node {
        x: number; y: number; baseX: number; baseY: number;
        driftAngle: number; driftSpeed: number; radius: number;
        constructor() {
          this.baseX = this.x = Math.random() * (W || window.innerWidth);
          this.baseY = this.y = Math.random() * (H || window.innerHeight);
          this.driftAngle = Math.random() * Math.PI * 2;
          this.driftSpeed = 0.001 + Math.random() * 0.002;
          this.radius = 1.5 + Math.random() * 1.5;
        }
        update() {
          this.driftAngle += this.driftSpeed;
          this.x = this.baseX + Math.sin(this.driftAngle) * 12;
          this.y = this.baseY + Math.cos(this.driftAngle * 0.7) * 10;
        }
        draw() {
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
          ctx.fillStyle = ORANGE + '0.25)';
          ctx.fill();
        }
      }

      class Transmission {
        from: Node; to: Node; progress: number; speed: number; hue: string; size: number;
        trail: {x:number,y:number,a:number}[];
        constructor(from: Node, to: Node) {
          this.from = from; this.to = to;
          this.progress = 0;
          this.speed = 0.008 + Math.random() * 0.012;
          this.hue = Math.random() < 0.7 ? 'o' : 'e';
          this.size = 1.5 + Math.random() * 1.5;
          this.trail = [];
        }
        update(): boolean {
          this.progress += this.speed;
          const x = this.from.x + (this.to.x - this.from.x) * this.progress;
          const y = this.from.y + (this.to.y - this.from.y) * this.progress;
          this.trail.push({x, y, a: 1});
          if (this.trail.length > 12) this.trail.shift();
          this.trail.forEach(t => t.a *= 0.88);
          return this.progress >= 1;
        }
        draw() {
          const col = this.hue === 'o' ? ORANGE : ELECTRIC;
          // Trail
          for (const t of this.trail) {
            ctx.beginPath();
            ctx.arc(t.x, t.y, this.size * t.a * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = col + (t.a * 0.3) + ')';
            ctx.fill();
          }
          // Head
          const x = this.from.x + (this.to.x - this.from.x) * this.progress;
          const y = this.from.y + (this.to.y - this.from.y) * this.progress;
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fillStyle = col + '0.7)';
          ctx.shadowBlur = 6;
          ctx.shadowColor = col + '0.5)';
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      class Ping {
        x: number; y: number; radius: number; maxRadius: number; alpha: number;
        constructor(x: number, y: number) {
          this.x = x; this.y = y;
          this.radius = 2; this.maxRadius = 18 + Math.random() * 12;
          this.alpha = 0.5;
        }
        update(): boolean {
          this.radius += 0.4;
          this.alpha *= 0.96;
          return this.radius >= this.maxRadius || this.alpha < 0.02;
        }
        draw() {
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
          ctx.strokeStyle = ORANGE + this.alpha + ')';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      let nodes: Node[] = [];
      let transmissions: Transmission[] = [];
      let pings: Ping[] = [];
      let spawnTimer = 0;

      function init() {
        nodes = [];
        transmissions = [];
        pings = [];
        for (let i = 0; i < NODE_COUNT(); i++) nodes.push(new Node());
      }

      function spawnTransmission() {
        if (nodes.length < 2) return;
        const a = nodes[Math.floor(Math.random() * nodes.length)];
        // Find a nearby node
        let best: Node | null = null, bestDist = Infinity;
        for (const n of nodes) {
          if (n === a) continue;
          const dx = n.x - a.x, dy = n.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < CONN_DIST() && d < bestDist) { best = n; bestDist = d; }
        }
        if (best) transmissions.push(new Transmission(a, best));
      }

      function loop() {
        ctx.clearRect(0, 0, W, H);

        // Draw faint connections
        const cd = CONN_DIST();
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < cd) {
              const a = (1 - dist / cd) * 0.04;
              ctx.beginPath();
              ctx.moveTo(nodes[i].x, nodes[i].y);
              ctx.lineTo(nodes[j].x, nodes[j].y);
              ctx.strokeStyle = ORANGE + a + ')';
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }

        // Update & draw nodes
        nodes.forEach(n => { n.update(); n.draw(); });

        // Spawn transmissions periodically
        spawnTimer++;
        const spawnRate = isMobile() ? 90 : 50;
        if (spawnTimer >= spawnRate) {
          spawnTransmission();
          // Occasional burst
          if (Math.random() < 0.2) { spawnTransmission(); spawnTransmission(); }
          spawnTimer = 0;
        }

        // Update & draw transmissions
        transmissions = transmissions.filter(t => {
          const done = t.update();
          t.draw();
          if (done) pings.push(new Ping(t.to.x, t.to.y));
          return !done;
        });

        // Update & draw pings
        pings = pings.filter(p => { const done = p.update(); p.draw(); return !done; });

        animId = requestAnimationFrame(loop);
      }

      resize(); init(); loop();
      window.addEventListener('resize', resize, { passive: true });
    })();
  });

  onDestroy(() => {
    clearInterval(clockInterval);
    intervals.forEach(clearInterval);
    disconnectPriceWs();
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    window.removeEventListener('scroll', handleScroll);
    if (sectionObserver) sectionObserver.disconnect();
  });
</script>

<canvas id="net-canvas" aria-hidden="true"></canvas>

<!-- ══ SKIP NAVIGATION ═══════════════════════════════════════ -->
<a href="#main-content" class="skip-link">Skip to main content</a>

<!-- ══ HEADER ════════════════════════════════════════════════ -->
<header class="hdr" class:hdr--scrolled={scrolled} role="banner">

  <!-- Brand — always left -->
  <a href="/" class="brand" aria-label="gl4nce home">
    <div class="globe-wrap" aria-hidden="true">
      <div class="globe">
        <div class="wire w-eq"></div><div class="wire w-lg1"></div>
        <div class="wire w-lg2"></div><div class="wire w-lt1"></div><div class="wire w-lt2"></div>
        <div class="ping ping-1"></div><div class="ping ping-2"></div>
        <div class="ping ping-3"></div><div class="ping ping-4"></div><div class="ping ping-5"></div>
      </div>
    </div>
    <span class="brand-name" aria-hidden="true">
      <span class="b-gl">gl</span><span class="b-4">4</span><span class="b-nce">nce</span><span class="b-dot">.</span>
    </span>
  </a>

  <!-- Desktop nav — left-aligned after brand (Electric Xtra style) -->
  <nav class="page-nav desktop-only" aria-label="Main navigation">
    <button class="nav-link" class:nav-link--active={$activeSection==='signal'}    on:click={()=>navigateTo('signal')}>₿ Signal</button>
    <button class="nav-link" class:nav-link--active={$activeSection==='portfolio'} on:click={()=>navigateTo('portfolio')}>↗ Portfolio</button>
    <button class="nav-link" class:nav-link--active={$activeSection==='intel'}     on:click={()=>navigateTo('intel')}>◈ Intel</button>
  </nav>

  <!-- Spacer pushes right controls to far right on desktop -->
  <div class="hdr-spacer" aria-hidden="true"></div>

  <!-- Desktop right controls -->
  <div class="hdr-right desktop-only">
    <time class="hdr-clock" aria-label="Current time">{$time}</time>
    <!-- Live price feed status -->
    <span class="ws-badge" class:ws-badge--live={$btcWsConnected}
      role="status"
      aria-label="{$btcWsConnected?'Live price feed connected':'Price polling fallback'}"
      title="{$btcWsConnected?'Live price feed connected (Binance WebSocket)':'Price polling fallback — attempting live connection…'}">
      <span class="ws-dot" aria-hidden="true"></span>{$btcWsConnected?'LIVE':'POLL'}
    </span>

    <!-- Dark/Light mode toggle -->
    <button class="mode-toggle btn-ghost" on:click={toggleLightMode}
      aria-label="Switch to {$lightMode ? 'dark' : 'light'} mode">
      {#if $lightMode}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
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
      on:click={() => { $showSettings = !$showSettings; mobileMenuOpen = false; }}
      aria-label="Settings" aria-expanded={$showSettings} aria-controls="settings-drawer">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>
  </div>

  <!-- Mobile burger — only visible on small screens -->
  <button class="burger mobile-only" on:click={toggleMobileMenu}
    aria-label="{mobileMenuOpen ? 'Close menu' : 'Open menu'}"
    aria-expanded={mobileMenuOpen} aria-controls="mobile-menu"
    class:burger--open={mobileMenuOpen}>
    <span></span><span></span><span></span>
  </button>

</header>

<!-- ══ SETTINGS DRAWER (desktop) ══════════════════════════════ -->
{#if $showSettings}
<div class="drawer" id="settings-drawer" role="region" aria-label="Settings">
  <div class="drawer-inner">
    <div class="dg"><p class="dg-hd">DCA Stack</p>
      <div class="dfields">
        <label class="df"><span class="dlbl">Start date</span><input type="date" bind:value={$settings.dca.startDate} class="dinp"/></label>
        <label class="df"><span class="dlbl">Daily AUD</span><input type="number" bind:value={$settings.dca.dailyAmount} class="dinp"/></label>
        <label class="df"><span class="dlbl">BTC held</span><input type="number" step="0.00000001" bind:value={$settings.dca.btcHeld} class="dinp"/></label>
        <label class="df"><span class="dlbl">Goal BTC</span><input type="number" step="0.001" bind:value={$settings.dca.goalBtc} class="dinp"/></label>
        <label class="df"><span class="dlbl">Low Price (USD)</span><input type="number" bind:value={$settings.dca.lowPrice} class="dinp"/></label>
        <label class="df"><span class="dlbl">High Price (USD)</span><input type="number" bind:value={$settings.dca.highPrice} class="dinp"/></label>
        <label class="df"><span class="dlbl">Max DCA (AUD)</span><input type="number" bind:value={$settings.dca.maxDcaAud} class="dinp"/></label>
        <label class="df"><span class="dlbl">DCA Frequency</span>
          <select bind:value={$settings.dca.dcaFrequency} class="dinp">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
      </div>
    </div>
    <div class="dg"><p class="dg-hd">Display Currency <span class="dhint">BTC price second currency</span></p>
      <div class="dfields" style="align-items:flex-end;">
        <label class="df" style="max-width:120px;">
          <span class="dlbl">Currency code</span>
          <input bind:value={$settings.displayCurrency} placeholder="AUD" class="dinp" style="text-transform:uppercase;" maxlength="3"/>
        </label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding-bottom:2px;">
          {#each ['AUD','EUR','GBP','CAD','JPY','CHF','NZD','SGD'] as c}
            <button class="curr-preset" class:curr-preset--active={($settings.displayCurrency||'AUD').toUpperCase()===c}
              on:click={()=>$settings.displayCurrency=c}>{c}</button>
          {/each}
        </div>
      </div>
    </div>
    <div class="dg"><p class="dg-hd">Watchlist <span class="dhint">pinned in markets</span></p>
      <div class="dtags">{#each $settings.polymarket.keywords as kw,i}<span class="dtag">{kw}<button on:click={()=>removeKeyword(i)} class="dtag-x">×</button></span>{/each}</div>
      <div class="dinp-row"><input bind:value={newKeyword} on:keydown={(e)=>e.key==='Enter'&&handleAddKeyword()} placeholder="Add keyword…" class="dinp"/><button on:click={handleAddKeyword} class="btn-ghost" style="white-space:nowrap;">Add</button></div>
    </div>
    <div class="dg"><p class="dg-hd">News Feeds <span class="dhint">toggle on/off · add custom</span></p>
      <p class="dlbl" style="margin-bottom:6px;">Default Feeds</p>
      <div class="feed-list">
        {#each $settings.news.defaultFeeds as feed, i}
          <label class="feed-toggle">
            <input type="checkbox" checked={feed.enabled} on:change={()=>toggleDefaultFeed(i)} />
            <span class="feed-name">{feed.name}</span>
          </label>
        {/each}
      </div>
      {#if $settings.news.customFeeds.length>0}
      <p class="dlbl" style="margin:12px 0 6px;">Custom Feeds</p>
      <div class="feed-list">
        {#each $settings.news.customFeeds as feed, i}
          <div class="feed-custom">
            <label class="feed-toggle">
              <input type="checkbox" checked={feed.enabled} on:change={()=>toggleCustomFeed(i)} />
              <span class="feed-name">{feed.name}</span>
            </label>
            <button on:click={()=>removeSource(i)} class="dtag-x" title="Remove">×</button>
          </div>
        {/each}
      </div>
      {/if}
      <p class="dlbl" style="margin:12px 0 6px;">Add Custom Feed</p>
      <div class="dinp-row"><input type="url" bind:value={newSource} on:keydown={(e)=>e.key==='Enter'&&handleAddSource()} placeholder="https://example.com/feed.xml" class="dinp" style="flex:2;"/><input bind:value={newSourceName} placeholder="Feed name (optional)" class="dinp" style="flex:1;"/><button on:click={handleAddSource} class="btn-ghost" style="white-space:nowrap;">Add</button></div>
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
<div class="mobile-menu" id="mobile-menu" role="dialog" aria-modal="true" aria-label="Settings menu">
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="mobile-menu-backdrop" on:click={closeMobileMenu}></div>
  <div class="mobile-menu-panel">
    <!-- Settings inline in mobile menu -->
    <p class="mobile-section-title">Settings</p>
    <div class="mobile-settings">
      <div class="dg"><p class="dg-hd">DCA Stack</p>
        <div class="dfields">
          <label class="df"><span class="dlbl">Start date</span><input type="date" bind:value={$settings.dca.startDate} class="dinp"/></label>
          <label class="df"><span class="dlbl">Daily AUD</span><input type="number" bind:value={$settings.dca.dailyAmount} class="dinp"/></label>
          <label class="df"><span class="dlbl">BTC held</span><input type="number" step="0.00000001" bind:value={$settings.dca.btcHeld} class="dinp"/></label>
          <label class="df"><span class="dlbl">Goal BTC</span><input type="number" step="0.001" bind:value={$settings.dca.goalBtc} class="dinp"/></label>
          <label class="df"><span class="dlbl">Low Price (USD)</span><input type="number" bind:value={$settings.dca.lowPrice} class="dinp"/></label>
          <label class="df"><span class="dlbl">High Price (USD)</span><input type="number" bind:value={$settings.dca.highPrice} class="dinp"/></label>
          <label class="df"><span class="dlbl">Max DCA (AUD)</span><input type="number" bind:value={$settings.dca.maxDcaAud} class="dinp"/></label>
          <label class="df"><span class="dlbl">DCA Frequency</span>
            <select bind:value={$settings.dca.dcaFrequency} class="dinp">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
      </div>
      <div class="dg"><p class="dg-hd">News Feeds</p>
        <div class="feed-list">
          {#each $settings.news.defaultFeeds as feed, i}
            <label class="feed-toggle">
              <input type="checkbox" checked={feed.enabled} on:change={()=>toggleDefaultFeed(i)} />
              <span class="feed-name">{feed.name}</span>
            </label>
          {/each}
        </div>
        {#if $settings.news.customFeeds.length>0}
        <div class="feed-list" style="margin-top:6px;">
          {#each $settings.news.customFeeds as feed, i}
            <div class="feed-custom">
              <label class="feed-toggle">
                <input type="checkbox" checked={feed.enabled} on:change={()=>toggleCustomFeed(i)} />
                <span class="feed-name">{feed.name}</span>
              </label>
              <button on:click={()=>removeSource(i)} class="dtag-x" aria-label="Remove {feed.name}">×</button>
            </div>
          {/each}
        </div>
        {/if}
      </div>
      <div class="dg"><p class="dg-hd">Ghostfolio Token</p>
        <label class="df"><span class="dlbl">Security token</span><input type="password" bind:value={$settings.ghostfolio.token} placeholder="your-security-token" class="dinp"/></label>
      </div>
      <button on:click={() => { saveAll(); closeMobileMenu(); }} class="btn-primary" style="width:100%;">{$saved?'✓ Saved':'Save Settings'}</button>
    </div>
  </div>
</div>
{/if}

<!-- ══ MOBILE BOTTOM TABS ═════════════════════════════════════ -->
<nav class="mobile-tabs mobile-only" aria-label="Section navigation">
  <button class="tab-btn" class:tab-btn--active={$activeSection==='signal'} on:click={()=>navigateTo('signal')} aria-label="Signal section">
    <span class="tab-icon" aria-hidden="true">₿</span>
    <span class="tab-label">Signal</span>
  </button>
  <button class="tab-btn" class:tab-btn--active={$activeSection==='portfolio'} on:click={()=>navigateTo('portfolio')} aria-label="Portfolio section">
    <span class="tab-icon" aria-hidden="true">↗</span>
    <span class="tab-label">Portfolio</span>
  </button>
  <button class="tab-btn" class:tab-btn--active={$activeSection==='intel'} on:click={()=>navigateTo('intel')} aria-label="Intel section">
    <span class="tab-icon" aria-hidden="true">◈</span>
    <span class="tab-label">Intel</span>
  </button>
  <button class="tab-btn" on:click={toggleLightMode} aria-label="Switch to {$lightMode ? 'dark' : 'light'} mode">
    <span class="tab-icon" aria-hidden="true">{$lightMode ? '☀' : '☾'}</span>
    <span class="tab-label">Theme</span>
  </button>
</nav>

<!-- ══ PAGE ═══════════════════════════════════════════════════ -->
<main class="page-wrap" id="main-content" role="main"><slot /></main>

<!-- ══ FOOTER ════════════════════════════════════════════════ -->
<footer class="site-footer" role="contentinfo">
  <span class="footer-brand">gl<span style="color:var(--orange);">4</span>nce.</span>
  <span class="footer-sources">mempool.space · alternative.me · binance · exchangerate-api · ghostfol.io · worldbank</span>
</footer>

<style>
  /* Canvas */
  #net-canvas { position:fixed; inset:0; width:100%; height:100%; z-index:-1; pointer-events:none; will-change:transform; transition:opacity .5s; }
  :global(html.light) #net-canvas { opacity:0.2; }

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
    background:none; cursor:pointer;
  }
  .nav-link::after {
    content:''; position:absolute; bottom:0; left:0; width:0; height:2px;
    background:linear-gradient(90deg,#f7931a,#00c8ff);
    box-shadow:0 0 8px rgba(247,147,26,.7); transition:width .3s ease;
  }
  .nav-link:hover { color:rgba(255,255,255,.9); border-color:rgba(247,147,26,.3); box-shadow:inset 0 0 12px rgba(247,147,26,.08); }
  .nav-link:hover::after { width:100%; }
  .nav-link--active { color:var(--orange)!important; border-color:rgba(247,147,26,.3)!important; }
  .nav-link--active::after { width:100%!important; }

  /* Spacer pushes clock/settings to far right */
  .hdr-spacer { flex:1; }

  /* Right controls */
  .hdr-right { display:flex; align-items:center; gap:10px; flex-shrink:0; }
  .hdr-clock { font-size:.7rem; font-weight:500; color:rgba(255,255,255,.22); font-variant-numeric:tabular-nums; letter-spacing:.07em; margin-right:4px; }
  /* Live price feed badge */
  .ws-badge {
    display:flex; align-items:center; gap:5px;
    font-size:.52rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
    font-family:'Orbitron',monospace;
    color:rgba(255,255,255,.22); background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.08); border-radius:3px; padding:3px 8px;
    transition:all .5s;
  }
  .ws-badge--live { color:var(--up); border-color:rgba(34,197,94,.25); background:rgba(34,197,94,.06); }
  .ws-dot {
    width:6px; height:6px; border-radius:50%; background:currentColor; flex-shrink:0;
    box-shadow:0 0 0 2px transparent;
  }
  .ws-badge--live .ws-dot { animation:wsPulse 2s ease-in-out infinite; box-shadow:0 0 8px var(--up); }
  @keyframes wsPulse { 0%,100%{opacity:1} 50%{opacity:.4} }
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
    background:rgba(247,147,26,.1); border:1px solid rgba(247,147,26,.4);
    border-radius:3px; cursor:pointer; transition:border-color .2s;
  }
  .burger span {
    display:block; height:2px; width:100%; background:var(--orange);
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
  }
  .mobile-menu-backdrop {
    position:absolute; inset:0;
    background:rgba(0,0,0,.55); backdrop-filter:blur(4px);
    cursor:pointer;
  }
  .mobile-menu-panel {
    position:absolute; top:54px; left:0; right:0;
    background:rgba(10,10,10,.97); backdrop-filter:blur(28px);
    border-bottom:1px solid rgba(247,147,26,.2);
    padding:0 0 24px; max-height:calc(100vh - 54px - 60px); overflow-y:auto;
  }
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
  .mobile-settings { padding:0 20px; display:flex; flex-direction:column; gap:18px; }

  /* ── MOBILE BOTTOM TABS ──────────────────────────────────── */
  .mobile-tabs {
    position:fixed; bottom:0; left:0; right:0; z-index:300;
    background:rgba(10,10,10,.97); backdrop-filter:blur(20px);
    -webkit-backdrop-filter:blur(20px);
    border-top:1px solid rgba(247,147,26,.18);
    padding:0; height:60px;
  }
  .tab-btn {
    flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:3px; background:none; border:none; cursor:pointer;
    color:rgba(255,255,255,.4); transition:color .2s;
    padding:8px 4px; height:100%;
  }
  .tab-btn:hover { color:rgba(255,255,255,.75); }
  .tab-btn--active { color:var(--orange); }
  .tab-icon { font-size:1.1rem; line-height:1; }
  .tab-label { font-size:.55rem; font-weight:700; text-transform:uppercase; letter-spacing:.1em; font-family:'Orbitron',monospace; }
  :global(html.light) .mobile-tabs { background:rgba(255,255,255,.97); border-top-color:rgba(0,0,0,.1); }
  :global(html.light) .tab-btn { color:rgba(0,0,0,.4); }
  :global(html.light) .tab-btn:hover { color:rgba(0,0,0,.75); }
  :global(html.light) .tab-btn--active { color:var(--orange); }

  /* ── SETTINGS DRAWER (desktop) ───────────────────────────── */
  .drawer {
    position: fixed; top: 64px; left: 0; right: 0; z-index: 200;
    overflow-y: auto; max-height: calc(100vh - 64px);
    background:rgba(8,8,8,.97); backdrop-filter:blur(24px);
    border-bottom:1px solid rgba(247,147,26,.15);
  }
  @media (max-width:768px) { .drawer { top: 54px; max-height: calc(100vh - 54px); } }
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
  .dinp-row { display:flex; gap:8px; flex-wrap:wrap; }
  .dinp-row .dinp { min-width:120px; }
  .dsrcs { max-height:68px; overflow-y:auto; margin-bottom:8px; }
  .curr-preset { padding:4px 10px; font-size:.62rem; font-weight:600; font-family:'Orbitron',monospace; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1); border-radius:3px; color:rgba(255,255,255,.4); cursor:pointer; transition:all .2s; letter-spacing:.04em; }
  .curr-preset:hover { border-color:rgba(247,147,26,.3); color:var(--orange); }
  .curr-preset--active { background:rgba(247,147,26,.15); border-color:var(--orange)!important; color:var(--orange)!important; }
  :global(html.light) .curr-preset { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.1); color:rgba(0,0,0,.5); }
  :global(html.light) .curr-preset--active { background:rgba(247,147,26,.1); }
  .dsrc { display:flex; justify-content:space-between; align-items:center; padding:3px 0; font-size:.62rem; color:rgba(255,255,255,.25); }
  .dsrc-url { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:300px; }
  .d-save--ok { background:linear-gradient(45deg,#22c55e,#15803d)!important; }

  /* ── PAGE WRAP ───────────────────────────────────────────── */
  .page-wrap { padding-top:64px; min-height:100vh; }
  @media (max-width:768px) { .page-wrap { padding-top:54px; padding-bottom:64px; } }

  /* ── FEED TOGGLES ──────────────────────────────────────────── */
  .feed-list { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
  .feed-toggle { display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 10px; border-radius:3px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); transition:all .2s; font-size:.68rem; color:var(--t2); }
  .feed-toggle:hover { border-color:rgba(247,147,26,.2); }
  .feed-toggle input[type="checkbox"] { accent-color:var(--orange); width:13px; height:13px; cursor:pointer; }
  .feed-toggle input[type="checkbox"]:checked + .feed-name { color:var(--t1); }
  .feed-name { font-size:.65rem; font-weight:500; transition:color .2s; }
  .feed-custom { display:flex; align-items:center; gap:4px; }
  :global(html.light) .feed-toggle { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.08); }
  :global(html.light) .feed-toggle:hover { border-color:rgba(247,147,26,.3); }

  /* ── FOOTER ──────────────────────────────────────────────── */
  .site-footer { border-top:1px solid rgba(247,147,26,.12); padding:18px 32px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; background:rgba(0,0,0,.5); }
  .footer-brand { font-family:'Orbitron',monospace; font-size:.62rem; font-weight:900; color:rgba(255,255,255,.25); letter-spacing:.1em; }
  .footer-sources { font-size:.56rem; color:rgba(255,255,255,.14); }
  @media (max-width:600px) { .site-footer { display:none; } }

  /* ── LIGHT MODE ──────────────────────────────────────────── */
  :global(html.light) { --bg:#f4f4f5; --bg2:#eaeaeb; --glass-bg:rgba(255,255,255,.72); --glass-bg2:rgba(255,255,255,.85); --glass-bd:rgba(0,0,0,.12); --glass-bd2:rgba(0,0,0,.18); --t1:#111; --t2:#444; --t3:#aaa; --up:#16a34a; --dn:#dc2626; }
  :global(html.light) body { background:#f0f0f1; color:#111; }
  :global(html.light) body::before { background: radial-gradient(circle at 15% 85%,rgba(247,147,26,.10) 0%,transparent 42%), radial-gradient(circle at 85% 10%,rgba(0,180,255,.06) 0%,transparent 42%); }
  :global(html.light) body::after { background: linear-gradient(transparent 50%, rgba(0,0,0,0.008) 50%); }
  :global(html.light) .hdr { background:rgba(255,255,255,.92); border-bottom-color:rgba(0,0,0,.08); }
  :global(html.light) .hdr--scrolled { background:rgba(255,255,255,.97); box-shadow:0 2px 12px rgba(0,0,0,.08); }
  :global(html.light) .b-gl,:global(html.light) .b-nce { color:#111; }
  :global(html.light) .hdr-clock { color:rgba(0,0,0,.45); }
  :global(html.light) .nav-link { color:rgba(0,0,0,.55); }
  :global(html.light) .nav-link:hover { color:#111; border-color:rgba(247,147,26,.4); }
  :global(html.light) .nav-link--active { color:#c77a10!important; border-color:rgba(247,147,26,.4)!important; }
  :global(html.light) .drawer { background:rgba(255,255,255,.98); border-bottom-color:rgba(0,0,0,.08); }
  :global(html.light) .dinp { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.15); color:#111; }
  :global(html.light) .dinp:focus { border-color:var(--orange); }
  :global(html.light) .dg-hd { color:rgba(0,0,0,.7); }
  :global(html.light) .dhint { color:rgba(0,0,0,.35); }
  :global(html.light) .dlbl { color:rgba(0,0,0,.5); }
  :global(html.light) .dtag { background:rgba(247,147,26,.08); border-color:rgba(247,147,26,.25); color:rgba(0,0,0,.6); }
  :global(html.light) .dtag-x { color:rgba(0,0,0,.3); }
  :global(html.light) .site-footer { background:rgba(255,255,255,.7); border-top-color:rgba(0,0,0,.06); }
  :global(html.light) .footer-brand { color:rgba(0,0,0,.4); }
  :global(html.light) .footer-sources { color:rgba(0,0,0,.3); }
  :global(html.light) .mobile-menu-panel { background:rgba(255,255,255,.98); }
  :global(html.light) .mobile-menu-backdrop { background:rgba(0,0,0,.25); }
  :global(html.light) .mobile-nav-link { color:rgba(0,0,0,.75); border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .mobile-theme-toggle { color:rgba(0,0,0,.6); }
  :global(html.light) .mobile-section-title { color:rgba(247,147,26,.9); }
  :global(html.light) .btn-ghost { color:rgba(0,0,0,.5); border-color:rgba(0,0,0,.12); background:rgba(0,0,0,.02); }
  :global(html.light) .btn-ghost:hover { color:var(--orange); border-color:rgba(247,147,26,.3); background:rgba(247,147,26,.06); }
  :global(html.light) .burger span { background:rgba(0,0,0,.8); }
  :global(html.light) .burger { background:rgba(0,0,0,.06); border-color:rgba(0,0,0,.15); }

  /* Light mode — page-level glass cards and content */
  :global(html.light) .gc { background:rgba(255,255,255,.72); border-color:rgba(0,0,0,.08); box-shadow:0 2px 16px rgba(0,0,0,.06),inset 0 1px 0 rgba(255,255,255,.9); backdrop-filter:blur(16px); }
  :global(html.light) .gc::before { background:linear-gradient(90deg,transparent,rgba(247,147,26,.15),transparent); }
  :global(html.light) .gc:hover { border-color:rgba(247,147,26,.2); box-shadow:0 4px 24px rgba(0,0,0,.1); }
  :global(html.light) .gc-title { color:#111; }
  :global(html.light) .eyebrow { color:rgba(0,0,0,.4); }
  :global(html.light) .eyebrow.orange { color:#c77a10; }
  :global(html.light) .dim { color:rgba(0,0,0,.4); }
  :global(html.light) .ts { color:rgba(0,0,0,.3); }
  :global(html.light) .stat-tile { background:rgba(255,255,255,.65); border-color:rgba(0,0,0,.08); }
  :global(html.light) .stat-tile:hover { border-color:rgba(247,147,26,.25); box-shadow:0 6px 20px rgba(0,0,0,.08); }
  :global(html.light) .stat-n { color:#111; }
  :global(html.light) .stat-l { color:rgba(0,0,0,.4); }
  :global(html.light) .met-n { color:#111; }
  :global(html.light) .met-u { color:rgba(0,0,0,.35); }
  :global(html.light) .sig-label { color:rgba(0,0,0,.75); }
  :global(html.light) .pbar { background:rgba(0,0,0,.06); }
  :global(html.light) .vband-track { background:rgba(0,0,0,.06); }
  :global(html.light) .dca-sub { color:rgba(0,0,0,.3); }
  :global(html.light) .muted { color:rgba(0,0,0,.1); }
  :global(html.light) .halving-days { color:#c77a10; }
  :global(html.light) .halving-u { color:rgba(200,120,20,.7); }
  :global(html.light) .btc-pill { background:rgba(247,147,26,.06); border-color:rgba(247,147,26,.15); }
  :global(html.light) .ap { background:rgba(255,255,255,.55); border-color:rgba(0,0,0,.06); }
  :global(html.light) .ap:hover { border-color:rgba(0,0,0,.12); }
  :global(html.light) .ap-name { color:rgba(0,0,0,.4); }
  :global(html.light) .ap-sub { color:rgba(0,0,0,.35); }
  :global(html.light) .gf-nw { color:#111; }
  :global(html.light) .gf-perf { border-left-color:rgba(0,0,0,.08); }
  :global(html.light) .bench { border-color:rgba(0,0,0,.08); background:rgba(0,0,0,.02); }
  :global(html.light) .bench-c { border-right-color:rgba(0,0,0,.06); }
  :global(html.light) .bench-v { color:#111; }
  :global(html.light) .h-card { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.06); }
  :global(html.light) .h-card:hover { border-color:rgba(247,147,26,.2); }
  :global(html.light) .h-sym { color:#111; }
  :global(html.light) .h-name { color:rgba(0,0,0,.4); }
  :global(html.light) .h-foot { color:rgba(0,0,0,.35); }
  :global(html.light) .mkt { border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .mkt-tag { background:rgba(0,0,0,.04); border-color:rgba(0,0,0,.08); color:rgba(0,0,0,.45); }
  :global(html.light) .mkt-pin { background:rgba(247,147,26,.08); border-color:rgba(247,147,26,.2); color:#c77a10; }
  :global(html.light) .mkt-q { color:rgba(0,0,0,.6); }
  :global(html.light) .mkt-q:hover { color:#111; }
  :global(html.light) .news { border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .news-title { color:rgba(0,0,0,.6); }
  :global(html.light) .news-title:hover { color:#111; }
  :global(html.light) .news-src { color:#c77a10; }
  :global(html.light) .sigs { border-top-color:rgba(0,0,0,.06); }
  :global(html.light) .pip { background:rgba(0,0,0,.08); border-color:rgba(0,0,0,.12); }
  :global(html.light) .sig-badge { background:rgba(247,147,26,.08); border-color:rgba(247,147,26,.2); color:#c77a10; }
  :global(html.light) .err-msg { background:rgba(220,38,38,.06); border-color:rgba(220,38,38,.2); }
  :global(html.light) .holdings-wrap { border-top-color:rgba(0,0,0,.06); }
  :global(html.light) .live-badge { color:rgba(0,0,0,.45); }
  :global(html.light) .ws-badge { color:rgba(0,0,0,.3); background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.08); }
  :global(html.light) .ws-badge--live { color:var(--up); background:rgba(22,163,74,.06); border-color:rgba(22,163,74,.2); }
  :global(html.light) .section-divider { background:linear-gradient(90deg,transparent,rgba(247,147,26,.3),rgba(0,200,255,.15),transparent); }
  :global(html.light) .sect-title { background:linear-gradient(45deg,#c77a10,#0090cc); -webkit-background-clip:text; background-clip:text; }

  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  :global(.blink){animation:blink 2s step-end infinite;}
</style>
