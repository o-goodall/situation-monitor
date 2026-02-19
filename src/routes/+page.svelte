<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadSettings, saveSettings, calcDCA, DEFAULT_SETTINGS, type Settings, type LiveSignals } from '$lib/settings';

  let time = '';
  let dateStr = '';
  let settings: Settings = DEFAULT_SETTINGS;
  let showSettings = false;
  let saved = false;
  let newKeyword = '';
  let newSource = '';
  let activeMobileTab: 'signal' | 'intel' | 'portfolio' = 'signal';
  let showHoldings = false;

  let btcPrice = 0;
  let btcBlock = 0;
  let btcFees = { low: 0, medium: 0, high: 0 };
  let prevPrice = 0;
  let priceFlash = '';
  let halvingBlocksLeft = 0;
  let halvingDays = 0;
  let halvingDate = '';
  let halvingProgress = 0;

  let goldPriceUsd: number | null = null;
  let goldYtdPct: number | null = null;
  let sp500Price: number | null = null;
  let sp500YtdPct: number | null = null;
  let cpiAnnual: number | null = null;

  let fearGreed: number | null = null;
  let fearGreedLabel = '';
  let difficultyChange: number | null = null;
  let fundingRate: number | null = null;
  let audUsd: number | null = null;
  let dcaUpdated = '';

  let markets: { id: string; question: string; topOutcome: string; probability: number; volume: number; volume24hr: number; endDate: string; tag: string; url: string; pinned: boolean }[] = [];
  let newsItems: { title: string; link: string; source: string; pubDate: string }[] = [];

  let gfNetWorth: number | null = null;
  let gfTotalInvested: number | null = null;
  let gfNetGain: number | null = null;
  let gfNetGainPct: number | null = null;
  let gfNetGainYtdPct: number | null = null;
  let gfTodayChangePct: number | null = null;
  let gfHoldings: { symbol: string; name: string; allocationInPercentage: number; valueInBaseCurrency: number; netPerformancePercentWithCurrencyEffect: number; assetClass: string }[] = [];
  let gfError = '';
  let gfLoading = false;
  let gfUpdated = '';

  let clockInterval: ReturnType<typeof setInterval>;
  let intervals: ReturnType<typeof setInterval>[] = [];

  let dcaDays = 0;
  let invested = 0;
  let currentVal = 0;
  let perf = 0;
  let goalPct = 0;
  let satsHeld = 0;
  let satsLeft = 0;

  function updateStacking() {
    const s = settings.dca;
    dcaDays = Math.max(0, Math.floor((Date.now() - new Date(s.startDate).getTime()) / 86400000));
    invested = dcaDays * s.dailyAmount;
    currentVal = s.btcHeld * btcPrice;
    perf = invested > 0 ? ((currentVal - invested) / invested) * 100 : 0;
    goalPct = s.goalBtc > 0 ? Math.min(100, (s.btcHeld / s.goalBtc) * 100) : 0;
    satsHeld = Math.round(s.btcHeld * 1e8);
    satsLeft = Math.max(0, Math.round((s.goalBtc - s.btcHeld) * 1e8));
  }

  $: settings, btcPrice, updateStacking();
  $: liveSignals = { fearGreed, difficultyChange, fundingRate, audUsd } as LiveSignals;
  $: dca = btcPrice > 0 ? calcDCA(btcPrice, liveSignals) : null;
  $: dcaBuyColor = !dca ? '#555566' : dca.finalAud === 0 ? '#ff5252' : dca.finalAud >= 750 ? '#00e676' : dca.finalAud >= 400 ? '#f7931a' : '#4fc3f7';
  $: priceColor = priceFlash === 'up' ? '#00e676' : priceFlash === 'down' ? '#ff5252' : '#e8e8f0';
  $: btcAud = (btcPrice > 0 && audUsd !== null) ? btcPrice * audUsd : null;
  $: satsPerAud = btcAud !== null && btcAud > 0 ? Math.round(1e8 / btcAud) : null;

  $: inflationAdjustedNetWorth = (() => {
    if (gfNetWorth === null || cpiAnnual === null) return null;
    const yrs = (Date.now() - new Date(settings.dca.startDate).getTime()) / (365.25 * 24 * 3600 * 1000);
    return gfNetWorth / Math.pow(1 + cpiAnnual / 100, yrs);
  })();

  $: cpiCumulativeLoss = (() => {
    if (cpiAnnual === null) return 0;
    const yrs = Math.max(0.1, (Date.now() - new Date(settings.dca.startDate).getTime()) / (365.25 * 24 * 3600 * 1000));
    return (1 - 1 / Math.pow(1 + cpiAnnual / 100, yrs)) * 100;
  })();

  $: portfolioAnnualisedPct = (() => {
    if (gfNetGainPct === null) return null;
    const yrs = Math.max(0.1, (Date.now() - new Date(settings.dca.startDate).getTime()) / (365.25 * 24 * 3600 * 1000));
    return (Math.pow(1 + gfNetGainPct / 100, 1 / yrs) - 1) * 100;
  })();

  function tick() {
    const now = new Date();
    time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dateStr = now.toISOString().split('T')[0];
  }

  async function fetchBtc() {
    try {
      const d = await fetch('/api/bitcoin').then(r => r.json());
      prevPrice = btcPrice;
      btcPrice = d.price ?? 0;
      btcBlock = d.blockHeight ?? 0;
      btcFees = d.fees ?? { low: 0, medium: 0, high: 0 };
      if (d.halving) {
        halvingBlocksLeft = d.halving.blocksRemaining;
        halvingDays = d.halving.daysRemaining;
        halvingDate = d.halving.estimatedDate;
        halvingProgress = d.halving.progressPct;
      }
      if (prevPrice && btcPrice !== prevPrice) {
        priceFlash = btcPrice > prevPrice ? 'up' : 'down';
        setTimeout(() => priceFlash = '', 1200);
      }
    } catch {}
  }

  async function fetchDCA() {
    try {
      const d = await fetch('/api/dca').then(r => r.json());
      fearGreed = d.fearGreed; fearGreedLabel = d.fearGreedLabel;
      difficultyChange = d.difficultyChange; fundingRate = d.fundingRate;
      audUsd = d.audUsd;
      dcaUpdated = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    } catch {}
  }

  async function fetchPoly() {
    try {
      const kw = encodeURIComponent(JSON.stringify(settings.polymarket.keywords));
      markets = (await fetch(`/api/polymarket?keywords=${kw}`).then(r => r.json())).markets ?? [];
    } catch {}
  }

  async function fetchNews() {
    try {
      const src = encodeURIComponent(JSON.stringify(settings.news.sources));
      newsItems = (await fetch(`/api/news?sources=${src}`).then(r => r.json())).items ?? [];
    } catch {}
  }

  async function fetchMarkets() {
    try {
      const d = await fetch('/api/markets').then(r => r.json());
      goldPriceUsd = d.gold?.priceUsd ?? null; goldYtdPct = d.gold?.ytdPct ?? null;
      sp500Price = d.sp500?.price ?? null; sp500YtdPct = d.sp500?.ytdPct ?? null;
      cpiAnnual = d.cpiAnnual ?? null;
    } catch {}
  }

  async function fetchGhostfolio() {
    const token = settings.ghostfolio?.token?.trim();
    if (!token) return;
    gfLoading = true; gfError = '';
    try {
      const d = await fetch(`/api/ghostfolio?token=${encodeURIComponent(token)}`).then(r => r.json());
      if (d.error) { gfError = d.error; }
      else {
        gfNetWorth = d.netWorth; gfTotalInvested = d.totalInvested;
        gfNetGain = d.netGain; gfNetGainPct = d.netGainPct;
        gfNetGainYtdPct = d.netGainYtdPct; gfTodayChangePct = d.todayChangePct;
        gfHoldings = d.holdings ?? [];
        gfUpdated = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      }
    } catch { gfError = 'Connection failed'; }
    finally { gfLoading = false; }
  }

  function saveAll() {
    saveSettings(settings); saved = true;
    setTimeout(() => saved = false, 2000);
    fetchPoly(); fetchNews();
    if (settings.ghostfolio?.token) fetchGhostfolio();
  }

  const addKeyword = () => { if (newKeyword.trim()) { settings.polymarket.keywords = [...settings.polymarket.keywords, newKeyword.trim()]; newKeyword = ''; } };
  const removeKeyword = (i: number) => { settings.polymarket.keywords = settings.polymarket.keywords.filter((_, idx) => idx !== i); };
  const addSource = () => { if (newSource.trim()) { settings.news.sources = [...settings.news.sources, newSource.trim()]; newSource = ''; } };
  const removeSource = (i: number) => { settings.news.sources = settings.news.sources.filter((_, idx) => idx !== i); };

  const fmtVol = (v: number) => v >= 1e6 ? `$${(v/1e6).toFixed(1)}m` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}k` : `$${v}`;
  const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; } };
  const pColor = (p: number) => p >= 70 ? '#00e676' : p >= 40 ? '#f7931a' : '#ff5252';
  const timeAgo = (d: string) => { try { const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000); return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m/60)}h` : `${Math.floor(m/1440)}d`; } catch { return ''; } };
  const n = (v: number, dec = 0) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

  onMount(() => {
    settings = loadSettings(); updateStacking(); tick();
    clockInterval = setInterval(tick, 1000);
    fetchBtc(); fetchDCA(); fetchPoly(); fetchNews(); fetchMarkets();
    if (settings.ghostfolio?.token) fetchGhostfolio();
    intervals = [
      setInterval(fetchBtc, 60000), setInterval(fetchDCA, 300000),
      setInterval(fetchPoly, 300000), setInterval(fetchNews, 300000),
      setInterval(fetchMarkets, 300000),
      setInterval(() => { if (settings.ghostfolio?.token) fetchGhostfolio(); }, 300000),
    ];
  });
  onDestroy(() => { clearInterval(clockInterval); intervals.forEach(clearInterval); });
