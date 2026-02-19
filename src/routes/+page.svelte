<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadSettings, saveSettings, loadManual, saveManual, calcDCA, DEFAULT_SETTINGS, DEFAULT_MANUAL, type Settings, type ManualSignals } from '$lib/settings';

  let time = '';
  let dateStr = '';
  let settings: Settings = DEFAULT_SETTINGS;
  let manual: ManualSignals = DEFAULT_MANUAL;
  let showManual = false;
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

  let fearGreed: number | null = null;
  let fearGreedLabel = '';
  let difficultyChange: number | null = null;
  let fundingRate: number | null = null;
  let audUsd: number | null = null;
  let dcaUpdated = '';

  let markets: { id: string; question: string; topOutcome: string; probability: number; volume: number; endDate: string }[] = [];
  let newsItems: { title: string; link: string; source: string; pubDate: string }[] = [];

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
  $: liveSignals = { fearGreed, difficultyChange, fundingRate, audUsd };
  $: dca = btcPrice > 0 ? calcDCA(btcPrice, liveSignals, manual) : null;
  $: dcaBuyColor = !dca ? '#888899' : dca.finalAud === 0 ? '#ff5252' : dca.finalAud >= 750 ? '#00e676' : dca.finalAud >= 400 ? '#f7931a' : '#4fc3f7';
  $: priceColor = priceFlash === 'up' ? '#00e676' : priceFlash === 'down' ? '#ff5252' : '#e8e8f0';

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

  function saveAll() {
    saveSettings(settings);
    saveManual(manual);
    saved = true;
    setTimeout(() => saved = false, 2000);
    fetchPoly();
    fetchNews();
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
    manual = loadManual();
    updateStacking();
    tick();
    clockInterval = setInterval(tick, 1000);
    fetchBtc(); fetchDCA(); fetchPoly(); fetchNews();
    intervals = [
      setInterval(fetchBtc, 60000),
      setInterval(fetchDCA, 300000),
      setInterval(fetchPoly, 300000),
      setInterval(fetchNews, 300000),
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
      <div class="card-label">POLYMARKET KEYWORDS</div>
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
  <button on:click={saveAll} style="padding:6px 20px; background:{saved ? '#00e676' : '#4fc3f7'}; border:none; border-radius:4px; color:#09090b; font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.8rem; letter-spacing:0.1em; cursor:pointer;">
    {saved ? 'SAVED' : 'SAVE'}
  </button>
</div>
{/if}

<main style="padding:12px; max-width:1400px; margin:0 auto;">
  <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px;">

    <div style="display:flex; flex-direction:column; gap:12px;">

      <div class="card">
        <div class="card-label">BTC BITCOIN NETWORK</div>
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:14px;">
          <div>
            <div class="card-label" style="margin-bottom:4px;">PRICE</div>
            <div class="val-lg" style="color:{priceColor}; transition:color 0.5s;">${n(btcPrice)}</div>
          </div>
          <div>
            <div class="card-label" style="margin-bottom:4px;">SATS/$</div>
            <div class="val-lg" style="color:#f7931a;">{n(btcSats)}</div>
          </div>
          <div>
            <div class="card-label" style="margin-bottom:4px;">BLOCK</div>
            <div class="val-lg" style="color:#4fc3f7;">{n(btcBlock)}</div>
          </div>
        </div>
        <div style="border-top:1px solid #1e1e28; padding-top:10px;">
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
      </div>

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

      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div class="card-label" style="margin:0;">DCA SIGNAL</div>
          <div style="display:flex; align-items:center; gap:8px;">
            {#if dcaUpdated}<div style="font-size:0.6rem; color:#555566;">{dcaUpdated}</div>{/if}
            <button on:click={() => showManual = !showManual}
              style="padding:2px 8px; border:1px solid {showManual ? '#4fc3f7' : '#1e1e28'}; border-radius:3px; background:none; color:{showManual ? '#4fc3f7' : '#888899'}; font-family:Rajdhani,sans-serif; font-weight:700; font-size:0.65rem; cursor:pointer;">
              {showManual ? 'HIDE' : 'MANUAL DATA'}
            </button>
          </div>
        </div>

        <div style="text-align:center; padding:12px; border:1px solid #1e1e28; border-radius:6px; background:rgba(0,0,0,0.3); margin-bottom:12px;">
          <div class="card-label" style="margin-bottom:4px;">FORTNIGHTLY ACTION</div>
          <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:2rem; line-height:1; color:{dcaBuyColor};">
            {!dca ? '--' : dca.finalAud === 0 ? 'DO NOT BUY' : 'BUY $' + dca.finalAud.toLocaleString() + ' AUD'}
          </div>
          {#if dca && dca.finalAud > 0}
            <div style="font-size:0.65rem; color:#888899; margin-top:4px;">{dca.totalPct.toFixed(0)}% of $1,000 - {dca.conviction}/7 signals</div>
          {/if}
        </div>

        <div style="margin-bottom:12px;">
          <div class="card-label" style="margin-bottom:8px;">SIGNALS</div>
          {#if dca}
            {#each dca.signals as sig}
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; margin-bottom:5px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="color:{sig.active ? '#00e676' : '#555566'}">{sig.active ? '>' : '-'}</span>
                  <span style="color:{sig.active ? '#e8e8f0' : '#555566'}">{sig.name}</span>
                </div>
                <div style="display:flex; gap:12px;">
                  <span style="color:#888899">{sig.value}</span>
                  <span style="color:{sig.active ? '#00e676' : '#555566'}">+{sig.boost}%</span>
                </div>
              </div>
            {/each}
          {/if}
        </div>

        {#if dca}
          <div style="border-top:1px solid #1e1e28; padding-top:10px; margin-bottom:12px;">
            <div class="card-label" style="margin-bottom:6px;">CALCULATION</div>
            <div style="font-size:0.7rem; font-family:monospace;">
              <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="color:#888899">BTC</span><span>${n(btcPrice)} / ${n(dca.btcAud, 0)} AUD</span></div>
              <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="color:#888899">AUD/USD</span><span>{(1/dca.audUsd).toFixed(4)}</span></div>
              <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="color:#888899">Base</span><span style="color:#f7931a">{dca.base.toFixed(0)}%{dca.usingFallback ? ' (taper)' : ''}</span></div>
              {#each dca.signals.filter(s => s.active) as sig}
                <div style="display:flex; justify-content:space-between; margin-bottom:3px;"><span style="color:#888899">+ {sig.name}</span><span style="color:#00e676">+{sig.boost}%</span></div>
              {/each}
              <div style="display:flex; justify-content:space-between; border-top:1px solid #1e1e28; padding-top:4px; margin-top:4px;"><span style="color:#888899">Total</span><span style="color:{dcaBuyColor}">{dca.totalPct.toFixed(0)}% - ${dca.finalAud} AUD</span></div>
            </div>
          </div>
        {/if}

        <div style="border-top:1px solid #1e1e28; padding-top:10px; margin-bottom:{showManual ? '12px' : '0'};">
          <div class="card-label" style="margin-bottom:8px;">LIVE DATA</div>
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; font-size:0.7rem;">
            <div>
              <div style="color:#555566; margin-bottom:2px;">Fear and Greed</div>
              <div class="val-lg" style="color:{fgColor(fearGreed)};">{fearGreed ?? '--'}</div>
              <div style="font-size:0.6rem; color:#555566;">{fearGreedLabel || '--'}</div>
            </div>
            <div>
              <div style="color:#555566; margin-bottom:2px;">Difficulty</div>
              <div class="val-lg" style="color:{difficultyChange !== null && difficultyChange < -7 ? '#ff5252' : '#888899'};">{difficultyChange !== null ? difficultyChange.toFixed(1) + '%' : '--'}</div>
            </div>
            <div>
              <div style="color:#555566; margin-bottom:2px;">Funding (8h)</div>
              <div class="val-lg" style="color:{fundingRate !== null && fundingRate < -0.05 ? '#00e676' : '#888899'};">{fundingRate !== null ? fundingRate.toFixed(3) + '%' : '--'}</div>
            </div>
          </div>
        </div>

        {#if showManual}
          <div style="border-top:1px solid #1e1e28; padding-top:10px;">
            <div class="card-label" style="margin-bottom:8px;">MANUAL DATA - Glassnode / LookIntoBitcoin</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
              <div>
                <div style="font-size:0.65rem; color:#888899; margin-bottom:4px;">MVRV</div>
                <input type="number" step="0.01" placeholder="e.g. 1.85" bind:value={manual.mvrv} on:change={() => saveManual(manual)}
                  style="width:100%; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:4px 8px; color:#e8e8f0; font-family:monospace; font-size:0.75rem;" />
              </div>
              <div>
                <div style="font-size:0.65rem; color:#888899; margin-bottom:4px;">NUPL</div>
                <input type="number" step="0.01" placeholder="e.g. 0.42" bind:value={manual.nupl} on:change={() => saveManual(manual)}
                  style="width:100%; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:4px 8px; color:#e8e8f0; font-family:monospace; font-size:0.75rem;" />
              </div>
            </div>
            <div>
              <div style="font-size:0.65rem; color:#888899; margin-bottom:6px;">LTH NET POSITION</div>
              <div style="display:flex; align-items:center; gap:12px;">
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.75rem;">
                  <input type="checkbox" bind:checked={manual.lthAccumulating} on:change={() => saveManual(manual)} style="accent-color:#00e676;" />
                  Accumulating
                </label>
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-size:0.65rem; color:#888899;">Days:</span>
                  <input type="number" min="0" placeholder="e.g. 9" bind:value={manual.lthDays} on:change={() => saveManual(manual)}
                    style="width:60px; background:#09090b; border:1px solid #1e1e28; border-radius:4px; padding:4px 6px; color:#e8e8f0; font-family:monospace; font-size:0.75rem;" />
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>

    </div>

    <div>
      <div class="card" style="height:100%;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div class="card-label" style="margin:0;">POLYMARKET: GEOPOLITICS</div>
          <div class="card-label" style="margin:0; color:#888899;">PREDICTION MARKETS</div>
        </div>
        {#if markets.length === 0}
          <div style="color:#888899; font-size:0.8rem;">No markets found. Add keywords in Settings.</div>
        {:else}
          {#each markets as m}
            <div style="padding:8px 0; border-bottom:1px solid #1e1e28;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:4px;">
                <div style="font-size:0.75rem; color:#e8e8f0; line-height:1.35; flex:1;">{m.question}</div>
                <div style="font-family:Rajdhani,sans-serif; font-weight:700; font-size:1rem; color:{pColor(m.probability)}; white-space:nowrap;">{m.probability}%</div>
              </div>
              <div class="pbar"><div class="pfill" style="width:{m.probability}%; background:{pColor(m.probability)};"></div></div>
              <div style="display:flex; justify-content:space-between; margin-top:4px;">
                <div style="font-size:0.65rem; color:#888899;">{m.topOutcome}</div>
                <div style="display:flex; gap:10px;">
                  {#if m.endDate}<div style="font-size:0.65rem; color:#888899;">{fmtDate(m.endDate)}</div>{/if}
                  <div style="font-size:0.65rem; color:#555566;">{fmtVol(m.volume)}</div>
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>

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
</main>

<footer style="border-top:1px solid #1e1e28; padding:6px 16px; display:flex; justify-content:space-between; font-size:0.6rem; color:#555566; margin-top:12px;">
  <div><span style="color:#00e676">*</span> SITUATION MONITOR v1.1</div>
  <div>BTC - DCA SIGNAL - POLYMARKET - NEWS</div>
</footer>
