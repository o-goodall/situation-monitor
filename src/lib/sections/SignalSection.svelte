<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    settings, btcPrice, priceFlash, priceHistory, btcFees,
    halvingDays, halvingDate, halvingProgress,
    dcaUpdated, dca, accentColor, priceColor, btcAud, satsPerAud,
    goldPriceUsd, cpiAnnual, btcDisplayPrice, btcHashrate, latestBlock, mempoolStats
  } from '$lib/store';
  import Sparkline from '$lib/Sparkline.svelte';
  import PriceChart from '$lib/PriceChart.svelte';
  import PersonalGreeting from '$lib/PersonalGreeting.svelte';
  import { getStoredSettings } from '$lib/personalization';

  $: displayCur = ($settings.displayCurrency ?? 'AUD').toUpperCase();
  let personalizationEnabled = typeof window !== 'undefined' ? getStoredSettings().enabled : false;

  let btcChartRange: '1D' | '1W' | '1Y' | '5Y' | 'MAX' = '1D';
  let btcChartData: { t: number; p: number }[] = [];
  let btcChartLoading = false;
  let btcDayOpenPrice = 0;

  async function fetchBtcChart(r = btcChartRange) {
    btcChartLoading = true;
    try {
      const map: Record<string,string> = { '1D':'1d', '1W':'7d', '1Y':'1y', '5Y':'5y', 'MAX':'max' };
      const d = await fetch(`/api/bitcoin/history?range=${map[r]}`).then(res => res.json());
      btcChartData = d.prices ?? [];
      if (r === '1D' && btcChartData.length > 0) btcDayOpenPrice = btcChartData[0].p;
    } catch { btcChartData = []; }
    finally { btcChartLoading = false; }
  }

  $: btcDayChangePct = btcDayOpenPrice > 0 && $btcPrice > 0
    ? (($btcPrice - btcDayOpenPrice) / btcDayOpenPrice) * 100
    : null;

  let _lastChartPrice = 0;
  $: if ($btcPrice > 0 && btcChartData.length > 0 && btcChartRange === '1D') {
    const changePct = _lastChartPrice > 0 ? Math.abs($btcPrice - _lastChartPrice) / _lastChartPrice : 1;
    if (changePct >= 0.0005) {
      _lastChartPrice = $btcPrice;
      btcChartData = [...btcChartData.slice(0, -1), { t: Date.now(), p: $btcPrice }];
    }
  }

  let hashrateChartRange: '3M' | '6M' | '1Y' | '2Y' | 'All' = '1Y';
  let hashrateData: { t: number; p: number }[] = [];
  let hashrateLoading = false;

  async function fetchHashrateChart(r = hashrateChartRange) {
    hashrateLoading = true;
    try {
      const map: Record<string,'3m'|'6m'|'1y'|'2y'|'all'> = { '3M':'3m', '6M':'6m', '1Y':'1y', '2Y':'2y', 'All':'all' };
      const d = await fetch(`/api/bitcoin/hashrate?range=${map[r]}`).then(res => res.json());
      hashrateData = d.hashrates ?? [];
    } catch { hashrateData = []; }
    finally { hashrateLoading = false; }
  }

  async function setHashrateChartRange(r: '3M' | '6M' | '1Y' | '2Y' | 'All') {
    hashrateChartRange = r;
    await fetchHashrateChart(r);
  }

  function computeMA(data: { t: number; p: number }[], window: number): { t: number; p: number }[] {
    const result: { t: number; p: number }[] = [];
    for (let i = window - 1; i < data.length; i++) {
      const slice = data.slice(i - window + 1, i + 1);
      const avg = slice.reduce((s, d) => s + d.p, 0) / slice.length;
      result.push({ t: data[i].t, p: parseFloat(avg.toFixed(2)) });
    }
    return result;
  }

  $: hashrateMA7  = hashrateData.length >= 7  ? computeMA(hashrateData, 7)  : [];
  $: hashrateMA30 = hashrateData.length >= 30 ? computeMA(hashrateData, 30) : [];

  let btcGoldPctChange: number | null = null;
  let btcGoldStartRatio: number | null = null;
  let btcGoldRangeLoading = false;

  // Bitcoin in Gold all-time high: 40.33 oz, hit 17 Dec 2024
  const BTC_GOLD_ATH = 40.33;
  const BTC_GOLD_ATH_DATE = '17 Dec 2024';

  async function fetchBtcGoldRange() {
    btcGoldRangeLoading = true;
    try {
      const d = await fetch(`/api/bitcoin/gold?range=1y`).then(res => res.json());
      btcGoldPctChange = d.pctChange ?? null;
      btcGoldStartRatio = d.startRatio ?? null;
    } catch { btcGoldPctChange = null; btcGoldStartRatio = null; }
    finally { btcGoldRangeLoading = false; }
  }

  $: btcInGoldOz = ($btcPrice > 0 && $goldPriceUsd !== null && $goldPriceUsd > 0)
    ? parseFloat(($btcPrice / $goldPriceUsd).toFixed(2))
    : null;

  const n   = (v:number, dec=0) => v.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  const fmtBytes = (b:number) => b>=1e6?`${(b/1e6).toFixed(2)} MB`:b>=1e3?`${(b/1e3).toFixed(0)} KB`:`${b} B`;
  const fmtSats  = (s:number) => s>=1e8?`${(s/1e8).toFixed(3)} BTC`:s>=1e6?`${(s/1e6).toFixed(1)}M sats`:s>=1e3?`${(s/1e3).toFixed(0)}K sats`:`${s} sats`;
  const blockAge = (ts:number) => {const m=Math.floor((Date.now()/1000-ts)/60);return m<1?'just now':m<60?`${m}m ago`:`${Math.floor(m/60)}h ${m%60}m ago`;};

  $: low   = $settings.dca.lowPrice;
  $: high  = $settings.dca.highPrice;
  $: range = high - low;
  $: third = range / 3;
  $: dcaZoneGif = $btcPrice <= 0 ? '' : $btcPrice <= (low+third) ? '/dca-red.gif' : $btcPrice <= (low+2*third) ? '/dca-amber.gif' : '/dca-green.gif';

  $: s        = $settings.dca;
  $: freqLabel = ({daily:'day',weekly:'week',fortnightly:'fortnight',monthly:'month'} as Record<string,string>)[s.dcaFrequency??'fortnightly']??'fortnight';
  $: freqDesc  = ({daily:'daily buy',weekly:'weekly buy',fortnightly:'fortnightly buy',monthly:'monthly buy'} as Record<string,string>)[s.dcaFrequency??'fortnightly']??'fortnightly buy';

  let dcaSecretClicks = 0;
  let dcaSecretMode = false;
  let dcaSecretTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
  function handleDcaTileClick() {
    dcaSecretClicks++;
    clearTimeout(dcaSecretTimeout);
    if (dcaSecretClicks >= 3) {
      dcaSecretMode = !dcaSecretMode;
      dcaSecretClicks = 0;
    } else {
      dcaSecretTimeout = setTimeout(() => { dcaSecretClicks = 0; }, 800);
    }
  }

  onMount(() => {
    fetchBtcChart();
    fetchHashrateChart();
    fetchBtcGoldRange();
    personalizationEnabled = getStoredSettings().enabled;
  });
