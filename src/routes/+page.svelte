<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadSettings, saveSettings, calcDCA, DEFAULT_SETTINGS, type Settings, type LiveSignals } from '$lib/settings';

  // ── STATE ──────────────────────────────────────────────────
  let time = '', dateStr = '';
  let settings: Settings = DEFAULT_SETTINGS;
  let showSettings = false;
  let saved = false;
  let newKeyword = '', newSource = '';
  let activeMobileTab: 'signal' | 'intel' | 'portfolio' = 'signal';
  let showHoldings = false;

  let btcPrice = 0, btcBlock = 0, prevPrice = 0, priceFlash = '';
  let btcFees = { low: 0, medium: 0, high: 0 };
  let halvingBlocksLeft = 0, halvingDays = 0, halvingDate = '', halvingProgress = 0;

  let goldPriceUsd: number|null=null, goldYtdPct: number|null=null;
  let sp500Price: number|null=null, sp500YtdPct: number|null=null;
  let cpiAnnual: number|null=null;

  let fearGreed: number|null=null, fearGreedLabel='';
  let difficultyChange: number|null=null, fundingRate: number|null=null;
  let audUsd: number|null=null, dcaUpdated='';

  let markets: { id:string; question:string; topOutcome:string; probability:number; volume:number; volume24hr:number; endDate:string; tag:string; url:string; pinned:boolean }[] = [];
  let newsItems: { title:string; link:string; source:string; pubDate:string }[] = [];

  let gfNetWorth: number|null=null, gfTotalInvested: number|null=null;
  let gfNetGain: number|null=null, gfNetGainPct: number|null=null;
  let gfNetGainYtdPct: number|null=null, gfTodayChangePct: number|null=null;
  let gfHoldings: { symbol:string; name:string; allocationInPercentage:number; valueInBaseCurrency:number; netPerformancePercentWithCurrencyEffect:number; assetClass:string }[] = [];
  let gfError='', gfLoading=false, gfUpdated='';

  let clockInterval: ReturnType<typeof setInterval>;
  let intervals: ReturnType<typeof setInterval>[] = [];
  let dcaDays=0, invested=0, currentVal=0, perf=0, goalPct=0, satsHeld=0, satsLeft=0;

  // ── DERIVED ────────────────────────────────────────────────
  function updateStacking() {
    const s = settings.dca;
    dcaDays   = Math.max(0, Math.floor((Date.now() - new Date(s.startDate).getTime()) / 86400000));
    invested  = dcaDays * s.dailyAmount;
    currentVal = s.btcHeld * btcPrice;
    perf      = invested > 0 ? ((currentVal - invested) / invested) * 100 : 0;
    goalPct   = s.goalBtc > 0 ? Math.min(100, (s.btcHeld / s.goalBtc) * 100) : 0;
    satsHeld  = Math.round(s.btcHeld * 1e8);
    satsLeft  = Math.max(0, Math.round((s.goalBtc - s.btcHeld) * 1e8));
  }

  $: settings, btcPrice, updateStacking();
  $: liveSignals  = { fearGreed, difficultyChange, fundingRate, audUsd } as LiveSignals;
  $: dca          = btcPrice > 0 ? calcDCA(btcPrice, liveSignals) : null;
  $: accentColor  = !dca ? '#3f3f46' : dca.finalAud === 0 ? '#f43f5e' : dca.finalAud >= 750 ? '#22c55e' : dca.finalAud >= 400 ? '#f7931a' : '#38bdf8';
  $: priceColor   = priceFlash === 'up' ? '#22c55e' : priceFlash === 'down' ? '#f43f5e' : '#e2e2e8';
  $: btcAud       = (btcPrice > 0 && audUsd !== null) ? btcPrice * audUsd : null;
  $: satsPerAud   = btcAud !== null && btcAud > 0 ? Math.round(1e8 / btcAud) : null;

  $: inflationAdjNW = (() => {
    if (gfNetWorth === null || cpiAnnual === null) return null;
    const yrs = (Date.now() - new Date(settings.dca.startDate).getTime()) / (365.25*24*3600*1000);
    return gfNetWorth / Math.pow(1 + cpiAnnual/100, yrs);
  })();

  $: cpiCumLoss = (() => {
    if (cpiAnnual === null) return 0;
    const yrs = Math.max(0.1, (Date.now() - new Date(settings.dca.startDate).getTime()) / (365.25*24*3600*1000));
    return (1 - 1/Math.pow(1 + cpiAnnual/100, yrs)) * 100;
  })();

  $: portCAGR = (() => {
    if (gfNetGainPct === null) return null;
    const yrs = Math.max(0.1, (Date.now() - new Date(settings.dca.startDate).getTime()) / (365.25*24*3600*1000));
    return (Math.pow(1 + gfNetGainPct/100, 1/yrs) - 1) * 100;
  })();

  // ── FETCHERS ───────────────────────────────────────────────
  function tick() {
    const now = new Date();
    time    = now.toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
    dateStr = now.toISOString().split('T')[0];
  }

  async function fetchBtc() {
    try {
      const d = await fetch('/api/bitcoin').then(r=>r.json());
      prevPrice = btcPrice; btcPrice = d.price ?? 0; btcBlock = d.blockHeight ?? 0;
      btcFees = d.fees ?? { low:0, medium:0, high:0 };
      if (d.halving) { halvingBlocksLeft=d.halving.blocksRemaining; halvingDays=d.halving.daysRemaining; halvingDate=d.halving.estimatedDate; halvingProgress=d.halving.progressPct; }
      if (prevPrice && btcPrice !== prevPrice) { priceFlash = btcPrice > prevPrice ? 'up' : 'down'; setTimeout(() => priceFlash='', 1200); }
    } catch {}
  }

  async function fetchDCA() {
    try {
      const d = await fetch('/api/dca').then(r=>r.json());
      fearGreed=d.fearGreed; fearGreedLabel=d.fearGreedLabel; difficultyChange=d.difficultyChange;
      fundingRate=d.fundingRate; audUsd=d.audUsd;
      dcaUpdated = new Date().toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit' });
    } catch {}
  }

  async function fetchPoly() {
    try {
      const kw = encodeURIComponent(JSON.stringify(settings.polymarket.keywords));
      markets = (await fetch(`/api/polymarket?keywords=${kw}`).then(r=>r.json())).markets ?? [];
    } catch {}
  }

  async function fetchNews() {
    try {
      const src = encodeURIComponent(JSON.stringify(settings.news.sources));
      newsItems = (await fetch(`/api/news?sources=${src}`).then(r=>r.json())).items ?? [];
    } catch {}
  }

  async function fetchMarkets() {
    try {
      const d = await fetch('/api/markets').then(r=>r.json());
      goldPriceUsd=d.gold?.priceUsd??null; goldYtdPct=d.gold?.ytdPct??null;
      sp500Price=d.sp500?.price??null; sp500YtdPct=d.sp500?.ytdPct??null;
      cpiAnnual=d.cpiAnnual??null;
    } catch {}
  }

  async function fetchGhostfolio() {
    const token = settings.ghostfolio?.token?.trim();
    if (!token) return;
    gfLoading=true; gfError='';
    try {
      const d = await fetch(`/api/ghostfolio?token=${encodeURIComponent(token)}`).then(r=>r.json());
      if (d.error) { gfError=d.error; }
      else {
        gfNetWorth=d.netWorth; gfTotalInvested=d.totalInvested; gfNetGain=d.netGain;
        gfNetGainPct=d.netGainPct; gfNetGainYtdPct=d.netGainYtdPct; gfTodayChangePct=d.todayChangePct;
        gfHoldings=d.holdings??[];
        gfUpdated = new Date().toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit' });
      }
    } catch { gfError='Connection failed'; }
    finally { gfLoading=false; }
  }

  function saveAll() {
    saveSettings(settings); saved=true; setTimeout(()=>saved=false, 2000);
    fetchPoly(); fetchNews(); if (settings.ghostfolio?.token) fetchGhostfolio();
  }

  const addKeyword   = () => { if (newKeyword.trim())  { settings.polymarket.keywords=[...settings.polymarket.keywords, newKeyword.trim()]; newKeyword=''; } };
  const removeKeyword = (i:number) => { settings.polymarket.keywords=settings.polymarket.keywords.filter((_,j)=>j!==i); };
  const addSource    = () => { if (newSource.trim())  { settings.news.sources=[...settings.news.sources, newSource.trim()]; newSource=''; } };
  const removeSource = (i:number) => { settings.news.sources=settings.news.sources.filter((_,j)=>j!==i); };

  // ── HELPERS ────────────────────────────────────────────────
  const fmtVol  = (v:number) => v>=1e6 ? `$${(v/1e6).toFixed(1)}m` : v>=1e3 ? `$${(v/1e3).toFixed(0)}k` : `$${v}`;
  const fmtDate = (d:string) => { try { return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'}); } catch { return ''; } };
  const pColor  = (p:number) => p>=70?'#22c55e':p>=40?'#f7931a':'#f43f5e';
  const timeAgo = (d:string) => { try { const m=Math.floor((Date.now()-new Date(d).getTime())/60000); return m<60?`${m}m`:m<1440?`${Math.floor(m/60)}h`:`${Math.floor(m/1440)}d`; } catch { return ''; } };
  const n       = (v:number, dec=0) => v.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  const pct     = (v:number|null) => v===null ? '—' : (v>=0?'+':'')+v.toFixed(2)+'%';
  const signColor = (v:number|null) => v===null?'#52525b':v>=0?'#22c55e':'#f43f5e';

  onMount(() => {
    settings=loadSettings(); updateStacking(); tick();
    clockInterval=setInterval(tick, 1000);
    fetchBtc(); fetchDCA(); fetchPoly(); fetchNews(); fetchMarkets();
    if (settings.ghostfolio?.token) fetchGhostfolio();
    intervals = [
      setInterval(fetchBtc,60000), setInterval(fetchDCA,300000),
      setInterval(fetchPoly,300000), setInterval(fetchNews,300000),
      setInterval(fetchMarkets,300000),
      setInterval(()=>{ if (settings.ghostfolio?.token) fetchGhostfolio(); },300000),
    ];
  });
  onDestroy(()=>{ clearInterval(clockInterval); intervals.forEach(clearInterval); });
</script>

<!-- ══════════════════════════════════════════════════════
     AMBIENT LAYERS — orbs, floating shapes, scan lines
     ══════════════════════════════════════════════════════ -->
<div class="bg-orbs" aria-hidden="true">
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="orb orb-3"></div>
</div>
<div class="bg-shapes" aria-hidden="true">
  <div class="geo geo-1"></div>
  <div class="geo geo-2"></div>
  <div class="geo geo-3"></div>
  <div class="geo geo-4"></div>
</div>
<div class="bg-lines" aria-hidden="true">
  <div class="scan"></div>
  <div class="scan"></div>
  <div class="scan"></div>
</div>

<!-- ══════════════════════════════════════════════════════
     FLOATING PILL HEADER
     ══════════════════════════════════════════════════════ -->
<header class="hdr">
  <div class="hdr-brand">
    <div class="brand-orb"><span class="blink"></span></div>
    <span class="brand-name">Glance</span>
    <span class="brand-sub">Bitcoin Intelligence</span>
  </div>
  <div class="hdr-center">
    <span class="hdr-clock">{time}</span>
  </div>
  <div class="hdr-right">
    <button class="hdr-btn" class:hdr-btn--on={showSettings} on:click={() => showSettings = !showSettings}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      <span class="hdr-lbl">Settings</span>
    </button>
  </div>
</header>

<!-- ══════════════════════════════════════════════════════
     SETTINGS DRAWER
     ══════════════════════════════════════════════════════ -->
{#if showSettings}
<div class="drawer">
  <div class="drawer-inner">
    <div class="dg">
      <p class="dg-hd">DCA Stack</p>
      <div class="dfields">
        <label class="df"><span class="dlbl">Start date</span><input type="date" bind:value={settings.dca.startDate} class="dinp"/></label>
        <label class="df"><span class="dlbl">Daily AUD</span><input type="number" bind:value={settings.dca.dailyAmount} class="dinp"/></label>
        <label class="df"><span class="dlbl">BTC held</span><input type="number" step="0.00000001" bind:value={settings.dca.btcHeld} class="dinp"/></label>
        <label class="df"><span class="dlbl">Goal BTC</span><input type="number" step="0.001" bind:value={settings.dca.goalBtc} class="dinp"/></label>
      </div>
    </div>
    <div class="dg">
      <p class="dg-hd">Watchlist <span class="dhint">pinned in markets feed</span></p>
      <div class="dtags">
        {#each settings.polymarket.keywords as kw, i}
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
        {#each settings.news.sources as src, i}
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
        <label class="df" style="flex:3;"><span class="dlbl">Security token</span><input type="password" bind:value={settings.ghostfolio.token} placeholder="your-security-token" class="dinp"/></label>
        <label class="df"><span class="dlbl">Currency</span><input bind:value={settings.ghostfolio.currency} placeholder="AUD" class="dinp" style="width:72px;"/></label>
      </div>
    </div>
    <button on:click={saveAll} class="d-save" class:d-save--ok={saved}>{saved ? '✓ Saved' : 'Save'}</button>
  </div>
</div>
{/if}

<!-- ══════════════════════════════════════════════════════
     HERO BANNER — full width, before grid
     ══════════════════════════════════════════════════════ -->
<section class="hero">
  <div class="hero-inner">
    <p class="hero-eyebrow">Bitcoin · Gold · Markets · Portfolio</p>
    <h1 class="hero-title">SITUATION MONITOR</h1>
    <p class="hero-desc">Real-time on-chain intelligence and portfolio tracking.<br>One dashboard. Everything that matters.</p>

    <!-- Live stats strip — 4 key numbers -->
    <div class="hero-stats">
      <div class="hero-stat">
        <span class="hero-stat-n" style="color:{priceColor}; transition:color 0.5s;">{btcPrice > 0 ? '$'+n(btcPrice) : '—'}</span>
        <span class="hero-stat-l">BTC / USD</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-n" style="color:var(--orange);">{satsPerAud ? satsPerAud.toLocaleString() : '—'}</span>
        <span class="hero-stat-l">Sats per A$1</span>
      </div>
      <div class="hero-stat">
        {#if dca && dca.finalAud > 0}
          <span class="hero-stat-n" style="color:{accentColor};">${dca.finalAud.toLocaleString()}</span>
          <span class="hero-stat-l">DCA Signal (AUD)</span>
        {:else if dca && dca.finalAud === 0}
          <span class="hero-stat-n" style="color:var(--dn);">PASS</span>
          <span class="hero-stat-l">DCA Signal</span>
        {:else}
          <span class="hero-stat-n" style="color:rgba(255,255,255,0.15);">—</span>
          <span class="hero-stat-l">DCA Signal</span>
        {/if}
      </div>
      <div class="hero-stat">
        <span class="hero-stat-n">{halvingDays > 0 ? halvingDays.toLocaleString() : '—'}</span>
        <span class="hero-stat-l">Days to Halving</span>
      </div>
    </div>
  </div>
</section>

<!-- ══════════════════════════════════════════════════════
     MAIN GRID
     ══════════════════════════════════════════════════════ -->
<main class="app"
  class:tab-signal={activeMobileTab==='signal'}
  class:tab-intel={activeMobileTab==='intel'}
  class:tab-portfolio={activeMobileTab==='portfolio'}>

  <div class="layout">

    <!-- ── COLUMN A: SIGNAL ─────────────────────────── -->
    <section class="col-a">

      <p class="sect-title">SIGNAL ANALYSIS</p>

      <!-- BUY SIGNAL — hero card -->
      <div class="gc signal-card" style="--ac:{accentColor};">
        <div class="signal-bar" style="background:linear-gradient(90deg,{accentColor}44,{accentColor},{accentColor}44);"></div>

        <div class="sc-head">
          <div>
            <p class="eyebrow" style="color:var(--orange); letter-spacing:0.14em;">DCA Signal</p>
            <p class="dim-text" style="margin-top:4px;">Fortnightly buy recommendation</p>
          </div>
          <span class="ts-badge">{dcaUpdated || 'loading…'}</span>
        </div>

        <div class="sc-hero">
          {#if !dca}
            <span class="hero-n" style="color:rgba(255,255,255,0.08);">—</span>
          {:else if dca.finalAud === 0}
            <span class="hero-n" style="color:var(--dn); text-shadow:0 0 80px rgba(239,68,68,0.35);">PASS</span>
          {:else}
            <span class="hero-n" style="color:{accentColor}; text-shadow:0 0 100px {accentColor}44;">${dca.finalAud.toLocaleString()}</span>
          {/if}
          <p class="hero-sub">AUD · fortnightly</p>
        </div>

        <!-- Valuation band -->
        {#if btcPrice > 0}
        <div class="vband">
          <div class="vband-labels">
            <span style="color:var(--up); font-size:0.58rem; font-weight:600;">$55k CHEAP</span>
            <span style="font-size:0.58rem; color:rgba(255,255,255,0.25);">Bitcoin Valuation Band</span>
            <span style="color:var(--dn); font-size:0.58rem; font-weight:600;">EXPENSIVE $125k</span>
          </div>
          <div class="vband-track">
            {#if btcPrice <= 55000}
              <div class="vband-fill" style="width:2%; background:var(--up);"></div>
            {:else if btcPrice >= 125000}
              <div class="vband-fill" style="width:100%; background:var(--dn);"></div>
            {:else}
              <div class="vband-fill" style="width:{((btcPrice-55000)/70000)*100}%; background:linear-gradient(90deg,var(--up),var(--orange),var(--dn));"></div>
            {/if}
          </div>
        </div>
        {/if}

        <!-- Signals — spacious dot list -->
        {#if dca}
        <div class="sigs">
          {#each dca.signals as sig}
            <div class="sig" class:sig--on={sig.active}>
              <div class="sig-pip-wrap">
                <div class="sig-pip" class:sig-pip--on={sig.active}></div>
                {#if sig.active}<div class="sig-ring"></div>{/if}
              </div>
              <span class="sig-label">{sig.name}</span>
              {#if sig.active}<span class="sig-badge">+{sig.boost}%</span>{/if}
            </div>
          {/each}
        </div>
        {/if}

        <!-- Price trio -->
        <div class="price-trio">
          <div class="pt-item"><p class="eyebrow">BTC/USD</p><p class="pt-val" style="color:{priceColor}; transition:color 0.5s;">{btcPrice > 0 ? '$'+n(btcPrice) : '—'}</p></div>
          <div class="pt-div"></div>
          <div class="pt-item"><p class="eyebrow">BTC/AUD</p><p class="pt-val">{btcAud ? 'A$'+n(btcAud,0) : '—'}</p></div>
          <div class="pt-div"></div>
          <div class="pt-item"><p class="eyebrow">Sats/A$1</p><p class="pt-val" style="color:var(--orange);">{satsPerAud ? satsPerAud.toLocaleString() : '—'}</p></div>
        </div>
      </div>

      <!-- BITCOIN NETWORK — own card, room to breathe -->
      <div class="gc">
        <div class="card-head">
          <p class="ch-t">Bitcoin Network</p>
          <a href="https://mempool.space" target="_blank" rel="noopener noreferrer" class="ch-link">mempool.space ↗</a>
        </div>
        <div class="metric-trio">
          <div class="mt-item">
            <p class="eyebrow">Block Height</p>
            <p class="metric-n">{n(btcBlock) || '—'}</p>
          </div>
          <div class="mt-item">
            <p class="eyebrow">Fee · Low</p>
            <p class="metric-n" style="color:var(--up);">{btcFees.low || '—'}<span class="metric-unit">sat/vb</span></p>
          </div>
          <div class="mt-item">
            <p class="eyebrow">Fee · High</p>
            <p class="metric-n" style="color:var(--dn);">{btcFees.high || '—'}<span class="metric-unit">sat/vb</span></p>
          </div>
        </div>

        {#if halvingBlocksLeft > 0}
        <div class="halving">
          <div class="halving-row">
            <div>
              <p class="eyebrow">Next Halving</p>
              <p class="halving-days">{halvingDays.toLocaleString()} <span class="halving-unit">days</span></p>
            </div>
            <div style="text-align:right;">
              <p class="eyebrow">{halvingProgress.toFixed(1)}% of epoch</p>
              <p class="dim-text" style="margin-top:2px;">{halvingBlocksLeft.toLocaleString()} blocks · ~{halvingDate}</p>
            </div>
          </div>
          <div class="hprog-track">
            <div class="hprog-fill" style="width:{halvingProgress}%;"></div>
          </div>
        </div>
        {/if}
      </div>

      <!-- MY STACK — own card -->
      <div class="gc">
        <div class="card-head">
          <p class="ch-t">My Stack</p>
          <p class="ch-accent">${settings.dca.dailyAmount}/day · {dcaDays}d</p>
        </div>
        <div class="metric-trio" style="margin-bottom:20px;">
          <div class="mt-item">
            <p class="eyebrow">Invested</p>
            <p class="metric-n">${n(invested)}</p>
          </div>
          <div class="mt-item">
            <p class="eyebrow">Value Today</p>
            <p class="metric-n" style="color:{perf>=0?'var(--up)':'var(--dn)'};">{btcPrice>0?'$'+n(currentVal):'—'}</p>
          </div>
          <div class="mt-item">
            <p class="eyebrow">Total Return</p>
            <p class="metric-n" style="color:{perf>=0?'var(--up)':'var(--dn)'};">{btcPrice>0?(perf>=0?'+':'')+perf.toFixed(1)+'%':'—'}</p>
          </div>
        </div>

        <div class="btc-pill">
          <span style="color:var(--orange); font-weight:700; font-size:0.95rem;">{settings.dca.btcHeld.toFixed(8)}</span>
          <span style="color:rgba(255,255,255,0.35); margin:0 6px;">BTC</span>
          <span style="color:rgba(255,255,255,0.25); font-size:0.75rem;">{n(satsHeld)} sats</span>
        </div>

        <div class="goal">
          <div class="goal-head">
            <p class="eyebrow">Goal · {settings.dca.goalBtc} BTC</p>
            <p class="eyebrow" style="color:var(--orange);">{goalPct.toFixed(1)}%</p>
          </div>
          <div class="goal-track"><div class="goal-fill" style="width:{goalPct}%;"></div></div>
          <p class="dim-text" style="text-align:right; margin-top:5px;">{n(satsLeft)} sats remaining</p>
        </div>
      </div>

    </section>

    <!-- ── COLUMN B: INTEL ──────────────────────────── -->
    <section class="col-b">

      <p class="sect-title">MARKET INTELLIGENCE</p>

      <!-- POLYMARKET — max 5, generous spacing -->
      <div class="gc">
        <div class="card-head" style="margin-bottom:20px;">
          <div>
            <p class="ch-t">Prediction Markets</p>
            <p class="dim-text" style="margin-top:3px;">Live crowd-sourced probability</p>
          </div>
          <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" class="ch-link">Polymarket ↗</a>
        </div>

        {#if markets.length === 0}
          <p class="dim-text" style="padding:8px 0;">Fetching live markets…</p>
        {:else}
          {#each markets.slice(0,5) as m}
            <div class="mkt">
              <div class="mkt-meta">
                <span class="mkt-tag" class:mkt-tag--pin={m.pinned}>{m.pinned ? '★ Pinned' : m.tag}</span>
                {#if m.endDate}<span class="dim-text">{fmtDate(m.endDate)}</span>{/if}
              </div>
              <div class="mkt-body">
                <a href="{m.url}" target="_blank" rel="noopener noreferrer" class="mkt-q">{m.question}</a>
                <div class="mkt-prob-wrap">
                  <span class="mkt-prob" style="color:{pColor(m.probability)};">{m.probability}</span>
                  <span class="mkt-pct">%</span>
                </div>
              </div>
              <div class="mkt-track"><div class="mkt-fill" style="width:{m.probability}%; background:{pColor(m.probability)};"></div></div>
              <div class="mkt-foot">
                <span style="font-size:0.64rem; color:{pColor(m.probability)}; font-weight:500;">{m.topOutcome}</span>
                <span class="dim-text">{fmtVol(m.volume)}</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- NEWS — generous line spacing -->
      <div class="gc">
        <div class="card-head" style="margin-bottom:20px;">
          <p class="ch-t">Latest News</p>
        </div>
        {#if newsItems.length === 0}
          <p class="dim-text">Fetching feeds…</p>
        {:else}
          {#each newsItems as item}
            <div class="news">
              <a href={item.link} target="_blank" rel="noopener noreferrer" class="news-title">{item.title}</a>
              <div class="news-meta">
                <span class="news-src">{item.source}</span>
                <span class="dim-text">{timeAgo(item.pubDate)} ago</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>

    </section>

    <!-- ── ROW 2: PORTFOLIO ─────────────────────────── -->
    <section class="col-c">

      <p class="sect-title" style="width:100%;">PORTFOLIO INTELLIGENCE</p>

      <!-- ASSET PANELS — 4 big visual tiles instead of tiny bar rows -->
      <div class="gc asset-grid-card">
        <div class="card-head" style="margin-bottom:24px;">
          <p class="ch-t">Asset Performance</p>
          <p class="dim-text">1-year return vs Bitcoin</p>
        </div>
        <div class="asset-panels">
          {#each [
            { ticker:'BTC',  name:'Bitcoin',   icon:'₿', pct:null,        color:'#f7931a', sub: btcPrice ? '$'+n(btcPrice) : '—' },
            { ticker:'XAU',  name:'Gold',      icon:'◈', pct:goldYtdPct,  color:'#c9a84c', sub: goldPriceUsd ? '$'+n(goldPriceUsd,0) : '—' },
            { ticker:'SPX',  name:'S&P 500',   icon:'↗', pct:sp500YtdPct, color:'#888888', sub: sp500Price ? n(sp500Price,0) : '—' },
            { ticker:'CPI',  name:'Inflation', icon:'↓', pct:cpiAnnual,   color:'#ef4444', sub: 'Annual rate' },
          ] as a}
            <div class="asset-panel" style="--pc:{a.color};">
              <div class="ap-top">
                <span class="ap-icon" style="color:{a.color};">{a.icon}</span>
                <div>
                  <p class="ap-ticker" style="color:{a.color};">{a.ticker}</p>
                  <p class="ap-name">{a.name}</p>
                </div>
              </div>
              <p class="ap-pct" style="color:{a.pct===null?a.color:a.pct>=0?'var(--up)':'var(--dn)'};">
                {a.pct!==null?(a.pct>=0?'+':'')+a.pct.toFixed(1)+'%':'live'}
              </p>
              <p class="ap-sub">{a.sub}</p>
              <div class="ap-bar">
                {#if a.pct !== null}
                  {@const w = Math.min(100, Math.max(2, (a.pct/150)*100+50))}
                  <div class="ap-fill" style="width:{w}%; background:{a.pct>=0?'var(--up)':'var(--dn)'};"></div>
                {:else}
                  <div class="ap-fill" style="width:70%; background:{a.color}; animation: apPulse 3s ease-in-out infinite;"></div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
        {#if cpiAnnual !== null}
          <p class="cpi-note">Purchasing power lost to inflation since DCA start: <span style="color:var(--dn);">−{cpiCumLoss.toFixed(1)}%</span></p>
        {/if}
      </div>

      <!-- GHOSTFOLIO -->
      {#if settings.ghostfolio?.token}
      <div class="gc gf-card">
        <div class="card-head" style="margin-bottom:24px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <p class="ch-t">Portfolio</p>
            <span class="dim-text">via Ghostfolio</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            {#if gfLoading}<span class="live-dot blink"></span>{/if}
            {#if gfUpdated && !gfLoading}<span class="dim-text">{gfUpdated}</span>{/if}
            <button on:click={fetchGhostfolio} class="icon-btn">↻</button>
          </div>
        </div>

        {#if gfError}
          <p class="err-msg">{gfError} — check your token in Settings.</p>
        {:else}
          <!-- Net worth hero -->
          <div class="gf-hero-row">
            <div class="gf-nw-block">
              <p class="eyebrow">Net Worth</p>
              <p class="gf-nw">{gfNetWorth !== null ? '$'+n(gfNetWorth,0) : '—'}</p>
              <p class="eyebrow">{settings.ghostfolio.currency||'AUD'} · nominal</p>
            </div>
            {#if inflationAdjNW !== null}
            <div class="gf-nw-block" style="opacity:0.45;">
              <p class="eyebrow">Real Value</p>
              <p class="gf-nw">{inflationAdjNW !== null ? '$'+n(inflationAdjNW,0) : '—'}</p>
              <p class="eyebrow">CPI-adjusted</p>
            </div>
            {/if}
            <div class="gf-vline"></div>
            <div class="gf-perf-row">
              <div class="gf-perf"><p class="eyebrow">Today</p><p class="gf-pv" style="color:{signColor(gfTodayChangePct)};">{pct(gfTodayChangePct)}</p></div>
              <div class="gf-perf"><p class="eyebrow">YTD</p><p class="gf-pv" style="color:{signColor(gfNetGainYtdPct)};">{pct(gfNetGainYtdPct)}</p></div>
              <div class="gf-perf"><p class="eyebrow">All-time</p><p class="gf-pv" style="color:{signColor(gfNetGainPct)};">{pct(gfNetGainPct)}</p></div>
              <div class="gf-perf"><p class="eyebrow">Invested</p><p class="gf-pv">{gfTotalInvested!==null?'$'+n(gfTotalInvested,0):'—'}</p></div>
            </div>
          </div>

          <!-- Benchmark strip -->
          {#if portCAGR!==null || cpiAnnual!==null || goldYtdPct!==null || sp500YtdPct!==null}
          <div class="bench-strip">
            {#if portCAGR!==null}
              <div class="bench-cell">
                <p class="eyebrow" style="color:var(--orange);">Portfolio CAGR</p>
                <p class="bench-v" style="color:{portCAGR>=0?'var(--up)':'var(--dn)'};">{portCAGR>=0?'+':''}{portCAGR.toFixed(1)}<span class="bench-u">%/yr</span></p>
                {#if cpiAnnual!==null}<p class="bench-vs" style="color:{portCAGR>cpiAnnual?'var(--up)':'var(--dn)'};">{portCAGR>cpiAnnual?'▲ ':'▼ '}{Math.abs(portCAGR-cpiAnnual).toFixed(1)}% vs CPI</p>{/if}
              </div>
            {/if}
            {#if cpiAnnual!==null}
              <div class="bench-cell">
                <p class="eyebrow" style="color:var(--dn);">CPI Inflation</p>
                <p class="bench-v" style="color:var(--dn);">+{cpiAnnual.toFixed(1)}<span class="bench-u">%/yr</span></p>
              </div>
            {/if}
            {#if goldYtdPct!==null}
              <div class="bench-cell">
                <p class="eyebrow" style="color:#c9a84c;">Gold 1Y</p>
                <p class="bench-v" style="color:{goldYtdPct>=0?'#c9a84c':'var(--dn)'};">{goldYtdPct>=0?'+':''}{goldYtdPct.toFixed(1)}<span class="bench-u">%</span></p>
              </div>
            {/if}
            {#if sp500YtdPct!==null}
              <div class="bench-cell">
                <p class="eyebrow">S&P 500 1Y</p>
                <p class="bench-v" style="color:{sp500YtdPct>=0?'rgba(255,255,255,0.85)':'var(--dn)'};">{sp500YtdPct>=0?'+':''}{sp500YtdPct.toFixed(1)}<span class="bench-u">%</span></p>
              </div>
            {/if}
          </div>
          {/if}

          <!-- Holdings collapsible -->
          {#if gfHoldings.length > 0}
          <div class="holdings">
            <button class="hold-btn" on:click={() => showHoldings=!showHoldings}>
              <span>Holdings ({gfHoldings.length})</span>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor"
                style="transform:{showHoldings?'rotate(180deg)':'rotate(0)'}; transition:transform 0.25s; margin-left:6px; opacity:0.35;">
                <path d="M5 7L1 3h8z"/>
              </svg>
            </button>
            {#if showHoldings}
            <div class="hgrid">
              {#each gfHoldings as h}
                {@const pc = h.netPerformancePercentWithCurrencyEffect}
                <div class="h-card">
                  <div class="h-top"><span class="h-sym">{h.symbol}</span><span class="h-pct" style="color:{pc>=0?'var(--up)':'var(--dn)'};">{pc>=0?'+':''}{pc.toFixed(1)}%</span></div>
                  {#if h.name!==h.symbol}<p class="h-name">{h.name.slice(0,22)}</p>{/if}
                  <div class="h-bar"><div class="h-fill" style="width:{Math.min(100,h.allocationInPercentage)}%;"></div></div>
                  <div class="h-foot"><span>{h.allocationInPercentage.toFixed(1)}%</span><span>${n(h.valueInBaseCurrency,0)}</span></div>
                </div>
              {/each}
            </div>
            {/if}
          </div>
          {/if}
        {/if}
      </div>
      {/if}

    </section>
  </div>
</main>

<!-- ══════════════════════════════════════════════════════
     MOBILE BOTTOM NAV
     ══════════════════════════════════════════════════════ -->
<nav class="bnav">
  <button class="bnav-tab" class:bnav-tab--on={activeMobileTab==='signal'} on:click={() => activeMobileTab='signal'}>
    <span class="bnav-ico">₿</span>
    <span class="bnav-lbl">Signal</span>
    {#if dca && dca.finalAud > 0}<span class="bnav-pip" style="background:{accentColor};"></span>{/if}
  </button>
  <button class="bnav-tab" class:bnav-tab--on={activeMobileTab==='intel'} on:click={() => activeMobileTab='intel'}>
    <span class="bnav-ico">◈</span>
    <span class="bnav-lbl">Intel</span>
    {#if markets.length > 0}<span class="bnav-pip" style="background:var(--orange);"></span>{/if}
  </button>
  <button class="bnav-tab" class:bnav-tab--on={activeMobileTab==='portfolio'} on:click={() => activeMobileTab='portfolio'}>
    <span class="bnav-ico">↗</span>
    <span class="bnav-lbl">Portfolio</span>
  </button>
</nav>

<footer class="site-footer">
  <div class="footer-brand">
    <span class="blink" style="color:var(--orange); font-size:0.5rem; vertical-align:middle;">●</span>
    Glance · Bitcoin Intelligence Monitor
  </div>
  <div class="footer-sources">mempool.space · alternative.me · binance · exchangerate-api · ghostfol.io · worldbank</div>
</footer>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :global(button, a) { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }

  /* ══ AMBIENT BACKGROUND ════════════════════════════════════════ */
  .bg-orbs { position: fixed; inset: 0; z-index: -3; pointer-events: none; overflow: hidden; }
  .orb { position: absolute; border-radius: 50%; filter: blur(120px); animation: orbDrift 22s ease-in-out infinite; }
  .orb-1 { width: 700px; height: 700px; bottom: -250px; left: -200px; background: radial-gradient(circle, rgba(247,147,26,0.2) 0%, transparent 70%); animation-delay: 0s; }
  .orb-2 { width: 550px; height: 550px; top: -180px; right: -150px; background: radial-gradient(circle, rgba(200,90,10,0.14) 0%, transparent 70%); animation-delay: -8s; }
  .orb-3 { width: 400px; height: 400px; top: 45%; left: 48%; background: radial-gradient(circle, rgba(247,147,26,0.07) 0%, transparent 70%); animation-delay: -16s; }
  @keyframes orbDrift {
    0%, 100% { transform: translate(0,0) scale(1); opacity: 0.7; }
    33%       { transform: translate(50px,-40px) scale(1.06); opacity: 1; }
    66%       { transform: translate(-30px, 25px) scale(0.94); opacity: 0.75; }
  }

  .bg-shapes { position: fixed; inset: 0; z-index: -2; pointer-events: none; overflow: hidden; }
  .geo { position: absolute; border: 1px solid rgba(247,147,26,0.1); animation: geoRise 26s linear infinite; }
  .geo-1 { width: 90px; height: 90px; left: 9%;  animation-delay:  0s; }
  .geo-2 { width: 55px; height: 55px; left: 68%; animation-delay: -9s;  border-radius: 50%; border-color: rgba(247,147,26,0.07); }
  .geo-3 { width: 70px; height: 70px; left: 38%; animation-delay:-18s; transform: rotate(45deg); border-color: rgba(247,147,26,0.09); }
  .geo-4 { width: 100px;height: 100px;right:8%;  animation-delay: -5s;  border-color: rgba(247,147,26,0.06); }
  @keyframes geoRise {
    from { transform: translateY(110vh) rotate(0deg);   opacity: 0; }
    10%, 90% { opacity: 1; }
    to   { transform: translateY(-120px) rotate(360deg); opacity: 0; }
  }

  .bg-lines { position: fixed; inset: 0; z-index: -1; pointer-events: none; }
  .scan { position: absolute; left: 0; width: 100%; height: 1px; background: linear-gradient(90deg, transparent, rgba(247,147,26,0.2), transparent); animation: scanPulse 5s ease-in-out infinite; }
  .scan:nth-child(1) { top: 20%; animation-delay:   0s; }
  .scan:nth-child(2) { top: 56%; animation-delay: -1.7s; }
  .scan:nth-child(3) { top: 79%; animation-delay: -3.3s; }
  @keyframes scanPulse {
    0%, 100% { opacity: 0; transform: scaleX(0.2); }
    50%       { opacity: 1; transform: scaleX(1); }
  }

  /* ══ GLASS CARD ════════════════════════════════════════════════ */
  .gc {
    background: rgba(255,255,255,0.04);
    backdrop-filter: blur(28px) saturate(160%);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 22px;
    padding: 28px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06);
    transition: transform 0.4s cubic-bezier(0.4,0,0.2,1), border-color 0.3s, box-shadow 0.4s;
  }
  .gc:hover {
    transform: translateY(-5px) perspective(800px) rotateX(1deg);
    border-color: rgba(247,147,26,0.18);
    box-shadow: 0 24px 52px rgba(0,0,0,0.55), 0 0 0 1px rgba(247,147,26,0.08), inset 0 1px 0 rgba(255,255,255,0.09);
  }

  /* ══ FLOATING PILL HEADER ══════════════════════════════════════ */
  .hdr {
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    z-index: 300; width: calc(100% - 32px); max-width: 1240px;
    display: flex; align-items: center;
    padding: 14px 24px;
    background: rgba(6,6,6,0.75);
    backdrop-filter: blur(32px) saturate(200%);
    -webkit-backdrop-filter: blur(32px) saturate(200%);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 24px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
  }
  .hdr-brand { display: flex; align-items: center; gap: 10px; flex: 1; }
  .brand-orb {
    width: 11px; height: 11px; border-radius: 50%;
    background: var(--orange); box-shadow: 0 0 12px var(--orange), 0 0 24px rgba(247,147,26,0.35);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .brand-orb .blink { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,0.8); }
  .brand-name { font-size: 0.92rem; font-weight: 700; color: #f0f0f0; letter-spacing: -0.02em; }
  .brand-sub { font-size: 0.62rem; color: rgba(255,255,255,0.2); display: none; }
  @media (min-width: 600px) { .brand-sub { display: block; } }
  .hdr-center { position: absolute; left: 50%; transform: translateX(-50%); }
  .hdr-clock { font-size: 0.82rem; font-weight: 500; color: rgba(255,255,255,0.3); font-variant-numeric: tabular-nums; letter-spacing: 0.06em; }
  .hdr-right { flex: 1; display: flex; justify-content: flex-end; }
  .hdr-btn { display: flex; align-items: center; gap: 7px; padding: 8px 15px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.4); font-size: 0.72rem; font-family: 'Inter', sans-serif; cursor: pointer; transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
  .hdr-btn:hover, .hdr-btn--on { background: rgba(247,147,26,0.1); border-color: rgba(247,147,26,0.28); color: var(--orange); box-shadow: 0 0 20px rgba(247,147,26,0.12); }
  .hdr-lbl { display: block; }
  @media (max-width: 600px) {
    .hdr { top: 10px; width: calc(100% - 20px); padding: 11px 16px; border-radius: 18px; }
    .hdr-center { display: none; }
    .hdr-lbl { display: none; }
    .hdr-btn { padding: 8px; min-width: 36px; justify-content: center; }
  }

  /* ══ SETTINGS DRAWER ═══════════════════════════════════════════ */
  .drawer { background: rgba(4,4,4,0.97); backdrop-filter: blur(24px); border-bottom: 1px solid rgba(247,147,26,0.12); }
  .drawer-inner { max-width: 880px; margin: 0 auto; padding: 30px 24px; display: flex; flex-direction: column; gap: 24px; }
  .dg {}
  .dg-hd { font-size: 0.73rem; font-weight: 600; color: rgba(255,255,255,0.5); margin-bottom: 13px; display: flex; align-items: center; gap: 8px; }
  .dhint { font-size: 0.64rem; color: rgba(255,255,255,0.2); font-weight: 400; }
  .dfields { display: flex; gap: 10px; flex-wrap: wrap; }
  .df { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 100px; }
  .dlbl { font-size: 0.6rem; color: rgba(255,255,255,0.25); font-weight: 500; text-transform: uppercase; letter-spacing: 0.08em; }
  .dinp { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 9px 12px; color: #f0f0f0; font-family: 'Inter', sans-serif; font-size: 0.82rem; transition: border-color 0.2s, box-shadow 0.2s; }
  .dinp:focus { outline: none; border-color: rgba(247,147,26,0.5); box-shadow: 0 0 0 3px rgba(247,147,26,0.1); }
  .dtags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .dtag { display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px; background: rgba(247,147,26,0.07); border: 1px solid rgba(247,147,26,0.18); border-radius: 20px; font-size: 0.7rem; color: rgba(255,255,255,0.55); }
  .dtag-x { background: none; border: none; color: rgba(255,255,255,0.25); cursor: pointer; font-size: 1rem; padding: 0; line-height: 1; transition: color 0.15s; }
  .dtag-x:hover { color: var(--dn); }
  .dinp-row { display: flex; gap: 7px; }
  .d-add { padding: 9px 16px; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; background: none; color: rgba(255,255,255,0.4); font-size: 0.72rem; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
  .d-add:hover { border-color: rgba(247,147,26,0.3); color: var(--orange); }
  .dsrcs { max-height: 72px; overflow-y: auto; margin-bottom: 9px; }
  .dsrc { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 0.64rem; color: rgba(255,255,255,0.25); }
  .dsrc-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
  .d-save { align-self: flex-start; padding: 11px 28px; background: linear-gradient(135deg, #f7931a, #d97010); border: none; border-radius: 12px; color: #fff; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 22px rgba(247,147,26,0.3); }
  .d-save:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(247,147,26,0.45); }
  .d-save--ok { background: linear-gradient(135deg, #22c55e, #15803d); box-shadow: 0 4px 22px rgba(34,197,94,0.3); }
  @media (max-width: 600px) { .drawer-inner { padding: 22px 16px; } .dfields { flex-direction: column; } }

  /* ══ HERO SECTION ═══════════════════════════════════════════════ */
  .hero {
    padding: 120px 24px 60px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  .hero::before {
    content: '';
    position: absolute; top: 50%; left: 50%;
    width: 70%; height: 70%;
    background: radial-gradient(circle, rgba(247,147,26,0.05) 0%, transparent 70%);
    transform: translate(-50%, -50%);
    animation: heroPulse 12s ease-in-out infinite;
    z-index: -1;
  }
  @keyframes heroPulse {
    0%, 100% { transform: translate(-50%,-50%) scale(1); opacity: 0.6; }
    50%       { transform: translate(-50%,-50%) scale(1.4); opacity: 1; }
  }
  .hero-inner { max-width: 820px; margin: 0 auto; animation: heroAppear 1.6s ease-out; }
  @keyframes heroAppear {
    from { opacity: 0; transform: translateY(40px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .hero-eyebrow {
    font-size: 0.72rem; font-weight: 500;
    color: var(--orange);
    text-transform: uppercase; letter-spacing: 0.35em;
    margin-bottom: 20px;
    position: relative; display: inline-block;
  }
  .hero-eyebrow::before, .hero-eyebrow::after {
    content: '';
    position: absolute; top: 50%;
    width: 36px; height: 1px;
    background: linear-gradient(90deg, transparent, var(--orange), transparent);
    animation: linePulse 3s ease infinite;
  }
  .hero-eyebrow::before { right: calc(100% + 16px); }
  .hero-eyebrow::after  { left:  calc(100% + 16px); }
  @keyframes linePulse {
    0%, 100% { opacity: 0.4; transform: scaleX(0.7); }
    50%       { opacity: 1;   transform: scaleX(1.2); }
  }
  .hero-title {
    font-size: clamp(2rem, 6vw, 4.2rem);
    font-weight: 800;
    letter-spacing: -0.025em;
    line-height: 1.05;
    margin-bottom: 20px;
    background: linear-gradient(135deg, #f7931a 0%, #ffd080 40%, #f7931a 70%, #e06000 100%);
    background-size: 300% 300%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: titleGlow 8s ease infinite;
  }
  @keyframes titleGlow {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .hero-desc { font-size: 1rem; color: rgba(255,255,255,0.4); line-height: 1.7; margin-bottom: 50px; font-weight: 300; }
  .hero-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 20px; max-width: 680px; margin: 0 auto; }
  .hero-stat {
    text-align: center; padding: 18px 12px;
    background: linear-gradient(135deg, rgba(247,147,26,0.07), rgba(247,147,26,0.03));
    border: 1px solid rgba(247,147,26,0.14);
    border-radius: 14px;
    backdrop-filter: blur(10px);
    transition: transform 0.3s, border-color 0.3s, box-shadow 0.3s;
  }
  .hero-stat:hover { transform: translateY(-6px) scale(1.03); border-color: rgba(247,147,26,0.28); box-shadow: 0 16px 36px rgba(247,147,26,0.1); }
  .hero-stat-n { display: block; font-size: 1.5rem; font-weight: 700; color: #f0f0f0; letter-spacing: -0.02em; margin-bottom: 6px; }
  .hero-stat-l { font-size: 0.6rem; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.1em; }
  @media (max-width: 600px) {
    .hero { padding: 90px 16px 40px; }
    .hero-stats { grid-template-columns: repeat(2,1fr); gap: 10px; }
    .hero-stat-n { font-size: 1.2rem; }
    .hero-eyebrow::before, .hero-eyebrow::after { display: none; }
  }

  /* ══ LAYOUT GRID ═══════════════════════════════════════════════ */
  .app { }
  .layout {
    display: grid;
    grid-template-columns: 360px 1fr;
    grid-template-rows: auto auto;
    gap: 14px; padding: 0 14px 14px;
    max-width: 1440px; margin: 0 auto; align-items: start;
  }
  .col-a { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; gap: 14px; }
  .col-b { grid-column: 2; grid-row: 1; display: flex; flex-direction: column; gap: 14px; }
  .col-c { grid-column: 1/-1; grid-row: 2; display: flex; gap: 14px; align-items: start; flex-wrap: wrap; }
  @media (max-width: 1100px) { .layout { grid-template-columns: 310px 1fr; } }
  @media (max-width: 800px) {
    .layout { grid-template-columns: 1fr; gap: 10px; padding: 0 10px 10px; }
    .col-a, .col-b { grid-column: 1; grid-row: auto; }
    .col-c { flex-direction: column; }
  }
  @media (max-width: 600px) {
    .layout { padding: 0 8px 90px; gap: 8px; }
    .col-a, .col-b, .col-c { display: none !important; }
    .tab-signal    .col-a { display: flex !important; flex-direction: column; gap: 8px; }
    .tab-intel     .col-b { display: flex !important; flex-direction: column; gap: 8px; }
    .tab-portfolio .col-c { display: flex !important; flex-direction: column; gap: 8px; }
  }

  /* ══ SECTION TITLES — Neural Glass gradient style ══════════════ */
  .sect-title {
    font-size: 0.65rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.22em;
    background: linear-gradient(90deg, var(--orange), rgba(247,147,26,0.5));
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 4px; padding-left: 2px;
    position: relative;
  }
  .sect-title::after {
    content: '';
    position: absolute; bottom: -6px; left: 0;
    width: 40px; height: 1px;
    background: linear-gradient(90deg, var(--orange), transparent);
  }

  /* ══ TYPE ATOMS ════════════════════════════════════════════════ */
  .eyebrow { font-size: 0.59rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(255,255,255,0.22); }
  .dim-text { font-size: 0.62rem; color: rgba(255,255,255,0.25); }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .ch-t { font-size: 0.84rem; font-weight: 600; color: #f0f0f0; letter-spacing: -0.01em; }
  .ch-link { font-size: 0.62rem; color: rgba(255,255,255,0.25); text-decoration: none; transition: color 0.2s; }
  .ch-link:hover { color: var(--orange); }
  .ch-accent { font-size: 0.62rem; color: var(--orange); }
  .ts-badge { font-size: 0.59rem; color: rgba(255,255,255,0.2); font-variant-numeric: tabular-nums; }
  .err-msg { font-size: 0.74rem; color: var(--dn); padding: 10px 14px; border: 1px solid rgba(239,68,68,0.2); border-radius: 10px; background: rgba(239,68,68,0.05); }

  /* ══ SIGNAL CARD ════════════════════════════════════════════════ */
  .signal-card {
    background: linear-gradient(180deg, rgba(247,147,26,0.07) 0%, rgba(255,255,255,0.04) 70px);
    position: relative; overflow: hidden;
  }
  .signal-bar { position: absolute; top: 0; left: 0; right: 0; height: 2px; border-radius: 22px 22px 0 0; }
  .sc-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 26px; }

  .sc-hero { text-align: center; padding: 20px 0 24px; }
  .hero-n {
    display: block;
    font-size: 5rem; font-weight: 700;
    line-height: 1; letter-spacing: -0.045em;
    transition: color 0.5s, text-shadow 0.5s;
  }
  .hero-sub { font-size: 0.58rem; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 0.16em; margin-top: 10px; }
  @media (max-width: 600px) { .hero-n { font-size: 6.5rem; } .sc-hero { padding: 28px 0 32px; } }

  /* Valuation band */
  .vband { margin-bottom: 20px; }
  .vband-labels { display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px; }
  .vband-track { height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
  .vband-fill { height: 100%; border-radius: 2px; transition: width 0.8s cubic-bezier(.4,0,.2,1); }

  /* Signal conditions */
  .sigs { display: flex; flex-direction: column; gap: 11px; padding: 18px 0; border-top: 1px solid rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 20px; }
  .sig { display: flex; align-items: center; gap: 12px; transition: opacity 0.2s; }
  .sig:not(.sig--on) { opacity: 0.3; }
  .sig-pip-wrap { position: relative; width: 12px; height: 12px; flex-shrink: 0; }
  .sig-pip { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18); transition: all 0.25s; }
  .sig-pip--on { background: var(--orange); border-color: var(--orange); box-shadow: 0 0 10px rgba(247,147,26,0.6); }
  .sig-ring { position: absolute; inset: -4px; border-radius: 50%; background: rgba(247,147,26,0.15); animation: ringPulse 2s ease-out infinite; }
  @keyframes ringPulse { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(2.4); opacity: 0; } }
  .sig-label { font-size: 0.72rem; color: #f0f0f0; flex: 1; }
  .sig-badge { font-size: 0.63rem; color: var(--orange); font-weight: 600; background: rgba(247,147,26,0.1); border: 1px solid rgba(247,147,26,0.2); padding: 2px 8px; border-radius: 20px; }

  /* Price trio footer */
  .price-trio { display: flex; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.05); }
  .pt-item { flex: 1; text-align: center; display: flex; flex-direction: column; gap: 5px; }
  .pt-val { font-size: 0.9rem; font-weight: 600; color: #f0f0f0; }
  .pt-div { width: 1px; background: rgba(255,255,255,0.05); flex-shrink: 0; }

  /* ══ NETWORK / STACK SHARED ════════════════════════════════════ */
  .metric-trio { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin-top: 16px; }
  .mt-item { display: flex; flex-direction: column; gap: 8px; }
  .metric-n { font-size: 1.55rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: #f0f0f0; }
  .metric-unit { font-size: 0.45em; color: rgba(255,255,255,0.3); font-weight: 400; margin-left: 2px; }

  .halving { border-top: 1px solid rgba(255,255,255,0.06); margin-top: 20px; padding-top: 18px; }
  .halving-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .halving-days { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.03em; color: var(--orange); line-height: 1; }
  .halving-unit { font-size: 0.55em; color: rgba(247,147,26,0.7); font-weight: 400; }
  .hprog-track { height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
  .hprog-fill { height: 100%; background: linear-gradient(90deg, rgba(247,147,26,0.5), var(--orange)); border-radius: 2px; transition: width 0.8s cubic-bezier(.4,0,.2,1); }

  .btc-pill { display: flex; align-items: baseline; gap: 0; padding: 12px 16px; background: rgba(247,147,26,0.05); border: 1px solid rgba(247,147,26,0.1); border-radius: 10px; margin-bottom: 18px; }
  .goal { }
  .goal-head { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .goal-track { height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
  .goal-fill { height: 100%; background: linear-gradient(90deg, rgba(247,147,26,0.6), var(--orange)); border-radius: 2px; transition: width 0.8s; }

  /* ══ POLYMARKET ═════════════════════════════════════════════════ */
  .mkt { padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .mkt:last-child { border-bottom: none; padding-bottom: 0; }
  .mkt-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
  .mkt-tag { font-size: 0.56rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; padding: 2px 8px; border-radius: 5px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); color: rgba(255,255,255,0.3); }
  .mkt-tag--pin { background: rgba(247,147,26,0.09); border-color: rgba(247,147,26,0.22); color: var(--orange); }
  .mkt-body { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
  .mkt-q { font-size: 0.8rem; color: rgba(255,255,255,0.55); line-height: 1.5; flex: 1; text-decoration: none; transition: color 0.2s; }
  .mkt-q:hover { color: #f0f0f0; }
  .mkt-prob-wrap { display: flex; align-items: baseline; gap: 1px; white-space: nowrap; }
  .mkt-prob { font-size: 1.8rem; font-weight: 800; line-height: 1; letter-spacing: -0.03em; }
  .mkt-pct { font-size: 0.8rem; opacity: 0.55; }
  .mkt-track { height: 2px; background: rgba(255,255,255,0.05); border-radius: 1px; overflow: hidden; margin: 8px 0 5px; }
  .mkt-fill { height: 100%; border-radius: 1px; opacity: 0.5; transition: width 0.7s cubic-bezier(.4,0,.2,1); }
  .mkt-foot { display: flex; justify-content: space-between; align-items: center; }

  /* ══ NEWS ═══════════════════════════════════════════════════════ */
  .news { padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .news:last-child { border-bottom: none; }
  .news-title { display: block; font-size: 0.8rem; color: rgba(255,255,255,0.55); text-decoration: none; line-height: 1.52; margin-bottom: 6px; transition: color 0.2s; }
  .news-title:hover { color: #f0f0f0; }
  .news-meta { display: flex; gap: 10px; align-items: center; }
  .news-src { font-size: 0.6rem; color: var(--orange); font-weight: 600; }

  /* ══ ASSET PANELS — Visual tiles, not bar rows ═════════════════ */
  .asset-grid-card { flex: 1; min-width: 260px; }
  .asset-panels { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 16px; }
  @media (max-width: 900px) { .asset-panels { grid-template-columns: repeat(2,1fr); } }
  .asset-panel {
    background: linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 14px; padding: 18px 16px;
    transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), border-color 0.3s, box-shadow 0.35s;
    position: relative; overflow: hidden;
  }
  .asset-panel::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--pc, rgba(247,147,26,0.3)), transparent);
    opacity: 0.6;
  }
  .asset-panel:hover {
    transform: translateY(-6px) perspective(600px) rotateX(2deg);
    border-color: rgba(255,255,255,0.12);
    box-shadow: 0 18px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05);
  }
  .ap-top { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .ap-icon { font-size: 1.3rem; line-height: 1; }
  .ap-ticker { font-size: 0.85rem; font-weight: 700; letter-spacing: -0.01em; }
  .ap-name { font-size: 0.58rem; color: rgba(255,255,255,0.3); margin-top: 1px; }
  .ap-pct { font-size: 2rem; font-weight: 800; letter-spacing: -0.04em; line-height: 1; margin-bottom: 4px; }
  .ap-sub { font-size: 0.6rem; color: rgba(255,255,255,0.25); margin-bottom: 12px; }
  .ap-bar { height: 2px; background: rgba(255,255,255,0.06); border-radius: 1px; overflow: hidden; }
  .ap-fill { height: 100%; border-radius: 1px; transition: width 0.8s cubic-bezier(.4,0,.2,1); }
  @keyframes apPulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
  .cpi-note { font-size: 0.63rem; color: rgba(255,255,255,0.25); border-top: 1px solid rgba(255,255,255,0.05); padding-top: 14px; line-height: 1.6; }

  /* ══ GHOSTFOLIO ═════════════════════════════════════════════════ */
  .gf-card { flex: 2; min-width: 300px; }
  .gf-hero-row { display: flex; align-items: flex-end; gap: 28px; flex-wrap: wrap; margin-bottom: 22px; }
  .gf-nw-block { display: flex; flex-direction: column; gap: 7px; }
  .gf-nw { font-size: 2.8rem; font-weight: 700; letter-spacing: -0.045em; line-height: 1; color: #f0f0f0; }
  .gf-vline { width: 1px; height: 52px; background: rgba(255,255,255,0.06); align-self: center; flex-shrink: 0; }
  .gf-perf-row { display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap; flex: 1; }
  .gf-perf { display: flex; flex-direction: column; gap: 7px; }
  .gf-pv { font-size: 1.3rem; font-weight: 700; letter-spacing: -0.025em; line-height: 1; }
  .live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--orange); box-shadow: 0 0 10px var(--orange); }
  .icon-btn { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; color: rgba(255,255,255,0.3); font-size: 0.85rem; padding: 5px 11px; cursor: pointer; transition: all 0.2s; }
  .icon-btn:hover { border-color: rgba(247,147,26,0.25); color: var(--orange); }

  .bench-strip { display: flex; border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; overflow: hidden; margin-bottom: 22px; background: rgba(255,255,255,0.02); }
  .bench-cell { flex: 1; padding: 15px 16px; border-right: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; gap: 5px; min-width: 80px; }
  .bench-cell:last-child { border-right: none; }
  .bench-v { font-size: 1.2rem; font-weight: 700; letter-spacing: -0.025em; line-height: 1; }
  .bench-u { font-size: 0.56em; opacity: 0.5; font-weight: 400; }
  .bench-vs { font-size: 0.6rem; }

  .holdings { border-top: 1px solid rgba(255,255,255,0.05); padding-top: 18px; }
  .hold-btn { background: none; border: none; color: rgba(255,255,255,0.3); font-size: 0.7rem; font-family: 'Inter',sans-serif; cursor: pointer; display: flex; align-items: center; padding: 0; margin-bottom: 16px; transition: color 0.2s; }
  .hold-btn:hover { color: rgba(255,255,255,0.55); }
  .hgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(162px,1fr)); gap: 9px; }
  .h-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 14px; transition: transform 0.3s, border-color 0.3s; }
  .h-card:hover { transform: translateY(-4px) perspective(600px) rotateX(2deg); border-color: rgba(247,147,26,0.15); }
  .h-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .h-sym { font-size: 0.92rem; font-weight: 700; color: #f0f0f0; }
  .h-pct { font-size: 0.7rem; font-weight: 600; }
  .h-name { font-size: 0.6rem; color: rgba(255,255,255,0.25); margin-bottom: 8px; }
  .h-bar { height: 2px; background: rgba(255,255,255,0.06); border-radius: 1px; overflow: hidden; margin-bottom: 8px; }
  .h-fill { height: 100%; background: linear-gradient(90deg, rgba(247,147,26,0.5), var(--orange)); border-radius: 1px; transition: width 0.7s; }
  .h-foot { display: flex; justify-content: space-between; font-size: 0.62rem; color: rgba(255,255,255,0.25); }

  @media (max-width: 800px) {
    .gf-vline { display: none; }
    .bench-strip { flex-wrap: wrap; }
    .bench-cell { min-width: calc(50% - 1px); }
    .gf-nw { font-size: 2.2rem; }
  }
  @media (max-width: 600px) { .hgrid { grid-template-columns: 1fr 1fr; } }

  /* ══ MOBILE NAV ═════════════════════════════════════════════════ */
  .bnav { display: none; }
  @media (max-width: 600px) {
    .bnav {
      display: flex; position: fixed; bottom: 0; left: 0; right: 0; z-index: 300;
      background: rgba(4,4,4,0.94);
      backdrop-filter: blur(32px) saturate(200%);
      -webkit-backdrop-filter: blur(32px) saturate(200%);
      border-top: 1px solid rgba(255,255,255,0.07);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }
  .bnav-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 11px 0 9px; gap: 3px; background: none; border: none; cursor: pointer; position: relative; }
  .bnav-ico { font-size: 1.1rem; color: rgba(255,255,255,0.18); transition: color 0.2s, text-shadow 0.2s; }
  .bnav-lbl { font-size: 0.52rem; color: rgba(255,255,255,0.18); transition: color 0.2s; letter-spacing: 0.06em; text-transform: uppercase; }
  .bnav-tab--on .bnav-ico { color: var(--orange); text-shadow: 0 0 14px rgba(247,147,26,0.6); }
  .bnav-tab--on .bnav-lbl { color: var(--orange); }
  .bnav-pip { position: absolute; top: 9px; right: 22%; width: 5px; height: 5px; border-radius: 50%; }

  /* ══ FOOTER ═════════════════════════════════════════════════════ */
  .site-footer { border-top: 1px solid rgba(255,255,255,0.05); padding: 20px 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .footer-brand { font-size: 0.68rem; font-weight: 500; color: rgba(255,255,255,0.3); display: flex; align-items: center; gap: 7px; }
  .footer-sources { font-size: 0.58rem; color: rgba(255,255,255,0.15); }
  @media (max-width: 600px) { .site-footer { display: none; } }

  /* ══ ANIMATIONS ═════════════════════════════════════════════════ */
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  .blink { animation: blink 2s step-end infinite; }
</style>
