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

<!-- ╔══════════════════════════════════════════════╗
     ║  HEADER                                      ║
     ╚══════════════════════════════════════════════╝ -->
<header class="hdr">
  <div class="hdr-brand">
    <span class="brand-pip blink"></span>
    <span class="brand-name">Glance</span>
  </div>
  <div class="hdr-clock-wrap">
    <span class="hdr-clock">{time}</span>
  </div>
  <div class="hdr-right">
    <button class="hdr-btn" class:hdr-btn--on={showSettings} on:click={() => showSettings = !showSettings}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      <span class="hdr-btn-lbl">Settings</span>
    </button>
  </div>
</header>

<!-- ╔══════════════════════════════════════════════╗
     ║  SETTINGS                                    ║
     ╚══════════════════════════════════════════════╝ -->
{#if showSettings}
<div class="drawer">
  <div class="drawer-inner">

    <div class="dgroup">
      <p class="dgroup-label">DCA Stack</p>
      <div class="dfields">
        <label class="dfield">
          <span class="dlabel">Start date</span>
          <input type="date" bind:value={settings.dca.startDate} class="dinp" />
        </label>
        <label class="dfield">
          <span class="dlabel">Daily AUD</span>
          <input type="number" bind:value={settings.dca.dailyAmount} class="dinp" />
        </label>
        <label class="dfield">
          <span class="dlabel">BTC held</span>
          <input type="number" step="0.00000001" bind:value={settings.dca.btcHeld} class="dinp" />
        </label>
        <label class="dfield">
          <span class="dlabel">Goal BTC</span>
          <input type="number" step="0.001" bind:value={settings.dca.goalBtc} class="dinp" />
        </label>
      </div>
    </div>

    <div class="dgroup">
      <p class="dgroup-label">Watchlist <span class="dhint">pinned at top of markets feed</span></p>
      <div class="dtags">
        {#each settings.polymarket.keywords as kw, i}
          <span class="dtag">{kw}<button on:click={() => removeKeyword(i)} class="dtag-rm">×</button></span>
        {/each}
      </div>
      <div class="dinp-row">
        <input bind:value={newKeyword} on:keydown={(e) => e.key==='Enter' && addKeyword()} placeholder="Add keyword…" class="dinp" />
        <button on:click={addKeyword} class="dbtn">Add</button>
      </div>
    </div>

    <div class="dgroup">
      <p class="dgroup-label">News RSS</p>
      <div class="dsrcs">
        {#each settings.news.sources as src, i}
          <div class="dsrc-row"><span class="dsrc-url">{src}</span><button on:click={() => removeSource(i)} class="dtag-rm">×</button></div>
        {/each}
      </div>
      <div class="dinp-row">
        <input type="url" bind:value={newSource} on:keydown={(e) => e.key==='Enter' && addSource()} placeholder="https://…" class="dinp" />
        <button on:click={addSource} class="dbtn">Add</button>
      </div>
    </div>

    <div class="dgroup">
      <p class="dgroup-label">Ghostfolio <span class="dhint">token stays in your browser</span></p>
      <div class="dfields" style="max-width:500px;">
        <label class="dfield" style="flex:3;">
          <span class="dlabel">Security token</span>
          <input type="password" bind:value={settings.ghostfolio.token} placeholder="your-security-token" class="dinp" />
        </label>
        <label class="dfield">
          <span class="dlabel">Currency</span>
          <input bind:value={settings.ghostfolio.currency} placeholder="AUD" class="dinp" style="width:72px;" />
        </label>
      </div>
    </div>

    <button on:click={saveAll} class="dsave" class:dsave--ok={saved}>{saved ? '✓ Saved' : 'Save'}</button>
  </div>
</div>
{/if}

<!-- ╔══════════════════════════════════════════════╗
     ║  MAIN GRID                                   ║
     ╚══════════════════════════════════════════════╝ -->
<main class="app"
  class:tab-signal={activeMobileTab === 'signal'}
  class:tab-intel={activeMobileTab === 'intel'}
  class:tab-portfolio={activeMobileTab === 'portfolio'}>

  <div class="grid">

    <!-- ── SIGNAL COLUMN ───────────────────── -->
    <section class="col-a">

      <!-- BUY SIGNAL — hero card -->
      <div class="card signal-card" style="--ac:{accentColor};">
        <div class="sc-top">
          <div>
            <p class="micro-label" style="color:var(--orange);">DCA Signal</p>
            <p class="micro-sub">Fortnightly recommendation</p>
          </div>
          <span class="sc-time">{dcaUpdated || '—'}</span>
        </div>

        <div class="sc-hero">
          {#if !dca}
            <span class="hero-num" style="color:var(--t3);">—</span>
          {:else if dca.finalAud === 0}
            <span class="hero-num" style="color:var(--dn);">Pass</span>
          {:else}
            <span class="hero-num" style="color:{accentColor};">${dca.finalAud.toLocaleString()}</span>
          {/if}
          <p class="hero-unit">AUD to buy</p>
        </div>

        <!-- Valuation range bar -->
        {#if btcPrice > 0}
        <div class="range-row">
          <span class="range-cap" style="color:var(--up);">$55k</span>
          <div class="pbar range-bar">
            {#if btcPrice <= 55000}
              <div class="pfill" style="width:2%;"></div>
            {:else if btcPrice >= 125000}
              <div class="pfill" style="width:100%; background:var(--dn);"></div>
            {:else}
              <div class="pfill" style="width:{((btcPrice-55000)/70000)*100}%; background:linear-gradient(90deg,var(--up),var(--orange),var(--dn));"></div>
            {/if}
          </div>
          <span class="range-cap" style="color:var(--dn);">$125k</span>
        </div>
        {/if}

        <!-- Signal conditions — list style -->
        {#if dca}
        <div class="sigs">
          {#each dca.signals as sig}
            <div class="sig" class:sig--on={sig.active}>
              <span class="sig-indicator">{sig.active ? '▲' : '—'}</span>
              <span class="sig-name">{sig.name}</span>
              {#if sig.active}<span class="sig-boost">+{sig.boost}%</span>{/if}
            </div>
          {/each}
        </div>
        {/if}

        <!-- Stat bar -->
        <div class="sc-stats">
          <div class="sc-stat">
            <p class="micro-label">BTC/USD</p>
            <p class="sc-stat-val" style="transition:color 0.5s; color:{priceColor};">{btcPrice > 0 ? '$'+n(btcPrice) : '—'}</p>
          </div>
          <div class="sc-div"></div>
          <div class="sc-stat">
            <p class="micro-label">BTC/AUD</p>
            <p class="sc-stat-val">{btcAud ? 'A$'+n(btcAud,0) : '—'}</p>
          </div>
          <div class="sc-div"></div>
          <div class="sc-stat">
            <p class="micro-label">Sats / A$1</p>
            <p class="sc-stat-val" style="color:var(--orange);">{satsPerAud ? satsPerAud.toLocaleString() : '—'}</p>
          </div>
        </div>
      </div>

      <!-- BITCOIN NETWORK -->
      <div class="card">
        <div class="ch">
          <p class="ch-title">Network</p>
          <a href="https://mempool.space" target="_blank" rel="noopener noreferrer" class="ch-link">mempool.space ↗</a>
        </div>
        <div class="stat3">
          <div class="s3">
            <p class="micro-label">Block</p>
            <p class="s3-val" style="color:var(--t1);">{n(btcBlock)}</p>
          </div>
          <div class="s3">
            <p class="micro-label">Fee low</p>
            <p class="s3-val" style="color:var(--up);">{btcFees.low}<small>sat/vb</small></p>
          </div>
          <div class="s3">
            <p class="micro-label">Fee high</p>
            <p class="s3-val" style="color:var(--dn);">{btcFees.high}<small>sat/vb</small></p>
          </div>
        </div>
        {#if halvingBlocksLeft > 0}
        <div class="halving">
          <div class="halving-row">
            <p class="micro-label">Next Halving</p>
            <p class="halving-days">{halvingDays.toLocaleString()} days</p>
          </div>
          <div class="pbar" style="height:2px; margin:7px 0;">
            <div class="pfill" style="width:{halvingProgress}%; background:var(--orange);"></div>
          </div>
          <p class="micro-dim">{halvingProgress.toFixed(0)}% of epoch · {halvingBlocksLeft.toLocaleString()} blocks · ~{halvingDate}</p>
        </div>
        {/if}
      </div>

      <!-- STACK -->
      <div class="card">
        <div class="ch">
          <p class="ch-title">Stack</p>
          <p class="ch-sub" style="color:var(--orange);">${settings.dca.dailyAmount}/day · {dcaDays}d</p>
        </div>
        <div class="stat3 mb14">
          <div class="s3">
            <p class="micro-label">Invested</p>
            <p class="s3-val">${n(invested)}</p>
          </div>
          <div class="s3">
            <p class="micro-label">Value</p>
            <p class="s3-val" style="color:{perf>=0?'var(--up)':'var(--dn)'};">{btcPrice>0?'$'+n(currentVal):'—'}</p>
          </div>
          <div class="s3">
            <p class="micro-label">Return</p>
            <p class="s3-val" style="color:{perf>=0?'var(--up)':'var(--dn)'};">{btcPrice>0?(perf>=0?'+':'')+perf.toFixed(1)+'%':'—'}</p>
          </div>
        </div>
        <p class="btc-line"><span style="color:var(--orange);">{settings.dca.btcHeld.toFixed(8)}</span> BTC · {n(satsHeld)} sats</p>
        <div class="goal">
          <div class="goal-head">
            <p class="micro-label">Goal · {settings.dca.goalBtc} BTC</p>
            <p class="micro-label" style="color:var(--orange);">{goalPct.toFixed(1)}%</p>
          </div>
          <div class="pbar" style="height:2px; margin:6px 0;">
            <div class="pfill" style="width:{goalPct}%; background:var(--orange);"></div>
          </div>
          <p class="micro-dim" style="text-align:right;">{n(satsLeft)} sats to go</p>
        </div>
      </div>

    </section>

    <!-- ── INTEL COLUMN ────────────────────── -->
    <section class="col-b">

      <!-- POLYMARKET — capped at 5 items -->
      <div class="card" style="flex:1;">
        <div class="ch" style="margin-bottom:18px;">
          <div>
            <p class="ch-title">Markets</p>
            <p class="ch-sub">Prediction market pricing</p>
          </div>
          <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" class="ch-link">Polymarket ↗</a>
        </div>

        {#if markets.length === 0}
          <p class="empty-msg">Fetching markets…</p>
        {:else}
          {#each markets.slice(0, 5) as m}
            <div class="mkt">
              <div class="mkt-meta">
                <span class="mkt-tag" class:mkt-tag--pin={m.pinned}>{m.pinned ? '★' : ''}{m.pinned ? ' Pinned' : m.tag}</span>
                {#if m.endDate}<span class="mkt-end">{fmtDate(m.endDate)}</span>{/if}
              </div>
              <div class="mkt-body">
                <a href="{m.url}" target="_blank" rel="noopener noreferrer" class="mkt-q">{m.question}</a>
                <span class="mkt-prob" style="color:{pColor(m.probability)};">{m.probability}<small>%</small></span>
              </div>
              <div class="pbar" style="margin:7px 0 4px;">
                <div class="pfill" style="width:{m.probability}%; background:{pColor(m.probability)}; opacity:0.45;"></div>
              </div>
              <div class="mkt-foot">
                <span style="font-size:0.63rem; color:{pColor(m.probability)}; font-weight:500;">{m.topOutcome}</span>
                <span class="micro-dim">{fmtVol(m.volume)}</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- NEWS -->
      <div class="card" style="flex:1;">
        <div class="ch" style="margin-bottom:18px;">
          <p class="ch-title">News</p>
        </div>
        {#if newsItems.length === 0}
          <p class="empty-msg">Fetching feeds…</p>
        {:else}
          {#each newsItems as item}
            <div class="news-row">
              <a href={item.link} target="_blank" rel="noopener noreferrer" class="news-link">{item.title}</a>
              <div class="news-meta">
                <span class="news-src">{item.source}</span>
                <span class="micro-dim">{timeAgo(item.pubDate)} ago</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>

    </section>

    <!-- ── PORTFOLIO ROW ───────────────────── -->
    <section class="col-c">

      <!-- ASSETS -->
      <div class="card" style="flex:1; min-width:220px;">
        <div class="ch" style="margin-bottom:20px;">
          <p class="ch-title">Assets</p>
          <p class="ch-sub">1-year return</p>
        </div>
        <div class="assets">
          {#each [
            { ticker:'BTC', name:'Bitcoin',   pct:null,        color:'var(--orange)', sub: btcPrice ? '$'+n(btcPrice) : '' },
            { ticker:'XAU', name:'Gold',      pct:goldYtdPct,  color:'#c9a84c',       sub: goldPriceUsd ? '$'+n(goldPriceUsd,0)+'/oz' : '' },
            { ticker:'SPX', name:'S&P 500',   pct:sp500YtdPct, color:'#555555',       sub: sp500Price ? n(sp500Price,0) : '' },
            { ticker:'CPI', name:'Inflation', pct:cpiAnnual,   color:'var(--dn)',     sub: '' },
          ] as a}
            <div class="a-row">
              <div class="a-left">
                <p class="a-ticker" style="color:{a.color};">{a.ticker}</p>
                <p class="a-name">{a.name}</p>
                {#if a.sub}<p class="a-sub">{a.sub}</p>{/if}
              </div>
              <div class="a-bar">
                {#if a.pct !== null}
                  {@const w = Math.min(100, Math.max(0, (a.pct/150)*100+50))}
                  <div class="pbar" style="height:1px;"><div class="pfill" style="width:{w}%; background:{a.color}; opacity:0.4;"></div></div>
                {:else}
                  <div class="pbar" style="height:1px;"></div>
                {/if}
              </div>
              <p class="a-pct" style="color:{a.pct===null?'var(--t3)':a.pct>=0?'var(--up)':'var(--dn)'};">{a.pct!==null?(a.pct>=0?'+':'')+a.pct.toFixed(1)+'%':'live'}</p>
            </div>
          {/each}
        </div>
        {#if cpiAnnual !== null}
          <p class="cpi-note">Purchasing power lost to CPI since DCA start: <span style="color:var(--dn);">−{cpiCumLoss.toFixed(1)}%</span></p>
        {/if}
      </div>

      <!-- GHOSTFOLIO -->
      {#if settings.ghostfolio?.token}
      <div class="card" style="flex:2;">
        <div class="ch" style="margin-bottom:20px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <p class="ch-title">Portfolio</p>
            <span class="ch-sub">Ghostfolio</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            {#if gfLoading}<span class="pulse-dot"></span>{/if}
            {#if gfUpdated && !gfLoading}<span class="ch-sub">{gfUpdated}</span>{/if}
            <button on:click={fetchGhostfolio} class="icon-btn">↻</button>
          </div>
        </div>

        {#if gfError}
          <p class="err-msg">{gfError} — check your token in Settings.</p>
        {:else}
          <div class="gf-top">
            <div class="gf-hero">
              <p class="micro-label">Net Worth</p>
              <p class="gf-nw">{gfNetWorth !== null ? '$'+n(gfNetWorth,0) : '—'}</p>
              <p class="micro-label">{settings.ghostfolio.currency || 'AUD'} nominal</p>
            </div>
            {#if inflationAdjNW !== null}
            <div class="gf-hero" style="opacity:0.4;">
              <p class="micro-label">Real Value</p>
              <p class="gf-nw">{inflationAdjNW !== null ? '$'+n(inflationAdjNW,0) : '—'}</p>
              <p class="micro-label">CPI-adjusted</p>
            </div>
            {/if}
            <div class="gf-vdiv"></div>
            <div class="gf-smalls">
              <div class="gf-sm"><p class="micro-label">Today</p><p class="gf-sm-v" style="color:{signColor(gfTodayChangePct)};">{pct(gfTodayChangePct)}</p></div>
              <div class="gf-sm"><p class="micro-label">YTD</p><p class="gf-sm-v" style="color:{signColor(gfNetGainYtdPct)};">{pct(gfNetGainYtdPct)}</p></div>
              <div class="gf-sm"><p class="micro-label">All-time</p><p class="gf-sm-v" style="color:{signColor(gfNetGainPct)};">{pct(gfNetGainPct)}</p></div>
              <div class="gf-sm"><p class="micro-label">Invested</p><p class="gf-sm-v">{gfTotalInvested !== null ? '$'+n(gfTotalInvested,0) : '—'}</p></div>
            </div>
          </div>

          {#if portCAGR !== null || cpiAnnual !== null || goldYtdPct !== null || sp500YtdPct !== null}
          <div class="roi-strip">
            {#if portCAGR !== null}
              <div class="roi-cell">
                <p class="micro-label" style="color:var(--orange);">Portfolio CAGR</p>
                <p class="roi-v" style="color:{portCAGR>=0?'var(--up)':'var(--dn)'};">{portCAGR>=0?'+':''}{portCAGR.toFixed(1)}<span class="roi-u">%/yr</span></p>
                {#if cpiAnnual !== null}<p class="roi-vs" style="color:{portCAGR>cpiAnnual?'var(--up)':'var(--dn)'};">{portCAGR>cpiAnnual?'+':''}{(portCAGR-cpiAnnual).toFixed(1)}% vs CPI</p>{/if}
              </div>
            {/if}
            {#if cpiAnnual !== null}
              <div class="roi-cell">
                <p class="micro-label" style="color:var(--dn);">CPI</p>
                <p class="roi-v" style="color:var(--dn);">+{cpiAnnual.toFixed(1)}<span class="roi-u">%/yr</span></p>
              </div>
            {/if}
            {#if goldYtdPct !== null}
              <div class="roi-cell">
                <p class="micro-label" style="color:#c9a84c;">Gold 1Y</p>
                <p class="roi-v" style="color:{goldYtdPct>=0?'#c9a84c':'var(--dn)'};">{goldYtdPct>=0?'+':''}{goldYtdPct.toFixed(1)}<span class="roi-u">%</span></p>
              </div>
            {/if}
            {#if sp500YtdPct !== null}
              <div class="roi-cell">
                <p class="micro-label">S&P 500 1Y</p>
                <p class="roi-v" style="color:{sp500YtdPct>=0?'var(--t1)':'var(--dn)'};">{sp500YtdPct>=0?'+':''}{sp500YtdPct.toFixed(1)}<span class="roi-u">%</span></p>
              </div>
            {/if}
          </div>
          {/if}

          {#if gfHoldings.length > 0}
          <div class="holdings">
            <button class="hold-toggle" on:click={() => showHoldings = !showHoldings}>
              Holdings ({gfHoldings.length})
              <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" style="transform:{showHoldings?'rotate(180deg)':'rotate(0)'}; transition:transform 0.2s; color:var(--t3); margin-left:4px;"><path d="M5 7L1 3h8z"/></svg>
            </button>
            {#if showHoldings}
            <div class="hgrid">
              {#each gfHoldings as h}
                {@const pc = h.netPerformancePercentWithCurrencyEffect}
                <div class="h-item">
                  <div class="h-top">
                    <span class="h-sym">{h.symbol}</span>
                    <span class="h-pct" style="color:{pc>=0?'var(--up)':'var(--dn)'};">{pc>=0?'+':''}{pc.toFixed(1)}%</span>
                  </div>
                  {#if h.name !== h.symbol}<p class="h-name">{h.name.slice(0,22)}</p>{/if}
                  <div class="pbar" style="margin:7px 0;"><div class="pfill" style="width:{Math.min(100,h.allocationInPercentage)}%; background:var(--orange); opacity:0.3;"></div></div>
                  <div class="h-foot">
                    <span>{h.allocationInPercentage.toFixed(1)}%</span>
                    <span>${n(h.valueInBaseCurrency,0)}</span>
                  </div>
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

<!-- ╔══════════════════════════════════════════════╗
     ║  MOBILE NAV                                  ║
     ╚══════════════════════════════════════════════╝ -->
<nav class="bnav">
  <button class="bnav-tab" class:bnav-tab--on={activeMobileTab === 'signal'} on:click={() => activeMobileTab = 'signal'}>
    <span class="bnav-g">₿</span>
    <span class="bnav-l">Signal</span>
    {#if dca && dca.finalAud > 0}<span class="bnav-pip" style="background:{accentColor};"></span>{/if}
  </button>
  <button class="bnav-tab" class:bnav-tab--on={activeMobileTab === 'intel'} on:click={() => activeMobileTab = 'intel'}>
    <span class="bnav-g">◈</span>
    <span class="bnav-l">Intel</span>
    {#if markets.length > 0}<span class="bnav-pip" style="background:var(--orange);"></span>{/if}
  </button>
  <button class="bnav-tab" class:bnav-tab--on={activeMobileTab === 'portfolio'} on:click={() => activeMobileTab = 'portfolio'}>
    <span class="bnav-g">↗</span>
    <span class="bnav-l">Portfolio</span>
  </button>
</nav>

<footer class="site-footer">
  <span><span class="blink" style="color:var(--orange); font-size:0.4rem; vertical-align:middle;">●</span> Glance · Bitcoin Intelligence</span>
  <span>mempool · alternative.me · binance · er-api · ghostfol.io · worldbank</span>
</footer>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :global(button, a) { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }

  /* ── HEADER ──────────────────────────────── */
  .hdr {
    position: sticky; top: 0; z-index: 100;
    display: flex; align-items: center;
    padding: 0 24px; height: 54px;
    background: rgba(10,10,10,0.88);
    backdrop-filter: blur(24px) saturate(150%);
    border-bottom: 1px solid var(--b1);
  }
  .hdr-brand { display: flex; align-items: center; gap: 9px; flex: 1; }
  .brand-pip { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--orange); }
  .brand-name { font-size: 0.9rem; font-weight: 600; color: var(--t1); letter-spacing: -0.02em; }
  .hdr-clock-wrap { position: absolute; left: 50%; transform: translateX(-50%); }
  .hdr-clock { font-size: 0.82rem; font-weight: 500; color: var(--t3); font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }
  .hdr-right { flex: 1; display: flex; justify-content: flex-end; }
  .hdr-btn {
    display: flex; align-items: center; gap: 7px;
    padding: 6px 13px; border-radius: 8px;
    background: none; border: 1px solid var(--b1);
    color: var(--t2); font-size: 0.72rem; font-family: 'Inter', sans-serif;
    cursor: pointer; transition: border-color 0.15s, color 0.15s;
  }
  .hdr-btn:hover, .hdr-btn--on { border-color: var(--b2); color: var(--t1); }
  .hdr-btn-lbl { display: block; }
  @media (max-width: 600px) {
    .hdr { padding: 0 16px; height: 50px; }
    .hdr-clock-wrap { display: none; }
    .brand-name { font-size: 0.82rem; }
    .hdr-btn-lbl { display: none; }
    .hdr-btn { padding: 8px; min-width: 36px; justify-content: center; border-radius: 7px; }
  }

  /* ── SETTINGS DRAWER ─────────────────────── */
  .drawer { background: #080808; border-bottom: 1px solid var(--b1); }
  .drawer-inner { max-width: 860px; margin: 0 auto; padding: 28px 24px; display: flex; flex-direction: column; gap: 22px; }
  .dgroup { }
  .dgroup-label { font-size: 0.72rem; font-weight: 500; color: var(--t2); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .dhint { font-size: 0.64rem; color: var(--t3); font-weight: 400; }
  .dfields { display: flex; gap: 10px; flex-wrap: wrap; }
  .dfield { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 100px; }
  .dlabel { font-size: 0.6rem; color: var(--t3); font-weight: 500; }
  .dinp { width: 100%; background: var(--s2); border: 1px solid var(--b1); border-radius: 8px; padding: 8px 11px; color: var(--t1); font-family: 'Inter', sans-serif; font-size: 0.8rem; transition: border-color 0.15s; }
  .dinp:focus { outline: none; border-color: var(--orange); }
  .dtags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
  .dtag { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; background: var(--s2); border: 1px solid var(--b1); border-radius: 20px; font-size: 0.7rem; color: var(--t2); }
  .dtag-rm { background: none; border: none; color: var(--t3); cursor: pointer; font-size: 0.9rem; padding: 0; line-height: 1; }
  .dtag-rm:hover { color: var(--dn); }
  .dinp-row { display: flex; gap: 7px; }
  .dbtn { padding: 8px 14px; border: 1px solid var(--b1); border-radius: 8px; background: none; color: var(--t2); font-size: 0.72rem; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
  .dbtn:hover { border-color: var(--b2); color: var(--t1); }
  .dsrcs { max-height: 70px; overflow-y: auto; margin-bottom: 8px; }
  .dsrc-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 0.64rem; color: var(--t3); }
  .dsrc-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
  .dsave { align-self: flex-start; padding: 9px 22px; background: var(--t1); border: none; border-radius: 8px; color: var(--bg); font-size: 0.78rem; font-weight: 500; cursor: pointer; transition: background 0.2s; }
  .dsave:hover { background: #d0d0d0; }
  .dsave--ok { background: var(--orange); color: #fff; }
  @media (max-width: 600px) {
    .drawer-inner { padding: 20px 16px; }
    .dfields { flex-direction: column; }
  }

  /* ── LAYOUT GRID ─────────────────────────── */
  .grid {
    display: grid;
    grid-template-columns: 340px 1fr;
    grid-template-rows: auto auto;
    gap: 10px; padding: 10px;
    max-width: 1440px; margin: 0 auto; align-items: start;
  }
  .col-a { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; gap: 10px; }
  .col-b { grid-column: 2; grid-row: 1; display: flex; flex-direction: column; gap: 10px; }
  .col-c { grid-column: 1/-1; grid-row: 2; display: flex; gap: 10px; align-items: start; }

  @media (max-width: 1100px) {
    .grid { grid-template-columns: 300px 1fr; }
  }
  @media (max-width: 800px) {
    .grid { grid-template-columns: 1fr; }
    .col-a, .col-b { grid-column: 1; grid-row: auto; }
    .col-c { grid-column: 1; grid-row: auto; flex-direction: column; }
  }
  @media (max-width: 600px) {
    .grid { padding: 8px 8px 86px; gap: 8px; }
    .col-a, .col-b, .col-c { display: none !important; }
    .tab-signal    .col-a { display: flex !important; flex-direction: column; gap: 8px; }
    .tab-intel     .col-b { display: flex !important; flex-direction: column; gap: 8px; }
    .tab-portfolio .col-c { display: flex !important; flex-direction: column; gap: 8px; }
  }

  /* ── TYPE ATOMS ─────────────────────────── */
  .micro-label { font-size: 0.6rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.1em; color: var(--t3); }
  .micro-sub   { font-size: 0.65rem; color: var(--t3); margin-top: 2px; }
  .micro-dim   { font-size: 0.6rem; color: var(--t3); }
  .ch { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .ch-title { font-size: 0.78rem; font-weight: 500; color: var(--t1); }
  .ch-sub   { font-size: 0.62rem; color: var(--t3); margin-top: 2px; }
  .ch-link  { font-size: 0.62rem; color: var(--t3); text-decoration: none; transition: color 0.15s; }
  .ch-link:hover { color: var(--t2); }
  .empty-msg { font-size: 0.74rem; color: var(--t3); }
  .err-msg { font-size: 0.74rem; color: var(--dn); padding: 10px 12px; border: 1px solid rgba(239,68,68,0.15); border-radius: 8px; background: rgba(239,68,68,0.04); }

  /* ── SIGNAL HERO CARD ────────────────────── */
  .signal-card { border-top: 2px solid var(--ac, var(--t3)); }
  .sc-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
  .sc-time { font-size: 0.6rem; color: var(--t3); font-variant-numeric: tabular-nums; margin-top: 2px; }
  .sc-hero { text-align: center; padding: 16px 0 20px; }
  .hero-num {
    display: block;
    font-size: 4.5rem; font-weight: 600;
    line-height: 1; letter-spacing: -0.03em;
    transition: color 0.5s;
  }
  .hero-unit { font-size: 0.6rem; color: var(--t3); text-transform: uppercase; letter-spacing: 0.1em; margin-top: 8px; }
  @media (max-width: 600px) {
    .hero-num { font-size: 6rem; }
    .sc-hero { padding: 22px 0 26px; }
  }

  /* range bar */
  .range-row { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
  .range-bar { flex: 1; }
  .range-cap { font-size: 0.58rem; font-weight: 600; white-space: nowrap; letter-spacing: 0.02em; }

  /* signals */
  .sigs { display: flex; flex-direction: column; gap: 7px; margin-bottom: 22px; padding: 14px 0; border-top: 1px solid var(--b1); border-bottom: 1px solid var(--b1); }
  .sig { display: flex; align-items: center; gap: 10px; font-size: 0.7rem; color: var(--t3); transition: color 0.2s; }
  .sig--on { color: var(--t1); }
  .sig-indicator { width: 12px; font-size: 0.5rem; text-align: center; color: var(--t3); flex-shrink: 0; }
  .sig--on .sig-indicator { color: var(--orange); }
  .sig-name { flex: 1; }
  .sig-boost { font-size: 0.63rem; color: var(--orange); font-weight: 500; }

  /* stat bar */
  .sc-stats { display: flex; padding-top: 16px; }
  .sc-stat { flex: 1; text-align: center; display: flex; flex-direction: column; gap: 5px; }
  .sc-stat-val { font-size: 0.88rem; font-weight: 600; color: var(--t1); letter-spacing: -0.01em; }
  .sc-div { width: 1px; background: var(--b1); flex-shrink: 0; }

  /* ── NETWORK CARD ────────────────────────── */
  .stat3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-top: 14px; }
  .s3 { display: flex; flex-direction: column; gap: 6px; }
  .s3-val { font-size: 1.35rem; font-weight: 600; letter-spacing: -0.02em; line-height: 1; color: var(--t1); }
  .s3-val small { font-size: 0.48em; color: var(--t3); font-weight: 400; margin-left: 2px; }
  .mb14 { margin-bottom: 14px; }
  .halving { border-top: 1px solid var(--b1); margin-top: 16px; padding-top: 14px; }
  .halving-row { display: flex; justify-content: space-between; align-items: center; }
  .halving-days { font-size: 1.1rem; font-weight: 600; letter-spacing: -0.02em; color: var(--orange); }

  /* ── STACK CARD ──────────────────────────── */
  .btc-line { font-size: 0.72rem; color: var(--t2); margin-bottom: 14px; }
  .goal-head { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .goal-sub { font-size: 0.6rem; color: var(--t3); text-align: right; margin-top: 4px; }

  /* ── POLYMARKET ──────────────────────────── */
  .mkt { padding: 13px 0; border-bottom: 1px solid var(--b1); }
  .mkt:last-child { border-bottom: none; padding-bottom: 0; }
  .mkt-meta { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
  .mkt-tag { font-size: 0.55rem; color: var(--t3); background: var(--s2); border: 1px solid var(--b1); border-radius: 4px; padding: 2px 7px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.08em; }
  .mkt-tag--pin { color: var(--orange); border-color: var(--orange2); }
  .mkt-end { font-size: 0.58rem; color: var(--t3); margin-left: auto; }
  .mkt-body { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .mkt-q { font-size: 0.78rem; color: var(--t2); line-height: 1.45; flex: 1; text-decoration: none; transition: color 0.15s; }
  .mkt-q:hover { color: var(--t1); }
  .mkt-prob { font-size: 1.6rem; font-weight: 700; line-height: 1; white-space: nowrap; }
  .mkt-prob small { font-size: 0.5em; opacity: 0.6; font-weight: 400; }
  .mkt-foot { display: flex; justify-content: space-between; align-items: center; }

  /* ── NEWS ────────────────────────────────── */
  .news-row { padding: 11px 0; border-bottom: 1px solid var(--b1); }
  .news-row:last-child { border-bottom: none; }
  .news-link { display: block; font-size: 0.77rem; color: var(--t2); text-decoration: none; line-height: 1.48; margin-bottom: 5px; transition: color 0.15s; }
  .news-link:hover { color: var(--t1); }
  .news-meta { display: flex; gap: 10px; align-items: center; }
  .news-src { font-size: 0.6rem; color: var(--orange); font-weight: 500; }

  /* ── ASSETS ──────────────────────────────── */
  .assets { display: flex; flex-direction: column; gap: 14px; margin-bottom: 14px; }
  .a-row { display: grid; grid-template-columns: 86px 1fr 50px; align-items: center; gap: 10px; }
  .a-left { display: flex; flex-direction: column; gap: 1px; }
  .a-ticker { font-size: 0.8rem; font-weight: 600; letter-spacing: -0.01em; }
  .a-name { font-size: 0.58rem; color: var(--t3); }
  .a-sub { font-size: 0.56rem; color: var(--t3); margin-top: 1px; }
  .a-pct { font-size: 0.8rem; font-weight: 600; text-align: right; }
  .cpi-note { font-size: 0.62rem; color: var(--t3); border-top: 1px solid var(--b1); padding-top: 12px; line-height: 1.55; }

  /* ── GHOSTFOLIO ──────────────────────────── */
  .gf-top { display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap; margin-bottom: 20px; }
  .gf-hero { display: flex; flex-direction: column; gap: 7px; }
  .gf-nw { font-size: 2.4rem; font-weight: 600; letter-spacing: -0.03em; line-height: 1; color: var(--t1); }
  .gf-vdiv { width: 1px; height: 44px; background: var(--b1); align-self: center; flex-shrink: 0; }
  .gf-smalls { display: flex; align-items: flex-end; gap: 20px; flex-wrap: wrap; flex: 1; }
  .gf-sm { display: flex; flex-direction: column; gap: 7px; }
  .gf-sm-v { font-size: 1.2rem; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
  .icon-btn { background: none; border: 1px solid var(--b1); border-radius: 6px; color: var(--t3); font-size: 0.8rem; padding: 4px 10px; cursor: pointer; transition: all 0.15s; }
  .icon-btn:hover { border-color: var(--b2); color: var(--t2); }
  .pulse-dot { display: inline-block; width: 6px; height: 6px; background: var(--orange); border-radius: 50%; animation: blink 1s infinite; }

  /* ROI strip */
  .roi-strip { display: flex; border: 1px solid var(--b1); border-radius: 10px; overflow: hidden; margin-bottom: 18px; }
  .roi-cell { flex: 1; padding: 13px 15px; border-right: 1px solid var(--b1); display: flex; flex-direction: column; gap: 4px; min-width: 80px; }
  .roi-cell:last-child { border-right: none; }
  .roi-v { font-size: 1.1rem; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
  .roi-u { font-size: 0.6em; opacity: 0.55; font-weight: 400; }
  .roi-vs { font-size: 0.58rem; }

  /* Holdings */
  .holdings { border-top: 1px solid var(--b1); padding-top: 16px; }
  .hold-toggle { background: none; border: none; color: var(--t3); font-size: 0.68rem; font-family: 'Inter', sans-serif; cursor: pointer; display: flex; align-items: center; padding: 0; margin-bottom: 14px; transition: color 0.15s; }
  .hold-toggle:hover { color: var(--t2); }
  .hgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px,1fr)); gap: 8px; }
  .h-item { background: var(--s2); border: 1px solid var(--b1); border-radius: 10px; padding: 13px; }
  .h-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
  .h-sym { font-size: 0.88rem; font-weight: 600; }
  .h-pct { font-size: 0.7rem; font-weight: 500; }
  .h-name { font-size: 0.6rem; color: var(--t3); margin-bottom: 6px; }
  .h-foot { display: flex; justify-content: space-between; font-size: 0.62rem; color: var(--t3); }

  @media (max-width: 800px) {
    .gf-top { gap: 16px; }
    .gf-vdiv { display: none; }
    .roi-strip { flex-wrap: wrap; }
    .roi-cell { min-width: calc(50% - 1px); }
  }
  @media (max-width: 600px) {
    .gf-nw { font-size: 2rem; }
    .hgrid { grid-template-columns: 1fr 1fr; }
    .roi-cell { min-width: calc(50% - 1px); }
  }

  /* ── MOBILE NAV ──────────────────────────── */
  .bnav { display: none; }
  @media (max-width: 600px) {
    .bnav {
      display: flex; position: fixed; bottom: 0; left: 0; right: 0; z-index: 200;
      background: rgba(10,10,10,0.96); backdrop-filter: blur(28px) saturate(150%);
      border-top: 1px solid var(--b1);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }
  .bnav-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 0 8px; gap: 3px; background: none; border: none; cursor: pointer; position: relative; }
  .bnav-g { font-size: 1rem; color: var(--t3); transition: color 0.15s; }
  .bnav-l { font-size: 0.52rem; color: var(--t3); transition: color 0.15s; letter-spacing: 0.04em; }
  .bnav-tab--on .bnav-g, .bnav-tab--on .bnav-l { color: var(--orange); }
  .bnav-pip { position: absolute; top: 8px; right: 20%; width: 5px; height: 5px; border-radius: 50%; }

  /* ── FOOTER ──────────────────────────────── */
  .site-footer { border-top: 1px solid var(--b1); padding: 12px 24px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; font-size: 0.58rem; color: var(--t3); margin-top: 4px; }
  @media (max-width: 600px) { .site-footer { display: none; } }

  /* ── ANIMATIONS ──────────────────────────── */
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  .blink { animation: blink 2s step-end infinite; }
</style>