</script>

<section id="signal" class="section" aria-label="Signal">
  {#if personalizationEnabled}
    <div class="pg-container">
      <PersonalGreeting />
    </div>
  {/if}
  <div class="section-header">
    <h2 class="sect-title">Signal</h2>
  </div>

  <!-- KEY METRICS STRIP — combined BTC price + sats + halving -->
  <div class="stat-strip">

    <!-- BTC Price — USD and user currency side by side -->
    <div class="stat-tile stat-tile--chart stat-tile--wide">
      <span class="tile-header">Bitcoin Price</span>
      {#if $priceHistory.length >= 2}
        <div class="tile-spark" aria-hidden="true"><Sparkline prices={$priceHistory} height={52} opacity={0.28} /></div>
      {/if}
      <div class="price-pair" aria-live="polite" aria-atomic="true">
        <span class="price-usd" style="color:{$priceColor};transition:color .5s;">{$btcPrice>0?'$'+n($btcPrice):'—'}</span>
        {#if $btcDisplayPrice !== null && displayCur !== 'USD'}
          <span class="price-sep">|</span>
          <span class="price-alt" style="color:{$priceColor};transition:color .5s;">${n($btcDisplayPrice,0)}</span>
        {/if}
      </div>
      <div class="stat-l-row">
        <span class="stat-l">
          <span class="price-label-usd">USD</span>
          {#if $btcDisplayPrice !== null && displayCur !== 'USD'}
            <span class="price-label-sep"> · </span><span class="price-label-cur">{displayCur}</span>
          {/if}
        </span>
        {#if btcDayChangePct !== null}
          <span class="price-day-change" class:price-day-change--up={btcDayChangePct >= 0} class:price-day-change--dn={btcDayChangePct < 0}>
            {btcDayChangePct >= 0 ? '↑' : '↓'} {btcDayChangePct >= 0 ? '+' : ''}{btcDayChangePct.toFixed(2)}%
          </span>
        {/if}
      </div>
    </div>

    <!-- BTC in Gold + ATH row -->
    <div class="stat-tile stat-tile--static stat-tile--btc-gold" data-tooltip="Bitcoin priced in gold (troy ounces)">
      <span class="tile-header">Bitcoin in Gold</span>
      <!-- 1 ₿ header with foil glimmer -->
      <div class="btc-gold-badge-row">
        <span class="btc-gold-badge-btc btc-glimmer">1 ₿</span>
      </div>
      <!-- Label -->
      <span class="btc-gold-label">Price in Gold (oz)</span>
      <!-- Current price - primary display -->
      <div class="btc-gold-strip-hero" aria-live="polite" aria-atomic="true">
        {#if btcInGoldOz !== null}
          <span class="btc-gold-strip-n">{btcInGoldOz.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span class="btc-gold-strip-unit">oz</span>
        {:else}
          <span class="btc-gold-strip-n muted">—</span>
        {/if}
      </div>
      <!-- Year ago + % change, then ATH row -->
      {#if btcGoldRangeLoading}
        <span class="btc-gold-strip-spot muted">…</span>
      {:else}
        <div class="btc-gold-history">
          {#if btcGoldStartRatio !== null && btcGoldPctChange !== null}
            <div class="btc-gold-hist-row">
              <span class="btc-gold-hist-label">1yr ago</span>
              <span class="btc-gold-hist-val">{n(btcGoldStartRatio, 2)} oz</span>
            </div>
            <div class="btc-gold-hist-row">
              <span class="btc-gold-hist-label">change</span>
              <span class="btc-gold-hist-pct" style="color:{btcGoldPctChange >= 0 ? 'var(--up)' : 'var(--dn)'}">{btcGoldPctChange >= 0 ? '+' : ''}{btcGoldPctChange.toFixed(1)}%</span>
            </div>
          {/if}
          <!-- ATH row -->
          {#if btcInGoldOz !== null && btcInGoldOz >= BTC_GOLD_ATH}
            <div class="btc-gold-hist-row btc-gold-ath-row">
              <span class="btc-gold-hist-label btc-gold-ath-new">★ NEW ATH</span>
              <span class="btc-gold-hist-pct" style="color:var(--up);">+{((btcInGoldOz / BTC_GOLD_ATH - 1) * 100).toFixed(1)}%</span>
            </div>
            <div class="btc-gold-hist-row">
              <span class="btc-gold-hist-label">prev ATH</span>
              <span class="btc-gold-hist-val">{BTC_GOLD_ATH} oz</span>
            </div>
          {:else}
            <div class="btc-gold-hist-row btc-gold-ath-row">
              <span class="btc-gold-hist-label">ATH</span>
              <span class="btc-gold-hist-val">{BTC_GOLD_ATH} oz</span>
            </div>
            {#if btcInGoldOz !== null}
              <div class="btc-gold-hist-row">
                <span class="btc-gold-hist-label">▼ from ATH</span>
                <span class="btc-gold-hist-pct" style="color:var(--dn);">{(((btcInGoldOz / BTC_GOLD_ATH) - 1) * 100).toFixed(1)}%</span>
              </div>
              <div class="btc-gold-hist-row btc-gold-ath-date">
                <span class="btc-gold-hist-label">{BTC_GOLD_ATH_DATE}</span>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Halving countdown + sats per currency combined -->
    <div class="stat-tile halving-tile stat-tile--static" data-tooltip="Estimated blocks remaining until next Bitcoin halving · Satoshis per {displayCur}">
      <span class="tile-header">Halving | SATS</span>
      {#if $halvingDays > 0}
        <div class="price-pair" aria-live="polite" aria-atomic="true">
          <span class="stat-n halving-n">{$halvingDays.toLocaleString()}</span>
          {#if $halvingProgress > 0}
            <span class="price-sep">|</span>
            <span class="price-alt">{$halvingProgress.toFixed(1)}%</span>
          {/if}
        </div>
        <span class="stat-l">Days to Halving</span>
        {#if $halvingDate}<span class="halving-date halving-date--glow">{$halvingDate}</span>{/if}
      {:else}
        <span class="stat-n muted">—</span>
        <span class="stat-l">Days to Halving</span>
      {/if}
      <div class="halving-sats-divider"></div>
      <div class="sats-display">
        <span class="sats-cur">{$satsPerAud !== null ? $satsPerAud.toLocaleString() : '—'}</span>
      </div>
      <span class="stat-l"><span class="sats-label-sats">SATS</span> · <span class="sats-label-cur">{displayCur}</span></span>
    </div>
  </div>

  <!-- SIGNAL + NETWORK + STACK GRID -->
  <div class="signal-grid">

    <!-- DCA SIGNAL CARD — simplified -->
    <div class="gc"
      class:signal-card={dcaSecretMode}
      class:signal-zone--red={dcaSecretMode && dcaZoneGif.includes('red')}
      class:signal-zone--amber={dcaSecretMode && dcaZoneGif.includes('amber')}
      class:signal-zone--green={dcaSecretMode && dcaZoneGif.includes('green')}
      style="--ac:{$accentColor};"
      on:click={handleDcaTileClick}
    >

      <!-- Zone background GIF — behind frosted glass (secret mode only) -->
      {#if dcaSecretMode && dcaZoneGif}
        {#key dcaZoneGif}
          <div class="zone-bg">
            <img src={dcaZoneGif} alt="" class="zone-bg-img" loading="lazy" />
          </div>
        {/key}
      {/if}
      <!-- Full-tile zone colour tint (secret mode only) -->
      {#if dcaSecretMode && dcaZoneGif}
        <div class="zone-tint" class:zone-tint--red={dcaZoneGif.includes('red')} class:zone-tint--amber={dcaZoneGif.includes('amber')} class:zone-tint--green={dcaZoneGif.includes('green')}></div>
      {/if}
      {#if dcaSecretMode}
        <div class="zone-glass"></div>
      {/if}

      <!-- Flip container -->
      <div class="dca-face">
            <div class="gc-head">
              <div>
                <p class="gc-title">DCA Signal</p>
              </div>
              <span class="ts">{$dcaUpdated||'—'}</span>
            </div>

            <div class="dca-hero" aria-live="polite" aria-atomic="true">
              {#if !$dca}
                <span class="dca-n muted">—</span>
              {:else if $dca.finalAud===0}
                <span class="dca-n" style="color:var(--dn);text-shadow:0 0 60px rgba(239,68,68,.3);">PASS</span>
                <p class="dca-sub">Price too high — skip this {freqLabel}</p>
              {:else}
                <span class="dca-n" style="color:{$accentColor};text-shadow:0 0 70px {$accentColor}30;">${$dca.finalAud.toLocaleString()}</span>
                <p class="dca-sub">AUD · {freqDesc}</p>
              {/if}
            </div>

            <!-- Price zone bar -->
            {#if $btcPrice>0}
            <div class="vband">
              <div class="vband-row">
                <span class="vband-l up">Low Zone</span>
                <span class="vband-l" style="color:var(--orange);">Mid Zone</span>
                <span class="vband-l dn">High Zone</span>
              </div>
              <div class="vband-track">
                <div class="vband-zones">
                  <div class="vzone vzone--low"></div>
                  <div class="vzone vzone--mid"></div>
                  <div class="vzone vzone--high"></div>
                </div>
                {#if $btcPrice<=low}
                  <div class="vband-dot" style="left:2%;"></div>
                {:else if $btcPrice>=high}
                  <div class="vband-dot" style="left:98%;"></div>
                {:else}
                  <div class="vband-dot" style="left:{(($btcPrice-low)/range)*100}%;"></div>
                {/if}
              </div>
              <div class="vband-labels">
                <span>${(low/1000).toFixed(0)}K</span><span>${((low+high)/2/1000).toFixed(0)}K</span><span>${(high/1000).toFixed(0)}K</span>
              </div>
            </div>
            {/if}

            <!-- Signal conditions — compact -->
            {#if $dca}
            <div class="sigs">
              {#each $dca.signals as sig}
                <div class="sig" class:sig--on={sig.active} title={sig.description}>
                  <div class="pip-wrap">
                    <div class="pip" class:pip--on={sig.active}></div>
                    {#if sig.active}<div class="pip-ring"></div>{/if}
                  </div>
                  <div class="sig-body">
                    <span class="sig-label">{sig.name}</span>
                    {#if sig.value && sig.value !== 'Inactive'}
                      <span class="sig-val">{sig.value}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
            {/if}

          </div>
    </div>

    <!-- BITCOIN NETWORK — expanded with mempool data -->
    <div class="gc btc-network-card">
      <div class="gc-head">
        <p class="gc-title">Bitcoin Network</p>
        <a href="https://mempool.space" target="_blank" rel="noopener noreferrer" class="btn-ghost" aria-label="Open mempool.space in new tab">mempool ↗</a>
      </div>

      <!-- Latest Block -->
      {#if $latestBlock}
      <div class="latest-block">
        <div class="lb-header">
          <span class="eyebrow orange">Latest Block</span>
          <span class="ts">{blockAge($latestBlock.timestamp)}</span>
        </div>
        <div class="lb-grid">
          <div class="lb-item">
            <span class="lb-label">Block</span>
            <span class="lb-val">{n($latestBlock.height)}</span>
          </div>
          <div class="lb-item">
            <span class="lb-label">Mined by</span>
            <span class="lb-val lb-miner">{$latestBlock.miner}</span>
          </div>
          <div class="lb-item">
            <span class="lb-label">Transactions</span>
            <span class="lb-val">{n($latestBlock.txCount)}</span>
          </div>
          <div class="lb-item">
            <span class="lb-label">Size</span>
            <span class="lb-val">{fmtBytes($latestBlock.size)}</span>
          </div>
          {#if $latestBlock.totalFees}
          <div class="lb-item">
            <span class="lb-label">Total Fees</span>
            <span class="lb-val">{fmtSats($latestBlock.totalFees)}</span>
          </div>
          {/if}
          {#if $latestBlock.medianFee}
          <div class="lb-item">
            <span class="lb-label">Median Fee</span>
            <span class="lb-val">{$latestBlock.medianFee}<span class="met-u"> sat/vB</span></span>
          </div>
          {/if}
        </div>
      </div>
      {/if}

      <!-- Mempool Status -->
      {#if $mempoolStats}
      <div class="mempool-bar">
        <div class="lb-header">
          <span class="eyebrow">Mempool</span>
          <span class="ts">{n($mempoolStats.count)} unconfirmed</span>
        </div>
        <div class="mp-stats">
          <div class="lb-item">
            <span class="lb-label">Pending TXs</span>
            <span class="lb-val">{n($mempoolStats.count)}</span>
          </div>
          <div class="lb-item">
            <span class="lb-label">Size</span>
            <span class="lb-val">{fmtBytes($mempoolStats.vsize)}</span>
          </div>
          <div class="lb-item">
            <span class="lb-label">Total Fees</span>
            <span class="lb-val">{fmtSats($mempoolStats.totalFee)}</span>
          </div>
        </div>
      </div>
      {/if}

      <!-- Fees -->
      <div class="met3" style="margin-top:14px;">
        <div class="met"><p class="eyebrow">Fee · Low</p><p class="met-n up">{$btcFees.low||'—'}<span class="met-u">sat/vB</span></p></div>
        <div class="met"><p class="eyebrow">Fee · Med</p><p class="met-n">{$btcFees.medium||'—'}<span class="met-u">sat/vB</span></p></div>
        <div class="met"><p class="eyebrow">Fee · High</p><p class="met-n dn">{$btcFees.high||'—'}<span class="met-u">sat/vB</span></p></div>
      </div>

      <!-- Hash Rate -->
      {#if $btcHashrate !== null}
      <div class="hash-row">
        <span class="eyebrow">Hash Rate</span>
        <span class="hash-val">{$btcHashrate.toFixed(1)}<span class="met-u"> EH/s</span></span>
      </div>
      {/if}

    </div>

    <!-- BITCOIN HASHRATE — replaces My Stack -->
    <div class="gc gc--hashrate btc-hashrate-card">
      <div class="chart-header" style="margin-bottom:8px;">
        <p class="gc-title">Bitcoin Hashrate</p>
        <div class="chart-range-btns" role="group" aria-label="Hashrate chart range">
          <button class="crb" class:crb--active={hashrateChartRange==='3M'} on:click={() => setHashrateChartRange('3M')}>3M</button>
          <button class="crb" class:crb--active={hashrateChartRange==='6M'} on:click={() => setHashrateChartRange('6M')}>6M</button>
          <button class="crb" class:crb--active={hashrateChartRange==='1Y'} on:click={() => setHashrateChartRange('1Y')}>1Y</button>
          <button class="crb" class:crb--active={hashrateChartRange==='2Y'} on:click={() => setHashrateChartRange('2Y')}>2Y</button>
          <button class="crb" class:crb--active={hashrateChartRange==='All'} on:click={() => setHashrateChartRange('All')}>All</button>
        </div>
      </div>
      <!-- MA legend -->
      <div class="hashrate-legend">
        <span class="hr-leg" style="--c:#f7931a;">● Hashrate</span>
        {#if hashrateMA7.length > 0}<span class="hr-leg" style="--c:#fbbf24;">● 7D MA</span>{/if}
        {#if hashrateMA30.length > 0}<span class="hr-leg" style="--c:#60a5fa;">● 30D MA</span>{/if}
      </div>
      <div class="chart-container">
        {#if hashrateLoading}
          <div class="skeleton" style="height:100%;min-height:200px;border-radius:6px;"></div>
        {:else if hashrateData.length >= 2}
          <PriceChart
            prices={hashrateData}
            fillParent={true}
            range={hashrateChartRange === 'All' ? 'max' : hashrateChartRange === '2Y' ? '5y' : hashrateChartRange === '1Y' ? '1y' : '7d'}
            formatY={(v) => `${v.toFixed(0)} EH/s`}
            lineColor="#f7931a"
            overlays={[
              ...(hashrateMA7.length > 0  ? [{ prices: hashrateMA7,  color: '#fbbf24', label: '7D MA'  }] : []),
              ...(hashrateMA30.length > 0 ? [{ prices: hashrateMA30, color: '#60a5fa', label: '30D MA' }] : []),
            ]}
          />
        {:else}
          <p class="dim" style="text-align:center;padding:40px 0;">Loading hashrate data…</p>
        {/if}
      </div>
      {#if $btcHashrate !== null}
      <div class="hash-row">
        <span class="eyebrow">Current Hash Rate</span>
        <span class="hash-val" style="color:#f7931a;">{$btcHashrate.toFixed(1)}<span class="met-u"> EH/s</span></span>
      </div>
      {/if}
    </div>

  </div>
</section>
