<script lang="ts">
  import '../app.css';
  import { onMount, onDestroy } from 'svelte';
  import { loadSettings, getEnabledFeedUrls } from '$lib/settings';
  import type { FeedCategory } from '$lib/settings';
  import {
    settings, showSettings, saved, time, lightMode, activeSection,
    btcPrice, prevPrice, priceFlash, priceHistory, btcBlock, btcFees,
    halvingBlocksLeft, halvingDays, halvingDate, halvingProgress,
    latestBlock, mempoolStats,
    fearGreed, fearGreedLabel, difficultyChange, fundingRate, audUsd, dcaUpdated,
    markets, marketsUpdated, newsItems, breakingNewsLinks,
    goldPriceUsd, goldYtdPct, sp500Price, sp500YtdPct, cpiAnnual, btcYtdPct,
    gfNetWorth, gfTotalInvested, gfNetGainPct, gfNetGainYtdPct,
    gfTodayChangePct, gfHoldings, gfError, gfLoading, gfUpdated,
    gfDividendTotal, gfDividendYtd, gfCash, gfAnnualizedPct, gfFirstOrderDate, gfOrdersCount,
    persistSettings, fxRates, btcWsConnected, btcMa200, btcHashrate, gfPortfolioChart
  } from '$lib/store';

  let newSource = '', newSourceName = '';
  let clockInterval: ReturnType<typeof setInterval>;
  let intervals: ReturnType<typeof setInterval>[] = [];
  let scrolled = false;
  let mobileMenuOpen = false;
  let sectionObserver: IntersectionObserver | null = null;

  const FEED_CATEGORIES: { key: FeedCategory; label: string; hint: string }[] = [
    { key: 'global',   label: '🌍 Global / Major News', hint: 'Breaking world events' },
    { key: 'business', label: '📈 Business & Markets',  hint: 'Finance & economy' },
    { key: 'tech',     label: '💻 Technology',           hint: 'Tech news & innovation' },
    { key: 'security', label: '🛡 Security & Defence',   hint: 'Cyber & geopolitical risk' },
    { key: 'crypto',   label: '₿ Crypto',                hint: 'Cryptocurrency news' },
  ];

  const BREAKING_NEWS_TIMEOUT_MS = 3 * 60 * 1000; // clear breaking badge after 3 minutes

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
      $marketsUpdated = new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});
    } catch {}
  }

  let _prevNewsLinks = new Set<string>();
  let _breakingTimer: ReturnType<typeof setTimeout> | null = null;

  // Only mark items as breaking if they are genuinely major events
  const BREAKING_MAJOR_KEYWORDS = /war|conflict|attack|airstrike|missile|bomb|invasion|troops|military|ceasefire|killed|killing|coup|president|prime minister|chancellor|tariff|sanction|nuclear|election|elected|leader|treaty|genocide|massacre|offensive|explosion|assassination|crisis/i;

  async function fetchNews() {
    try {
      const urls = getEnabledFeedUrls($settings.news);
      const src = encodeURIComponent(JSON.stringify(urls));
      const items = (await fetch(`/api/news?sources=${src}`).then(r=>r.json())).items ?? [];
      // Detect newly-arrived links for major events only
      const newLinks = new Set<string>();
      for (const item of items) {
        if (!item.link || _prevNewsLinks.has(item.link)) continue;
        const text = (item.title ?? '') + ' ' + (item.description ?? '');
        if (BREAKING_MAJOR_KEYWORDS.test(text)) newLinks.add(item.link);
      }
      if (newLinks.size > 0 && _prevNewsLinks.size > 0) {
        // Only treat as breaking when we have a previous snapshot to compare against
        $breakingNewsLinks = newLinks;
        if (_breakingTimer) clearTimeout(_breakingTimer);
        _breakingTimer = setTimeout(() => { $breakingNewsLinks = new Set(); _breakingTimer = null; }, BREAKING_NEWS_TIMEOUT_MS);
      }
      _prevNewsLinks = new Set(items.map((i: { link: string }) => i.link));
      $newsItems = items;
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
        $gfPortfolioChart = d.portfolioChart ?? [];
        $gfUpdated = new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});
      }
    } catch { $gfError = 'Connection failed'; } finally { $gfLoading = false; }
  }

  function saveAll() {
    persistSettings($settings);
    fetchPoly(); fetchNews(); fetchMarkets();
    if ($settings.ghostfolio?.token) fetchGhostfolio();
  }

  function handleAddSource() {
    if (newSource.trim()) {
      const name = newSourceName.trim() || (() => { try { return new URL(newSource.trim()).hostname.replace('www.','').replace('feeds.',''); } catch { return 'Custom'; } })();
      $settings.news.customFeeds = [...$settings.news.customFeeds, { url: newSource.trim(), name, enabled: true }];
      newSource = ''; newSourceName = '';
    }
  }
  function removeSource(i:number) { $settings.news.customFeeds = $settings.news.customFeeds.filter((_,j)=>j!==i); }
  function toggleCustomFeed(i:number) { $settings.news.customFeeds[i].enabled = !$settings.news.customFeeds[i].enabled; $settings.news.customFeeds = [...$settings.news.customFeeds]; }
  function toggleCategory(cat: FeedCategory) {
    const anyEnabled = $settings.news.defaultFeeds.some(f => f.category === cat && f.enabled);
    $settings.news.defaultFeeds = $settings.news.defaultFeeds.map(f => f.category === cat ? { ...f, enabled: !anyEnabled } : f);
  }

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


    // Bitcoin peer-to-peer network visualization: anchor nodes (peers) with faint
    // connections, data packets (transactions) traveling between them, and expanding pings (confirmations).
    (function() {
      const canvas = document.getElementById('net-canvas') as HTMLCanvasElement;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      let W: number, H: number, animId: number;
      const ORANGE = 'rgba(247,147,26,';
      const AMBER  = 'rgba(255,180,60,';

      let mobile = window.innerWidth < 768;
      const NODE_COUNT = () => mobile ? 10 : 32;
      const CONN_DIST = () => mobile ? 150 : 220;

      let resizeTimer: any;
      function resize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; mobile = window.innerWidth < 768; init(); }, 200);
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
          this.hue = Math.random() < 0.65 ? 'o' : 'a';
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
          const col = this.hue === 'o' ? ORANGE : AMBER;
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
          this.radius = 1.5; this.maxRadius = 22 + Math.random() * 14;
          this.alpha = 0.65;
        }
        update(): boolean {
          this.radius += 0.45;
          this.alpha *= 0.955;
          return this.radius >= this.maxRadius || this.alpha < 0.02;
        }
        draw() {
          // Outer ring
          ctx.beginPath();
          ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
          ctx.strokeStyle = ORANGE + this.alpha + ')';
          ctx.lineWidth = 1;
          ctx.stroke();
          // Inner faint fill dot for confirmed-block feel
          if (this.radius < 8) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, Math.max(0, 3 - this.radius * 0.3), 0, Math.PI * 2);
            ctx.fillStyle = ORANGE + (this.alpha * 0.4) + ')';
            ctx.fill();
          }
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
        const connDist = CONN_DIST();
        let best: Node | null = null, bestDist = Infinity;
        for (const n of nodes) {
          if (n === a) continue;
          const dx = n.x - a.x, dy = n.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < connDist && d < bestDist) { best = n; bestDist = d; }
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
        const spawnRate = mobile ? 120 : 50;
        if (spawnTimer >= spawnRate) {
          spawnTransmission();
          // Occasional burst — less frequent on mobile
          if (Math.random() < (mobile ? 0.1 : 0.2)) { spawnTransmission(); spawnTransmission(); }
          spawnTimer = 0;
        }

        // Update & draw transmissions
        const chainConnDist = CONN_DIST();
        transmissions = transmissions.filter(t => {
          const done = t.update();
          t.draw();
          if (done) {
            pings.push(new Ping(t.to.x, t.to.y));
            // Chain: ~55% on desktop, ~30% on mobile to reduce CPU load
            if (Math.random() < (mobile ? 0.3 : 0.55)) {
              const from = t.to;
              let chainTo: Node | null = null, chainDist = Infinity;
              for (const n of nodes) {
                if (n === from) continue;
                const dx = n.x - from.x, dy = n.y - from.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < chainConnDist && d < chainDist) { chainTo = n; chainDist = d; }
              }
              if (chainTo) transmissions.push(new Transmission(from, chainTo));
            }
          }
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
    <div class="eye-wrap" aria-hidden="true">
      <svg class="eye-svg" viewBox="0 0 60 24" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <clipPath id="eyeClip">
            <path d="M30,3.5 C18,3.5 6,12 6,12 C6,12 18,20.5 30,20.5 C42,20.5 54,12 54,12 C54,12 42,3.5 30,3.5 Z"/>
          </clipPath>
          <filter id="outlineGlow" x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.7" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <!-- Eye background -->
        <path d="M30,3.5 C18,3.5 6,12 6,12 C6,12 18,20.5 30,20.5 C42,20.5 54,12 54,12 C54,12 42,3.5 30,3.5 Z" fill="#040201"/>
        <!-- Top eyelid arc -->
        <path class="eye-lid-top" d="M6,12 C18,3.5 42,3.5 54,12" fill="none" stroke="rgba(247,147,26,0.55)" stroke-width="0.7" stroke-linecap="round"/>
        <!-- Full eye outline with soft glow -->
        <path class="eye-outline" filter="url(#outlineGlow)" d="M30,3.5 C18,3.5 6,12 6,12 C6,12 18,20.5 30,20.5 C42,20.5 54,12 54,12 C54,12 42,3.5 30,3.5 Z" fill="none" stroke="#f7931a" stroke-width="0.85" opacity="0.78"/>
        <!-- Corner accent dots -->
        <circle class="eye-corner" cx="6"  cy="12" r="1.1" fill="rgba(247,147,26,0.6)"/>
        <circle class="eye-corner" cx="54" cy="12" r="1.1" fill="rgba(247,147,26,0.6)"/>
        <!-- Eyelid cover — slides up on load via CSS animation to reveal GL4NCE text -->
        <g clip-path="url(#eyeClip)">
          <rect class="eye-lid-reveal" x="6" y="3.5" width="48" height="17" fill="#040201"/>
        </g>
        <!-- Iris and pupil — revealed on hover/tap, clipped to eye shape -->
        <g clip-path="url(#eyeClip)">
          <circle class="eye-iris"  cx="30" cy="12" r="5"   fill="rgba(247,147,26,0.06)" stroke="rgba(247,147,26,0.55)" stroke-width="0.55"/>
          <circle class="eye-pupil" cx="30" cy="12" r="2.2" fill="rgba(14,2,1,0.92)"     stroke="rgba(247,147,26,0.28)" stroke-width="0.3"/>
        </g>
      </svg>
      <span class="brand-name">GL<span class="b-4">4</span>NCE</span>
    </div>
  </a>

  <!-- Desktop nav — left-aligned after brand (Electric Xtra style) -->
  <nav class="page-nav desktop-only" aria-label="Main navigation">
    <button class="nav-link" class:nav-link--active={$activeSection==='signal'}    on:click={()=>navigateTo('signal')}>
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15.31 8h-6.62A1.5 1.5 0 0 0 7.5 10.5V11a2 2 0 0 0 2 2h5a2 2 0 0 1 2 2v.5a1.5 1.5 0 0 1-1.5 1.5H8.69"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="18"/></svg>
      Signal
    </button>
    <button class="nav-link" class:nav-link--active={$activeSection==='portfolio'} on:click={()=>navigateTo('portfolio')}>
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
      Portfolio
    </button>
    <button class="nav-link" class:nav-link--active={$activeSection==='intel'}     on:click={()=>navigateTo('intel')}>
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      Intel
    </button>
  </nav>

  <!-- Spacer pushes right controls to far right on desktop -->
  <div class="hdr-spacer" aria-hidden="true"></div>

  <!-- Desktop right controls -->
  <div class="hdr-right desktop-only">
    <time class="hdr-clock" aria-label="Current time">{$time}</time>
    <!-- Live price feed status -->
    <span class="ws-badge btn-ghost" class:ws-badge--live={$btcWsConnected}
      role="status"
      aria-label="{$btcWsConnected?'Live price feed connected':'Price polling fallback'}"
      title="{$btcWsConnected?'Live price feed connected (Binance WebSocket)':'Price polling fallback — attempting live connection…'}">
      <span class="ws-dot" aria-hidden="true"></span>
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

  <!-- Mobile right controls — just the clock (no polling dot, no mode toggle, no settings cog — all moved to bottom nav) -->
  <div class="mobile-hdr-right mobile-only">
    <time class="hdr-clock" aria-label="Current time">{$time}</time>
  </div>

</header>

<!-- ══ SETTINGS DRAWER (desktop) ══════════════════════════════ -->
{#if $showSettings}
<div class="drawer" id="settings-drawer" role="region" aria-label="Settings">
  <div class="drawer-inner">
    <div class="dg"><p class="dg-hd">DCA Stack</p>
      <div class="dfields">
        <label class="df"><span class="dlbl">Start date</span><input type="date" bind:value={$settings.dca.startDate} class="dinp"/></label>
        <label class="df"><span class="dlbl">Daily AUD</span><input type="number" bind:value={$settings.dca.dailyAmount} class="dinp"/></label>
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
    <div class="dg"><p class="dg-hd">News Feeds <span class="dhint">toggle categories on/off · add custom sources</span></p>
      <div class="feed-list" style="margin-bottom:12px;">
        {#each FEED_CATEGORIES as cat}
          {@const anyEnabled = $settings.news.defaultFeeds.some(f => f.category === cat.key && f.enabled)}
          <label class="feed-toggle" title={cat.hint}>
            <input type="checkbox" checked={anyEnabled} on:change={() => toggleCategory(cat.key)} />
            <span class="feed-name">{cat.label}</span>
          </label>
        {/each}
      </div>
      {#if $settings.news.customFeeds.length>0}
      <p class="dlbl" style="margin:0 0 6px;">Custom Feeds</p>
      <div class="feed-list" style="margin-bottom:10px;">
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
    <!-- Appearance row: light/dark toggle -->
    <div class="mob-appearance-row">
      <span class="mob-appearance-label">Appearance</span>
      <button class="mob-theme-btn" on:click={toggleLightMode} aria-label="Switch to {$lightMode ? 'dark' : 'light'} mode">
        {#if $lightMode}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          Dark
        {:else}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          Light
        {/if}
      </button>
    </div>

    <!-- Settings inline in mobile menu -->
    <p class="mobile-section-title">Settings</p>
    <div class="mobile-settings">
      <div class="dg"><p class="dg-hd">DCA Stack</p>
        <div class="dfields">
          <label class="df"><span class="dlbl">Start date</span><input type="date" bind:value={$settings.dca.startDate} class="dinp"/></label>
          <label class="df"><span class="dlbl">Daily AUD</span><input type="number" bind:value={$settings.dca.dailyAmount} class="dinp"/></label>
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
      <div class="dg"><p class="dg-hd">News Feeds <span class="dhint">toggle categories on/off</span></p>
        <div class="feed-list" style="margin-bottom:8px;">
          {#each FEED_CATEGORIES as cat}
            {@const anyEnabled = $settings.news.defaultFeeds.some(f => f.category === cat.key && f.enabled)}
            <label class="feed-toggle" title={cat.hint}>
              <input type="checkbox" checked={anyEnabled} on:change={() => toggleCategory(cat.key)} />
              <span class="feed-name">{cat.label}</span>
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

<!-- ══ PAGE ═══════════════════════════════════════════════════ -->
<main class="page-wrap" id="main-content" role="main"><slot /></main>

<!-- ══ FOOTER ════════════════════════════════════════════════ -->
<footer class="site-footer" role="contentinfo">
  <span class="footer-brand">GL<span style="color:var(--orange);">4</span>NCE</span>
  <span class="footer-sources">
    <a href="https://mempool.space" target="_blank" rel="noopener noreferrer">mempool.space</a> ·
    <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noopener noreferrer">alternative.me</a> ·
    <a href="https://www.binance.com" target="_blank" rel="noopener noreferrer">binance</a> ·
    <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">exchangerate-api</a> ·
    <a href="https://ghostfol.io" target="_blank" rel="noopener noreferrer">ghostfol.io</a> ·
    <a href="https://www.worldbank.org" target="_blank" rel="noopener noreferrer">worldbank</a> ·
    <a href="https://gdeltproject.org" target="_blank" rel="noopener noreferrer">GDELT</a>
  </span>
</footer>

<!-- ══ MOBILE BOTTOM NAVIGATION ══════════════════════════════ -->
<nav class="bottom-nav mobile-only" aria-label="Section navigation">
  <button class="bnav-btn" class:bnav-btn--active={$activeSection==='signal'} on:click={()=>navigateTo('signal')} aria-label="Signal section" aria-current={$activeSection==='signal'?'page':undefined}>
    <svg class="bnav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15.31 8h-6.62A1.5 1.5 0 0 0 7.5 10.5V11a2 2 0 0 0 2 2h5a2 2 0 0 1 2 2v.5a1.5 1.5 0 0 1-1.5 1.5H8.69"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="18"/></svg>
    <span class="bnav-label">Signal</span>
  </button>
  <button class="bnav-btn" class:bnav-btn--active={$activeSection==='portfolio'} on:click={()=>navigateTo('portfolio')} aria-label="Portfolio section" aria-current={$activeSection==='portfolio'?'page':undefined}>
    <svg class="bnav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
    <span class="bnav-label">Portfolio</span>
  </button>
  <button class="bnav-btn" class:bnav-btn--active={$activeSection==='intel'} on:click={()=>navigateTo('intel')} aria-label="Intel section" aria-current={$activeSection==='intel'?'page':undefined}>
    <svg class="bnav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <span class="bnav-label">Intel</span>
  </button>
  <!-- Settings button in bottom nav -->
  <button class="bnav-btn" class:bnav-btn--active={mobileMenuOpen} on:click={toggleMobileMenu}
    aria-label="{mobileMenuOpen ? 'Close settings' : 'Open settings'}"
    aria-expanded={mobileMenuOpen} aria-controls="mobile-menu">
    <svg class="bnav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
    <span class="bnav-label">Settings</span>
  </button>
</nav>

<style>
  /* Canvas */
  #net-canvas { position:fixed; inset:0; width:100%; height:100%; z-index:-1; pointer-events:none; will-change:transform; transition:opacity .5s; }
  :global(html.light) #net-canvas { opacity:0.2; }

  /* ── LAYOUT TOKENS ───────────────────────────────────────── */
  /* Height of the sticky mobile bottom nav — used for clearance calculations */
  :root { --bottom-nav-h: 72px; }

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
  .brand { display:flex; align-items:center; text-decoration:none; flex-shrink:0; margin-right:28px; }

  /* Desktop nav — immediately after brand, left-aligned (Electric Xtra style) */
  .page-nav { display:flex; gap:4px; flex-shrink:0; }
  .nav-icon { width:14px; height:14px; flex-shrink:0; vertical-align:middle; margin-right:5px; position:relative; z-index:1; }
  .nav-link {
    padding:10px 18px; border-radius:3px; display:flex; align-items:center;
    font-family:inherit; font-size:.8rem; font-weight:700;
    color:rgba(255,255,255,.78); text-decoration:none;
    text-transform:uppercase; letter-spacing:.08em;
    position:relative; border:1px solid transparent;
    transition:background .2s, border-color .2s, color .2s, box-shadow .2s; white-space:nowrap;
    background:none; cursor:pointer; overflow:hidden;
  }
  .nav-link::before {
    content:''; position:absolute; inset:0; pointer-events:none; border-radius:inherit;
    background:linear-gradient(105deg,transparent 25%,rgba(255,255,255,.55) 50%,transparent 75%);
    background-size:200% 100%; background-position:-200% center;
    transition:background-position .4s ease, opacity .2s ease; z-index:0; /* shimmer, behind underline */
    opacity:0;
  }
  .nav-link::after {
    content:''; position:absolute; bottom:0; left:0; width:0; height:2px;
    background:var(--orange);
    transition:width .3s ease; z-index:1;
  }
  .nav-link:hover { color:var(--orange); border-color:rgba(247,147,26,.25); background:rgba(247,147,26,.08); }
  .nav-link:hover::before { background-position:200% center; opacity:0; }
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
    display:flex; align-items:center; justify-content:center;
    color:rgba(255,255,255,.22);
    padding:7px 10px;
    transition:all .5s;
  }
  .ws-badge--live { color:var(--up); }
  .ws-dot {
    width:8px; height:8px; border-radius:50%; background:currentColor; flex-shrink:0;
    box-shadow:0 0 0 2px transparent;
  }
  .ws-badge--live .ws-dot { animation:wsPulse 2s ease-in-out infinite; box-shadow:0 0 8px var(--up); }
  @keyframes wsPulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .mode-toggle { padding:7px 10px; display:flex; align-items:center; justify-content:center; }
  .settings-btn { padding:7px 11px; }
  .settings-btn--on { border-color:rgba(247,147,26,.4)!important; color:var(--orange)!important; }
  /* Desktop: make ws-badge (polling dot) exactly the same size as settings-btn */
  .hdr-right .ws-badge, .hdr-right .settings-btn { width:32px; height:32px; padding:0; justify-content:center; }

  /* ── CYBERPUNK EYE ───────────────────────────────────────── */
  .eye-wrap { width:136px; height:58px; position:relative; flex-shrink:0; overflow:visible; display:flex; align-items:center; justify-content:center; }
  .eye-svg { width:100%; height:100%; overflow:visible; }

  /* Outline subtle pulse — stays orange on both desktop and mobile */
  @keyframes eyeOutlinePulse { 0%,100%{opacity:.78} 50%{opacity:.96} }
  .eye-outline { animation:eyeOutlinePulse 3s ease-in-out infinite; }

  /* Eyelid reveal — CSS animation (more reliable than SMIL across browsers) */
  @keyframes eyeLidReveal {
    from { transform: translateY(0); }
    to   { transform: translateY(-130%); }
  }
  .eye-lid-reveal {
    transform-box: fill-box;
    animation: eyeLidReveal 2.4s cubic-bezier(0.42, 0, 0.18, 1) 0.4s both;
  }

  /* ── PUPIL & IRIS — hover/tap interactive effect ────────── */
  .eye-iris, .eye-pupil { opacity:0; transition:opacity .3s ease, filter .3s ease; }
  .brand:hover .eye-iris, .brand:focus-within .eye-iris,
  .brand:hover .eye-pupil, .brand:focus-within .eye-pupil { opacity:1; }
  /* Orange glow on iris when hovered */
  .brand:hover .eye-iris, .brand:focus-within .eye-iris {
    filter: drop-shadow(0 0 2px rgba(247,147,26,0.9)) drop-shadow(0 0 5px rgba(247,147,26,0.5));
  }
  /* Shimmer sweep on brand hover — clipped to the pupil so it stays inside the eye.
     Pupil is at cx=30 cy=12 r=2.2 in the 60×24 SVG viewBox, which maps to ~50%/50%
     of the eye-wrap; radii in % keep it tight to the pupil on all screen sizes. */
  .eye-wrap::after {
    content:''; position:absolute; inset:0; pointer-events:none; z-index:2;
    background:linear-gradient(105deg,transparent 25%,rgba(255,255,255,.45) 50%,transparent 75%);
    background-size:200% 100%; background-position:-200% center;
    transition:background-position .4s ease, opacity .2s ease;
    opacity:0;
    clip-path: ellipse(5% 11% at 50% 50%);
  }
  .brand:hover .eye-wrap::after, .brand:focus-within .eye-wrap::after {
    background-position:200% center; opacity:1;
  }

  @media (prefers-reduced-motion:reduce) {
    .eye-outline { animation:none; }
    .eye-lid-reveal { display:none; animation:none; }
    .brand-name { animation:none !important; opacity:1 !important; }
  }

  /* ── WORDMARK ────────────────────────────────────────────── */
  /* Eyelid finishes at begin(0.4s) + dur(2.4s) = 2.8s; text reveal starts at 2.2s for synchronized overlap */
  .brand-name { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:inherit; font-weight:900; font-size:0.92rem; letter-spacing:.12em; line-height:1; pointer-events:none; color:#eaeaea; text-transform:uppercase; overflow:visible; z-index:1; animation:brandReveal 1.0s ease-out 2.2s both; }
  @keyframes brandReveal { from{opacity:0} to{opacity:1} }
  .b-4 { color:var(--orange); }

  /* ── RESPONSIVE VISIBILITY ───────────────────────────────── */
  .desktop-only { display:flex; }
  .mobile-only  { display:none; }

  /* ── MOBILE HEADER RIGHT CONTROLS ───────────────────────── */
  .mobile-hdr-right { display:none; align-items:center; gap:6px; }

  @media (max-width:768px) {
    /* Remove backdrop-filter on mobile — it forces the header to re-composite with
       the animated canvas on every frame, causing the header/buttons to flash. Use
       a solid background instead and promote the element to its own GPU layer so it
       is unaffected by paints in other layers. */
    .hdr { position:relative; height:54px; padding:0 16px; backdrop-filter:none; -webkit-backdrop-filter:none; background:rgba(10,10,10,0.97); transform:translateZ(0); }
    .hdr--scrolled { height:54px; background:rgba(10,10,10,0.99); box-shadow:0 4px 28px rgba(247,147,26,0.10); }
    .desktop-only { display:none !important; }
    .mobile-only  { display:flex !important; }
    .brand { margin-right:0; }
    .brand-name { font-size:0.74rem; }
    .eye-wrap { width:104px; height:44px; }
    .mobile-hdr-right { display:flex; align-items:center; }
  }

  /* ── MOBILE BOTTOM NAVIGATION ────────────────────────────── */
  .bottom-nav {
    position:fixed; bottom:0; left:0; right:0; z-index:350;
    display:none;
    align-items:stretch;
    background:rgba(10,10,10,0.96);
    backdrop-filter:blur(20px) saturate(180%);
    -webkit-backdrop-filter:blur(20px) saturate(180%);
    border-top:1px solid rgba(247,147,26,0.14);
    box-shadow:0 -4px 24px rgba(0,0,0,.4);
    /* Safe area inset for notched phones */
    padding-bottom:env(safe-area-inset-bottom, 0px);
    padding-left:env(safe-area-inset-left, 0px);
    padding-right:env(safe-area-inset-right, 0px);
  }
  .bnav-btn {
    flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:4px; padding:10px 4px;
    background:none; border:none; cursor:pointer;
    color:rgba(255,255,255,.35);
    transition:color .2s, background .2s;
    position:relative; min-height:56px;
  }
  .bnav-btn::before {
    content:''; position:absolute; top:0; left:50%; transform:translateX(-50%);
    width:0; height:2px;
    background:var(--orange);
    transition:width .25s ease;
  }
  .bnav-btn:hover { color:rgba(255,255,255,.7); background:rgba(247,147,26,.05); }
  .bnav-btn--active { color:var(--orange)!important; }
  .bnav-btn--active::before { width:40px; }
  .bnav-icon { width:20px; height:20px; flex-shrink:0; }
  .bnav-label {
    font-family:inherit; font-size:.55rem; font-weight:700;
    text-transform:uppercase; letter-spacing:.1em; line-height:1;
  }
  @media (max-width:768px) {
    .bottom-nav { display:flex; }
  }
  :global(html.light) .bottom-nav { background:rgba(255,255,255,.97); border-top-color:rgba(0,0,0,.08); box-shadow:0 -2px 16px rgba(0,0,0,.08); }
  :global(html.light) .bnav-btn { color:rgba(0,0,0,.4); }
  :global(html.light) .bnav-btn:hover { background:rgba(247,147,26,.06); color:rgba(0,0,0,.7); }
  :global(html.light) .bnav-btn--active { color:#c77a10!important; }

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
    border-bottom:1px solid rgba(255,255,255,.08);
    padding:0 0 24px; max-height:calc(100vh - 54px - var(--bottom-nav-h)); overflow-y:auto;
  }
  .mobile-nav { display:flex; flex-direction:column; padding:8px 0; }
  .mobile-nav-link {
    display:flex; align-items:center; padding:16px 24px;
    font-family:inherit; font-size:.78rem; font-weight:700;
    color:rgba(255,255,255,.7); text-decoration:none;
    text-transform:uppercase; letter-spacing:.1em;
    border-bottom:1px solid rgba(255,255,255,.04);
    transition:all .2s;
  }
  .mobile-nav-link:hover { color:var(--orange); background:rgba(247,147,26,.06); padding-left:32px; }
  .mobile-divider { height:1px; background:rgba(255,255,255,.06); margin:4px 0; }
  .mobile-theme-toggle {
    display:flex; align-items:center; gap:14px; width:100%;
    padding:16px 24px; background:none; border:none;
    color:rgba(255,255,255,.6); font-family:inherit;
    font-size:.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.1em;
    cursor:pointer; transition:all .2s;
  }
  .mobile-theme-toggle:hover { color:var(--orange); background:rgba(247,147,26,.06); }
  .mobile-menu-icon { font-size:1.1rem; width:20px; text-align:center; }
  .mobile-section-title {
    padding:12px 24px 8px; font-family:inherit;
    font-size:.6rem; font-weight:700; color:rgba(247,147,26,.7);
    text-transform:uppercase; letter-spacing:.15em;
  }
  .mobile-settings { padding:0 20px; display:flex; flex-direction:column; gap:0; }
  .mobile-settings .dg { padding:14px 0; border-bottom:1px solid rgba(255,255,255,.04); }
  .mobile-settings .dg:last-of-type { border-bottom:none; }

  /* ── MOBILE APPEARANCE ROW ───────────────────────────────── */
  .mob-appearance-row {
    display:flex; align-items:center; justify-content:space-between;
    padding:12px 20px; border-bottom:1px solid rgba(255,255,255,.05);
  }
  .mob-appearance-label {
    font-family:inherit; font-size:.62rem; font-weight:700;
    text-transform:uppercase; letter-spacing:.1em; color:rgba(255,255,255,.4);
  }
  .mob-theme-btn {
    display:flex; align-items:center; gap:6px;
    padding:6px 14px; border-radius:4px; background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.1); cursor:pointer;
    font-family:inherit; font-size:.62rem; font-weight:600;
    text-transform:uppercase; letter-spacing:.08em; color:rgba(255,255,255,.55);
    transition:background .2s, border-color .2s, color .2s;
  }
  .mob-theme-btn:hover { color:var(--orange); border-color:rgba(247,147,26,.4); background:rgba(247,147,26,.1); }
  :global(html.light) .mob-appearance-row { border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .mob-appearance-label { color:rgba(0,0,0,.45); }
  :global(html.light) .mob-theme-btn { background:rgba(0,0,0,.04); border-color:rgba(0,0,0,.1); color:rgba(0,0,0,.55); }
  :global(html.light) .mob-theme-btn:hover { color:#c77a10; border-color:rgba(200,120,16,.45); background:rgba(247,147,26,.1); }

  /* ── PAGE WRAP ───────────────────────────────────────────── */
  .page-wrap { padding-top:64px; min-height:100vh; }
  /* Desktop scroll snap — sections snap to viewport on scroll */
  @media (min-width:701px) {
    .page-wrap {
      height: 100vh;
      overflow-y: scroll;
      scroll-snap-type: y proximity;
      scroll-padding-top: 64px;
    }
  }
  @media (max-width:768px) { .page-wrap { padding-top:0; padding-bottom:calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px)); } }
  @media (max-width:700px) {
    .page-wrap { display:flex; flex-direction:column; }
  }

  /* ── SETTINGS DRAWER ────────────────────────────────────── */
  .drawer {
    position: fixed; top: 64px; left: 0; right: 0; z-index: 200;
    overflow-y: auto; max-height: calc(100vh - 64px);
    background:rgba(8,8,8,.97); backdrop-filter:blur(24px);
    border-bottom:1px solid rgba(247,147,26,.15);
    animation: slideDown 0.22s ease-out both;
  }
  @keyframes slideDown {
    from { opacity:0; transform:translateY(-8px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @media (max-width:768px) { .drawer { top: 54px; max-height: calc(100vh - 54px - var(--bottom-nav-h)); } }
  .drawer-inner { max-width:900px; margin:0 auto; padding:20px 24px; display:flex; flex-direction:column; gap:0; }
  .dg { padding:16px 0; border-bottom:1px solid rgba(255,255,255,.04); }
  .dg:last-of-type { border-bottom:none; }
  .dg-hd { font-size:.65rem; font-weight:700; color:rgba(255,255,255,.4); margin-bottom:10px; display:flex; align-items:center; gap:8px; font-family:inherit; letter-spacing:.08em; text-transform:uppercase; }
  .dhint { font-size:.6rem; color:rgba(255,255,255,.18); font-weight:400; font-family:inherit; text-transform:none; letter-spacing:0; }
  .dfields { display:flex; gap:10px; flex-wrap:wrap; }
  .df { display:flex; flex-direction:column; gap:5px; flex:1; min-width:100px; }
  .dlbl { font-size:.58rem; color:rgba(255,255,255,.25); font-weight:500; text-transform:uppercase; letter-spacing:.1em; }
  .dinp { width:100%; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1); border-radius:6px; padding:8px 10px; color:#eaeaea; font-family:inherit; font-size:.78rem; transition:border-color .2s,box-shadow .2s; }
  .dinp:focus { outline:none; border-color:var(--orange); box-shadow:0 0 0 3px rgba(247,147,26,.12),0 0 16px rgba(247,147,26,.18); }
  .dtags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
  .dtag { display:inline-flex; align-items:center; gap:5px; padding:3px 10px; background:rgba(247,147,26,.07); border:1px solid rgba(247,147,26,.2); border-radius:999px; font-size:.68rem; color:rgba(255,255,255,.55); }
  .dtag-x { background:none; border:none; color:rgba(255,255,255,.25); cursor:pointer; font-size:1rem; padding:0; line-height:1; transition:color .15s; }
  .dtag-x:hover { color:var(--dn); }
  .dinp-row { display:flex; gap:8px; flex-wrap:wrap; }
  .dinp-row .dinp { min-width:120px; }
  .dsrcs { max-height:68px; overflow-y:auto; margin-bottom:8px; }
  .curr-preset { padding:4px 10px; font-size:.62rem; font-weight:600; font-family:inherit; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1); border-radius:3px; color:rgba(255,255,255,.4); cursor:pointer; transition:background .2s, border-color .2s, color .2s, box-shadow .2s; letter-spacing:.04em; position:relative; overflow:hidden; }
  .curr-preset::after { content:''; position:absolute; inset:0; pointer-events:none; border-radius:inherit; background:linear-gradient(105deg,transparent 25%,rgba(255,255,255,.55) 50%,transparent 75%); background-size:200% 100%; background-position:-200% center; transition:background-position .4s ease, opacity .2s ease; opacity:0; }
  .curr-preset:hover { border-color:rgba(247,147,26,.45); color:var(--orange); background:rgba(247,147,26,.14); box-shadow:0 0 8px rgba(247,147,26,.25); }
  .curr-preset:hover::after { background-position:200% center; opacity:1; }
  .curr-preset--active { background:rgba(247,147,26,.15); border-color:var(--orange)!important; color:var(--orange)!important; }
  :global(html.light) .curr-preset { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.1); color:rgba(0,0,0,.5); }
  :global(html.light) .curr-preset:hover { border-color:rgba(200,120,16,.45); color:#c77a10; background:rgba(247,147,26,.1); box-shadow:0 0 8px rgba(200,120,16,.2); }
  :global(html.light) .curr-preset--active { background:rgba(247,147,26,.1); }
  .dsrc { display:flex; justify-content:space-between; align-items:center; padding:3px 0; font-size:.62rem; color:rgba(255,255,255,.25); }
  .dsrc-url { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:300px; }
  .d-save--ok { background:linear-gradient(45deg,#22c55e,#15803d)!important; }

  /* ── FEED TOGGLES ──────────────────────────────────────────── */
  .feed-list { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
  .feed-toggle { display:flex; align-items:center; gap:6px; cursor:pointer; padding:4px 10px; border-radius:3px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); transition:all .2s; font-size:.68rem; color:var(--t2); }
  .feed-toggle:hover { border-color:rgba(247,147,26,.2); }
  .feed-toggle input[type="checkbox"] { accent-color:var(--orange); width:13px; height:13px; cursor:pointer; }
  .feed-toggle input[type="checkbox"]:checked + .feed-name { color:var(--t1); }
  .feed-name { font-size:.65rem; font-weight:500; transition:color .2s; display:flex; align-items:center; gap:5px; }
  .feed-custom { display:flex; align-items:center; gap:4px; }
  .feed-cat-lbl { font-size:.65rem; font-weight:700; color:var(--t2); margin-top:10px; letter-spacing:.03em; }
  :global(html.light) .feed-toggle { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.08); }
  :global(html.light) .feed-toggle:hover { border-color:rgba(247,147,26,.3); }

  /* ── FOOTER ──────────────────────────────────────────────── */
  .site-footer {
    border-top:1px solid rgba(247,147,26,.12);
    padding:20px 32px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;
    background:rgba(0,0,0,.55);
    backdrop-filter:blur(8px);
  }
  .footer-brand { font-family:inherit; font-size:.65rem; font-weight:900; color:rgba(255,255,255,.28); letter-spacing:.1em; text-transform:uppercase; }
  .footer-sources { font-size:.56rem; color:rgba(255,255,255,.18); letter-spacing:.02em; }
  .footer-sources a { color:rgba(255,255,255,.25); text-decoration:none; transition:color .2s; }
  .footer-sources a:hover { color:var(--orange); }
  @media (max-width:600px) { .site-footer { display:none; } }

  /* ── LIGHT MODE ──────────────────────────────────────────── */
  :global(html.light) { --bg:#f4f4f5; --bg2:#eaeaeb; --glass-bg:rgba(255,255,255,.72); --glass-bg2:rgba(255,255,255,.85); --glass-bd:rgba(0,0,0,.12); --glass-bd2:rgba(0,0,0,.18); --t1:#111; --t2:#444; --t3:#aaa; --up:#16a34a; --dn:#dc2626; }
  :global(html.light) body { background:#f0f0f1; color:#111; }
  :global(html.light) body::before { background: radial-gradient(circle at 15% 85%,rgba(247,147,26,.10) 0%,transparent 42%), radial-gradient(circle at 85% 10%,rgba(247,147,26,.06) 0%,transparent 42%); }
  :global(html.light) body::after { background: linear-gradient(transparent 50%, rgba(0,0,0,0.008) 50%); }
  :global(html.light) .hdr { background:rgba(255,255,255,.92); border-bottom-color:rgba(0,0,0,.08); }
  :global(html.light) .hdr--scrolled { background:rgba(255,255,255,.97); box-shadow:0 2px 12px rgba(0,0,0,.08); }
  /* brand-name keeps its default light color — the eye background is always dark so white text stays readable in both modes */
  :global(html.light) .hdr-clock { color:rgba(0,0,0,.45); }
  :global(html.light) .nav-link { color:rgba(0,0,0,.55); }
  :global(html.light) .nav-link:hover { color:#c77a10; border-color:rgba(200,120,16,.45); background:rgba(247,147,26,.1); box-shadow:0 0 8px rgba(200,120,16,.2); }
  :global(html.light) .nav-link--active { color:#c77a10!important; border-color:rgba(247,147,26,.4)!important; }
  :global(html.light) .drawer { background:rgba(255,255,255,.98); border-bottom-color:rgba(0,0,0,.08); }
  :global(html.light) .dg { border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .dinp { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.12); color:#111; }
  :global(html.light) .dinp:focus { border-color:var(--orange); }
  :global(html.light) .dg-hd { color:rgba(0,0,0,.7); }
  :global(html.light) .dhint { color:rgba(0,0,0,.35); }
  :global(html.light) .dlbl { color:rgba(0,0,0,.5); }
  :global(html.light) .dtag { background:rgba(247,147,26,.08); border-color:rgba(247,147,26,.25); color:rgba(0,0,0,.6); }
  :global(html.light) .dtag-x { color:rgba(0,0,0,.3); }
  :global(html.light) .site-footer { background:rgba(255,255,255,.75); border-top-color:rgba(0,0,0,.06); }
  :global(html.light) .footer-brand { color:rgba(0,0,0,.4); }
  :global(html.light) .footer-sources { color:rgba(0,0,0,.35); }
  :global(html.light) .footer-sources a { color:rgba(0,0,0,.35); }
  :global(html.light) .footer-sources a:hover { color:#c77a10; }
  :global(html.light) .mobile-menu-panel { background:rgba(255,255,255,.98); }
  :global(html.light) .mobile-menu-backdrop { background:rgba(0,0,0,.25); }
  :global(html.light) .mobile-settings .dg { border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .mobile-nav-link { color:rgba(0,0,0,.75); border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .mobile-theme-toggle { color:rgba(0,0,0,.6); }
  :global(html.light) .mobile-section-title { color:rgba(247,147,26,.9); }
  :global(html.light) .mobile-nav-btn { color:rgba(0,0,0,.45); }
  :global(html.light) .mobile-nav-btn:hover { color:#111; }
  :global(html.light) .mobile-nav-btn--active { color:#c77a10!important; border-color:rgba(247,147,26,.4)!important; }
  :global(html.light) .btn-ghost { color:rgba(0,0,0,.5); border-color:rgba(0,0,0,.12); background:rgba(0,0,0,.02); }
  :global(html.light) .btn-ghost:hover { color:#c77a10; border-color:rgba(200,120,16,.45); background:rgba(247,147,26,.1); box-shadow:0 0 8px rgba(200,120,16,.2); }

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
  :global(html.light) .ws-badge { color:rgba(0,0,0,.3); }
  :global(html.light) .ws-badge--live { color:var(--up); }
  :global(html.light) .section-divider { background:rgba(0,0,0,.08); }
  :global(html.light) .sect-title { color:#111; background:none; -webkit-background-clip:unset; background-clip:unset; }

  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  :global(.blink){animation:blink 2s step-end infinite;}
</style>
