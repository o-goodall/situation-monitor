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

<!-- ═══ HEADER ══════════════════════════════════════════════ -->
<header class="hdr">
  <div class="hdr-left">
    <span class="live-dot blink"></span>
    <span class="hdr-wordmark">Situation Monitor</span>
  </div>
  <div class="hdr-mid">
    <span class="hdr-time">{time}</span>
  </div>
  <div class="hdr-right">
    <button
      class="hdr-btn"
      class:hdr-btn--active={showSettings}
      on:click={() => showSettings = !showSettings}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      <span class="hdr-btn-lbl">Settings</span>
    </button>
  </div>
</header>

<!-- ═══ SETTINGS ════════════════════════════════════════════ -->
{#if showSettings}
<div class="settings-drawer">
  <div class="settings-inner">

    <div class="settings-group">
      <p class="settings-group-label">Stack Config</p>
      <div class="settings-fields">
        <div class="field">
          <label class="flabel">Start date</label>
          <input type="date" bind:value={settings.dca.startDate} class="finp" />
        </div>
        <div class="field">
          <label class="flabel">Daily AUD</label>
          <input type="number" bind:value={settings.dca.dailyAmount} class="finp" />
        </div>
        <div class="field">
          <label class="flabel">BTC held</label>
          <input type="number" step="0.00000001" bind:value={settings.dca.btcHeld} class="finp" />
        </div>
        <div class="field">
          <label class="flabel">Goal BTC</label>
          <input type="number" step="0.001" bind:value={settings.dca.goalBtc} class="finp" />
        </div>
      </div>
    </div>

    <div class="settings-group">
      <p class="settings-group-label">Watchlist <span class="settings-hint">pinned on top of auto-trending feed</span></p>
      <div class="tag-list">
        {#each settings.polymarket.keywords as kw, i}
          <span class="stag">{kw}<button on:click={() => removeKeyword(i)} class="stag-rm">×</button></span>
        {/each}
      </div>
      <div class="finp-row">
        <input bind:value={newKeyword} on:keydown={(e) => e.key==='Enter' && addKeyword()} placeholder="Add keyword…" class="finp" />
        <button on:click={addKeyword} class="btn-add">Add</button>
      </div>
    </div>

    <div class="settings-group">
      <p class="settings-group-label">News RSS</p>
      <div class="src-list">
        {#each settings.news.sources as src, i}
          <div class="src-row"><span class="src-url">{src}</span><button on:click={() => removeSource(i)} class="stag-rm">×</button></div>
        {/each}
      </div>
      <div class="finp-row">
        <input type="url" bind:value={newSource} on:keydown={(e) => e.key==='Enter' && addSource()} placeholder="https://…" class="finp" />
        <button on:click={addSource} class="btn-add">Add</button>
      </div>
    </div>

    <div class="settings-group">
      <p class="settings-group-label">Ghostfolio <span class="settings-hint">token stays in your browser</span></p>
      <div class="settings-fields" style="max-width:520px;">
        <div class="field" style="flex:3;">
          <label class="flabel">Security token</label>
          <input type="password" bind:value={settings.ghostfolio.token} placeholder="your-security-token" class="finp" />
        </div>
        <div class="field">
          <label class="flabel">Currency</label>
          <input bind:value={settings.ghostfolio.currency} placeholder="AUD" class="finp" style="width:72px;" />
        </div>
      </div>
    </div>

    <button on:click={saveAll} class="btn-save" class:btn-save--saved={saved}>
      {saved ? '✓ Saved' : 'Save'}
    </button>

  </div>
</div>
{/if}

<!-- ═══ MAIN ═════════════════════════════════════════════════ -->
<main
  class="app"
  class:view-signal={activeMobileTab === 'signal'}
  class:view-intel={activeMobileTab === 'intel'}
  class:view-portfolio={activeMobileTab === 'portfolio'}
>
  <div class="layout">

    <!-- ── COL 1 ─────────────────────────────────────── -->
    <section class="col-signal">

      <!-- BUY SIGNAL HERO -->
      <div class="card hero-card" style="--ac:{accentColor};">
        <div class="hero-top">
          <span class="eyebrow">DCA Signal</span>
          <span class="hero-updated">{dcaUpdated || '…'}</span>
        </div>

        <div class="hero-num-wrap">
          {#if !dca}
            <div class="hero-num" style="color:var(--t3);">—</div>
          {:else if dca.finalAud === 0}
            <div class="hero-num" style="color:var(--red-hi); font-size:2.8rem;">Pass</div>
          {:else}
            <div class="hero-num" style="color:{accentColor};">${dca.finalAud.toLocaleString()}</div>
          {/if}
          <div class="hero-unit">AUD · fortnightly buy</div>
        </div>

        <!-- price-range bar -->
        {#if btcPrice > 0 && dca}
        <div class="range-bar">
          <span class="range-label" style="color:var(--green-hi);">$55k</span>
          <div class="pbar range-track" style="height:2px; flex:1;">
            {#if btcPrice <= 55000}
              <div class="pfill" style="width:0%;"></div>
            {:else if btcPrice >= 125000}
              <div class="pfill" style="width:100%; background:var(--red-hi);"></div>
            {:else}
              <div class="pfill" style="width:{((btcPrice-55000)/70000)*100}%; background:linear-gradient(90deg,var(--green-hi),var(--orange),var(--red-hi));"></div>
            {/if}
          </div>
          <span class="range-label" style="color:var(--red-hi);">$125k</span>
        </div>
        {/if}

        <!-- signal conditions -->
        {#if dca}
        <div class="signals">
          {#each dca.signals as sig}
            <div class="sig-row" class:sig-row--on={sig.active}>
              <span class="sig-dot">{sig.active ? '●' : '○'}</span>
              <span class="sig-name">{sig.name}</span>
              {#if sig.active}<span class="sig-boost">+{sig.boost}%</span>{/if}
            </div>
          {/each}
        </div>
        {/if}

        <!-- footer stats -->
        <div class="hero-footer">
          <div class="hf-stat">
            <span class="eyebrow">BTC / USD</span>
            <span class="hf-val" style="color:{priceColor}; transition:color 0.5s;">{btcPrice > 0 ? '$' + n(btcPrice) : '—'}</span>
          </div>
          <div class="hf-div"></div>
          <div class="hf-stat">
            <span class="eyebrow">BTC / AUD</span>
            <span class="hf-val">{btcAud ? 'A$' + n(btcAud, 0) : '—'}</span>
          </div>
          <div class="hf-div"></div>
          <div class="hf-stat">
            <span class="eyebrow">Sats / A$1</span>
            <span class="hf-val" style="color:var(--orange);">{satsPerAud ? satsPerAud.toLocaleString() : '—'}</span>
          </div>
        </div>
      </div>

      <!-- BITCOIN NETWORK -->
      <div class="card">
        <div class="c-head">
          <span class="c-title">Network</span>
          <a href="https://mempool.space" target="_blank" rel="noopener noreferrer" class="c-src">mempool.space ↗</a>
        </div>

        <div class="trio">
          <div class="trio-stat">
            <span class="eyebrow">Block</span>
            <span class="bignum" style="color:var(--blue);">{n(btcBlock)}</span>
          </div>
          <div class="trio-stat">
            <span class="eyebrow">Fee Low</span>
            <span class="bignum" style="color:var(--green-hi);">{btcFees.low}<small> sat/vb</small></span>
          </div>
          <div class="trio-stat">
            <span class="eyebrow">Fee High</span>
            <span class="bignum" style="color:var(--red-hi);">{btcFees.high}<small> sat/vb</small></span>
          </div>
        </div>

        {#if halvingBlocksLeft > 0}
        <div class="halving">
          <div class="halving-head">
            <span class="eyebrow">Next Halving</span>
            <span class="halving-days">{halvingDays.toLocaleString()} days</span>
          </div>
          <div class="pbar" style="height:2px; margin:8px 0;">
            <div class="pfill" style="width:{halvingProgress}%; background:var(--orange);"></div>
          </div>
          <div class="halving-sub">{halvingProgress.toFixed(0)}% of epoch · {halvingBlocksLeft.toLocaleString()} blocks · ~{halvingDate}</div>
        </div>
        {/if}
      </div>

      <!-- STACK -->
      <div class="card">
        <div class="c-head">
          <span class="c-title">Stack</span>
          <span class="c-src" style="color:var(--green-hi);">${settings.dca.dailyAmount}/day · {dcaDays}d</span>
        </div>

        <div class="trio mb-16">
          <div class="trio-stat">
            <span class="eyebrow">Invested</span>
            <span class="bignum">${n(invested)}</span>
          </div>
          <div class="trio-stat">
            <span class="eyebrow">Value</span>
            <span class="bignum" style="color:{perf >= 0 ? 'var(--green-hi)' : 'var(--red-hi)'};">{btcPrice > 0 ? '$' + n(currentVal) : '—'}</span>
          </div>
          <div class="trio-stat">
            <span class="eyebrow">Return</span>
            <span class="bignum" style="color:{perf >= 0 ? 'var(--green-hi)' : 'var(--red-hi)'};">{btcPrice > 0 ? (perf >= 0 ? '+' : '') + perf.toFixed(1) + '%' : '—'}</span>
          </div>
        </div>

        <div class="btc-line">
          <span style="color:var(--orange);">{settings.dca.btcHeld.toFixed(8)}</span> BTC · {n(satsHeld)} sats
        </div>

        <div class="goal-block">
          <div class="goal-head">
            <span class="eyebrow">Goal · {settings.dca.goalBtc} BTC</span>
            <span class="eyebrow" style="color:var(--green-hi);">{goalPct.toFixed(1)}%</span>
          </div>
          <div class="pbar" style="height:2px; margin:6px 0;">
            <div class="pfill" style="width:{goalPct}%; background:linear-gradient(90deg,var(--orange),var(--green-hi));"></div>
          </div>
          <div class="goal-sub">{n(satsLeft)} sats remaining</div>
        </div>
      </div>

    </section>

    <!-- ── COL 2: POLYMARKET ──────────────────────── -->
    <section class="col-poly">
      <div class="card" style="height:100%;">
        <div class="c-head" style="margin-bottom:20px;">
          <div>
            <div class="c-title">Geopolitical Intel</div>
            <div class="c-sub">Live prediction markets</div>
          </div>
          <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" class="c-src c-src-link">Polymarket ↗</a>
        </div>

        {#if markets.length === 0}
          <div class="empty-msg">Fetching markets…</div>
        {:else}
          {#each markets as m}
            <div class="mkt-item">
              <div class="mkt-tags">
                <span class="mkt-tag" class:mkt-tag--pin={m.pinned}>{m.pinned ? 'Pinned' : m.tag}</span>
                {#if m.volume24hr > 1000}<span class="mkt-hot">{fmtVol(m.volume24hr)} today</span>{/if}
                {#if m.endDate}<span class="mkt-ends">{fmtDate(m.endDate)}</span>{/if}
              </div>
              <div class="mkt-body">
                <a href="{m.url}" target="_blank" rel="noopener noreferrer" class="mkt-q">{m.question}</a>
                <div class="mkt-prob" style="color:{pColor(m.probability)};">{m.probability}<span class="mkt-pct-sym">%</span></div>
              </div>
              <div class="pbar" style="margin:7px 0;">
                <div class="pfill" style="width:{m.probability}%; background:{pColor(m.probability)}; opacity:0.55;"></div>
              </div>
              <div class="mkt-foot">
                <span style="font-size:0.65rem; color:{pColor(m.probability)};">{m.topOutcome}</span>
                <span class="muted">{fmtVol(m.volume)}</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <!-- ── COL 3: NEWS ────────────────────────────── -->
    <section class="col-news">
      <div class="card" style="height:100%;">
        <div class="c-head" style="margin-bottom:20px;">
          <span class="c-title">News</span>
        </div>
        {#if newsItems.length === 0}
          <div class="empty-msg">Fetching feeds…</div>
        {:else}
          {#each newsItems as item}
            <div class="news-row">
              <a href={item.link} target="_blank" rel="noopener noreferrer" class="news-title">{item.title}</a>
              <div class="news-meta">
                <span class="news-src">{item.source}</span>
                <span class="muted">{timeAgo(item.pubDate)} ago</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <!-- ── PORTFOLIO ROW ───────────────────────────── -->
    <section class="col-portfolio">

      <!-- ASSETS -->
      <div class="card asset-card">
        <div class="c-head" style="margin-bottom:22px;">
          <span class="c-title">Assets</span>
          <span class="c-src">1 Year Return</span>
        </div>
        <div class="asset-rows">
          {#each [
            { name:'Bitcoin',   ticker:'BTC', pct:null,        color:'var(--orange)', sub: btcPrice ? '$'+n(btcPrice) : '' },
            { name:'Gold',      ticker:'XAU', pct:goldYtdPct,  color:'#d4a017',       sub: goldPriceUsd ? '$'+n(goldPriceUsd,0)+'/oz' : '' },
            { name:'S&P 500',   ticker:'SPX', pct:sp500YtdPct, color:'var(--blue)',    sub: sp500Price ? n(sp500Price,0) : '' },
            { name:'Inflation', ticker:'CPI', pct:cpiAnnual,   color:'var(--red-hi)', sub: '' },
          ] as a}
            <div class="a-row">
              <div class="a-left">
                <span class="a-ticker" style="color:{a.color};">{a.ticker}</span>
                <span class="a-name">{a.name}</span>
                {#if a.sub}<span class="a-sub">{a.sub}</span>{/if}
              </div>
              <div class="a-bar">
                {#if a.pct !== null}
                  {@const w = Math.min(100, Math.max(0, (a.pct / 150) * 100 + 50))}
                  <div class="pbar" style="height:1px;"><div class="pfill" style="width:{w}%; background:{a.color}; opacity:0.45;"></div></div>
                {:else}
                  <div class="pbar" style="height:1px;"></div>
                {/if}
              </div>
              <div class="a-pct" style="color:{a.pct === null ? 'var(--t3)' : a.pct >= 0 ? 'var(--green-hi)' : 'var(--red-hi)'};">
                {a.pct !== null ? (a.pct >= 0 ? '+' : '') + a.pct.toFixed(1) + '%' : 'live'}
              </div>
            </div>
          {/each}
        </div>
        {#if cpiAnnual !== null}
          <div class="cpi-footer">
            Purchasing power lost to CPI since DCA start: <span style="color:var(--red-hi);">−{cpiCumLoss.toFixed(1)}%</span>
          </div>
        {/if}
      </div>

      <!-- GHOSTFOLIO -->
      {#if settings.ghostfolio?.token}
      <div class="card gf-card">
        <div class="c-head" style="margin-bottom:22px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="c-title">Portfolio</span>
            <span class="c-src">Ghostfolio</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            {#if gfLoading}<span class="pulse-dot"></span>{/if}
            {#if gfUpdated && !gfLoading}<span class="c-src">{gfUpdated}</span>{/if}
            <button on:click={fetchGhostfolio} class="icon-btn">↻</button>
          </div>
        </div>

        {#if gfError}
          <div class="err-msg">{gfError} — check your token in Settings.</div>
        {:else}
          <!-- Net Worth big numbers -->
          <div class="gf-top">
            <div class="gf-hero">
              <span class="eyebrow">Net Worth</span>
              <span class="gf-nw" style="color:#a78bfa;">{gfNetWorth !== null ? '$' + n(gfNetWorth, 0) : '—'}</span>
              <span class="eyebrow">{settings.ghostfolio.currency || 'AUD'} nominal</span>
            </div>
            {#if inflationAdjNW !== null}
            <div class="gf-hero" style="opacity:0.45;">
              <span class="eyebrow">Real Value</span>
              <span class="gf-nw" style="color:#a78bfa;">{inflationAdjNW !== null ? '$' + n(inflationAdjNW, 0) : '—'}</span>
              <span class="eyebrow">CPI-adjusted</span>
            </div>
            {/if}
            <div class="gf-divider"></div>
            <div class="gf-smalls">
              <div class="gf-sm">
                <span class="eyebrow">Today</span>
                <span class="gf-sm-val" style="color:{signColor(gfTodayChangePct)};">{pct(gfTodayChangePct)}</span>
              </div>
              <div class="gf-sm">
                <span class="eyebrow">YTD</span>
                <span class="gf-sm-val" style="color:{signColor(gfNetGainYtdPct)};">{pct(gfNetGainYtdPct)}</span>
              </div>
              <div class="gf-sm">
                <span class="eyebrow">All-time</span>
                <span class="gf-sm-val" style="color:{signColor(gfNetGainPct)};">{pct(gfNetGainPct)}</span>
              </div>
              <div class="gf-sm">
                <span class="eyebrow">Invested</span>
                <span class="gf-sm-val">{gfTotalInvested !== null ? '$' + n(gfTotalInvested, 0) : '—'}</span>
              </div>
            </div>
          </div>

          <!-- ROI comparison strip -->
          {#if portCAGR !== null || cpiAnnual !== null || goldYtdPct !== null || sp500YtdPct !== null}
          <div class="roi-strip">
            {#if portCAGR !== null}
              <div class="roi-cell">
                <span class="eyebrow" style="color:#a78bfa;">Portfolio CAGR</span>
                <span class="roi-val" style="color:{portCAGR >= 0 ? 'var(--green-hi)' : 'var(--red-hi)'};">{portCAGR >= 0 ? '+' : ''}{portCAGR.toFixed(1)}%<span class="roi-unit">/yr</span></span>
                {#if cpiAnnual !== null}
                  <span class="roi-vs" style="color:{portCAGR > cpiAnnual ? 'var(--green-hi)' : 'var(--red-hi)'};">{portCAGR > cpiAnnual ? '+' : ''}{(portCAGR - cpiAnnual).toFixed(1)}% vs CPI</span>
                {/if}
              </div>
            {/if}
            {#if cpiAnnual !== null}
              <div class="roi-cell">
                <span class="eyebrow" style="color:var(--red-hi);">CPI</span>
                <span class="roi-val" style="color:var(--red-hi);">+{cpiAnnual.toFixed(1)}%<span class="roi-unit">/yr</span></span>
              </div>
            {/if}
            {#if goldYtdPct !== null}
              <div class="roi-cell">
                <span class="eyebrow" style="color:#d4a017;">Gold 1Y</span>
                <span class="roi-val" style="color:{goldYtdPct >= 0 ? '#d4a017' : 'var(--red-hi)'};">{goldYtdPct >= 0 ? '+' : ''}{goldYtdPct.toFixed(1)}%</span>
              </div>
            {/if}
            {#if sp500YtdPct !== null}
              <div class="roi-cell">
                <span class="eyebrow" style="color:var(--blue);">S&P 500 1Y</span>
                <span class="roi-val" style="color:{sp500YtdPct >= 0 ? 'var(--blue)' : 'var(--red-hi)'};">{sp500YtdPct >= 0 ? '+' : ''}{sp500YtdPct.toFixed(1)}%</span>
              </div>
            {/if}
          </div>
          {/if}

          <!-- Holdings (collapsible) -->
          {#if gfHoldings.length > 0}
          <div class="holdings">
            <button class="holdings-toggle" on:click={() => showHoldings = !showHoldings}>
              Holdings ({gfHoldings.length})
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                style="transform:{showHoldings ? 'rotate(180deg)' : 'rotate(0)'}; transition:transform 0.2s; color:var(--t3); margin-left:4px;">
                <path d="M5 7L1 3h8z"/>
              </svg>
            </button>
            {#if showHoldings}
            <div class="hgrid">
              {#each gfHoldings as h}
                {@const pc = h.netPerformancePercentWithCurrencyEffect}
                <div class="h-item">
                  <div class="h-top">
                    <span class="h-sym">{h.symbol}</span>
                    <span class="h-pct" style="color:{pc >= 0 ? 'var(--green-hi)' : 'var(--red-hi)'};">{pc >= 0 ? '+' : ''}{pc.toFixed(1)}%</span>
                  </div>
                  {#if h.name !== h.symbol}<div class="h-name">{h.name.slice(0, 22)}</div>{/if}
                  <div class="pbar" style="margin:7px 0;"><div class="pfill" style="width:{Math.min(100,h.allocationInPercentage)}%; background:#a78bfa; opacity:0.35;"></div></div>
                  <div class="h-foot">
                    <span>{h.allocationInPercentage.toFixed(1)}%</span>
                    <span>${n(h.valueInBaseCurrency, 0)}</span>
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

<!-- ═══ MOBILE NAV ══════════════════════════════════════════ -->
<nav class="bnav">
  <button class="bnav-tab" class:bnav-tab--on={activeMobileTab === 'signal'} on:click={() => activeMobileTab = 'signal'}>
    <span class="bnav-glyph">₿</span>
    <span class="bnav-label">Signal</span>
    {#if dca && dca.finalAud > 0}<span class="bnav-pip" style="background:{accentColor};"></span>{/if}
  </button>
  <button class="bnav-tab" class:bnav-tab--on={activeMobileTab === 'intel'} on:click={() => activeMobileTab = 'intel'}>
    <span class="bnav-glyph">◈</span>
    <span class="bnav-label">Intel</span>
    {#if markets.length > 0}<span class="bnav-pip" style="background:var(--blue);"></span>{/if}
  </button>
  <button class="bnav-tab" class:bnav-tab--on={activeMobileTab === 'portfolio'} on:click={() => activeMobileTab = 'portfolio'}>
    <span class="bnav-glyph">↗</span>
    <span class="bnav-label">Portfolio</span>
  </button>
</nav>

<!-- ═══ FOOTER ═══════════════════════════════════════════════ -->
<footer class="site-footer">
  <span><span class="blink" style="color:var(--green-hi); font-size:0.45rem; vertical-align:middle;">●</span> Situation Monitor</span>
  <span>mempool · alternative.me · binance · er-api · ghostfol.io · yahoo finance · worldbank</span>
</footer>

<style>
  /* ─── RESET ─────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; }
  :global(button, a) { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }

  /* ─── HEADER ────────────────────────────── */
  .hdr {
    position: sticky; top: 0; z-index: 100;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 20px; height: 52px;
    background: rgba(8,8,8,0.85);
    backdrop-filter: blur(20px) saturate(160%);
    border-bottom: 1px solid var(--edge);
  }
  .hdr-left { display: flex; align-items: center; gap: 10px; }
  .live-dot { display: inline-block; width: 6px; height: 6px; background: var(--green-hi); border-radius: 50%; }
  .hdr-wordmark { font-size: 0.8rem; font-weight: 500; color: var(--t1); letter-spacing: -0.01em; }
  .hdr-mid { position: absolute; left: 50%; transform: translateX(-50%); }
  .hdr-time { font-family: 'Rajdhani', sans-serif; font-weight: 600; font-size: 0.9rem; letter-spacing: 0.06em; color: var(--t3); font-variant-numeric: tabular-nums; }
  .hdr-right { display: flex; align-items: center; gap: 8px; }
  .hdr-btn {
    display: flex; align-items: center; gap: 7px;
    padding: 6px 12px; border-radius: 7px;
    background: none; border: 1px solid var(--edge);
    color: var(--t2); font-size: 0.72rem; font-family: 'Inter', sans-serif;
    cursor: pointer; transition: border-color 0.15s, color 0.15s;
  }
  .hdr-btn:hover { border-color: var(--edge-hi); color: var(--t1); }
  .hdr-btn--active { border-color: var(--edge-hi); color: var(--t1); }
  .hdr-btn-lbl { display: block; }
  @media (max-width: 600px) {
    .hdr { padding: 0 14px; height: 48px; }
    .hdr-mid { display: none; }
    .hdr-wordmark { font-size: 0.75rem; }
    .hdr-btn-lbl { display: none; }
    .hdr-btn { padding: 7px; min-width: 36px; justify-content: center; }
  }

  /* ─── SETTINGS ──────────────────────────── */
  .settings-drawer {
    background: #060608;
    border-bottom: 1px solid var(--edge);
  }
  .settings-inner {
    max-width: 860px; margin: 0 auto;
    padding: 28px 20px;
    display: flex; flex-direction: column; gap: 24px;
  }
  .settings-group { }
  .settings-group-label {
    font-size: 0.7rem; font-weight: 500; color: var(--t2);
    margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .settings-hint { font-size: 0.65rem; color: var(--t3); font-weight: 400; }
  .settings-fields { display: flex; gap: 10px; flex-wrap: wrap; }
  .field { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 110px; }
  .flabel { font-size: 0.6rem; color: var(--t3); font-weight: 500; letter-spacing: 0.02em; }
  .finp {
    width: 100%; background: var(--s2);
    border: 1px solid var(--edge); border-radius: 7px;
    padding: 8px 10px; color: var(--t1);
    font-family: 'Inter', sans-serif; font-size: 0.8rem;
    transition: border-color 0.15s;
  }
  .finp:focus { outline: none; border-color: var(--edge-hi); }
  .tag-list { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
  .stag {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 10px; background: var(--s2);
    border: 1px solid var(--edge); border-radius: 20px;
    font-size: 0.7rem; color: var(--t2);
  }
  .stag-rm { background: none; border: none; color: var(--t3); cursor: pointer; font-size: 0.9rem; padding: 0; line-height: 1; }
  .stag-rm:hover { color: var(--red-hi); }
  .finp-row { display: flex; gap: 7px; }
  .btn-add {
    padding: 8px 14px; border: 1px solid var(--edge); border-radius: 7px;
    background: none; color: var(--t2); font-size: 0.72rem;
    cursor: pointer; white-space: nowrap; transition: all 0.15s;
  }
  .btn-add:hover { border-color: var(--edge-hi); color: var(--t1); }
  .src-list { max-height: 72px; overflow-y: auto; margin-bottom: 8px; }
  .src-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 0.64rem; color: var(--t3); }
  .src-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
  .btn-save {
    align-self: flex-start; padding: 9px 22px;
    background: var(--t1); border: none; border-radius: 7px;
    color: var(--bg); font-size: 0.78rem; font-weight: 500;
    cursor: pointer; transition: opacity 0.15s;
  }
  .btn-save:hover { opacity: 0.85; }
  .btn-save--saved { background: var(--green-hi); color: #fff; }
  @media (max-width: 600px) {
    .settings-inner { padding: 20px 14px; }
    .settings-fields { flex-direction: column; }
  }

  /* ─── LAYOUT ────────────────────────────── */
  .layout {
    display: grid;
    grid-template-columns: 340px 1fr 1fr;
    grid-template-rows: auto auto;
    gap: 10px; padding: 10px;
    max-width: 1440px; margin: 0 auto;
    align-items: start;
  }
  .col-signal    { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; gap: 10px; }
  .col-poly      { grid-column: 2; grid-row: 1; }
  .col-news      { grid-column: 3; grid-row: 1; }
  .col-portfolio { grid-column: 1 / -1; grid-row: 2; display: flex; gap: 10px; align-items: start; }
  @media (max-width: 1100px) {
    .layout { grid-template-columns: 300px 1fr 1fr; }
  }
  @media (max-width: 960px) {
    .layout { grid-template-columns: 1fr 1fr; }
    .col-signal { grid-column: 1; }
    .col-poly   { grid-column: 2; }
    .col-news   { grid-column: 1 / -1; grid-row: 2; }
    .col-portfolio { grid-column: 1 / -1; grid-row: 3; flex-direction: column; }
  }
  @media (max-width: 600px) {
    .layout { grid-template-columns: 1fr; padding: 8px 8px 86px; gap: 8px; }
    .col-signal, .col-poly, .col-news, .col-portfolio { grid-column: 1; grid-row: auto; }
    .col-signal, .col-poly, .col-news, .col-portfolio { display: none !important; }
    .view-signal    .col-signal    { display: flex !important; flex-direction: column; gap: 8px; }
    .view-intel     .col-poly,
    .view-intel     .col-news      { display: flex !important; flex-direction: column; }
    .view-portfolio .col-portfolio { display: flex !important; flex-direction: column; gap: 8px; }
  }

  /* ─── SHARED ATOMS ─────────────────────── */
  .eyebrow {
    display: block;
    font-size: 0.6rem; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--t3);
  }
  .bignum {
    font-family: 'Rajdhani', sans-serif; font-weight: 700;
    font-size: 1.5rem; line-height: 1; color: var(--t1);
  }
  .bignum small { font-size: 0.5em; opacity: 0.55; font-weight: 400; }
  .muted { font-size: 0.6rem; color: var(--t3); }
  .c-head { display: flex; justify-content: space-between; align-items: flex-start; }
  .c-title { font-size: 0.78rem; font-weight: 500; color: var(--t1); }
  .c-sub { font-size: 0.6rem; color: var(--t3); margin-top: 3px; }
  .c-src { font-size: 0.6rem; color: var(--t3); text-decoration: none; }
  .c-src-link:hover { color: var(--t2); }
  .trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 16px; }
  .trio-stat { display: flex; flex-direction: column; gap: 6px; }
  .mb-16 { margin-bottom: 16px; }
  .empty-msg { font-size: 0.75rem; color: var(--t3); padding: 8px 0; }
  .err-msg { font-size: 0.74rem; color: var(--red-hi); padding: 10px 12px; border: 1px solid rgba(244,63,94,0.15); border-radius: 8px; background: rgba(244,63,94,0.04); }

  /* ─── HERO CARD ─────────────────────────── */
  .hero-card {
    border-top: 2px solid var(--ac, var(--t3));
    position: relative; overflow: hidden;
  }
  /* Subtle radial glow behind the number */
  .hero-card::after {
    content: '';
    position: absolute; top: -40px; left: 50%; transform: translateX(-50%);
    width: 240px; height: 240px;
    background: radial-gradient(circle, color-mix(in srgb, var(--ac, transparent) 12%, transparent) 0%, transparent 70%);
    pointer-events: none;
  }
  .hero-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .hero-updated { font-size: 0.58rem; color: var(--t3); font-variant-numeric: tabular-nums; }
  .hero-num-wrap { text-align: center; padding: 12px 0 20px; position: relative; z-index: 1; }
  .hero-num {
    font-family: 'Rajdhani', sans-serif; font-weight: 700;
    font-size: 4rem; line-height: 1; transition: color 0.5s;
  }
  .hero-unit {
    font-size: 0.58rem; color: var(--t3); margin-top: 8px;
    text-transform: uppercase; letter-spacing: 0.12em;
  }
  @media (max-width: 600px) {
    .hero-num { font-size: 5.5rem; }
    .hero-num-wrap { padding: 20px 0 26px; }
  }

  /* Range bar */
  .range-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; }
  .range-track { flex: 1; }
  .range-label { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 0.55rem; letter-spacing: 0.04em; white-space: nowrap; }

  /* Signals list */
  .signals { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; }
  .sig-row { display: flex; align-items: center; gap: 8px; font-size: 0.7rem; color: var(--t3); transition: color 0.2s; }
  .sig-row--on { color: var(--t1); }
  .sig-dot { font-size: 0.45rem; flex-shrink: 0; }
  .sig-row--on .sig-dot { color: var(--green-hi); }
  .sig-name { flex: 1; }
  .sig-boost { font-size: 0.62rem; color: var(--green-hi); }

  /* Hero footer stats */
  .hero-footer { display: flex; border-top: 1px solid var(--edge); padding-top: 16px; }
  .hf-stat { flex: 1; display: flex; flex-direction: column; gap: 5px; text-align: center; }
  .hf-val { font-family: 'Rajdhani', sans-serif; font-weight: 600; font-size: 0.9rem; line-height: 1; color: var(--t1); }
  .hf-div { width: 1px; background: var(--edge); flex-shrink: 0; margin: 0 4px; }

  /* ─── BTC NETWORK ────────────────────────── */
  .halving { border-top: 1px solid var(--edge); margin-top: 18px; padding-top: 16px; }
  .halving-head { display: flex; justify-content: space-between; align-items: center; }
  .halving-days { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 1rem; color: var(--orange); }
  .halving-sub { font-size: 0.58rem; color: var(--t3); }

  /* ─── STACK ─────────────────────────────── */
  .btc-line { font-size: 0.72rem; color: var(--t2); margin-bottom: 16px; }
  .goal-block { }
  .goal-head { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .goal-sub { font-size: 0.58rem; color: var(--t3); text-align: right; margin-top: 4px; }

  /* ─── POLYMARKET ─────────────────────────── */
  .mkt-item { padding: 14px 0; border-bottom: 1px solid var(--edge); }
  .mkt-item:last-child { border-bottom: none; padding-bottom: 0; }
  .mkt-tags { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; flex-wrap: wrap; }
  .mkt-tag {
    font-size: 0.55rem; color: var(--t3);
    background: var(--s2); border: 1px solid var(--edge);
    border-radius: 4px; padding: 2px 6px;
    font-weight: 500; text-transform: uppercase; letter-spacing: 0.08em;
  }
  .mkt-tag--pin { color: var(--blue); border-color: rgba(14,165,233,0.2); }
  .mkt-hot { font-size: 0.58rem; color: var(--green-hi); }
  .mkt-ends { font-size: 0.58rem; color: var(--t3); margin-left: auto; }
  .mkt-body { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 0; }
  .mkt-q { font-size: 0.78rem; color: var(--t2); line-height: 1.45; flex: 1; text-decoration: none; transition: color 0.15s; }
  .mkt-q:hover { color: var(--t1); }
  .mkt-prob { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 1.6rem; line-height: 1; white-space: nowrap; }
  .mkt-pct-sym { font-size: 0.65em; opacity: 0.6; }
  .mkt-foot { display: flex; justify-content: space-between; align-items: center; }

  /* ─── NEWS ──────────────────────────────── */
  .news-row { padding: 11px 0; border-bottom: 1px solid var(--edge); }
  .news-row:last-child { border-bottom: none; }
  .news-title { display: block; font-size: 0.78rem; color: var(--t2); text-decoration: none; line-height: 1.48; margin-bottom: 5px; transition: color 0.15s; }
  .news-title:hover { color: var(--t1); }
  .news-meta { display: flex; gap: 10px; align-items: center; }
  .news-src { font-size: 0.6rem; color: var(--orange); font-weight: 500; }

  /* ─── ASSET CARD ─────────────────────────── */
  .asset-card { flex: 1; min-width: 220px; }
  .asset-rows { display: flex; flex-direction: column; gap: 14px; margin-bottom: 14px; }
  .a-row { display: grid; grid-template-columns: 88px 1fr 50px; align-items: center; gap: 10px; }
  .a-left { display: flex; flex-direction: column; gap: 1px; }
  .a-ticker { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 0.82rem; }
  .a-name { font-size: 0.58rem; color: var(--t3); }
  .a-sub { font-size: 0.55rem; color: var(--t3); margin-top: 1px; }
  .a-bar { }
  .a-pct { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 0.8rem; text-align: right; }
  .cpi-footer { font-size: 0.62rem; color: var(--t3); border-top: 1px solid var(--edge); padding-top: 12px; line-height: 1.5; }

  /* ─── GHOSTFOLIO ─────────────────────────── */
  .gf-card { flex: 2; }
  .gf-top { display: flex; align-items: flex-end; gap: 24px; flex-wrap: wrap; margin-bottom: 20px; }
  .gf-hero { display: flex; flex-direction: column; gap: 6px; }
  .gf-nw { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 2.4rem; line-height: 1; }
  .gf-divider { width: 1px; height: 48px; background: var(--edge); align-self: center; flex-shrink: 0; }
  .gf-smalls { display: flex; align-items: flex-end; gap: 20px; flex-wrap: wrap; flex: 1; }
  .gf-sm { display: flex; flex-direction: column; gap: 6px; }
  .gf-sm-val { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 1.3rem; line-height: 1; }
  .icon-btn {
    background: none; border: 1px solid var(--edge); border-radius: 6px;
    color: var(--t3); font-size: 0.8rem; padding: 4px 10px;
    cursor: pointer; transition: all 0.15s;
  }
  .icon-btn:hover { border-color: var(--edge-hi); color: var(--t2); }
  .pulse-dot { display: inline-block; width: 6px; height: 6px; background: var(--green-hi); border-radius: 50%; animation: blink 1s infinite; }

  /* ROI strip */
  .roi-strip { display: flex; border: 1px solid var(--edge); border-radius: 9px; overflow: hidden; margin-bottom: 18px; }
  .roi-cell { flex: 1; padding: 13px 15px; border-right: 1px solid var(--edge); display: flex; flex-direction: column; gap: 4px; min-width: 80px; }
  .roi-cell:last-child { border-right: none; }
  .roi-val { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 1.15rem; line-height: 1; }
  .roi-unit { font-size: 0.65em; opacity: 0.6; }
  .roi-vs { font-size: 0.58rem; }

  /* Holdings */
  .holdings { border-top: 1px solid var(--edge); padding-top: 16px; }
  .holdings-toggle {
    background: none; border: none; color: var(--t3); font-size: 0.68rem;
    font-family: 'Inter', sans-serif; cursor: pointer;
    display: flex; align-items: center; padding: 0; margin-bottom: 14px;
    transition: color 0.15s;
  }
  .holdings-toggle:hover { color: var(--t2); }
  .hgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); gap: 8px; }
  .h-item { background: var(--s2); border: 1px solid var(--edge); border-radius: 9px; padding: 13px; }
  .h-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
  .h-sym { font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 0.9rem; }
  .h-pct { font-size: 0.7rem; font-weight: 500; }
  .h-name { font-size: 0.6rem; color: var(--t3); margin-bottom: 6px; }
  .h-foot { display: flex; justify-content: space-between; font-size: 0.62rem; color: var(--t3); }

  @media (max-width: 960px) {
    .roi-strip { flex-wrap: wrap; }
    .roi-cell { min-width: calc(50% - 1px); }
    .gf-top { gap: 16px; }
    .gf-divider { display: none; }
  }
  @media (max-width: 600px) {
    .gf-nw { font-size: 2rem; }
    .gf-smalls { gap: 14px; }
    .hgrid { grid-template-columns: 1fr 1fr; }
    .roi-cell { min-width: calc(50% - 1px); }
  }

  /* ─── MOBILE NAV ─────────────────────────── */
  .bnav { display: none; }
  @media (max-width: 600px) {
    .bnav {
      display: flex; position: fixed; bottom: 0; left: 0; right: 0; z-index: 200;
      background: rgba(8,8,8,0.95);
      backdrop-filter: blur(24px) saturate(160%);
      border-top: 1px solid var(--edge);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }
  .bnav-tab {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 10px 0 8px; gap: 3px;
    background: none; border: none; cursor: pointer; position: relative;
  }
  .bnav-glyph { font-size: 1rem; color: var(--t3); transition: color 0.15s; }
  .bnav-label { font-size: 0.52rem; color: var(--t3); font-weight: 400; transition: color 0.15s; letter-spacing: 0.04em; }
  .bnav-tab--on .bnav-glyph,
  .bnav-tab--on .bnav-label { color: var(--t1); }
  .bnav-pip { position: absolute; top: 8px; right: 22%; width: 5px; height: 5px; border-radius: 50%; }

  /* ─── FOOTER ─────────────────────────────── */
  .site-footer {
    border-top: 1px solid var(--edge); padding: 12px 20px;
    display: flex; justify-content: space-between; flex-wrap: wrap;
    gap: 6px; font-size: 0.58rem; color: var(--t3); margin-top: 4px;
  }
  @media (max-width: 600px) { .site-footer { display: none; } }

  /* ─── ANIMS ──────────────────────────────── */
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  .blink { animation: blink 2s step-end infinite; }
</style>