</script>

<!-- ══ HEADER ══════════════════════════════════════════════════════════════════ -->
<header class="hdr">
  <div class="hdr-logo">
    <span class="hdr-gem">◈</span>
    <div>
      <div class="hdr-title">SITUATION MONITOR</div>
      <div class="hdr-sub"><span class="blink" style="color:#00e676">▮</span> LIVE · AUTO-REFRESH</div>
    </div>
  </div>
  <div class="hdr-right">
    <div class="hdr-clock">
      <div class="clock-time">{time}</div>
      <div class="clock-date">{dateStr}</div>
    </div>
    <button class="btn-settings" class:btn-settings--active={showSettings} on:click={() => showSettings = !showSettings}>
      <span class="btn-settings__label">SETTINGS</span>
      <span class="btn-settings__icon">⚙</span>
    </button>
  </div>
</header>

<!-- ══ SETTINGS ════════════════════════════════════════════════════════════════ -->
{#if showSettings}
<div class="settings-panel">
  <div class="settings-panel__title">SETTINGS</div>
  <div class="settings-grid">
    {#each [['DCA START DATE', 'date', 'startDate'], ['DAILY ($AUD)', 'number', 'dailyAmount'], ['BTC HELD', 'number', 'btcHeld'], ['GOAL (BTC)', 'number', 'goalBtc']] as [label, type, key]}
      <div>
        <div class="lbl">{label}</div>
        {#if key === 'startDate'}
          <input type="date" bind:value={settings.dca.startDate} class="inp" />
        {:else if key === 'dailyAmount'}
          <input type="number" bind:value={settings.dca.dailyAmount} class="inp" />
        {:else if key === 'btcHeld'}
          <input type="number" step="0.00000001" bind:value={settings.dca.btcHeld} class="inp" />
        {:else}
          <input type="number" step="0.001" bind:value={settings.dca.goalBtc} class="inp" />
        {/if}
      </div>
    {/each}
  </div>

  <div class="settings-two-col">
    <div>
      <div class="lbl">PINNED WATCHLIST</div>
      <div class="hint">Shown alongside auto-trending geopolitics feed</div>
      <div class="kw-list">
        {#each settings.polymarket.keywords as kw, i}
          <span class="kw-chip">{kw} <button on:click={() => removeKeyword(i)} class="kw-x">×</button></span>
        {/each}
      </div>
      <div class="inp-row">
        <input bind:value={newKeyword} on:keydown={(e) => e.key==='Enter' && addKeyword()} placeholder="Add keyword…" class="inp" />
        <button on:click={addKeyword} class="btn-sm">ADD</button>
      </div>
    </div>
    <div>
      <div class="lbl">NEWS RSS FEEDS</div>
      <div class="src-list">
        {#each settings.news.sources as src, i}
          <div class="src-row"><span class="src-url">{src}</span><button on:click={() => removeSource(i)} class="kw-x">×</button></div>
        {/each}
      </div>
      <div class="inp-row">
        <input type="url" bind:value={newSource} on:keydown={(e) => e.key==='Enter' && addSource()} placeholder="https://…" class="inp" />
        <button on:click={addSource} class="btn-sm">ADD</button>
      </div>
    </div>
  </div>

  <div class="settings-gf">
    <div class="lbl" style="color:#a78bfa; margin-bottom:6px;">GHOSTFOLIO NET WORTH</div>
    <div style="display:grid; grid-template-columns:1fr auto; gap:8px; align-items:end;">
      <div><div class="lbl" style="margin-bottom:4px;">SECURITY TOKEN</div>
        <input type="password" bind:value={settings.ghostfolio.token} placeholder="your-security-token" class="inp" /></div>
      <div><div class="lbl" style="margin-bottom:4px;">CURRENCY</div>
        <input bind:value={settings.ghostfolio.currency} placeholder="AUD" class="inp" style="width:72px;" /></div>
    </div>
    <div class="hint" style="margin-top:4px;">Token stays in your browser only.</div>
  </div>

  <button on:click={saveAll} class="btn-save" class:btn-save--ok={saved}>{saved ? '✓ SAVED' : 'SAVE'}</button>
</div>
{/if}

<!-- ══ MAIN ═════════════════════════════════════════════════════════════════════ -->
<main class="app"
  class:view-signal={activeMobileTab === 'signal'}
  class:view-intel={activeMobileTab === 'intel'}
  class:view-portfolio={activeMobileTab === 'portfolio'}>

  <div class="layout">

    <!-- ── COL 1: SIGNAL ─────────────────────────────────────── -->
    <section class="sec-signal">

      <!-- BUY HERO ------------------------------------------------ -->
      <div class="card hero-card" style="border-top-color:{dcaBuyColor}; background: linear-gradient(180deg, {dcaBuyColor}08 0%, transparent 72px);">
        <div class="hero-header">
          <span class="lbl" style="margin:0;">DCA SIGNAL</span>
          <span class="dim">{dcaUpdated || '…'}</span>
        </div>

        <div class="hero-body">
          <div class="hero-amount" style="color:{dcaBuyColor}; text-shadow:0 0 60px {dcaBuyColor}66;">
            {#if !dca}
              <span class="hero-loading">LOADING…</span>
            {:else if dca.finalAud === 0}
              DO NOT BUY
            {:else}
              ${dca.finalAud.toLocaleString()} <span class="hero-currency">AUD</span>
            {/if}
          </div>
          {#if dca && dca.finalAud > 0}
            <div class="hero-sub">RECOMMENDED FORTNIGHTLY</div>
          {/if}
        </div>

        {#if dca}
        <div class="pills">
          {#each dca.signals as sig}
            <div class="pill" class:pill--on={sig.active}>
              <span class="pill-dot">{sig.active ? '●' : '○'}</span>
              <span>{sig.name}</span>
              {#if sig.active}<span class="pill-boost">+{sig.boost}%</span>{/if}
            </div>
          {/each}
        </div>
        {/if}

        <div class="hero-ctx">
          <span style="color:{priceColor}; transition:color 0.5s;">{btcPrice > 0 ? '$' + n(btcPrice) : '…'}</span>
          <span class="sep">·</span>
          {#if btcAud}<span>A${n(btcAud, 0)}</span><span class="sep">·</span>{/if}
          {#if satsPerAud}<span style="color:#f7931a;">{satsPerAud.toLocaleString()} sat/A$1</span>{/if}
          {#if dca}<span class="sep">·</span><span class="dim">{dca.base.toFixed(0)}% base</span>{/if}
        </div>
      </div>

      <!-- BTC NETWORK --------------------------------------------- -->
      <div class="card">
        <div class="row-between mb10">
          <span class="lbl" style="margin:0;">BITCOIN NETWORK</span>
          <span class="tag">mempool.space</span>
        </div>

        <div class="btc-grid mb10">
          <div>
            <div class="lbl">PRICE</div>
            <div class="num-lg" style="color:{priceColor}; transition:color 0.5s;">${n(btcPrice)}</div>
            {#if btcAud}<div class="dim">A${n(btcAud, 0)}</div>{/if}
          </div>
          <div>
            <div class="lbl">SAT / A$1</div>
            <div class="num-lg" style="color:#f7931a;">{satsPerAud !== null ? satsPerAud.toLocaleString() : '--'}</div>
            <div class="dim">live</div>
          </div>
          <div>
            <div class="lbl">BLOCK</div>
            <div class="num-lg" style="color:#4fc3f7;">{n(btcBlock)}</div>
          </div>
        </div>

        <div class="fees-row">
          <span class="lbl">FEES</span>
          {#each [['LOW', btcFees.low, '#00e676'], ['MED', btcFees.medium, '#f7931a'], ['HIGH', btcFees.high, '#ff5252']] as [l, v, c]}
            <span class="fee" style="color:{c};">{l} <strong>{v}</strong></span>
          {/each}
          <span class="dim">sat/vb</span>
        </div>

        {#if halvingBlocksLeft > 0}
        <div class="halving">
          <div class="row-between mb4">
            <span class="halving-lbl">⚡ HALVING <strong style="color:#f7931a;">{halvingDays}d</strong> · {halvingBlocksLeft.toLocaleString()} blocks</span>
            <span class="dim">{halvingProgress.toFixed(0)}%</span>
          </div>
          <div class="pbar" style="height:4px;"><div class="pfill" style="width:{halvingProgress}%; background:linear-gradient(90deg,#f7931a,#ffd700);"></div></div>
          <div class="dim mt3">Epoch 4→5 · 3.125→1.5625 BTC/block · ~{halvingDate}</div>
        </div>
        {/if}
      </div>

      <!-- STACKING ------------------------------------------------ -->
      <div class="card">
        <div class="row-between mb10">
          <span class="lbl" style="margin:0;">STACKING</span>
          <span class="tag" style="color:#00e676; border-color:#00e67622;">${settings.dca.dailyAmount}/day · {dcaDays}d</span>
        </div>

        <div class="stack-row mb8">
          <div>
            <div class="lbl">INVESTED</div>
            <div class="num-lg">${n(invested)}</div>
          </div>
          <span class="arrow">→</span>
          <div>
            <div class="lbl">NOW</div>
            <div class="num-lg" style="color:{perf >= 0 ? '#00e676' : '#ff5252'};">{btcPrice > 0 ? '$' + n(currentVal) : '--'}</div>
          </div>
          <div style="text-align:right; margin-left:auto;">
            <div class="lbl">RETURN</div>
            <div class="num-lg" style="color:{perf >= 0 ? '#00e676' : '#ff5252'};">{btcPrice > 0 ? (perf >= 0 ? '+' : '') + perf.toFixed(1) + '%' : '--'}</div>
          </div>
        </div>

        <div class="dim mb10" style="font-size:0.65rem;">{settings.dca.btcHeld.toFixed(8)} <span style="color:#f7931a;">BTC</span> · {n(satsHeld)} sats</div>

        <div class="row-between mb4">
          <span class="lbl">GOAL: {settings.dca.goalBtc} BTC</span>
          <span class="lbl" style="color:#00e676;">{goalPct.toFixed(1)}%</span>
        </div>
        <div class="pbar"><div class="pfill" style="width:{goalPct}%; background:linear-gradient(90deg,#f7931a,#00e676);"></div></div>
        <div class="dim mt3" style="text-align:right;">{n(satsLeft)} sats to go</div>
      </div>

    </section>

    <!-- ── COL 2: POLYMARKET ─────────────────────────────────── -->
    <section class="sec-poly">
      <div class="card" style="height:100%;">
        <div class="row-between mb12">
          <div>
            <div class="lbl" style="margin:0; color:#e8e8f0;">GEOPOLITICAL INTEL</div>
            <div class="dim mt2">sorted by 24hr volume</div>
          </div>
          <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" class="tag tag-link">polymarket ↗</a>
        </div>

        {#if markets.length === 0}
          <div class="dim" style="padding:8px 0; line-height:1.8;">Fetching trending markets…<br><span style="color:#333344;">geopolitics · politics · economy</span></div>
        {:else}
          {#each markets as m}
            <div class="mkt">
              <div class="mkt-meta">
                <span class="mkt-tag" class:mkt-tag--pinned={m.pinned}>{m.pinned ? '📌 PINNED' : m.tag.toUpperCase()}</span>
                {#if m.volume24hr > 1000}<span class="mkt-fire">🔥 {fmtVol(m.volume24hr)}</span>{/if}
                {#if m.endDate}<span class="mkt-date">{fmtDate(m.endDate)}</span>{/if}
              </div>
              <div class="mkt-body">
                <a href="{m.url}" target="_blank" rel="noopener noreferrer" class="mkt-q">{m.question}</a>
                <div class="mkt-pct" style="color:{pColor(m.probability)};">{m.probability}%</div>
              </div>
              <div class="pbar mb4"><div class="pfill" style="width:{m.probability}%; background:{pColor(m.probability)}; opacity:0.85;"></div></div>
              <div class="row-between">
                <span style="color:{pColor(m.probability)}; font-size:0.63rem;">{m.topOutcome}</span>
                <span class="dim">{fmtVol(m.volume)}</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <!-- ── COL 3: NEWS ──────────────────────────────────────── -->
    <section class="sec-news">
      <div class="card" style="height:100%;">
        <div class="lbl mb10">NEWS FEED</div>
        {#if newsItems.length === 0}
          <div class="dim">Fetching feeds…</div>
        {:else}
          {#each newsItems as item}
            <div class="news-item">
              <a href={item.link} target="_blank" rel="noopener noreferrer" class="news-link">{item.title}</a>
              <div class="news-meta">
                <span style="color:#f7931a; font-size:0.62rem;">{item.source}</span>
                <span class="dim">{timeAgo(item.pubDate)} ago</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <!-- ── PORTFOLIO ROW (full width) ───────────────────────── -->
    <section class="sec-portfolio">

      <!-- ASSET COMPARISON --------------------------------------- -->
      <div class="card">
        <div class="row-between mb12">
          <span class="lbl" style="margin:0;">ASSET COMPARISON</span>
          <span class="tag">1Y RETURN · yahoo finance</span>
        </div>
        <div class="asset-bars">
          {#each [
            { label:'BTC',     pct:null,       color:'#f7931a', sub: btcPrice ? '$'+n(btcPrice)+' USD' : '', note:'live price' },
            { label:'GOLD',    pct:goldYtdPct, color:'#ffd700', sub: goldPriceUsd ? '$'+n(goldPriceUsd,0)+'/oz' : '' },
            { label:'S&P 500', pct:sp500YtdPct, color:'#4fc3f7', sub: sp500Price ? n(sp500Price,0) : '' },
            { label:'CPI',     pct:cpiAnnual,  color:'#ff5252', note:'inflation' },
          ] as row}
            <div class="asset-row">
              <div class="asset-name">
                <span style="color:{row.color}; font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.75rem;">{row.label}</span>
                {#if row.sub}<div class="dim">{row.sub}</div>{/if}
              </div>
              <div class="asset-track">
                {#if row.pct !== null}
                  {@const w = Math.min(100, Math.max(0, (row.pct / 150) * 100 + 50))}
                  <div class="pbar" style="height:5px;"><div class="pfill" style="width:{w}%; background:{row.color}; opacity:0.7;"></div></div>
                {:else}
                  <div class="pbar" style="height:5px;"></div>
                {/if}
              </div>
              <div class="asset-pct" style="color:{row.pct === null ? '#555566' : row.pct >= 0 ? '#00e676' : '#ff5252'};">
                {row.pct !== null ? (row.pct >= 0 ? '+' : '') + row.pct.toFixed(1) + '%' : '--'}
                {#if row.note}<span class="dim ml4">{row.note}</span>{/if}
              </div>
            </div>
          {/each}
        </div>
        {#if cpiAnnual !== null}
          <div class="cpi-note">CPI {cpiAnnual.toFixed(1)}%/yr · <span style="color:#ff5252;">-{cpiCumulativeLoss.toFixed(1)}% purchasing power since DCA start</span></div>
        {/if}
      </div>

      <!-- GHOSTFOLIO --------------------------------------------- -->
      {#if settings.ghostfolio?.token}
      <div class="card">
        <div class="row-between mb14">
          <div class="row-center gap8">
            <span class="lbl" style="margin:0; color:#a78bfa;">NET WORTH</span>
            <span class="tag">ghostfolio</span>
          </div>
          <div class="row-center gap10">
            {#if gfLoading}<span class="dim">fetching…</span>{/if}
            {#if gfUpdated && !gfLoading}<span class="dim">{gfUpdated}</span>{/if}
            <button on:click={fetchGhostfolio} class="btn-refresh">↻ REFRESH</button>
          </div>
        </div>

        {#if gfError}
          <div class="err">⚠ {gfError} — check token in Settings.</div>
        {:else}
          <div class="gf-grid mb14">
            <div>
              <div class="lbl">NET WORTH</div>
              <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.5rem; color:#a78bfa; line-height:1;">{gfNetWorth !== null ? '$' + n(gfNetWorth, 0) : '--'}</div>
              <div class="dim">{settings.ghostfolio.currency || 'AUD'}</div>
            </div>
            <div>
              <div class="lbl">REAL VALUE</div>
              <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.5rem; color:#a78bfa; opacity:0.65; line-height:1;">{inflationAdjustedNetWorth !== null ? '$' + n(inflationAdjustedNetWorth, 0) : gfNetWorth !== null ? '$' + n(gfNetWorth, 0) : '--'}</div>
              <div class="dim">CPI-adjusted</div>
            </div>
            <div>
              <div class="lbl">TODAY</div>
              <div class="num-lg" style="color:{gfTodayChangePct === null ? '#555566' : gfTodayChangePct >= 0 ? '#00e676' : '#ff5252'};">{gfTodayChangePct !== null ? (gfTodayChangePct >= 0 ? '+' : '') + gfTodayChangePct.toFixed(2) + '%' : '--'}</div>
            </div>
            <div>
              <div class="lbl">YTD</div>
              <div class="num-lg" style="color:{gfNetGainYtdPct === null ? '#555566' : gfNetGainYtdPct >= 0 ? '#00e676' : '#ff5252'};">{gfNetGainYtdPct !== null ? (gfNetGainYtdPct >= 0 ? '+' : '') + gfNetGainYtdPct.toFixed(2) + '%' : '--'}</div>
            </div>
            <div>
              <div class="lbl">ALL-TIME</div>
              <div class="num-lg" style="color:{gfNetGainPct === null ? '#555566' : gfNetGainPct >= 0 ? '#00e676' : '#ff5252'};">{gfNetGainPct !== null ? (gfNetGainPct >= 0 ? '+' : '') + gfNetGainPct.toFixed(2) + '%' : '--'}</div>
            </div>
            <div>
              <div class="lbl">INVESTED</div>
              <div class="num-lg">{gfTotalInvested !== null ? '$' + n(gfTotalInvested, 0) : '--'}</div>
            </div>
          </div>

          {#if portfolioAnnualisedPct !== null || cpiAnnual !== null || goldYtdPct !== null || sp500YtdPct !== null}
          <div class="roi-chips mb14">
            {#if portfolioAnnualisedPct !== null}
              <div class="roi-chip">
                <div class="lbl" style="color:#a78bfa;">PORTFOLIO CAGR</div>
                <div class="num-md" style="color:{portfolioAnnualisedPct >= 0 ? '#00e676' : '#ff5252'};">{portfolioAnnualisedPct >= 0 ? '+' : ''}{portfolioAnnualisedPct.toFixed(1)}%/yr</div>
              </div>
            {/if}
            {#if cpiAnnual !== null}
              <div class="roi-chip">
                <div class="lbl" style="color:#ff5252;">CPI INFLATION</div>
                <div class="num-md" style="color:#ff5252;">+{cpiAnnual.toFixed(1)}%/yr</div>
                {#if portfolioAnnualisedPct !== null}
                  <div style="font-size:0.58rem; color:{portfolioAnnualisedPct > cpiAnnual ? '#00e676' : '#ff5252'};">
                    {portfolioAnnualisedPct > cpiAnnual ? '+' + (portfolioAnnualisedPct - cpiAnnual).toFixed(1) + '% real ✓' : '-' + (cpiAnnual - portfolioAnnualisedPct).toFixed(1) + '% real ✗'}
                  </div>
                {/if}
              </div>
            {/if}
            {#if goldYtdPct !== null}
              <div class="roi-chip">
                <div class="lbl" style="color:#ffd700;">◈ GOLD 1Y</div>
                <div class="num-md" style="color:{goldYtdPct >= 0 ? '#ffd700' : '#ff5252'};">{goldYtdPct >= 0 ? '+' : ''}{goldYtdPct.toFixed(1)}%</div>
              </div>
            {/if}
            {#if sp500YtdPct !== null}
              <div class="roi-chip">
                <div class="lbl" style="color:#4fc3f7;">▲ S&P 500 1Y</div>
                <div class="num-md" style="color:{sp500YtdPct >= 0 ? '#4fc3f7' : '#ff5252'};">{sp500YtdPct >= 0 ? '+' : ''}{sp500YtdPct.toFixed(1)}%</div>
              </div>
            {/if}
          </div>
          {/if}

          {#if gfHoldings.length > 0}
          <div class="holdings-section">
            <button class="holdings-toggle" on:click={() => showHoldings = !showHoldings}>
              HOLDINGS ({gfHoldings.length}) <span style="color:#4fc3f7; margin-left:4px;">{showHoldings ? '▲' : '▼'}</span>
            </button>
            {#if showHoldings}
            <div class="holdings-grid">
              {#each gfHoldings as h}
                {@const pc = h.netPerformancePercentWithCurrencyEffect}
                <div class="h-card">
                  <div class="row-between mb4">
                    <span class="h-sym">{h.symbol}</span>
                    <span style="color:{pc >= 0 ? '#00e676' : '#ff5252'}; font-size:0.72rem;">{pc >= 0 ? '+' : ''}{pc.toFixed(1)}%</span>
                  </div>
                  {#if h.name !== h.symbol}<div class="dim mb4">{h.name.slice(0, 22)}</div>{/if}
                  <div class="pbar mb4"><div class="pfill" style="width:{Math.min(100, h.allocationInPercentage)}%; background:#a78bfa; opacity:0.55;"></div></div>
                  <div class="row-between">
                    <span class="dim">{h.allocationInPercentage.toFixed(1)}%</span>
                    <span style="font-size:0.68rem;">${n(h.valueInBaseCurrency, 0)}</span>
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

  </div><!-- /layout -->
</main>

<!-- ══ MOBILE BOTTOM NAV ══════════════════════════════════════════════════════ -->
<nav class="bnav">
  <button class="bnav-btn" class:bnav-btn--active={activeMobileTab === 'signal'} on:click={() => activeMobileTab = 'signal'}>
    <span class="bnav-icon">₿</span>
    <span class="bnav-lbl">SIGNAL</span>
    {#if dca && dca.finalAud > 0}
      <span class="bnav-badge" style="background:{dcaBuyColor};">${dca.finalAud}</span>
    {/if}
  </button>
  <button class="bnav-btn" class:bnav-btn--active={activeMobileTab === 'intel'} on:click={() => activeMobileTab = 'intel'}>
    <span class="bnav-icon">◈</span>
    <span class="bnav-lbl">INTEL</span>
    {#if markets.length > 0}<span class="bnav-badge" style="background:#4fc3f7; color:#09090b;">{markets.length}</span>{/if}
  </button>
  <button class="bnav-btn" class:bnav-btn--active={activeMobileTab === 'portfolio'} on:click={() => activeMobileTab = 'portfolio'}>
    <span class="bnav-icon">▲</span>
    <span class="bnav-lbl">PORTFOLIO</span>
  </button>
</nav>

<!-- ══ FOOTER ════════════════════════════════════════════════════════════════ -->
<footer class="footer">
  <span><span style="color:#00e676">▮</span> SITUATION MONITOR v1.5</span>
  <span>mempool · alternative.me · binance · er-api · ghostfol.io · yahoo finance · worldbank</span>
</footer>

<style>
  /* ─── BASE ─────────────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; }
  :global(button, a) { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }

  /* ─── HEADER ───────────────────────────────────────────────── */
  .hdr {
    position: sticky; top: 0; z-index: 100;
    background: rgba(9,9,11,0.96); backdrop-filter: blur(8px);
    border-bottom: 1px solid #1e1e28;
    padding: 10px 16px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .hdr-logo { display: flex; align-items: center; gap: 10px; }
  .hdr-gem { font-size: 1.25rem; color: #4fc3f7; }
  .hdr-title { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 1.05rem; letter-spacing: 0.18em; color: #e8e8f0; }
  .hdr-sub { font-size: 0.58rem; color: #555566; }
  .hdr-right { display: flex; align-items: center; gap: 12px; }
  .hdr-clock { text-align: right; }
  .clock-time { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 1.5rem; color: #4fc3f7; line-height: 1; }
  .clock-date { font-size: 0.58rem; color: #555566; }
  .btn-settings {
    padding: 6px 14px; border: 1px solid #1e1e28; border-radius: 4px;
    background: none; color: #888899;
    font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 0.68rem; letter-spacing: 0.12em;
    cursor: pointer; transition: border-color 0.15s, color 0.15s;
  }
  .btn-settings--active { border-color: #4fc3f7; color: #4fc3f7; }
  .btn-settings__icon { display: none; font-size: 1.1rem; }
  @media (max-width: 600px) {
    .hdr { padding: 8px 12px; }
    .hdr-title { font-size: 0.85rem; letter-spacing: 0.12em; }
    .clock-date { display: none; }
    .clock-time { font-size: 1.25rem; }
    .btn-settings { min-width: 44px; min-height: 44px; padding: 0; display: flex; align-items: center; justify-content: center; }
    .btn-settings__label { display: none; }
    .btn-settings__icon { display: block; }
  }

  /* ─── SETTINGS ─────────────────────────────────────────────── */
  .settings-panel { background: #0d0d10; border-bottom: 1px solid #1e1e28; padding: 1rem 1.25rem; max-width: 900px; margin: 0 auto; }
  .settings-panel__title { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 0.7rem; letter-spacing: 0.15em; color: #4fc3f7; margin-bottom: 1rem; }
  .settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem; }
  .settings-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 0.75rem; }
  .settings-gf { border-top: 1px solid #1e1e28; padding-top: 0.75rem; margin-bottom: 0.75rem; }
  .lbl { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 0.6rem; letter-spacing: 0.13em; color: #555566; text-transform: uppercase; margin-bottom: 6px; }
  .hint { font-size: 0.57rem; color: #555566; margin-bottom: 6px; }
  .inp { width: 100%; background: #09090b; border: 1px solid #1e1e28; border-radius: 4px; padding: 6px 8px; color: #e8e8f0; font-family: 'Share Tech Mono', monospace; font-size: 0.78rem; }
  .inp-row { display: flex; gap: 6px; }
  .kw-list { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .kw-chip { background: #09090b; border: 1px solid #1e1e28; border-radius: 3px; padding: 2px 8px; font-size: 0.68rem; color: #e8e8f0; display: inline-flex; align-items: center; gap: 5px; }
  .kw-x { background: none; border: none; color: #ff5252; cursor: pointer; font-size: 0.95rem; padding: 0; line-height: 1; }
  .btn-sm { padding: 4px 10px; border: 1px solid #4fc3f7; border-radius: 4px; background: none; color: #4fc3f7; font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 0.7rem; cursor: pointer; white-space: nowrap; }
  .src-list { max-height: 76px; overflow-y: auto; margin-bottom: 6px; }
  .src-row { display: flex; justify-content: space-between; align-items: center; padding: 2px 0; font-size: 0.62rem; color: #888899; }
  .src-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .btn-save { padding: 6px 24px; background: #4fc3f7; border: none; border-radius: 4px; color: #09090b; font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 0.8rem; letter-spacing: 0.1em; cursor: pointer; transition: background 0.2s; }
  .btn-save--ok { background: #00e676; }
  @media (max-width: 600px) {
    .settings-panel { padding: 0.75rem; }
    .settings-two-col { grid-template-columns: 1fr; }
  }

  /* ─── LAYOUT ───────────────────────────────────────────────── */
  .app { display: block; }
  .layout {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: auto auto;
    gap: 10px; padding: 10px;
    max-width: 1400px; margin: 0 auto;
    align-items: start;
  }
  .sec-signal    { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; gap: 10px; }
  .sec-poly      { grid-column: 2; grid-row: 1; }
  .sec-news      { grid-column: 3; grid-row: 1; }
  .sec-portfolio { grid-column: 1 / -1; grid-row: 2; display: flex; gap: 10px; }

  @media (max-width: 960px) {
    .layout { grid-template-columns: 1fr 1fr; }
    .sec-signal { grid-column: 1; grid-row: 1; }
    .sec-poly   { grid-column: 2; grid-row: 1; }
    .sec-news   { grid-column: 1 / -1; grid-row: 2; }
    .sec-portfolio { grid-column: 1 / -1; grid-row: 3; flex-direction: column; }
  }

  @media (max-width: 600px) {
    .layout { grid-template-columns: 1fr; padding: 8px 8px 90px; gap: 8px; }
    .sec-signal, .sec-poly, .sec-news, .sec-portfolio { grid-column: 1; grid-row: auto; }
    /* Tab switching: hide all by default */
    .sec-signal, .sec-poly, .sec-news, .sec-portfolio { display: none !important; }
    .view-signal   .sec-signal    { display: flex !important; flex-direction: column; gap: 8px; }
    .view-intel    .sec-poly,
    .view-intel    .sec-news      { display: flex !important; flex-direction: column; }
    .view-portfolio .sec-portfolio { display: flex !important; flex-direction: column; gap: 8px; }
  }

  /* ─── CARD ──────────────────────────────────────────────────── */
  @media (max-width: 600px) { :global(.card) { padding: 12px 13px; border-radius: 6px; } }

  /* ─── BUY HERO ──────────────────────────────────────────────── */
  .hero-card { border-top: 2px solid #555566; }
  .hero-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .hero-body { text-align: center; padding: 12px 0 16px; }
  .hero-amount { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 3.2rem; line-height: 1; transition: color 0.5s; }
  .hero-currency { font-size: 1.4rem; opacity: 0.7; }
  .hero-loading { font-size: 1.5rem; color: #555566; }
  .hero-sub { font-family: Rajdhani, sans-serif; font-size: 0.58rem; letter-spacing: 0.18em; color: #555566; margin-top: 5px; }
  .hero-ctx {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    justify-content: center; font-size: 0.67rem; color: #888899;
    border-top: 1px solid #1e1e28; padding-top: 10px; margin-top: 4px;
  }
  @media (max-width: 600px) { .hero-amount { font-size: 4.2rem; } }

  /* Signal pills */
  .pills { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; margin-bottom: 10px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 20px; font-family: Rajdhani, sans-serif; font-size: 0.6rem; font-weight: 600; letter-spacing: 0.06em; background: #1e1e28; border: 1px solid #2a2a3a; color: #555566; transition: all 0.2s; }
  .pill--on { background: rgba(0,230,118,0.07); border-color: rgba(0,230,118,0.3); color: #00e676; }
  .pill-dot { font-size: 0.48rem; }
  .pill-boost { opacity: 0.65; }

  /* ─── SHARED ────────────────────────────────────────────────── */
  .dim { font-size: 0.58rem; color: #555566; }
  .sep { color: #333344; }
  .tag { font-size: 0.57rem; color: #555566; border: 1px solid #1e1e28; border-radius: 3px; padding: 1px 6px; font-family: Rajdhani, sans-serif; font-weight: 700; letter-spacing: 0.08em; white-space: nowrap; }
  .tag-link { text-decoration: none; transition: color 0.15s; }
  .tag-link:hover { color: #888899; }
  .num-lg { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 1.3rem; line-height: 1.1; color: #e8e8f0; }
  .num-md { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 1.1rem; line-height: 1.2; }
  .row-between { display: flex; justify-content: space-between; align-items: center; }
  .row-center { display: flex; align-items: center; }
  .gap8 { gap: 8px; }
  .gap10 { gap: 10px; }
  .mb4 { margin-bottom: 4px; }
  .mb8 { margin-bottom: 8px; }
  .mb10 { margin-bottom: 10px; }
  .mb12 { margin-bottom: 12px; }
  .mb14 { margin-bottom: 14px; }
  .mt2 { margin-top: 2px; }
  .mt3 { margin-top: 3px; }
  .ml4 { margin-left: 4px; }
  .err { color: #ff5252; font-size: 0.78rem; padding: 8px 10px; border: 1px solid #ff525233; border-radius: 4px; }
  .arrow { color: #333344; font-size: 1rem; }

  /* ─── BTC ───────────────────────────────────────────────────── */
  .btc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .fees-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.65rem; border-top: 1px solid #1e1e28; border-bottom: 1px solid #1e1e28; padding: 6px 0; margin-bottom: 10px; }
  .fee { display: flex; gap: 3px; align-items: center; }
  .halving { }
  .halving-lbl { font-family: Rajdhani, sans-serif; font-weight: 600; font-size: 0.62rem; color: #888899; letter-spacing: 0.08em; }

  /* ─── STACKING ──────────────────────────────────────────────── */
  .stack-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
  .goal-block { }

  /* ─── POLYMARKET ─────────────────────────────────────────────── */
  .mkt { padding: 9px 0; border-bottom: 1px solid #1a1a22; }
  .mkt:last-child { border-bottom: none; }
  .mkt-meta { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; flex-wrap: wrap; }
  .mkt-tag { font-size: 0.52rem; background: #1e1e28; border: 1px solid #2a2a3a; color: #555566; border-radius: 3px; padding: 1px 5px; font-family: Rajdhani, sans-serif; font-weight: 700; letter-spacing: 0.08em; }
  .mkt-tag--pinned { border-color: #4fc3f733; color: #4fc3f7; }
  .mkt-fire { font-size: 0.55rem; color: #00e676; }
  .mkt-date { font-size: 0.57rem; color: #555566; margin-left: auto; }
  .mkt-body { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 5px; }
  .mkt-q { font-size: 0.72rem; color: #e8e8f0; line-height: 1.35; flex: 1; text-decoration: none; }
  .mkt-q:hover { color: #4fc3f7; }
  .mkt-pct { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 1.15rem; white-space: nowrap; line-height: 1; }
  .mb4 { margin-bottom: 4px; }

  /* ─── NEWS ──────────────────────────────────────────────────── */
  .news-item { border-bottom: 1px solid #1a1a22; padding: 8px 0; }
  .news-item:last-child { border-bottom: none; }
  .news-link { font-size: 0.72rem; color: #e8e8f0; text-decoration: none; line-height: 1.4; display: block; margin-bottom: 3px; }
  .news-link:hover { color: #4fc3f7; }
  .news-meta { display: flex; gap: 8px; align-items: center; }

  /* ─── ASSETS ────────────────────────────────────────────────── */
  .asset-bars { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
  .asset-row { display: grid; grid-template-columns: 70px 1fr 60px; align-items: center; gap: 8px; }
  .asset-name { }
  .asset-track { }
  .asset-pct { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 0.7rem; text-align: right; white-space: nowrap; }
  .cpi-note { font-size: 0.6rem; color: #555566; border-top: 1px solid #1e1e28; padding-top: 8px; }

  /* ─── GHOSTFOLIO ────────────────────────────────────────────── */
  .gf-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
  @media (max-width: 960px) { .gf-grid { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 600px) { .gf-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; } }
  .btn-refresh { padding: 3px 10px; border: 1px solid #2a2a3a; border-radius: 3px; background: none; color: #888899; font-family: Rajdhani, sans-serif; font-size: 0.65rem; cursor: pointer; }
  .roi-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .roi-chip { background: #0d0d10; border: 1px solid #1e1e28; border-radius: 5px; padding: 8px 12px; min-width: 100px; }
  .holdings-section { border-top: 1px solid #1e1e28; padding-top: 10px; }
  .holdings-toggle { background: none; border: none; color: #555566; font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 0.62rem; letter-spacing: 0.12em; cursor: pointer; padding: 0; margin-bottom: 8px; }
  .holdings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
  .h-card { background: #0d0d10; border-radius: 5px; padding: 10px 12px; border: 1px solid #1e1e28; }
  .h-sym { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 0.88rem; color: #e8e8f0; }
  @media (max-width: 600px) { .holdings-grid { grid-template-columns: 1fr 1fr; } }

  /* ─── MOBILE NAV ─────────────────────────────────────────────── */
  .bnav { display: none; }
  @media (max-width: 600px) {
    .bnav {
      display: flex; position: fixed; bottom: 0; left: 0; right: 0; z-index: 200;
      background: rgba(9,9,11,0.97); backdrop-filter: blur(12px);
      border-top: 1px solid #1e1e28;
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }
  .bnav-btn {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 10px 0 8px; gap: 3px; background: none; border: none; cursor: pointer; position: relative;
  }
  .bnav-icon { font-size: 1.1rem; color: #555566; transition: color 0.15s; }
  .bnav-lbl { font-family: Rajdhani, sans-serif; font-weight: 700; font-size: 0.53rem; letter-spacing: 0.13em; color: #555566; transition: color 0.15s; }
  .bnav-btn--active .bnav-icon,
  .bnav-btn--active .bnav-lbl { color: #4fc3f7; }
  .bnav-badge { position: absolute; top: 6px; right: 14%; font-size: 0.44rem; font-family: Rajdhani, sans-serif; font-weight: 700; padding: 1px 4px; border-radius: 8px; color: #09090b; white-space: nowrap; }

  /* ─── FOOTER ─────────────────────────────────────────────────── */
  .footer { border-top: 1px solid #1e1e28; padding: 6px 16px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; font-size: 0.57rem; color: #333344; margin-top: 8px; }
  @media (max-width: 600px) { .footer { display: none; } }

  /* ─── ANIMATIONS ─────────────────────────────────────────────── */
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  .blink { animation: blink 1.5s step-end infinite; }
</style>
