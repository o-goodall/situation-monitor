<script lang="ts">
  import '../app.css';
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { loadSettings } from '$lib/settings';
  import {
    settings, showSettings, saved, time,
    btcPrice, prevPrice, priceFlash, btcBlock, btcFees,
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

  $: activePage = $page.url.pathname.replace(/^\//, '') || 'signal';

  function tick() {
    $time = new Date().toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }

  async function fetchBtc() {
    try {
      const d = await fetch('/api/bitcoin').then(r => r.json());
      $prevPrice = $btcPrice; $btcPrice = d.price ?? 0; $btcBlock = d.blockHeight ?? 0;
      $btcFees = d.fees ?? { low:0, medium:0, high:0 };
      if (d.halving) { $halvingBlocksLeft=d.halving.blocksRemaining; $halvingDays=d.halving.daysRemaining; $halvingDate=d.halving.estimatedDate; $halvingProgress=d.halving.progressPct; }
      if ($prevPrice && $btcPrice !== $prevPrice) { $priceFlash = $btcPrice > $prevPrice ? 'up' : 'down'; setTimeout(() => $priceFlash='', 1200); }
    } catch {}
  }

  async function fetchDCA() {
    try {
      const d = await fetch('/api/dca').then(r => r.json());
      $fearGreed=d.fearGreed; $fearGreedLabel=d.fearGreedLabel; $difficultyChange=d.difficultyChange;
      $fundingRate=d.fundingRate; $audUsd=d.audUsd;
      $dcaUpdated = new Date().toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit' });
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
      const d = await fetch('/api/markets').then(r => r.json());
      $goldPriceUsd=d.gold?.priceUsd??null; $goldYtdPct=d.gold?.ytdPct??null;
      $sp500Price=d.sp500?.price??null; $sp500YtdPct=d.sp500?.ytdPct??null;
      $cpiAnnual=d.cpiAnnual??null;
    } catch {}
  }

  export async function fetchGhostfolio() {
    const token = $settings.ghostfolio?.token?.trim();
    if (!token) return;
    $gfLoading=true; $gfError='';
    try {
      const d = await fetch(`/api/ghostfolio?token=${encodeURIComponent(token)}`).then(r=>r.json());
      if (d.error) { $gfError=d.error; }
      else {
        $gfNetWorth=d.netWorth; $gfTotalInvested=d.totalInvested;
        $gfNetGainPct=d.netGainPct; $gfNetGainYtdPct=d.netGainYtdPct; $gfTodayChangePct=d.todayChangePct;
        $gfHoldings=d.holdings??[];
        $gfUpdated = new Date().toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit' });
      }
    } catch { $gfError='Connection failed'; }
    finally { $gfLoading=false; }
  }

  function saveAll() {
    persistSettings($settings);
    fetchPoly(); fetchNews(); if ($settings.ghostfolio?.token) fetchGhostfolio();
  }

  const addKeyword    = () => { if (newKeyword.trim()) { $settings.polymarket.keywords=[...$settings.polymarket.keywords, newKeyword.trim()]; newKeyword=''; } };
  const removeKeyword = (i: number) => { $settings.polymarket.keywords=$settings.polymarket.keywords.filter((_,j)=>j!==i); };
  const addSource     = () => { if (newSource.trim()) { $settings.news.sources=[...$settings.news.sources, newSource.trim()]; newSource=''; } };
  const removeSource  = (i: number) => { $settings.news.sources=$settings.news.sources.filter((_,j)=>j!==i); };

  onMount(() => {
    $settings = loadSettings(); tick();
    clockInterval = setInterval(tick, 1000);
    fetchBtc(); fetchDCA(); fetchPoly(); fetchNews(); fetchMarkets();
    if ($settings.ghostfolio?.token) fetchGhostfolio();
    intervals = [
      setInterval(fetchBtc, 60000), setInterval(fetchDCA, 300000),
      setInterval(fetchPoly, 300000), setInterval(fetchNews, 300000),
      setInterval(fetchMarkets, 300000),
      setInterval(() => { if ($settings.ghostfolio?.token) fetchGhostfolio(); }, 300000),
    ];
  });
  onDestroy(() => { clearInterval(clockInterval); intervals.forEach(clearInterval); });
</script>

<div class="bg-orbs" aria-hidden="true">
  <div class="orb orb-1"></div><div class="orb orb-2"></div><div class="orb orb-3"></div>
</div>
<div class="bg-shapes" aria-hidden="true">
  <div class="geo geo-1"></div><div class="geo geo-2"></div><div class="geo geo-3"></div><div class="geo geo-4"></div>
</div>
<div class="bg-lines" aria-hidden="true">
  <div class="scan"></div><div class="scan"></div><div class="scan"></div>
</div>

<header class="hdr">
  <a href="/signal" class="brand">
    <div class="globe-wrap" aria-hidden="true">
      <div class="globe">
        <!-- Static wireframe: equator + 2 longitude ellipses + 2 latitude rings -->
        <div class="wire w-eq"></div>
        <div class="wire w-lg1"></div>
        <div class="wire w-lg2"></div>
        <div class="wire w-lt1"></div>
        <div class="wire w-lt2"></div>
        <!-- Sequential ping lines — one after another, sweeping across the sphere -->
        <div class="ping ping-1"></div>
        <div class="ping ping-2"></div>
        <div class="ping ping-3"></div>
        <div class="ping ping-4"></div>
        <div class="ping ping-5"></div>
      </div>
    </div>
    <span class="brand-name">
      <span class="b-gl">gl</span><span class="b-4">4</span><span class="b-nce">nce</span><span class="b-dot">.</span>
    </span>
  </a>

  <nav class="page-nav">
    <a href="/signal"    class="nav-btn" class:nav-btn--on={activePage === 'signal'}>
      <span class="nav-ico">₿</span><span class="nav-lbl">Signal</span>
    </a>
    <a href="/intel"     class="nav-btn" class:nav-btn--on={activePage === 'intel'}>
      <span class="nav-ico">◈</span><span class="nav-lbl">Intel</span>
    </a>
    <a href="/portfolio" class="nav-btn" class:nav-btn--on={activePage === 'portfolio'}>
      <span class="nav-ico">↗</span><span class="nav-lbl">Portfolio</span>
    </a>
  </nav>

  <div class="hdr-right">
    <span class="hdr-clock">{$time}</span>
    <button class="settings-btn" class:settings-btn--on={$showSettings}
      on:click={() => $showSettings = !$showSettings} aria-label="Settings">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>
  </div>
</header>

{#if $showSettings}
<div class="drawer">
  <div class="drawer-inner">
    <div class="dg">
      <p class="dg-hd">DCA Stack</p>
      <div class="dfields">
        <label class="df"><span class="dlbl">Start date</span><input type="date" bind:value={$settings.dca.startDate} class="dinp"/></label>
        <label class="df"><span class="dlbl">Daily AUD</span><input type="number" bind:value={$settings.dca.dailyAmount} class="dinp"/></label>
        <label class="df"><span class="dlbl">BTC held</span><input type="number" step="0.00000001" bind:value={$settings.dca.btcHeld} class="dinp"/></label>
        <label class="df"><span class="dlbl">Goal BTC</span><input type="number" step="0.001" bind:value={$settings.dca.goalBtc} class="dinp"/></label>
      </div>
    </div>
    <div class="dg">
      <p class="dg-hd">Watchlist <span class="dhint">pinned in markets feed</span></p>
      <div class="dtags">
        {#each $settings.polymarket.keywords as kw, i}
          <span class="dtag">{kw}<button on:click={() => removeKeyword(i)} class="dtag-x">×</button></span>
        {/each}
      </div>
      <div class="dinp-row">
        <input bind:value={newKeyword} on:keydown={(e) => e.key==='Enter' && addKeyword()} placeholder="Add keyword…" class="dinp"/>
        <button on:click={addKeyword} class="d-add">Add</button>
      </div>
    </div>
    <div class="dg">
      <p class="dg-hd">News RSS</p>
      <div class="dsrcs">
        {#each $settings.news.sources as src, i}
          <div class="dsrc"><span class="dsrc-url">{src}</span><button on:click={() => removeSource(i)} class="dtag-x">×</button></div>
        {/each}
      </div>
      <div class="dinp-row">
        <input type="url" bind:value={newSource} on:keydown={(e) => e.key==='Enter' && addSource()} placeholder="https://…" class="dinp"/>
        <button on:click={addSource} class="d-add">Add</button>
      </div>
    </div>
    <div class="dg">
      <p class="dg-hd">Ghostfolio <span class="dhint">token stored locally in browser</span></p>
      <div class="dfields" style="max-width:500px;">
        <label class="df" style="flex:3;"><span class="dlbl">Security token</span><input type="password" bind:value={$settings.ghostfolio.token} placeholder="your-security-token" class="dinp"/></label>
        <label class="df"><span class="dlbl">Currency</span><input bind:value={$settings.ghostfolio.currency} placeholder="AUD" class="dinp" style="width:72px;"/></label>
      </div>
    </div>
    <button on:click={saveAll} class="d-save" class:d-save--ok={$saved}>{$saved ? '✓ Saved' : 'Save'}</button>
  </div>
</div>
{/if}

<div class="page-wrap"><slot /></div>

<footer class="site-footer">
  <div class="footer-brand">
    <span class="blink" style="color:var(--orange); font-size:0.45rem; vertical-align:middle; margin-right:5px;">●</span>
    gl<span style="color:var(--orange);">4</span>nce.
  </div>
  <div class="footer-sources">mempool.space · alternative.me · binance · exchangerate-api · ghostfol.io · worldbank</div>
</footer>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Inter:wght@300;400;500;600;700&display=swap');

  .bg-orbs { position: fixed; inset: 0; z-index: -3; pointer-events: none; overflow: hidden; }
  .orb { position: absolute; border-radius: 50%; filter: blur(120px); animation: orbDrift 22s ease-in-out infinite; }
  .orb-1 { width: 700px; height: 700px; bottom: -250px; left: -200px; background: radial-gradient(circle, rgba(247,147,26,0.2) 0%, transparent 70%); }
  .orb-2 { width: 550px; height: 550px; top: -180px; right: -150px; background: radial-gradient(circle, rgba(200,90,10,0.14) 0%, transparent 70%); animation-delay: -8s; }
  .orb-3 { width: 400px; height: 400px; top: 45%; left: 48%; background: radial-gradient(circle, rgba(247,147,26,0.07) 0%, transparent 70%); animation-delay: -16s; }
  @keyframes orbDrift { 0%,100%{transform:translate(0,0) scale(1); opacity:.7} 33%{transform:translate(50px,-40px) scale(1.06); opacity:1} 66%{transform:translate(-30px,25px) scale(.94); opacity:.75} }

  .bg-shapes { position: fixed; inset: 0; z-index: -2; pointer-events: none; overflow: hidden; }
  .geo { position: absolute; border: 1px solid rgba(247,147,26,0.1); animation: geoRise 26s linear infinite; }
  .geo-1 { width: 90px;  height: 90px;  left: 9%;   animation-delay: 0s; }
  .geo-2 { width: 55px;  height: 55px;  left: 68%;  animation-delay: -9s; border-radius: 50%; border-color: rgba(247,147,26,0.07); }
  .geo-3 { width: 70px;  height: 70px;  left: 38%;  animation-delay:-18s; transform:rotate(45deg); border-color:rgba(247,147,26,0.09); }
  .geo-4 { width: 100px; height: 100px; right: 8%;  animation-delay: -5s; border-color: rgba(247,147,26,0.06); }
  @keyframes geoRise { from{transform:translateY(110vh) rotate(0deg); opacity:0} 10%,90%{opacity:1} to{transform:translateY(-120px) rotate(360deg); opacity:0} }

  .bg-lines { position: fixed; inset: 0; z-index: -1; pointer-events: none; }
  .scan { position:absolute; left:0; width:100%; height:1px; background:linear-gradient(90deg,transparent,rgba(247,147,26,0.2),transparent); animation:scanPulse 5s ease-in-out infinite; }
  .scan:nth-child(1){top:20%; animation-delay:0s} .scan:nth-child(2){top:56%; animation-delay:-1.7s} .scan:nth-child(3){top:79%; animation-delay:-3.3s}
  @keyframes scanPulse { 0%,100%{opacity:0; transform:scaleX(.2)} 50%{opacity:1; transform:scaleX(1)} }

  /* HEADER — fixed height so page content never shifts between routes */
  .hdr {
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    z-index: 300; width: calc(100% - 32px); max-width: 1240px;
    display: flex; align-items: center; gap: 16px;
    height: 58px; /* explicit height — no layout reflow */
    padding: 0 18px;
    background: rgba(6,6,6,0.78);
    backdrop-filter: blur(32px) saturate(200%);
    -webkit-backdrop-filter: blur(32px) saturate(200%);
    border: 1px solid rgba(255,255,255,0.09); border-radius: 24px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
  }

  /* BRAND */
  .brand { display:flex; align-items:center; gap:11px; text-decoration:none; flex-shrink:0; }

  /* ── GLOBE: sequential ping-line version ─────────────────── */
  .globe-wrap { width: 32px; height: 32px; position: relative; flex-shrink: 0; }

  .globe {
    width: 100%; height: 100%;
    position: relative; border-radius: 50%;
    background: radial-gradient(circle at 40% 38%, rgba(247,147,26,0.22) 0%, rgba(247,147,26,0.05) 55%, transparent 75%);
    box-shadow:
      0 0 0 1px rgba(247,147,26,0.28),
      0 0 12px rgba(247,147,26,0.3),
      0 0 28px rgba(247,147,26,0.1),
      inset 0 0 8px rgba(247,147,26,0.08);
    overflow: hidden; /* clip pings to sphere edge */
  }

  /* Static wireframe — very faint, just gives globe form */
  .wire {
    position: absolute; border: 1px solid rgba(247,147,26,0.18);
    border-radius: 50%; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .w-eq  { width: 100%; height: 28%; }               /* equator */
  .w-lg1 { width: 52%;  height: 100%; }              /* longitude 1 */
  .w-lg2 { width: 22%;  height: 100%; }              /* longitude 2 */
  .w-lt1 { width: 80%;  height: 20%; top: 28%; }     /* latitude high */
  .w-lt2 { width: 80%;  height: 20%; top: 70%; }     /* latitude low */

  /*
   * Ping lines — horizontal light-streaks that scan top→bottom one after
   * another, like a radar sweep / Bitcoin node broadcast pulse.
   * Each ping is a thin full-width bar that slides from top to bottom,
   * staggered so they fire sequentially with a clear gap between each.
   *
   * Total cycle = 2.5s. 5 pings each offset by 0.5s.
   * Each ping: fade-in at top, travel to bottom, fade out. Takes ~0.7s of
   * the 2.5s window, leaving a clear pause before the next fires.
   */
  .ping {
    position: absolute;
    left: 0; right: 0;
    height: 2px;
    background: linear-gradient(90deg,
      transparent 0%,
      rgba(247,147,26,0.0) 8%,
      rgba(247,147,26,0.9) 35%,
      rgba(255,200,80,1.0) 50%,
      rgba(247,147,26,0.9) 65%,
      rgba(247,147,26,0.0) 92%,
      transparent 100%
    );
    border-radius: 1px;
    /* start above sphere */
    top: -2px;
    animation: pingDrop 2.5s linear infinite;
    opacity: 0;
    /* subtle glow trail */
    box-shadow: 0 0 4px rgba(247,147,26,0.6), 0 0 10px rgba(247,147,26,0.3);
  }

  /* stagger: each fires 0.5s after the previous */
  .ping-1 { animation-delay: 0s; }
  .ping-2 { animation-delay: 0.5s; }
  .ping-3 { animation-delay: 1.0s; }
  .ping-4 { animation-delay: 1.5s; }
  .ping-5 { animation-delay: 2.0s; }

  @keyframes pingDrop {
    /*
     * Quick fade in, travel full height of globe (0→100%), quick fade out.
     * Compressed into first 28% of the 2.5s cycle so there's a clear
     * pause before the next ping — gives a clean sequential rhythm.
     */
    0%   { top: -2px;    opacity: 0;   }
    4%   { top: 2%;      opacity: 1;   }
    24%  { top: 98%;     opacity: 0.9; }
    28%  { top: 102%;    opacity: 0;   }
    100% { top: 102%;    opacity: 0;   } /* hold until next cycle */
  }

  /* gl4nce WORDMARK */
  .brand-name { font-family:'Orbitron',monospace; font-weight:900; font-size:1.05rem; letter-spacing:.06em; line-height:1; }
  .b-gl  { color:rgba(240,240,240,.9); }
  .b-4   { color:var(--orange); text-shadow:0 0 14px rgba(247,147,26,.8),0 0 30px rgba(247,147,26,.4); animation:fourGlow 3s ease-in-out infinite; display:inline-block; }
  .b-nce { color:rgba(240,240,240,.9); }
  .b-dot { color:var(--orange); opacity:.7; }
  @keyframes fourGlow { 0%,100%{text-shadow:0 0 14px rgba(247,147,26,.8),0 0 30px rgba(247,147,26,.4)} 50%{text-shadow:0 0 22px rgba(247,147,26,1),0 0 50px rgba(247,147,26,.6),0 0 80px rgba(247,147,26,.2)} }

  /* PAGE NAV */
  .page-nav { flex:1; display:flex; justify-content:center; gap:6px; }
  .nav-btn {
    display:flex; align-items:center; gap:6px;
    /* Fixed height — prevents any layout shift when active border changes */
    height: 34px; padding: 0 18px;
    border-radius:12px;
    font-size:.75rem; font-weight:500; font-family:'Inter',sans-serif;
    color:rgba(255,255,255,.35);
    background:rgba(255,255,255,.03);
    border:1px solid rgba(255,255,255,.07);
    text-decoration:none;
    transition:color .2s, background .2s, border-color .2s, box-shadow .2s;
    letter-spacing:.03em;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .nav-btn:hover { color:rgba(255,255,255,.75); background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.13); }
  .nav-btn--on { color:var(--orange)!important; background:rgba(247,147,26,.1)!important; border-color:rgba(247,147,26,.28)!important; box-shadow:0 0 20px rgba(247,147,26,.12),inset 0 1px 0 rgba(247,147,26,.1); }
  .nav-ico { font-size:.82rem; line-height:1; }

  .hdr-right { display:flex; align-items:center; gap:12px; flex-shrink:0; }
  .hdr-clock { font-size:.78rem; font-weight:500; color:rgba(255,255,255,.2); font-variant-numeric:tabular-nums; letter-spacing:.06em; }
  .settings-btn { display:flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:10px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); color:rgba(255,255,255,.35); cursor:pointer; transition:all .2s; flex-shrink:0; }
  .settings-btn:hover, .settings-btn--on { background:rgba(247,147,26,.1); border-color:rgba(247,147,26,.28); color:var(--orange); box-shadow:0 0 16px rgba(247,147,26,.12); }

  @media (max-width:700px) {
    .hdr { top:10px; width:calc(100% - 20px); padding:9px 14px; border-radius:18px; gap:10px; }
    .brand-name { font-size:.88rem; }
    .hdr-clock { display:none; }
    /* nav buttons: fixed height so they never cause header reflow between pages */
    .nav-btn { padding:0 12px; height:32px; font-size:.7rem; gap:4px; }
    .globe-wrap { width:26px; height:26px; }
  }
  @media (max-width:480px) {
    .nav-btn { padding:0 10px; height:30px; font-size:.65rem; border-radius:9px; }
    .nav-lbl { display:none; }
    .nav-ico { font-size:1rem; }
  }

  /* SETTINGS DRAWER */
  .drawer { background:rgba(4,4,4,.97); backdrop-filter:blur(24px); border-bottom:1px solid rgba(247,147,26,.12); position:relative; z-index:200; }
  .drawer-inner { max-width:880px; margin:0 auto; padding:30px 24px; display:flex; flex-direction:column; gap:24px; }
  .dg-hd { font-size:.73rem; font-weight:600; color:rgba(255,255,255,.5); margin-bottom:13px; display:flex; align-items:center; gap:8px; }
  .dhint { font-size:.64rem; color:rgba(255,255,255,.2); font-weight:400; }
  .dfields { display:flex; gap:10px; flex-wrap:wrap; }
  .df { display:flex; flex-direction:column; gap:5px; flex:1; min-width:100px; }
  .dlbl { font-size:.59rem; color:rgba(255,255,255,.25); font-weight:500; text-transform:uppercase; letter-spacing:.09em; }
  .dinp { width:100%; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:10px; padding:9px 12px; color:#f0f0f0; font-family:'Inter',sans-serif; font-size:.82rem; transition:border-color .2s,box-shadow .2s; }
  .dinp:focus { outline:none; border-color:rgba(247,147,26,.5); box-shadow:0 0 0 3px rgba(247,147,26,.1); }
  .dtags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
  .dtag { display:inline-flex; align-items:center; gap:5px; padding:4px 11px; background:rgba(247,147,26,.07); border:1px solid rgba(247,147,26,.18); border-radius:20px; font-size:.7rem; color:rgba(255,255,255,.55); }
  .dtag-x { background:none; border:none; color:rgba(255,255,255,.25); cursor:pointer; font-size:1rem; padding:0; line-height:1; transition:color .15s; }
  .dtag-x:hover { color:var(--dn); }
  .dinp-row { display:flex; gap:7px; }
  .d-add { padding:9px 16px; border:1px solid rgba(255,255,255,.08); border-radius:10px; background:none; color:rgba(255,255,255,.4); font-size:.72rem; cursor:pointer; transition:all .2s; white-space:nowrap; }
  .d-add:hover { border-color:rgba(247,147,26,.3); color:var(--orange); }
  .dsrcs { max-height:72px; overflow-y:auto; margin-bottom:9px; }
  .dsrc { display:flex; justify-content:space-between; align-items:center; padding:3px 0; font-size:.64rem; color:rgba(255,255,255,.25); }
  .dsrc-url { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:300px; }
  .d-save { align-self:flex-start; padding:11px 28px; background:linear-gradient(135deg,#f7931a,#d97010); border:none; border-radius:12px; color:#fff; font-size:.8rem; font-weight:600; cursor:pointer; transition:all .3s; box-shadow:0 4px 22px rgba(247,147,26,.3); }
  .d-save:hover { transform:translateY(-2px); box-shadow:0 8px 32px rgba(247,147,26,.45); }
  .d-save--ok { background:linear-gradient(135deg,#22c55e,#15803d); box-shadow:0 4px 22px rgba(34,197,94,.3); }
  @media (max-width:600px) { .drawer-inner { padding:22px 16px; } .dfields { flex-direction:column; } }

  .page-wrap { padding-top: 90px; min-height: 100vh; } /* 58px header + 16px top offset + 16px gap */
  @media (max-width:700px) { .page-wrap { padding-top: 76px; } }

  .site-footer { border-top:1px solid rgba(255,255,255,.05); padding:20px 24px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; }
  .footer-brand { font-family:'Orbitron',monospace; font-size:.65rem; font-weight:700; color:rgba(255,255,255,.25); letter-spacing:.1em; display:flex; align-items:center; gap:5px; }
  .footer-sources { font-size:.57rem; color:rgba(255,255,255,.15); }
  @media (max-width:600px) { .site-footer { display:none; } }

  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  :global(.blink) { animation:blink 2s step-end infinite; }
</style>
