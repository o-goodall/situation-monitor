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

  let btcPrice = 0;
  let btcSats = 0;
  let btcBlock = 0;
  let btcFees = { low: 0, medium: 0, high: 0 };
  let prevPrice = 0;
  let priceFlash = '';

  // Halving
  let halvingBlocksLeft = 0;
  let halvingDays = 0;
  let halvingDate = '';
  let halvingProgress = 0;

  // Markets (gold, S&P500, CPI) — fetched from /api/markets
  let goldPriceUsd: number | null = null;
  let goldYtdPct: number | null = null;
  let sp500Price: number | null = null;
  let sp500YtdPct: number | null = null;
  let cpiAnnual: number | null = null;

  // SAT converter — derived from existing btcPrice + audUsd, no extra API
  let satInput = '100';
  let satInputMode: 'aud' | 'sats' = 'aud';

  let fearGreed: number | null = null;
  let fearGreedLabel = '';
  let difficultyChange: number | null = null;
  let fundingRate: number | null = null;
  let audUsd: number | null = null;
  let mvrv: number | null = null;
  let nupl: number | null = null;
  let nvt: number | null = null;
  let cmDate = '';
  let dcaUpdated = '';

  let markets: { id: string; question: string; topOutcome: string; probability: number; volume: number; volume24hr: number; endDate: string; tag: string; url: string; pinned: boolean }[] = [];
  let newsItems: { title: string; link: string; source: string; pubDate: string }[] = [];

  // Ghostfolio
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
  $: liveSignals = { fearGreed, difficultyChange, fundingRate, audUsd, mvrv, nupl, nvt } as LiveSignals;
  $: dca = btcPrice > 0 ? calcDCA(btcPrice, liveSignals) : null;
  $: dcaBuyColor = !dca ? '#888899' : dca.finalAud === 0 ? '#ff5252' : dca.finalAud >= 750 ? '#00e676' : dca.finalAud >= 400 ? '#f7931a' : '#4fc3f7';
  $: priceColor = priceFlash === 'up' ? '#00e676' : priceFlash === 'down' ? '#ff5252' : '#e8e8f0';
  $: mvrvColor = mvrv === null ? '#888899' : mvrv < 1 ? '#00e676' : mvrv < 2 ? '#4fc3f7' : mvrv < 3 ? '#f7931a' : '#ff5252';
  $: nuplColor = nupl === null ? '#888899' : nupl < 0 ? '#00e676' : nupl < 0.25 ? '#4fc3f7' : nupl < 0.5 ? '#f7931a' : '#ff5252';
  $: nvtColor = nvt === null ? '#888899' : nvt <= 40 ? '#00e676' : nvt <= 65 ? '#888899' : '#ff5252';

  // SAT converter: derive from existing BTC price + AUD/USD rate
  $: btcAud = (btcPrice > 0 && audUsd !== null) ? btcPrice * audUsd : null;
  $: satsPerAud = btcAud !== null && btcAud > 0 ? (1e8 / btcAud) : null;
  $: satConverterOutput = (() => {
    const val = parseFloat(satInput);
    if (isNaN(val) || val <= 0 || satsPerAud === null || btcAud === null) return null;
    if (satInputMode === 'aud') {
      const sats = val * satsPerAud;
      return { sats: Math.round(sats), aud: val };
    } else {
      const aud = val / satsPerAud;
      return { sats: Math.round(val), aud };
    }
  })();

  // Inflation-adjusted net worth (using CPI annual rate and DCA start date)
  $: inflationAdjustedNetWorth = (() => {
    if (gfNetWorth === null || cpiAnnual === null) return null;
    const startDate = new Date(settings.dca.startDate);
    const yearsElapsed = (Date.now() - startDate.getTime()) / (365.25 * 24 * 3600 * 1000);
    const cumulativeInflation = Math.pow(1 + cpiAnnual / 100, yearsElapsed);
    return gfNetWorth / cumulativeInflation;
  })();

  // Ghostfolio portfolio vs other assets (annualised returns)
  $: portfolioAnnualisedPct = (() => {
    if (gfNetGainPct === null) return null;
    const startDate = new Date(settings.dca.startDate);
    const yearsElapsed = Math.max(0.1, (Date.now() - startDate.getTime()) / (365.25 * 24 * 3600 * 1000));
    // CAGR: (1 + totalReturn)^(1/years) - 1
    return (Math.pow(1 + gfNetGainPct / 100, 1 / yearsElapsed) - 1) * 100;
  })();

  function tick() {
    const now = new Date();
    time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dateStr = now.toISOString().split('T')[0];
  }

  async function fetchBtc() {
    try {
      const res = await fetch('/api/bitcoin');
      const d = await res.json();
      prevPrice = btcPrice;
      btcPrice = d.price ?? 0;
      btcSats = d.satsPerDollar ?? 0;
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
      const res = await fetch('/api/dca');
      const d = await res.json();
      fearGreed = d.fearGreed;
      fearGreedLabel = d.fearGreedLabel;
      difficultyChange = d.difficultyChange;
      fundingRate = d.fundingRate;
      audUsd = d.audUsd;
      mvrv = d.mvrv;
      nupl = d.nupl;
      nvt = d.nvt;
      cmDate = d.cmDate ?? '';
      const now = new Date();
      dcaUpdated = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    } catch {}
  }

  async function fetchPoly() {
    try {
      const kw = encodeURIComponent(JSON.stringify(settings.polymarket.keywords));
      const res = await fetch(`/api/polymarket?keywords=${kw}`);
      const d = await res.json();
      markets = d.markets ?? [];
    } catch {}
  }

  async function fetchNews() {
    try {
      const src = encodeURIComponent(JSON.stringify(settings.news.sources));
      const res = await fetch(`/api/news?sources=${src}`);
      const d = await res.json();
      newsItems = d.items ?? [];
    } catch {}
  }

  async function fetchMarkets() {
    try {
      const res = await fetch('/api/markets');
      const d = await res.json();
      goldPriceUsd = d.gold?.priceUsd ?? null;
      goldYtdPct = d.gold?.ytdPct ?? null;
      sp500Price = d.sp500?.price ?? null;
      sp500YtdPct = d.sp500?.ytdPct ?? null;
      cpiAnnual = d.cpiAnnual ?? null;
    } catch {}
  }

  async function fetchGhostfolio() {
    const token = settings.ghostfolio?.token?.trim();
    if (!token) return;
    gfLoading = true;
    gfError = '';
    try {
      const res = await fetch(`/api/ghostfolio?token=${encodeURIComponent(token)}`);
      const d = await res.json();
      if (d.error) { gfError = d.error; }
      else {
        gfNetWorth = d.netWorth;
        gfTotalInvested = d.totalInvested;
        gfNetGain = d.netGain;
        gfNetGainPct = d.netGainPct;
        gfNetGainYtdPct = d.netGainYtdPct;
        gfTodayChangePct = d.todayChangePct;
        gfHoldings = d.holdings ?? [];
        gfUpdated = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {
      gfError = 'Connection failed';
    } finally {
      gfLoading = false;
    }
  }

  function saveAll() {
    saveSettings(settings);
    saved = true;
    setTimeout(() => saved = false, 2000);
    fetchPoly();
    fetchNews();
    if (settings.ghostfolio?.token) fetchGhostfolio();
  }

  function addKeyword() {
    if (!newKeyword.trim()) return;
    settings.polymarket.keywords = [...settings.polymarket.keywords, newKeyword.trim()];
    newKeyword = '';
  }
  function removeKeyword(i: number) {
    settings.polymarket.keywords = settings.polymarket.keywords.filter((_, idx) => idx !== i);
  }
  function addSource() {
    if (!newSource.trim()) return;
    settings.news.sources = [...settings.news.sources, newSource.trim()];
    newSource = '';
  }
  function removeSource(i: number) {
    settings.news.sources = settings.news.sources.filter((_, idx) => idx !== i);
  }

  function fmtVol(v: number) {
    if (v >= 1e6) return `$${(v/1e6).toFixed(1)}m`;
    if (v >= 1e3) return `$${(v/1e3).toFixed(0)}k`;
    return `$${v}`;
  }
  function fmtDate(d: string) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
  }
  function pColor(p: number) { return p >= 70 ? '#00e676' : p >= 40 ? '#f7931a' : '#ff5252'; }
  function fgColor(fg: number | null) {
    return fg === null ? '#888899' : fg <= 20 ? '#ff5252' : fg <= 40 ? '#f7931a' : fg >= 60 ? '#00e676' : '#888899';
  }
  function timeAgo(d: string) {
    if (!d) return '';
    try {
      const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
      if (m < 60) return `${m}m`;
      const h = Math.floor(m/60);
      if (h < 24) return `${h}h`;
      return `${Math.floor(h/24)}d`;
    } catch { return ''; }
  }
  function n(v: number, decimals = 0) {
    return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  onMount(() => {
    settings = loadSettings();
    updateStacking();
    tick();
    clockInterval = setInterval(tick, 1000);
    fetchBtc(); fetchDCA(); fetchPoly(); fetchNews(); fetchMarkets();
    if (settings.ghostfolio?.token) fetchGhostfolio();
    intervals = [
      setInterval(fetchBtc, 60000),
      setInterval(fetchDCA, 300000),
      setInterval(fetchPoly, 300000),
      setInterval(fetchNews, 300000),
      setInterval(fetchMarkets, 300000),
      setInterval(() => { if (settings.ghostfolio?.token) fetchGhostfolio(); }, 300000),
    ];
  });

  onDestroy(() => {
    clearInterval(clockInterval);
    intervals.forEach(clearInterval);
  });
</script>

<header style="border-bottom:1px solid #1e1e28; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; background:#09090b; z-index:100;">
  <div style="display:flex; align-items:center; gap:10px;">
    <span style="font-size:1.4rem">🌐</span>
    <div>
      <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.1rem; letter-spacing:0.15em; color:#e8e8f0;">SITUATION MONITOR</div>
      <div style="font-size:0.65rem; color:#555566;"><span class="blink" style="color:#00e676">▮</span> LIVE · AUTO-REFRESH</div>
    </div>
  </div>
  <div style="display:flex; align-items:center; gap:12px;">
    <div style="text-align:right;">
      <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.5rem; color:#4fc3f7; line-height:1;">{time}</div>
      <div style="font-size:0.65rem; color:#555566;">{dateStr} UTC</div>
    </div>
    <button on:click={() => showSettings = !showSettings}
      style="padding:5px 12px; border:1px solid {showSettings ? '#4fc3f7' : '#1e1e28'}; border-radius:4px; background:none; color:{showSettings ? '#4fc3f7' : '#888899'}; font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.7rem; letter-spacing:0.1em; cursor:pointer;">
      SETTINGS
    </button>
  </div>
</header>

{#if showSettings}
<div style="background:#111116; border-bottom:1px solid #1e1e28; padding:1rem 1.25rem; max-width:900px; margin:0 auto;">
  <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.7rem; letter-spacing:0.15em; color:#4fc3f7; margin-bottom:1rem;">SETTINGS</div>
  <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:1rem; margin-bottom:1rem;">
    <div>
      <div class="card-label">DCA START DATE</div>
      <input type="date" bind:value={settings.dca.startDate} style="width:100%; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:6px 8px; color:#e8e8f0; font-family:monospace; font-size:0.8rem;" />
    </div>
    <div>
      <div class="card-label">DAILY AMOUNT ($AUD)</div>
      <input type="number" bind:value={settings.dca.dailyAmount} style="width:100%; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:6px 8px; color:#e8e8f0; font-family:monospace; font-size:0.8rem;" />
    </div>
    <div>
      <div class="card-label">BTC HELD</div>
      <input type="number" step="0.00000001" bind:value={settings.dca.btcHeld} style="width:100%; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:6px 8px; color:#e8e8f0; font-family:monospace; font-size:0.8rem;" />
    </div>
    <div>
      <div class="card-label">GOAL (BTC)</div>
      <input type="number" step="0.001" bind:value={settings.dca.goalBtc} style="width:100%; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:6px 8px; color:#e8e8f0; font-family:monospace; font-size:0.8rem;" />
    </div>
  </div>
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:0.75rem;">
    <div>
      <div class="card-label">PINNED WATCHLIST (keywords)</div>
      <div style="font-size:0.6rem; color:#555566; margin-bottom:6px;">Added on top of auto-trending geopolitics/politics/economy feed</div>
      <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px;">
        {#each settings.polymarket.keywords as kw, i}
          <span style="background:#09090b; border:1px solid #1e1e28; border-radius:3px; padding:2px 8px; font-size:0.7rem; color:#e8e8f0; display:flex; align-items:center; gap:6px;">
            {kw} <button on:click={() => removeKeyword(i)} style="background:none; border:none; color:#ff5252; cursor:pointer; font-size:0.65rem; padding:0;">x</button>
          </span>
        {/each}
      </div>
      <div style="display:flex; gap:6px;">
        <input bind:value={newKeyword} on:keydown={(e) => e.key==='Enter' && addKeyword()} placeholder="Add keyword..." style="flex:1; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:4px 8px; color:#e8e8f0; font-family:monospace; font-size:0.75rem;" />
        <button on:click={addKeyword} style="padding:4px 10px; border:1px solid #4fc3f7; border-radius:4px; background:none; color:#4fc3f7; font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.7rem; cursor:pointer;">ADD</button>
      </div>
    </div>
    <div>
      <div class="card-label">NEWS RSS FEEDS</div>
      <div style="max-height:80px; overflow-y:auto; margin-bottom:6px;">
        {#each settings.news.sources as src, i}
          <div style="display:flex; justify-content:space-between; align-items:center; padding:2px 0; font-size:0.65rem; color:#888899;">
            <span style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{src}</span>
            <button on:click={() => removeSource(i)} style="background:none; border:none; color:#ff5252; cursor:pointer; font-size:0.65rem; padding:0 4px;">x</button>
          </div>
        {/each}
      </div>
      <div style="display:flex; gap:6px;">
        <input type="url" bind:value={newSource} on:keydown={(e) => e.key==='Enter' && addSource()} placeholder="https://..." style="flex:1; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:4px 8px; color:#e8e8f0; font-family:monospace; font-size:0.75rem;" />
        <button on:click={addSource} style="padding:4px 10px; border:1px solid #4fc3f7; border-radius:4px; background:none; color:#4fc3f7; font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.7rem; cursor:pointer;">ADD</button>
      </div>
    </div>
  </div>
  <!-- Ghostfolio -->
  <div style="border-top:1px solid #1e1e28; padding-top:0.75rem; margin-bottom:0.75rem;">
    <div class="card-label" style="color:#a78bfa; margin-bottom:6px;">GHOSTFOLIO NET WORTH</div>
    <div style="display:grid; grid-template-columns:1fr auto; gap:8px; align-items:end;">
      <div>
        <div class="card-label" style="margin-bottom:4px;">SECURITY TOKEN (from ghostfol.io → My Ghostfolio)</div>
        <input type="password" bind:value={settings.ghostfolio.token} placeholder="your-security-token"
          style="width:100%; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:6px 8px; color:#e8e8f0; font-family:monospace; font-size:0.8rem;" />
      </div>
      <div>
        <div class="card-label" style="margin-bottom:4px;">CURRENCY</div>
        <input bind:value={settings.ghostfolio.currency} placeholder="AUD"
          style="width:80px; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:6px 8px; color:#e8e8f0; font-family:monospace; font-size:0.8rem;" />
      </div>
    </div>
    <div style="font-size:0.6rem; color:#555566; margin-top:4px;">Token stays in your browser only. Calls go server-side to ghostfol.io — never exposed to any third party.</div>
  </div>
  <button on:click={saveAll} style="padding:6px 20px; background:{saved ? '#00e676' : '#4fc3f7'}; border:none; border-radius:4px; color:#09090b; font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.8rem; letter-spacing:0.1em; cursor:pointer;">
    {saved ? 'SAVED' : 'SAVE'}
  </button>
</div>
{/if}

<main style="padding:12px; max-width:1400px; margin:0 auto;">
  <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px;">

    <div style="display:flex; flex-direction:column; gap:12px;">

      <!-- BITCOIN -->
      <div class="card">
        <div class="card-label">BTC BITCOIN NETWORK</div>
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:14px;">
          <div>
            <div class="card-label" style="margin-bottom:4px;">PRICE</div>
            <div class="val-lg" style="color:{priceColor}; transition:color 0.5s;">${n(btcPrice)}</div>
            {#if btcAud !== null}<div style="font-size:0.65rem; color:#888899;">A${n(btcAud, 0)}</div>{/if}
          </div>
          <div>
            <div class="card-label" style="margin-bottom:4px;">SATS/$</div>
            <div class="val-lg" style="color:#f7931a;">{n(btcSats)}</div>
            {#if satsPerAud !== null}<div style="font-size:0.65rem; color:#888899;">{satsPerAud.toFixed(0)} sat/A$</div>{/if}
          </div>
          <div>
            <div class="card-label" style="margin-bottom:4px;">BLOCK</div>
            <div class="val-lg" style="color:#4fc3f7;">{n(btcBlock)}</div>
          </div>
        </div>

        <!-- MEMPOOL FEES -->
        <div style="border-top:1px solid #1e1e28; padding-top:10px; margin-bottom:12px;">
          <div class="card-label" style="margin-bottom:8px;">MEMPOOL FEES (SAT/VB)</div>
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px;">
            {#each [['LOW', btcFees.low, '#00e676'], ['MED', btcFees.medium, '#f7931a'], ['HIGH', btcFees.high, '#ff5252']] as [label, val, color]}
              <div style="text-align:center;">
                <div class="val-lg" style="color:{color};">{val}</div>
                <div class="card-label">{label}</div>
              </div>
            {/each}
          </div>
        </div>

        <!-- HALVING COUNTDOWN -->
        {#if halvingBlocksLeft > 0}
        <div style="border-top:1px solid #1e1e28; padding-top:10px; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div class="card-label" style="margin:0; color:#f7931a;">⚡ HALVING COUNTDOWN</div>
            <div style="font-size:0.65rem; color:#888899;">Epoch 4 → 5</div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
            <div>
              <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.3rem; color:#f7931a; line-height:1;">{halvingDays.toLocaleString()}</div>
              <div style="font-size:0.6rem; color:#555566;">DAYS (~{halvingDate})</div>
            </div>
            <div>
              <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.3rem; color:#888899; line-height:1;">{halvingBlocksLeft.toLocaleString()}</div>
              <div style="font-size:0.6rem; color:#555566;">BLOCKS TO #1,050,000</div>
            </div>
          </div>
          <div>
            <div style="display:flex; justify-content:space-between; font-size:0.6rem; color:#555566; margin-bottom:3px;">
              <span>Epoch 4 progress</span><span>{halvingProgress.toFixed(1)}%</span>
            </div>
            <div class="pbar">
              <div class="pfill" style="width:{halvingProgress}%; background:linear-gradient(90deg,#f7931a,#ffd700);"></div>
            </div>
            <div style="font-size:0.6rem; color:#555566; margin-top:3px;">3.125 BTC/block → 1.5625 after halving</div>
          </div>
        </div>
        {/if}

        <!-- SAT CONVERTER -->
        <div style="border-top:1px solid #1e1e28; padding-top:10px;">
          <div class="card-label" style="margin-bottom:8px;">SAT CONVERTER</div>
          <div style="display:flex; gap:6px; margin-bottom:8px;">
            <button on:click={() => satInputMode = 'aud'}
              style="flex:1; padding:4px; border:1px solid {satInputMode==='aud' ? '#f7931a' : '#1e1e28'}; border-radius:3px; background:none; color:{satInputMode==='aud' ? '#f7931a' : '#555566'}; font-family:Rajdhani,sans-serif; font-size:0.7rem; cursor:pointer;">A$ → SATS</button>
            <button on:click={() => satInputMode = 'sats'}
              style="flex:1; padding:4px; border:1px solid {satInputMode==='sats' ? '#f7931a' : '#1e1e28'}; border-radius:3px; background:none; color:{satInputMode==='sats' ? '#f7931a' : '#555566'}; font-family:Rajdhani,sans-serif; font-size:0.7rem; cursor:pointer;">SATS → A$</button>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <input type="number" bind:value={satInput} min="0"
              style="flex:1; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:6px 8px; color:#f7931a; font-family:monospace; font-size:0.9rem; min-width:0;" />
            <span style="font-size:0.7rem; color:#555566;">{satInputMode === 'aud' ? 'AUD' : 'sats'}</span>
          </div>
          {#if satConverterOutput !== null}
            <div style="margin-top:8px; padding:8px; background:#111116; border-radius:4px; font-family:monospace; font-size:0.8rem;">
              {#if satInputMode === 'aud'}
                <div style="color:#e8e8f0;">= <span style="color:#f7931a; font-size:1rem;">{satConverterOutput.sats.toLocaleString()}</span> sats</div>
                <div style="color:#555566; font-size:0.65rem; margin-top:2px;">≈ {(satConverterOutput.sats / 1e8).toFixed(8)} BTC</div>
              {:else}
                <div style="color:#e8e8f0;">= <span style="color:#00e676; font-size:1rem;">A${satConverterOutput.aud.toFixed(4)}</span></div>
                <div style="color:#555566; font-size:0.65rem; margin-top:2px;">≈ {(satConverterOutput.sats / 1e8).toFixed(8)} BTC</div>
              {/if}
            </div>
          {:else if satsPerAud === null}
            <div style="margin-top:6px; font-size:0.65rem; color:#555566;">Waiting for price data...</div>
          {/if}
        </div>
      </div>

      <!-- STACKING -->
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div class="card-label" style="margin:0;">STACKING GOALS</div>
          <div class="card-label" style="margin:0; color:#00e676;">${settings.dca.dailyAmount}/DAY - {dcaDays} DAYS</div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
          <div>
            <div class="card-label" style="margin-bottom:4px;">INVESTED</div>
            <div class="val-lg">${n(invested)}</div>
          </div>
          <div>
            <div class="card-label" style="margin-bottom:4px;">CURRENT VALUE</div>
            <div class="val-lg" style="color:{perf >= 0 ? '#00e676' : '#ff5252'};">{btcPrice > 0 ? '$' + n(currentVal) : '--'}</div>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
          <div>
            <div class="card-label" style="margin-bottom:4px;">BTC STACKED</div>
            <div style="color:#f7931a; font-size:0.85rem;">{settings.dca.btcHeld.toFixed(8)} BTC</div>
            <div style="font-size:0.65rem; color:#888899; margin-top:2px;">{n(satsHeld)} sats</div>
          </div>
          <div style="text-align:right;">
            <div class="card-label" style="margin-bottom:4px;">PERFORMANCE</div>
            <div class="val-lg" style="color:{perf >= 0 ? '#00e676' : '#ff5252'};">{btcPrice > 0 ? (perf >= 0 ? '+' : '') + perf.toFixed(2) + '%' : '--'}</div>
          </div>
        </div>
        <div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <div class="card-label" style="margin:0;">GOAL: {settings.dca.goalBtc} BTC</div>
            <div class="card-label" style="margin:0; color:#00e676;">{goalPct.toFixed(2)}%</div>
          </div>
          <div class="pbar"><div class="pfill" style="width:{goalPct}%; background:linear-gradient(90deg,#f7931a,#00e676);"></div></div>
          <div style="font-size:0.65rem; color:#888899; text-align:right; margin-top:2px;">{n(satsLeft)} sats to go</div>
        </div>
      </div>

      <!-- MARKETS: GOLD / S&P500 / CPI -->
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div class="card-label" style="margin:0;">ASSET COMPARISON</div>
          <div style="font-size:0.6rem; color:#555566;">1Y RETURN · yahoo finance</div>
        </div>

        <!-- BTC vs Gold vs S&P500 row -->
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:14px;">
          <!-- BTC -->
          <div style="background:#111116; border-radius:5px; padding:8px; text-align:center;">
            <div class="card-label" style="margin-bottom:4px; color:#f7931a;">₿ BTC</div>
            <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1rem; color:#f7931a;">${n(btcPrice)}</div>
            <div style="font-size:0.6rem; color:#555566; margin-top:2px;">USD · live</div>
          </div>
          <!-- GOLD -->
          <div style="background:#111116; border-radius:5px; padding:8px; text-align:center;">
            <div class="card-label" style="margin-bottom:4px; color:#ffd700;">◈ GOLD</div>
            <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1rem; color:#ffd700;">
              {goldPriceUsd !== null ? '$' + n(goldPriceUsd, 0) : '--'}
            </div>
            <div style="font-size:0.6rem; color:#555566; margin-top:2px;">USD/oz</div>
          </div>
          <!-- S&P 500 -->
          <div style="background:#111116; border-radius:5px; padding:8px; text-align:center;">
            <div class="card-label" style="margin-bottom:4px; color:#4fc3f7;">▲ S&P500</div>
            <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1rem; color:#4fc3f7;">
              {sp500Price !== null ? n(sp500Price, 0) : '--'}
            </div>
            <div style="font-size:0.6rem; color:#555566; margin-top:2px;">index</div>
          </div>
        </div>

        <!-- YTD performance comparison bars -->
        <div style="margin-bottom:12px;">
          <div class="card-label" style="margin-bottom:8px;">1Y PERFORMANCE</div>
          {#each [
            { label: 'BTC', pct: (() => { if (!btcPrice || !audUsd) return null; return null; })(), color: '#f7931a', note: 'from bitcoin API' },
            { label: 'GOLD', pct: goldYtdPct, color: '#ffd700', note: '' },
            { label: 'S&P', pct: sp500YtdPct, color: '#4fc3f7', note: '' },
            { label: 'CPI', pct: cpiAnnual, color: '#ff5252', note: 'inflation' },
          ] as row}
            <div style="margin-bottom:6px;">
              <div style="display:flex; justify-content:space-between; font-size:0.65rem; margin-bottom:2px;">
                <span style="color:{row.color};">{row.label}</span>
                <span style="color:{row.pct === null ? '#555566' : row.pct >= 0 ? '#00e676' : '#ff5252'};">
                  {row.pct !== null ? (row.pct >= 0 ? '+' : '') + row.pct.toFixed(1) + '%' : '--'}
                  {#if row.note}<span style="color:#555566; margin-left:4px;">{row.note}</span>{/if}
                </span>
              </div>
              {#if row.pct !== null}
                {@const barPct = Math.min(100, Math.max(0, (row.pct / 150) * 100 + 50))}
                <div class="pbar"><div class="pfill" style="width:{barPct}%; background:{row.color}; opacity:0.7;"></div></div>
              {:else}
                <div class="pbar"><div style="height:100%; background:#1e1e28;"></div></div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- CPI Purchasing Power Context -->
        {#if cpiAnnual !== null}
          <div style="border-top:1px solid #1e1e28; padding-top:10px;">
            <div class="card-label" style="margin-bottom:6px;">PURCHASING POWER EROSION</div>
            {@const years = Math.max(0.1, (Date.now() - new Date(settings.dca.startDate).getTime()) / (365.25 * 24 * 3600 * 1000))}
            {@const cumulativeLoss = (1 - 1 / Math.pow(1 + cpiAnnual / 100, years)) * 100}
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <div>
                <div style="font-size:0.65rem; color:#555566; margin-bottom:2px;">CPI Annual</div>
                <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.9rem; color:#ff5252;">{cpiAnnual.toFixed(1)}%</div>
              </div>
              <div>
                <div style="font-size:0.65rem; color:#555566; margin-bottom:2px;">Since DCA start</div>
                <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.9rem; color:#ff5252;">-{cumulativeLoss.toFixed(1)}%</div>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- DCA SIGNAL -->
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div class="card-label" style="margin:0;">DCA SIGNAL</div>
          <div style="font-size:0.6rem; color:#555566;">{dcaUpdated ? 'updated ' + dcaUpdated : 'loading...'}</div>
        </div>

        <!-- Buy recommendation -->
        <div style="text-align:center; padding:12px; border:1px solid #1e1e28; border-radius:6px; background:rgba(0,0,0,0.3); margin-bottom:12px;">
          <div class="card-label" style="margin-bottom:4px;">FORTNIGHTLY ACTION</div>
          <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:2rem; line-height:1; color:{dcaBuyColor};">
            {!dca ? 'LOADING...' : dca.finalAud === 0 ? 'DO NOT BUY' : 'BUY $' + dca.finalAud.toLocaleString() + ' AUD'}
          </div>
          {#if dca && dca.finalAud > 0}
            <div style="font-size:0.65rem; color:#888899; margin-top:4px;">{dca.totalPct.toFixed(0)}% of $1,000 · {dca.conviction}/7 signals active</div>
          {/if}
        </div>

        <!-- Signals -->
        <div style="margin-bottom:12px;">
          <div class="card-label" style="margin-bottom:8px;">SIGNALS</div>
          {#if dca}
            {#each dca.signals as sig}
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; margin-bottom:5px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="color:{sig.active ? '#00e676' : '#333344'}; font-size:0.8rem;">{sig.active ? '▮' : '▯'}</span>
                  <span style="color:{sig.active ? '#e8e8f0' : '#555566'}">{sig.name}</span>
                </div>
                <div style="display:flex; gap:12px; align-items:center;">
                  <span style="color:{sig.active ? '#888899' : '#333344'}; font-size:0.65rem;">{sig.value}</span>
                  <span style="color:{sig.active ? '#00e676' : '#333344'}; min-width:32px; text-align:right;">+{sig.boost}%</span>
                </div>
              </div>
            {/each}
          {:else}
            <div style="color:#555566; font-size:0.75rem;">Fetching signals...</div>
          {/if}
        </div>

        <!-- Calculation breakdown -->
        {#if dca}
          <div style="border-top:1px solid #1e1e28; padding-top:10px; margin-bottom:12px;">
            <div class="card-label" style="margin-bottom:6px;">CALCULATION</div>
            <div style="font-size:0.7rem; font-family:monospace;">
              <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="color:#555566">BTC/AUD</span><span>${n(dca.btcAud, 0)}</span></div>
              <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="color:#555566">AUD/USD</span><span>{(1/dca.audUsd).toFixed(4)}</span></div>
              <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="color:#555566">MVRV</span><span style="color:{mvrvColor}">{mvrv !== null ? mvrv.toFixed(3) : '--'}{dca.usingFallback ? ' (price proxy)' : ''}</span></div>
              <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="color:#555566">Base</span><span style="color:#f7931a">{dca.base.toFixed(0)}%</span></div>
              {#each dca.signals.filter(s => s.active) as sig}
                <div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="color:#555566">+ {sig.name}</span><span style="color:#00e676">+{sig.boost}%</span></div>
              {/each}
              <div style="display:flex; justify-content:space-between; border-top:1px solid #1e1e28; padding-top:4px; margin-top:4px;"><span style="color:#555566">Total</span><span style="color:{dcaBuyColor}">{dca.totalPct.toFixed(0)}% → ${dca.finalAud} AUD</span></div>
            </div>
          </div>
        {/if}

        <!-- Live data grid - all automated -->
        <div style="border-top:1px solid #1e1e28; padding-top:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div class="card-label" style="margin:0;">LIVE ON-CHAIN DATA</div>
            {#if cmDate}<div style="font-size:0.6rem; color:#555566;">as of {cmDate}</div>{/if}
          </div>
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; font-size:0.7rem; margin-bottom:8px;">
            <div>
              <div style="color:#555566; margin-bottom:2px;">Fear/Greed</div>
              <div class="val-lg" style="color:{fgColor(fearGreed)};">{fearGreed ?? '--'}</div>
              <div style="font-size:0.6rem; color:#555566;">{fearGreedLabel || '--'}</div>
            </div>
            <div>
              <div style="color:#555566; margin-bottom:2px;">MVRV</div>
              <div class="val-lg" style="color:{mvrvColor};">{mvrv !== null ? mvrv.toFixed(2) : '--'}</div>
              <div style="font-size:0.6rem; color:#555566;">{mvrv !== null ? (mvrv < 1 ? 'undervalued' : mvrv < 2 ? 'fair' : mvrv < 3 ? 'elevated' : 'overvalued') : '--'}</div>
            </div>
            <div>
              <div style="color:#555566; margin-bottom:2px;">NUPL</div>
              <div class="val-lg" style="color:{nuplColor};">{nupl !== null ? nupl.toFixed(3) : '--'}</div>
              <div style="font-size:0.6rem; color:#555566;">{nupl !== null ? (nupl < 0 ? 'capitulation' : nupl < 0.25 ? 'hope' : nupl < 0.5 ? 'optimism' : 'euphoria') : '--'}</div>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; font-size:0.7rem;">
            <div>
              <div style="color:#555566; margin-bottom:2px;">NVT</div>
              <div class="val-lg" style="color:{nvtColor};">{nvt !== null ? nvt.toFixed(0) : '--'}</div>
              <div style="font-size:0.6rem; color:#555566;">{nvt !== null ? (nvt <= 40 ? 'undervalued' : nvt <= 65 ? 'neutral' : 'overvalued') : '--'}</div>
            </div>
            <div>
              <div style="color:#555566; margin-bottom:2px;">Difficulty</div>
              <div class="val-lg" style="color:{difficultyChange !== null && difficultyChange < -7 ? '#ff5252' : '#888899'};">{difficultyChange !== null ? difficultyChange.toFixed(1) + '%' : '--'}</div>
            </div>
            <div>
              <div style="color:#555566; margin-bottom:2px;">Funding</div>
              <div class="val-lg" style="color:{fundingRate !== null && fundingRate < -0.05 ? '#00e676' : '#888899'};">{fundingRate !== null ? fundingRate.toFixed(3) + '%' : '--'}</div>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- COL 2: POLYMARKET -->
    <div>
      <div class="card" style="height:100%;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <div class="card-label" style="margin:0; color:#e8e8f0;">GEOPOLITICAL INTEL</div>
            <div style="font-size:0.6rem; color:#555566; margin-top:2px;">polymarket · sorted by 24hr vol</div>
          </div>
          <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer"
            style="font-size:0.6rem; color:#555566; text-decoration:none; border:1px solid #1e1e28; padding:2px 7px; border-radius:3px;">polymarket ↗</a>
        </div>
        {#if markets.length === 0}
          <div style="color:#555566; font-size:0.75rem; padding:8px 0;">
            Fetching trending markets...<br>
            <span style="font-size:0.65rem;">Shows top geopolitics/politics/economy events by 24hr trading volume.</span>
          </div>
        {:else}
          {#each markets as m}
            <div style="padding:8px 0; border-bottom:1px solid #1e1e28;">
              <!-- Header row: tag badge + 24hr vol -->
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <div style="display:flex; align-items:center; gap:5px;">
                  {#if m.pinned}
                    <span style="font-size:0.55rem; background:#1e1e28; border:1px solid #4fc3f7; color:#4fc3f7; border-radius:3px; padding:1px 5px;">📌 PINNED</span>
                  {:else}
                    <span style="font-size:0.55rem; background:#1e1e28; border:1px solid #2a2a3a; color:#555566; border-radius:3px; padding:1px 5px;">{m.tag.toUpperCase()}</span>
                  {/if}
                  {#if m.volume24hr > 1000}
                    <span style="font-size:0.55rem; color:#00e676;">🔥 {fmtVol(m.volume24hr)} today</span>
                  {/if}
                </div>
                {#if m.endDate}
                  <span style="font-size:0.6rem; color:#555566;">{fmtDate(m.endDate)}</span>
                {/if}
              </div>
              <!-- Question + probability -->
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:5px;">
                <a href="{m.url}" target="_blank" rel="noopener noreferrer"
                  style="font-size:0.75rem; color:#e8e8f0; line-height:1.35; flex:1; text-decoration:none;">
                  {m.question}
                </a>
                <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.1rem; color:{pColor(m.probability)}; white-space:nowrap; line-height:1;">
                  {m.probability}%
                </div>
              </div>
              <!-- Probability bar -->
              <div class="pbar" style="margin-bottom:4px;">
                <div class="pfill" style="width:{m.probability}%; background:{pColor(m.probability)};"></div>
              </div>
              <!-- Bottom: outcome label + total vol -->
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="font-size:0.65rem; color:{pColor(m.probability)};">{m.topOutcome}</div>
                <div style="font-size:0.6rem; color:#333344;">{fmtVol(m.volume)} total</div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- COL 3: NEWS -->
    <div>
      <div class="card" style="height:100%;">
        <div class="card-label">NEWS FEED</div>
        {#if newsItems.length === 0}
          <div style="color:#888899; font-size:0.8rem;">Fetching feeds...</div>
        {:else}
          {#each newsItems as item}
            <div class="news-item">
              <a href={item.link} target="_blank" rel="noopener noreferrer"
                style="font-size:0.75rem; color:#e8e8f0; text-decoration:none; line-height:1.4; display:block; margin-bottom:3px;">
                {item.title}
              </a>
              <div style="display:flex; gap:8px; align-items:center;">
                <span style="font-size:0.65rem; color:#f7931a;">{item.source}</span>
                <span style="font-size:0.65rem; color:#555566;">{timeAgo(item.pubDate)} ago</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>

  </div>

  <!-- GHOSTFOLIO NET WORTH - full width row -->
  {#if settings.ghostfolio?.token}
  <div style="margin-top:12px;">
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="card-label" style="margin:0; color:#a78bfa;">NET WORTH</div>
          <div style="font-size:0.6rem; color:#555566; border:1px solid #2a2a3a; border-radius:3px; padding:1px 6px;">ghostfolio</div>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          {#if gfLoading}<div style="font-size:0.65rem; color:#555566;">fetching...</div>{/if}
          {#if gfUpdated && !gfLoading}<div style="font-size:0.6rem; color:#555566;">updated {gfUpdated}</div>{/if}
          <button on:click={fetchGhostfolio} style="padding:3px 10px; border:1px solid #2a2a3a; border-radius:3px; background:none; color:#888899; font-family:Rajdhani,sans-serif; font-size:0.65rem; cursor:pointer;">↻ REFRESH</button>
        </div>
      </div>

      {#if gfError}
        <div style="color:#ff5252; font-size:0.8rem; padding:8px; border:1px solid #ff525244; border-radius:4px;">
          ⚠ {gfError}. Check your security token in Settings.
        </div>
      {:else}
        <!-- Summary row -->
        <div style="display:grid; grid-template-columns:repeat(6,1fr); gap:12px; margin-bottom:16px;">
          <div>
            <div class="card-label" style="margin-bottom:4px;">NET WORTH</div>
            <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.4rem; color:#a78bfa; line-height:1;">
              {gfNetWorth !== null ? '$' + n(gfNetWorth, 0) : '--'}
            </div>
            <div style="font-size:0.6rem; color:#555566;">{settings.ghostfolio.currency || 'AUD'} nominal</div>
          </div>
          <div>
            <div class="card-label" style="margin-bottom:4px;">REAL VALUE</div>
            <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.4rem; color:{inflationAdjustedNetWorth === null ? '#888899' : '#a78bfa'}; line-height:1; opacity:0.75;">
              {inflationAdjustedNetWorth !== null ? '$' + n(inflationAdjustedNetWorth, 0) : gfNetWorth !== null ? '$' + n(gfNetWorth, 0) : '--'}
            </div>
            <div style="font-size:0.6rem; color:#555566;">{cpiAnnual !== null ? 'CPI-adjusted' : 'no CPI data'}</div>
          </div>
          <div>
            <div class="card-label" style="margin-bottom:4px;">TODAY</div>
            <div class="val-lg" style="color:{gfTodayChangePct === null ? '#888899' : gfTodayChangePct >= 0 ? '#00e676' : '#ff5252'};">
              {gfTodayChangePct !== null ? (gfTodayChangePct >= 0 ? '+' : '') + gfTodayChangePct.toFixed(2) + '%' : '--'}
            </div>
          </div>
          <div>
            <div class="card-label" style="margin-bottom:4px;">YTD</div>
            <div class="val-lg" style="color:{gfNetGainYtdPct === null ? '#888899' : gfNetGainYtdPct >= 0 ? '#00e676' : '#ff5252'};">
              {gfNetGainYtdPct !== null ? (gfNetGainYtdPct >= 0 ? '+' : '') + gfNetGainYtdPct.toFixed(2) + '%' : '--'}
            </div>
          </div>
          <div>
            <div class="card-label" style="margin-bottom:4px;">ALL-TIME</div>
            <div class="val-lg" style="color:{gfNetGainPct === null ? '#888899' : gfNetGainPct >= 0 ? '#00e676' : '#ff5252'};">
              {gfNetGainPct !== null ? (gfNetGainPct >= 0 ? '+' : '') + gfNetGainPct.toFixed(2) + '%' : '--'}
            </div>
          </div>
          <div>
            <div class="card-label" style="margin-bottom:4px;">INVESTED</div>
            <div class="val-lg">{gfTotalInvested !== null ? '$' + n(gfTotalInvested, 0) : '--'}</div>
          </div>
        </div>

        <!-- Real ROI vs inflation + other assets -->
        {#if gfNetGainPct !== null || cpiAnnual !== null}
          <div style="border-top:1px solid #1e1e28; padding-top:12px; margin-bottom:14px;">
            <div class="card-label" style="margin-bottom:10px;">REAL ROI · PORTFOLIO vs ALTERNATIVES (annualised CAGR from DCA start)</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:8px;">
              <!-- Portfolio CAGR -->
              {#if portfolioAnnualisedPct !== null}
                <div style="background:#111116; border-radius:5px; padding:10px 12px; border:1px solid #2a2a3a;">
                  <div style="font-size:0.65rem; color:#a78bfa; margin-bottom:4px;">MY PORTFOLIO</div>
                  <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.2rem; color:{portfolioAnnualisedPct >= 0 ? '#00e676' : '#ff5252'};">
                    {portfolioAnnualisedPct >= 0 ? '+' : ''}{portfolioAnnualisedPct.toFixed(1)}%/yr
                  </div>
                  <div style="font-size:0.6rem; color:#555566;">CAGR since {settings.dca.startDate.slice(0,7)}</div>
                </div>
              {/if}
              <!-- CPI (inflation) -->
              {#if cpiAnnual !== null}
                <div style="background:#111116; border-radius:5px; padding:10px 12px; border:1px solid #2a2a3a;">
                  <div style="font-size:0.65rem; color:#ff5252; margin-bottom:4px;">CPI INFLATION</div>
                  <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.2rem; color:#ff5252;">
                    +{cpiAnnual.toFixed(1)}%/yr
                  </div>
                  <div style="font-size:0.6rem; color:#555566; margin-top:2px;">
                    {#if portfolioAnnualisedPct !== null}
                      {#if portfolioAnnualisedPct > cpiAnnual}
                        <span style="color:#00e676;">+{(portfolioAnnualisedPct - cpiAnnual).toFixed(1)}% real return ✓</span>
                      {:else}
                        <span style="color:#ff5252;">-{(cpiAnnual - portfolioAnnualisedPct).toFixed(1)}% below inflation ✗</span>
                      {/if}
                    {:else}
                      purchasing power loss
                    {/if}
                  </div>
                </div>
              {/if}
              <!-- Gold YTD -->
              {#if goldYtdPct !== null}
                <div style="background:#111116; border-radius:5px; padding:10px 12px; border:1px solid #2a2a3a;">
                  <div style="font-size:0.65rem; color:#ffd700; margin-bottom:4px;">◈ GOLD (1Y)</div>
                  <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.2rem; color:{goldYtdPct >= 0 ? '#ffd700' : '#ff5252'};">
                    {goldYtdPct >= 0 ? '+' : ''}{goldYtdPct.toFixed(1)}%
                  </div>
                  <div style="font-size:0.6rem; color:#555566;">${n(goldPriceUsd ?? 0, 0)} USD/oz</div>
                </div>
              {/if}
              <!-- S&P 500 YTD -->
              {#if sp500YtdPct !== null}
                <div style="background:#111116; border-radius:5px; padding:10px 12px; border:1px solid #2a2a3a;">
                  <div style="font-size:0.65rem; color:#4fc3f7; margin-bottom:4px;">▲ S&P 500 (1Y)</div>
                  <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.2rem; color:{sp500YtdPct >= 0 ? '#4fc3f7' : '#ff5252'};">
                    {sp500YtdPct >= 0 ? '+' : ''}{sp500YtdPct.toFixed(1)}%
                  </div>
                  <div style="font-size:0.6rem; color:#555566;">{n(sp500Price ?? 0, 0)} index</div>
                </div>
              {/if}
              <!-- Inflation-adjusted net worth diff -->
              {#if inflationAdjustedNetWorth !== null && gfNetWorth !== null}
                <div style="background:#111116; border-radius:5px; padding:10px 12px; border:1px solid #2a2a3a;">
                  <div style="font-size:0.65rem; color:#888899; margin-bottom:4px;">PURCHASING POWER LOST</div>
                  <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1.2rem; color:#ff5252;">
                    -${n(gfNetWorth - inflationAdjustedNetWorth, 0)}
                  </div>
                  <div style="font-size:0.6rem; color:#555566;">to CPI since DCA start</div>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Holdings breakdown -->
        {#if gfHoldings.length > 0}
          <div style="border-top:1px solid #1e1e28; padding-top:12px;">
            <div class="card-label" style="margin-bottom:8px;">HOLDINGS BREAKDOWN</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:8px;">
              {#each gfHoldings as h}
                {@const perfColor = h.netPerformancePercentWithCurrencyEffect >= 0 ? '#00e676' : '#ff5252'}
                {@const barWidth = Math.min(100, h.allocationInPercentage)}
                <div style="background:#111116; border-radius:6px; padding:10px 12px;">
                  <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px;">
                    <div>
                      <span style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.9rem; color:#e8e8f0;">{h.symbol}</span>
                      <span style="font-size:0.65rem; color:#555566; margin-left:6px;">{h.name !== h.symbol ? h.name.slice(0, 24) : ''}</span>
                    </div>
                    <span style="color:{perfColor}; font-size:0.75rem; font-family:monospace;">
                      {h.netPerformancePercentWithCurrencyEffect >= 0 ? '+' : ''}{h.netPerformancePercentWithCurrencyEffect.toFixed(1)}%
                    </span>
                  </div>
                  <div class="pbar" style="margin-bottom:5px;"><div class="pfill" style="width:{barWidth}%; background:#a78bfa;"></div></div>
                  <div style="display:flex; justify-content:space-between;">
                    <span style="font-size:0.7rem; color:#888899;">{h.allocationInPercentage.toFixed(1)}% allocation</span>
                    <span style="font-size:0.7rem; color:#e8e8f0;">${n(h.valueInBaseCurrency, 0)}</span>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {:else if !gfLoading && !gfError && gfNetWorth !== null}
          <div style="border-top:1px solid #1e1e28; padding-top:10px; color:#555566; font-size:0.75rem;">Holdings data unavailable</div>
        {/if}
      {/if}
    </div>
  </div>
  {/if}

</main>

<footer style="border-top:1px solid #1e1e28; padding:6px 16px; display:flex; justify-content:space-between; font-size:0.6rem; color:#555566; margin-top:12px;">
  <div><span style="color:#00e676">▮</span> SITUATION MONITOR v1.4</div>
  <div>Data: mempool.space · alternative.me · coinmetrics · binance · open.er-api · ghostfol.io · yahoo finance · worldbank</div>
</footer>

<style>
  @media (max-width: 900px) {
    main div[style*="grid-template-columns:repeat(3"] {
      grid-template-columns: 1fr !important;
    }
  }
</style>
