<script lang="ts">
  import { onMount } from 'svelte';
  import {
    settings, btcPrice, priceFlash, priceHistory, btcBlock, btcFees,
    halvingBlocksLeft, halvingDays, halvingDate, halvingProgress,
    latestBlock, mempoolStats,
    dcaUpdated, dca, accentColor, priceColor, btcAud, satsPerAud,
    goldPriceUsd, goldYtdPct, sp500Price, sp500YtdPct, cpiAnnual, btcYtdPct,
    gfNetWorth, gfTotalInvested, gfNetGainPct, gfNetGainYtdPct,
    gfTodayChangePct, gfHoldings, gfError, gfLoading, gfUpdated,
    gfDividendTotal, gfDividendYtd, gfCash, gfAnnualizedPct, gfFirstOrderDate, gfOrdersCount,
    markets, newsItems, btcDisplayPrice, btcWsConnected,
    btcHashrate
  } from '$lib/store';
  import Sparkline from '$lib/Sparkline.svelte';
  import PriceChart from '$lib/PriceChart.svelte';
  $: displayCur = ($settings.displayCurrency ?? 'AUD').toUpperCase();

  let btcChartRange: '1D' | '7D' | '1M' = '1D';
  let btcChartData: { t: number; p: number }[] = [];
  let btcChartLoading = false;

  async function fetchBtcChart(r = btcChartRange) {
    btcChartLoading = true;
    try {
      const map: Record<string,'1d'|'7d'|'30d'> = { '1D':'1d', '7D':'7d', '1M':'30d' };
      const d = await fetch(`/api/bitcoin/history?range=${map[r]}`).then(res => res.json());
      btcChartData = d.prices ?? [];
    } catch { btcChartData = []; }
    finally { btcChartLoading = false; }
  }

  async function setBtcChartRange(r: '1D' | '7D' | '1M') {
    btcChartRange = r;
    await fetchBtcChart(r);
  }

  // Keep last chart price point in sync with live WebSocket price.
  // Only update when price changes by >0.05% to avoid excessive array copies.
  let _lastChartPrice = 0;
  $: if ($btcPrice > 0 && btcChartData.length > 0) {
    const changePct = _lastChartPrice > 0 ? Math.abs($btcPrice - _lastChartPrice) / _lastChartPrice : 1;
    if (changePct >= 0.0005) {
      _lastChartPrice = $btcPrice;
      btcChartData = [...btcChartData.slice(0, -1), { t: Date.now(), p: $btcPrice }];
    }
  }

  let hashrateChartRange: '3M' | '6M' | '1Y' = '6M';
  let hashrateData: { t: number; p: number }[] = [];
  let hashrateLoading = false;

  async function fetchHashrateChart(r = hashrateChartRange) {
    hashrateLoading = true;
    try {
      const map: Record<string,'3m'|'6m'|'1y'> = { '3M':'3m', '6M':'6m', '1Y':'1y' };
      const d = await fetch(`/api/bitcoin/hashrate?range=${map[r]}`).then(res => res.json());
      hashrateData = d.hashrates ?? [];
    } catch { hashrateData = []; }
    finally { hashrateLoading = false; }
  }

  async function setHashrateChartRange(r: '3M' | '6M' | '1Y') {
    hashrateChartRange = r;
    await fetchHashrateChart(r);
  }

  let showHoldings = false;
  let holdingsSort: 'value'|'perf'|'alloc' = 'value';
  let intelView: 'cutting-edge'|'classic' = 'cutting-edge';
  const INTEL_TILE_LIMIT = 12; // 3 columns × 4 rows

  const n   = (v:number, dec=0) => v.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  const pct = (v:number|null)   => v===null?'—':(v>=0?'+':'')+v.toFixed(2)+'%';
  const sc  = (v:number|null)   => v===null?'var(--t3)':v>=0?'var(--up)':'var(--dn)';
  const fmtVol  = (v:number) => v>=1e6?`$${(v/1e6).toFixed(1)}m`:v>=1e3?`$${(v/1e3).toFixed(0)}k`:`$${v}`;
  const fmtDate = (d:string) => {try{return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}catch{return '';}};
  const pc  = (p:number) => p>=70?'var(--up)':p>=40?'var(--orange)':'var(--dn)';
  const ago = (d:string) => {try{const m=Math.floor((Date.now()-new Date(d).getTime())/60000);return m<60?`${m}m`:m<1440?`${Math.floor(m/60)}h`:`${Math.floor(m/1440)}d`;}catch{return '';}};
  const fmtBytes = (b:number) => b>=1e6?`${(b/1e6).toFixed(2)} MB`:b>=1e3?`${(b/1e3).toFixed(0)} KB`:`${b} B`;
  const fmtSats  = (s:number) => s>=1e8?`${(s/1e8).toFixed(3)} BTC`:s>=1e6?`${(s/1e6).toFixed(1)}M sats`:s>=1e3?`${(s/1e3).toFixed(0)}K sats`:`${s} sats`;
  const blockAge = (ts:number) => {const m=Math.floor((Date.now()/1000-ts)/60);return m<1?'just now':m<60?`${m}m ago`:`${Math.floor(m/60)}h ${m%60}m ago`;};

  // Price zone label
  $: low   = $settings.dca.lowPrice;
  $: high  = $settings.dca.highPrice;
  $: range = high - low;
  $: third = range / 3;

  $: priceZone = $btcPrice<=low?'LOW':$btcPrice<=(low+third)?'LOW–MID':$btcPrice<=(low+2*third)?'MID':$btcPrice<=high?'MID–HIGH':'HIGH';
  $: zoneColor = $btcPrice<=low?'var(--up)':$btcPrice<=(low+third)?'#4ade80':$btcPrice<=(low+2*third)?'var(--orange)':$btcPrice<=high?'#f97316':'var(--dn)';

  // DCA zone background GIF: red=low(cheap/fear), amber=mid, green=high(expensive/greed)
  $: dcaZoneGif = $btcPrice <= 0 ? '' : $btcPrice <= (low+third) ? '/dca-red.gif' : $btcPrice <= (low+2*third) ? '/dca-amber.gif' : '/dca-green.gif';

  $: s        = $settings.dca;
  $: dcaDays  = Math.max(0,Math.floor((Date.now()-new Date(s.startDate).getTime())/86400000));
  $: invested = dcaDays*s.dailyAmount;
  $: currentVal = s.btcHeld*$btcPrice;
  $: perf     = invested>0?((currentVal-invested)/invested)*100:0;
  $: goalPct  = s.goalBtc>0?Math.min(100,(s.btcHeld/s.goalBtc)*100):0;
  $: satsHeld = Math.round(s.btcHeld*1e8);
  $: satsLeft = Math.max(0,Math.round((s.goalBtc-s.btcHeld)*1e8));

  // DCA frequency label and description
  $: freqLabel = ({daily:'day',weekly:'week',fortnightly:'fortnight',monthly:'month'} as Record<string,string>)[s.dcaFrequency??'fortnightly']??'fortnight';
  $: freqDesc  = ({daily:'daily buy',weekly:'weekly buy',fortnightly:'fortnightly buy',monthly:'monthly buy'} as Record<string,string>)[s.dcaFrequency??'fortnightly']??'fortnightly buy';
  $: freqHint  = ({daily:'How much to buy today',weekly:'How much to buy this week',fortnightly:'How much to buy this fortnight',monthly:'How much to buy this month'} as Record<string,string>)[s.dcaFrequency??'fortnightly']??'How much to buy this fortnight';

  // CPI-adjusted real value: use portfolio duration from Ghostfolio if possible,
  // otherwise fall back to DCA start date duration
  $: inflAdj = (()=>{if($gfNetWorth===null||$cpiAnnual===null)return null;const y=Math.max(.1,dcaDays/365.25);return $gfNetWorth/Math.pow(1+$cpiAnnual/100,y);})();
  $: cpiLoss = (()=>{if($cpiAnnual===null)return 0;const y=Math.max(.1,dcaDays/365.25);return(1-1/Math.pow(1+$cpiAnnual/100,y))*100;})();
  $: portCAGR= (()=>{
    // Prefer Ghostfolio's own annualised performance if available, otherwise compute
    if ($gfAnnualizedPct !== null) return $gfAnnualizedPct;
    if($gfNetGainPct===null)return null;
    const y=Math.max(.1,dcaDays/365.25);
    return(Math.pow(1+$gfNetGainPct/100,1/y)-1)*100;
  })();

  // Asset class allocation derived from holdings
  const CLASS_LABEL: Record<string,string> = {
    EQUITY:'Equities', CRYPTOCURRENCY:'Crypto', FIXED_INCOME:'Fixed Income',
    REAL_ESTATE:'Real Estate', COMMODITY:'Commodities', ETF:'ETFs',
    CASH:'Cash', LIQUIDITY:'Liquidity', PRECIOUS_METAL:'Precious Metals',
  };
  $: assetClasses = (() => {
    const map: Record<string, number> = {};
    for (const h of $gfHoldings) {
      const cls = h.assetClass || 'OTHER';
      map[cls] = (map[cls] ?? 0) + h.allocationInPercentage;
    }
    return Object.entries(map)
      .map(([cls, pct]) => ({ cls, label: CLASS_LABEL[cls] ?? cls, pct: Math.round(pct * 10) / 10 }))
      .sort((a, b) => b.pct - a.pct);
  })();

  // Sorted holdings list
  $: sortedHoldings = [...$gfHoldings].sort((a, b) => {
    if (holdingsSort === 'perf') return b.netPerformancePercentWithCurrencyEffect - a.netPerformancePercentWithCurrencyEffect;
    if (holdingsSort === 'alloc') return b.allocationInPercentage - a.allocationInPercentage;
    return b.valueInBaseCurrency - a.valueInBaseCurrency;
  });

  // Mobile feed carousels — duplicate items so the CSS loop is seamless
  $: newsLoop = $newsItems.length ? [...$newsItems, ...$newsItems] : [];

  // Class accent colours for allocation breakdown
  const CLASS_COLOR: Record<string,string> = {
    EQUITY:'#6366f1', CRYPTOCURRENCY:'#f7931a', FIXED_INCOME:'#38bdf8',
    REAL_ESTATE:'#10b981', COMMODITY:'#c9a84c', ETF:'#8b5cf6',
    CASH:'#64748b', LIQUIDITY:'#64748b', PRECIOUS_METAL:'#c9a84c',
  };

  async function refreshGF() {
    const token=$settings.ghostfolio?.token?.trim();if(!token)return;
    $gfLoading=true;$gfError='';
    try{
      const d=await fetch(`/api/ghostfolio?token=${encodeURIComponent(token)}`).then(r=>r.json());
      if(d.error){$gfError=d.error;}
      else{
        $gfNetWorth=d.netWorth;$gfTotalInvested=d.totalInvested;
        $gfNetGainPct=d.netGainPct;$gfNetGainYtdPct=d.netGainYtdPct;
        $gfTodayChangePct=d.todayChangePct;$gfHoldings=d.holdings??[];
        $gfDividendTotal=d.dividendTotal??null;
        $gfDividendYtd=d.dividendYtd??null;
        $gfCash=d.cash??null;
        $gfAnnualizedPct=d.annualizedPerformancePct??null;
        $gfFirstOrderDate=d.firstOrderDate??null;
        $gfOrdersCount=d.ordersCount??null;
        $gfUpdated=new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});
      }
    }
    catch{$gfError='Connection failed';}finally{$gfLoading=false;}
  }

  onMount(() => { fetchHashrateChart(); });
</script>

<!-- ══════════════════════════════════════════════════════════
  ① SIGNAL SECTION
═══════════════════════════════════════════════════════════ -->
<section id="signal" class="section" aria-label="Signal">
  <div class="section-header">
    <h2 class="sect-title">Signal</h2>
  </div>

  <!-- KEY METRICS STRIP — combined BTC price + sats + halving -->
  <div class="stat-strip">

    <!-- BTC Price — USD and user currency side by side -->
    <div class="stat-tile stat-tile--chart stat-tile--wide">
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
            <span class="price-label-sep"> | </span><span class="price-label-cur">{displayCur}</span>
          {/if}
        </span>
      </div>
    </div>

    <!-- Sats per display currency — $1 | SATS format -->
    <div class="stat-tile stat-tile--static" data-tooltip="Satoshis you get for 1 {displayCur}">
      <div class="sats-display">
        <span class="sats-cur">{$satsPerAud !== null ? $satsPerAud.toLocaleString() : '—'}</span>
      </div>
      <span class="stat-l"><span style="color:var(--orange);">SATS</span> · <span class="price-label-cur">{displayCur}</span></span>
    </div>

    <div class="stat-tile halving-tile stat-tile--static" data-tooltip="Estimated blocks remaining until next Bitcoin halving">
      {#if $halvingDays > 0}
        <div class="price-pair" aria-live="polite" aria-atomic="true">
          <span class="stat-n halving-n">{$halvingDays.toLocaleString()}</span>
          {#if $halvingProgress > 0}
            <span class="price-sep">|</span>
            <span class="price-alt">{$halvingProgress.toFixed(1)}%</span>
          {/if}
        </div>
        <span class="stat-l">Days to Halving</span>
      {:else}
        <span class="stat-n muted">—</span>
        <span class="stat-l">Days to Halving</span>
      {/if}
    </div>
  </div>

  <!-- BITCOIN HASHRATE CHART CARD -->
  <div class="gc btc-chart-card">
    <div class="chart-header">
      <p class="gc-title">Bitcoin Hashrate</p>
      <div class="chart-range-btns" role="group" aria-label="Chart time range">
        <button class="crb" class:crb--active={chartRange==='3M'} on:click={() => setChartRange('3M')}>3M</button>
        <button class="crb" class:crb--active={chartRange==='6M'} on:click={() => setChartRange('6M')}>6M</button>
        <button class="crb" class:crb--active={chartRange==='1Y'} on:click={() => setChartRange('1Y')}>1Y</button>
      </div>
    </div>
    <div class="chart-container">
      {#if chartLoading}
        <div class="skeleton" style="height:110px;border-radius:6px;"></div>
      {:else if hashrateData.length >= 2}
        <PriceChart prices={hashrateData} height={110} range={chartRange === '3M' ? '7d' : chartRange === '6M' ? '30d' : '1y'} formatY={(v) => `${v.toFixed(0)} EH/s`} />
      {:else}
        <p class="dim" style="text-align:center;padding:40px 0;">Loading hashrate data…</p>
      {/if}
    </div>
  </div>

  <!-- SIGNAL + NETWORK + STACK GRID -->
  <div class="signal-grid">

    <!-- DCA SIGNAL CARD — simplified -->
    <div class="gc signal-card" style="--ac:{$accentColor};">
      <div class="signal-bar" style="background:linear-gradient(90deg,{$accentColor}33,{$accentColor},{$accentColor}33);"></div>

      <!-- Zone background GIF — behind frosted glass -->
      {#if dcaZoneGif}
        {#key dcaZoneGif}
          <div class="zone-bg">
            <img src={dcaZoneGif} alt="" class="zone-bg-img" loading="lazy" />
          </div>
        {/key}
      {/if}
      <div class="zone-glass"></div>

      <div class="gc-head">
        <div>
          <p class="eyebrow orange">DCA Signal</p>
          <p class="dim" style="margin-top:3px;">{freqHint}</p>
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

    <!-- BITCOIN NETWORK — expanded with mempool data -->
    <div class="gc">
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

    <!-- MY STACK -->
    <div class="gc">
      <div class="gc-head">
        <p class="gc-title">My Stack</p>
        <span class="dim">${s.dailyAmount}/day · {dcaDays}d</span>
      </div>
      <div class="met3" style="margin-bottom:18px;">
        <div class="met"><p class="eyebrow">Invested</p><p class="met-n">${n(invested)}</p></div>
        <div class="met"><p class="eyebrow">Value</p><p class="met-n" style="color:{perf>=0?'var(--up)':'var(--dn)'};">{$btcPrice>0?'$'+n(currentVal):'—'}</p></div>
        <div class="met"><p class="eyebrow">Return</p><p class="met-n" style="color:{perf>=0?'var(--up)':'var(--dn)'};">{$btcPrice>0?(perf>=0?'+':'')+perf.toFixed(1)+'%':'—'}</p></div>
      </div>
      <div class="btc-pill">
        <span style="color:var(--orange);font-weight:700;font-size:.92rem;">{s.btcHeld.toFixed(8)}</span>
        <span style="color:var(--t2);margin:0 6px;">BTC</span>
        <span style="color:var(--t3);font-size:.72rem;">{n(satsHeld)} sats</span>
      </div>
      <div><div class="goal-head"><p class="eyebrow">Goal · {s.goalBtc} BTC</p><p class="eyebrow orange">{goalPct.toFixed(1)}%</p></div>
        <div class="pbar"><div class="pfill" style="width:{goalPct}%;background:linear-gradient(90deg,rgba(247,147,26,.6),var(--orange));"></div></div>
        <p class="dim" style="text-align:right;margin-top:4px;">{n(satsLeft)} sats remaining</p>
      </div>

      <!-- Price Prediction Scenarios -->
      {#if s.btcHeld > 0}
      <div class="price-scen">
        <p class="eyebrow" style="margin-bottom:10px;">Price Scenarios</p>
        <div class="scen-grid">
          {#each [100000, 200000, 500000, 1000000] as target}
            {@const scenVal = s.btcHeld * target}
            {@const scenGain = invested > 0 ? ((scenVal - invested) / invested) * 100 : 0}
            <div class="scen-item">
              <span class="scen-price">${(target/1000).toFixed(0)}K</span>
              <span class="scen-val" style="color:{scenGain>=0?'var(--up)':'var(--dn)'};">${n(scenVal,0)}</span>
              <span class="scen-pct" style="color:{scenGain>=0?'var(--up)':'var(--dn)'};">{scenGain>=0?'+':''}{scenGain.toFixed(0)}%</span>
            </div>
          {/each}
        </div>
      </div>
      {/if}
    </div>

  </div>
</section>

<!-- ══════════════════════════════════════════════════════════
  ② PORTFOLIO SECTION
═══════════════════════════════════════════════════════════ -->
<section id="portfolio" class="section" aria-label="Portfolio">
  <div class="section-header">
    <h2 class="sect-title">Portfolio</h2>
  </div>

  <div class="port-grid">

    <!-- ASSET COMPARISON -->
    <div class="gc">
      <div class="gc-head">
        <p class="gc-title">Asset Comparison</p>
        <div style="display:flex;align-items:center;gap:8px;">
            <span class="live-dot" class:blink={$btcWsConnected} title="{$btcWsConnected?'BTC price live via WebSocket':'BTC price polling'}"></span>
            <p class="dim" title="Year-to-date performance in USD via Yahoo Finance">YTD (USD)</p>
          </div>
      </div>
      <div class="asset-panels">
        {#each [
          {ticker:'BTC', name:'Bitcoin',  icon:'₿', pct:$btcYtdPct,   color:'#f7931a', sub:$btcPrice?'$'+n($btcPrice):'—', live:$btcWsConnected},
          {ticker:'XAU', name:'Gold',     icon:'◈', pct:$goldYtdPct,  color:'#c9a84c', sub:$goldPriceUsd?'$'+n($goldPriceUsd,0)+' USD/oz':'—', live:false},
          {ticker:'SPX', name:'S&P 500',  icon:'↗', pct:$sp500YtdPct, color:'#888',    sub:$sp500Price?'$'+n($sp500Price,0):'—', live:false},
          {ticker:'CPI', name:'Inflation',icon:'↓', pct:$cpiAnnual,   color:'#ef4444', sub:'Annual rate', live:false},
        ] as a}
          <div class="ap" style="--pc:{a.color};">
            <div class="ap-top">
              <span class="ap-icon" style="color:{a.color};">{a.icon}</span>
              <div>
                <p class="ap-ticker" style="color:{a.color};">{a.ticker}{#if a.live}<span class="ap-live">●</span>{/if}</p>
                <p class="ap-name">{a.name}</p>
              </div>
            </div>
            <p class="ap-pct" style="color:{a.pct===null?a.color:a.pct>=0?'var(--up)':'var(--dn)'};">
              {a.pct!==null?(a.pct>=0?'+':'')+a.pct.toFixed(1)+'%':'—'}
            </p>
            <p class="ap-sub">{a.sub}</p>
            <div class="pbar" style="margin-top:8px;">{#if a.pct!==null}<div class="pfill" style="width:{Math.min(100,Math.max(2,(a.pct/150)*100+50))}%;background:{a.pct>=0?'var(--up)':'var(--dn)'};opacity:.55;"></div>{:else}<div class="pfill" style="width:70%;background:{a.color};animation:apPulse 3s ease-in-out infinite;"></div>{/if}</div>
          </div>
        {/each}
      </div>
      {#if $cpiAnnual!==null}<p class="dim" style="margin-top:14px;line-height:1.6;">Purchasing power erosion (annualized): <span style="color:var(--dn);">−{cpiLoss.toFixed(1)}%</span></p>{/if}
    </div>

    <!-- GHOSTFOLIO -->
    <div class="gc">
      {#if !$settings.ghostfolio?.token}
        <div class="gc-head" style="margin-bottom:12px;"><p class="gc-title">Connect Ghostfolio</p></div>
        <p class="dim" style="line-height:1.7;margin-bottom:8px;">Add your Ghostfolio security token in Settings to see full portfolio performance and holdings.</p>
        <p class="dim" style="line-height:1.6;">Your token is stored locally in your browser only.</p>
      {:else}
        <div class="gc-head" style="margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:10px;"><p class="gc-title">Portfolio</p><span class="dim">via Ghostfolio</span></div>
          <div style="display:flex;align-items:center;gap:10px;">
            {#if $gfLoading}<span class="live-dot blink" aria-label="Loading portfolio data" role="status"></span>{/if}
            {#if $gfUpdated&&!$gfLoading}<span class="dim" aria-label="Last updated at {$gfUpdated}">{$gfUpdated}</span>{/if}
            <a href="https://ghostfol.io" target="_blank" rel="noopener noreferrer" class="btn-ghost" aria-label="Open Ghostfolio">Ghostfolio ↗</a>
            <button on:click={refreshGF} class="btn-icon" aria-label="Refresh portfolio data" title="Refresh portfolio data">↻</button>
          </div>
        </div>
        {#if $gfError}
          <p class="err-msg">{$gfError} — check token in Settings.</p>
        {:else}
          <div class="gf-hero">
            <div>
              <p class="eyebrow">Net Worth</p>
              <p class="gf-nw">{$gfNetWorth!==null?'$'+n($gfNetWorth,0):'—'}</p>
              <p class="eyebrow" style="margin-top:4px;">{$settings.ghostfolio.currency||'AUD'}</p>
            </div>
            {#if inflAdj!==null}
            <div class="gf-cpi" title="Estimated purchasing-power value based on CPI since DCA start date. Limited by available CPI data.">
              <p class="eyebrow">Real Value <span class="gf-est">est.</span></p>
              <p class="gf-nw">${n(inflAdj,0)}</p>
              <p class="eyebrow" style="margin-top:4px;">CPI-adjusted</p>
            </div>
            {/if}
            <div class="gf-perf">
              <div class="gfp"><p class="eyebrow">Today</p><p class="gfp-v" style="color:{sc($gfTodayChangePct)};">{pct($gfTodayChangePct)}</p></div>
              <div class="gfp" title="Portfolio YTD performance from Ghostfolio"><p class="eyebrow">YTD <span style="font-size:.45rem;opacity:.6;">via GF</span></p><p class="gfp-v" style="color:{sc($gfNetGainYtdPct)};">{pct($gfNetGainYtdPct)}</p></div>
              <div class="gfp" title="Total return since portfolio inception (from Ghostfolio data)">
                <p class="eyebrow">All-time</p><p class="gfp-v" style="color:{sc($gfNetGainPct)};">{pct($gfNetGainPct)}</p>
              </div>
              <div class="gfp"><p class="eyebrow">Invested</p><p class="gfp-v">{$gfTotalInvested!==null?'$'+n($gfTotalInvested,0):'—'}</p></div>
            </div>
          </div>

          <!-- EXTRA SUMMARY METRICS (dividends, cash, order history) -->
          {#if $gfDividendTotal!==null||$gfCash!==null||$gfFirstOrderDate||$gfOrdersCount!==null}
          <div class="gf-summary">
            {#if $gfDividendTotal!==null}
            <div class="gf-sum-item" title="Total dividends received (all-time)">
              <p class="eyebrow">Dividends <span style="color:var(--up);">all-time</span></p>
              <p class="gf-sum-v">${n($gfDividendTotal,0)}</p>
              {#if $gfDividendYtd!==null}<p class="dim" style="font-size:.6rem;margin-top:2px;">YTD: ${n($gfDividendYtd,0)}</p>{/if}
            </div>
            {/if}
            {#if $gfCash!==null&&$gfCash>0}
            <div class="gf-sum-item" title="Cash / liquidity position">
              <p class="eyebrow">Cash</p>
              <p class="gf-sum-v">${n($gfCash,0)}</p>
            </div>
            {/if}
            {#if $gfFirstOrderDate}
            <div class="gf-sum-item" title="Date of first portfolio transaction">
              <p class="eyebrow">Investing since</p>
              <p class="gf-sum-v" style="font-size:.85rem;">{fmtDate($gfFirstOrderDate)}</p>
            </div>
            {/if}
            {#if $gfOrdersCount!==null}
            <div class="gf-sum-item" title="Total number of portfolio transactions">
              <p class="eyebrow">Transactions</p>
              <p class="gf-sum-v">{n($gfOrdersCount)}</p>
            </div>
            {/if}
          </div>
          {/if}

          {#if portCAGR!==null||$cpiAnnual!==null||$goldYtdPct!==null}
          <div class="bench">
            {#if portCAGR!==null}<div class="bench-c"><p class="eyebrow orange">Portfolio CAGR</p><p class="bench-v" style="color:{portCAGR>=0?'var(--up)':'var(--dn)'};">{portCAGR>=0?'+':''}{portCAGR.toFixed(1)}<span style="font-size:.55em;opacity:.5;">%/yr</span></p>{#if $cpiAnnual!==null}<p class="bench-vs" style="color:{portCAGR>$cpiAnnual?'var(--up)':'var(--dn)'};">{portCAGR>$cpiAnnual?'▲':'▼'} {Math.abs(portCAGR-$cpiAnnual).toFixed(1)}% vs CPI</p>{/if}</div>{/if}
            {#if $cpiAnnual!==null}<div class="bench-c"><p class="eyebrow dn">Inflation</p><p class="bench-v dn">+{$cpiAnnual.toFixed(1)}<span style="font-size:.55em;opacity:.5;">%/yr</span></p></div>{/if}
            {#if $goldYtdPct!==null}<div class="bench-c"><p class="eyebrow" style="color:#c9a84c;">Gold 1Y</p><p class="bench-v" style="color:{$goldYtdPct>=0?'#c9a84c':'var(--dn)'};">{$goldYtdPct>=0?'+':''}{$goldYtdPct.toFixed(1)}<span style="font-size:.55em;opacity:.5;">%</span></p></div>{/if}
            {#if $sp500YtdPct!==null}<div class="bench-c"><p class="eyebrow">S&amp;P 500</p><p class="bench-v" style="color:{$sp500YtdPct>=0?'var(--t1)':'var(--dn)'};">{$sp500YtdPct>=0?'+':''}{$sp500YtdPct.toFixed(1)}<span style="font-size:.55em;opacity:.5;">%</span></p></div>{/if}
          </div>
          {/if}

          <!-- ASSET CLASS ALLOCATION (from holdings) -->
          {#if assetClasses.length>0}
          <div class="alloc-wrap">
            <p class="eyebrow" style="margin-bottom:10px;">Allocation by Asset Class</p>
            <!-- Stacked bar -->
            <div class="alloc-bar">
              {#each assetClasses as ac}
                {@const color = CLASS_COLOR[ac.cls] ?? '#64748b'}
                <div class="alloc-seg" style="width:{ac.pct}%;background:{color};" title="{ac.label}: {ac.pct}%"></div>
              {/each}
            </div>
            <!-- Legend -->
            <div class="alloc-legend">
              {#each assetClasses as ac}
                {@const color = CLASS_COLOR[ac.cls] ?? '#64748b'}
                <div class="alloc-item">
                  <span class="alloc-dot" style="background:{color};"></span>
                  <span class="alloc-name">{ac.label}</span>
                  <span class="alloc-pct">{ac.pct}%</span>
                </div>
              {/each}
            </div>
          </div>
          {/if}

          {#if $gfHoldings.length>0}
          <div class="holdings-wrap">
            <div class="holdings-head">
              <button class="btn-secondary" on:click={()=>showHoldings=!showHoldings} style="font-size:.62rem;padding:7px 16px;"
                aria-expanded={showHoldings}>
                {showHoldings?'▲':'▼'} Holdings ({$gfHoldings.length})
              </button>
              {#if showHoldings}
              <div class="sort-btns" role="group" aria-label="Sort holdings by">
                <button class="sort-btn" class:sort-btn--active={holdingsSort==='value'} on:click={()=>holdingsSort='value'} aria-pressed={holdingsSort==='value'}>Value</button>
                <button class="sort-btn" class:sort-btn--active={holdingsSort==='perf'} on:click={()=>holdingsSort='perf'} aria-pressed={holdingsSort==='perf'}>Return</button>
                <button class="sort-btn" class:sort-btn--active={holdingsSort==='alloc'} on:click={()=>holdingsSort='alloc'} aria-pressed={holdingsSort==='alloc'}>Alloc</button>
              </div>
              {/if}
            </div>
            {#if showHoldings}
            <div class="hgrid">
              {#each sortedHoldings as h}
                {@const hp=h.netPerformancePercentWithCurrencyEffect}
                {@const hcolor = CLASS_COLOR[h.assetClass] ?? 'var(--orange)'}
                <div class="h-card">
                  <div class="h-top">
                    <div>
                      <span class="h-sym">{h.symbol}</span>
                      {#if h.assetClass}<span class="h-cls" style="background:{hcolor}22;color:{hcolor};">{CLASS_LABEL[h.assetClass]??h.assetClass}</span>{/if}
                    </div>
                    <span class="h-pct" style="color:{hp>=0?'var(--up)':'var(--dn)'};">{hp>=0?'+':''}{hp.toFixed(1)}%</span>
                  </div>
                  {#if h.name!==h.symbol}<p class="h-name">{h.name.slice(0,22)}</p>{/if}
                  <div class="pbar" style="margin:8px 0 6px;"><div class="pfill" style="width:{Math.min(100,h.allocationInPercentage)}%;background:linear-gradient(90deg,{hcolor}88,{hcolor});"></div></div>
                  <div class="h-foot"><span>{h.allocationInPercentage.toFixed(1)}%</span><span>${n(h.valueInBaseCurrency,0)}</span></div>
                </div>
              {/each}
            </div>
            {/if}
          </div>
          {/if}
        {/if}
      {/if}
    </div>

  </div>
</section>

<!-- ══════════════════════════════════════════════════════════
  ③ INTEL SECTION
═══════════════════════════════════════════════════════════ -->
<section id="intel" class="section" aria-label="Intel">
  <div class="section-header">
    <h2 class="sect-title">Intel</h2>
    <!-- Toggle: Cutting Edge / Classic — Apple-style -->
    <div class="intel-toggle-wrap" role="group" aria-label="Intel view">
      <span class="toggle-icon" class:toggle-icon--active={intelView==='cutting-edge'} title="Cutting Edge — prediction markets">◈</span>
      <button
        class="apple-toggle"
        class:apple-toggle--classic={intelView==='classic'}
        on:click={() => intelView = intelView === 'cutting-edge' ? 'classic' : 'cutting-edge'}
        role="switch"
        aria-checked={intelView === 'cutting-edge'}
        aria-label="Switch intel view. Currently {intelView === 'cutting-edge' ? 'Cutting Edge' : 'Classic'}"
      >
        <span class="apple-knob"></span>
      </button>
      <span class="toggle-icon" class:toggle-icon--active={intelView==='classic'} title="Classic — news feed">☰</span>
    </div>
  </div>

  {#if intelView === 'cutting-edge'}
  <!-- ── CUTTING EDGE: Polymarket Geopolitics card grid ── -->
  <div class="gc" style="padding:20px 18px;">
    <div class="gc-head" style="margin-bottom:16px;">
      <div>
        <p class="gc-title">Geopolitics</p>
        <p class="dim" style="margin-top:3px;">Live prediction markets · what the crowd expects</p>
      </div>
      <a href="https://polymarket.com/markets/geopolitics" target="_blank" rel="noopener noreferrer" class="btn-ghost" aria-label="Open Polymarket Geopolitics in new tab">polymarket.com ↗</a>
    </div>
    {#if $markets.length===0}
      <div class="markets-loading" role="status" aria-label="Loading markets">
        <div class="skeleton" style="height:90px;border-radius:10px;"></div>
        <div class="skeleton" style="height:90px;border-radius:10px;"></div>
        <div class="skeleton" style="height:90px;border-radius:10px;"></div>
      </div>
    {:else}
      <div class="pm-grid">
        {#each $markets.slice(0, INTEL_TILE_LIMIT) as m}
          <a href="{m.url}" target="_blank" rel="noopener noreferrer" class="pm-card" aria-label="{m.question}">
            <!-- Tag row -->
            <div class="pm-card-tags">
              {#if m.pinned}
                <span class="pm-tag pm-pin">★ Watching</span>
              {:else}
                <span class="pm-tag">{m.tag}</span>
              {/if}
            </div>
            <!-- Question -->
            <p class="pm-card-q">{m.question}</p>
            <!-- Outcomes bar -->
            <div class="pm-outcomes" class:pm-outcomes--multi={m.outcomes && m.outcomes.length > 2}>
              {#if m.outcomes && m.outcomes.length >= 2}
                {#each m.outcomes.slice(0, m.outcomes.length > 2 ? 3 : 2) as outcome}
                  <div class="pm-outcome" style="--oc:{pc(outcome.probability)};">
                    <span class="pm-outcome-name">{outcome.name}</span>
                    <span class="pm-outcome-pct" style="color:{pc(outcome.probability)};">{outcome.probability}<span style="font-size:.65em;opacity:.6;">%</span></span>
                  </div>
                {/each}
              {:else}
                <div class="pm-outcome" style="--oc:{pc(m.probability)};">
                  <span class="pm-outcome-name">{m.topOutcome}</span>
                  <span class="pm-outcome-pct" style="color:{pc(m.probability)};">{m.probability}<span style="font-size:.65em;opacity:.6;">%</span></span>
                </div>
              {/if}
            </div>
            <!-- Probability bar (leading outcome) -->
            <div class="pm-bar">
              <div class="pm-fill" style="width:{m.probability}%;background:{pc(m.probability)};"></div>
              <div class="pm-fill-rest" style="width:{100-m.probability}%;"></div>
            </div>
            <!-- Meta -->
            <div class="pm-meta">
              {#if m.endDate}<span class="dim">Ends {fmtDate(m.endDate)}</span>{/if}
              <span class="dim">{fmtVol(m.volume)} vol</span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </div>

  {:else}
  <!-- ── CLASSIC: News RSS feeds ── -->
  <div class="gc" style="padding:20px 18px;">
    <div class="gc-head" style="margin-bottom:16px;"><p class="gc-title">News Feed</p><span class="dim">{Math.min($newsItems.length, INTEL_TILE_LIMIT)} articles</span></div>
    {#if $newsItems.length===0}
      <p class="dim">Fetching RSS feeds…</p>
    {:else}
      <div class="pm-grid">
        {#each $newsItems.slice(0, INTEL_TILE_LIMIT) as item}
          <a href={item.link} target="_blank" rel="noopener noreferrer" class="pm-card" aria-label="{item.title}">
            <div class="pm-card-tags">
              <span class="pm-tag pm-news-src">{item.source}</span>
              <span class="pm-tag">{ago(item.pubDate)} ago</span>
            </div>
            {#if item.image}
              <div class="news-card-img" style="background-image:url('{item.image}');"></div>
            {/if}
            <p class="pm-card-q">{item.title}</p>
            {#if item.description}
              <p class="news-card-desc">{item.description.length > 100 ? item.description.slice(0, 100) + '…' : item.description}</p>
            {/if}
          </a>
        {/each}
      </div>
    {/if}
  </div>
  {/if}

</section>

<style>
  /* ── LAYOUT ──────────────────────────────────────────────── */
  .section { max-width: 1440px; margin: 0 auto; padding: 48px 24px 0; min-height: 100vh; scroll-snap-align: start; scroll-snap-stop: always; position: relative; overflow: hidden; }
  .section::before { content: ''; position: absolute; inset: -20% 0; z-index: -1; background: radial-gradient(ellipse at 50% 30%, rgba(247,147,26,.04) 0%, transparent 70%); transform: translateY(0); transition: transform 0.6s ease-out; pointer-events: none; }
  .section-header { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }

  .section-divider {
    max-width:1440px; margin:48px auto 0;
    height:1px; background:linear-gradient(90deg,transparent,rgba(247,147,26,.5),rgba(0,200,255,.25),transparent);
    position:relative;
  }
  .section-divider::after {
    content:''; position:absolute; top:-1px; left:50%; transform:translateX(-50%);
    width:60px; height:3px; background:linear-gradient(90deg,#f7931a,#00c8ff);
    box-shadow:0 0 12px rgba(247,147,26,.6);
  }
  @media (max-width:700px) {
    .section { padding:20px 12px 0; min-height: auto; }
    .section-header { margin-bottom:12px; }
    .section-divider { margin-top:24px; }
  }
  @media (max-width:600px) {
    .section-header { margin-bottom:10px; }
  }

  /* ── STAT STRIP ─────────────────────────────────────────── */
  .stat-strip { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 20px; }
  .stat-tile {
    padding: 16px 14px; text-align: center;
    background: var(--glass-bg); border: 1px solid var(--glass-bd);
    border-radius: 8px; backdrop-filter: blur(16px);
    transition: transform .25s, border-color .25s, box-shadow .25s;
    position: relative; overflow: hidden;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
  }
  .stat-tile::before {
    content:''; position:absolute; bottom:0; left:0; width:0; height:2px;
    background:linear-gradient(90deg,#f7931a,#00c8ff);
    box-shadow:0 0 10px rgba(247,147,26,.7);
    transition:width .3s ease;
  }
  .stat-tile:hover { transform:translateY(-4px); border-color:var(--orange-md); box-shadow:0 12px 32px rgba(247,147,26,.12); }
  .stat-tile:hover::before { width:100%; }

  .stat-tile--chart { padding-bottom: 0; }
  .stat-tile--chart::before { display:none; }
  .tile-spark { position: absolute; bottom: 0; left: 0; right: 0; height: 52px; opacity: 0.7; pointer-events: none; }
  .stat-tile--chart .price-pair, .stat-tile--chart .stat-l, .stat-tile--chart .stat-l-row { position: relative; z-index: 1; }
  .stat-tile--chart .stat-l-row { display: flex; justify-content: center; align-items: center; gap: 10px; padding-bottom: 56px; }

  /* BTC price pair — USD | Currency side by side */
  .price-pair { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; justify-content:center; margin-bottom:4px; position:relative; z-index:1; margin-top:8px; }
  .price-usd { font-size:1.4rem; font-weight:700; letter-spacing:-.025em; line-height:1.1; }
  .price-sep { font-size:.9rem; color:var(--t3); font-weight:400; }
  .price-alt { font-size:1.4rem; font-weight:700; letter-spacing:-.025em; line-height:1.1; }
  .price-label-usd { color:rgba(255,255,255,.55); font-weight:700; }
  .price-label-sep { color:var(--t3); }
  .price-label-cur { color:var(--orange); font-weight:700; }
  @media (max-width:500px) {
    .price-usd { font-size:1.05rem; }
    .price-alt { font-size:1.05rem; }
    .price-sep { font-size:.75rem; }
  }

  /* Sats per currency — large SATS display */
  .sats-display { display:flex; align-items:baseline; gap:6px; justify-content:center; margin-bottom:4px; }
  .sats-cur { font-size:1.4rem; font-weight:700; color:#e2e2e8; letter-spacing:-.025em; line-height:1.1; }
  @media (max-width:500px) {
    .sats-cur { font-size:1rem; }
  }

  .stat-n { display:block; font-size:1.4rem; font-weight:700; letter-spacing:-.025em; margin-bottom:6px; line-height:1.1; color:var(--t1); }
  .stat-l { font-size:.58rem; color:var(--t2); text-transform:uppercase; letter-spacing:.1em; }

  /* Halving number — clean, readable */
  .halving-n { font-size:1.2rem; font-weight:700; letter-spacing:.02em; }

  /* Static stat tile — no hover lift or underline animation */
  .stat-tile--static { cursor:default; }
  .stat-tile--static:hover { transform:none !important; border-color:var(--glass-bd) !important; box-shadow:none !important; }
  .stat-tile--static:hover::before { width:0 !important; }

  @media (max-width:800px) { .stat-strip{ grid-template-columns:repeat(3,1fr); } }
  @media (max-width:500px) {
    .stat-strip{ grid-template-columns:repeat(3,1fr); gap:6px; }
    .stat-n { font-size:1.05rem; }
    .stat-tile { padding:10px 8px; }
    .stat-tile--chart .stat-l-row { padding-bottom:44px; }
  }

  /* ── BTC PRICE CHART CARD ───────────────────────────────── */
  .btc-chart-card { padding:16px 18px; margin-bottom:14px; }
  .chart-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
  .chart-container { width:100%; }
  .chart-range-btns { display:flex; gap:4px; }
  .crb {
    padding:4px 12px; font-size:.62rem; font-weight:700; letter-spacing:.06em;
    text-transform:uppercase; font-family:'Poison',monospace;
    background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
    border-radius:4px; color:rgba(255,255,255,.45); cursor:pointer; transition:all .2s;
  }
  .crb:hover { color:rgba(255,255,255,.8); border-color:rgba(247,147,26,.3); }
  .crb--active { background:rgba(247,147,26,.15); border-color:rgba(247,147,26,.5); color:var(--orange); }
  :global(html.light) .crb { background:rgba(0,0,0,.04); border-color:rgba(0,0,0,.1); color:rgba(0,0,0,.5); }
  :global(html.light) .crb:hover { color:rgba(0,0,0,.8); }
  :global(html.light) .crb--active { background:rgba(247,147,26,.1); border-color:rgba(247,147,26,.4); color:#c77a10; }
  @media (max-width:500px) { .btc-chart-card { padding:12px 12px; } }

  /* ── SIGNAL GRID ────────────────────────────────────────── */
  .signal-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
  @media (max-width:1100px) { .signal-grid{grid-template-columns:1fr 1fr;} }
  @media (max-width:700px)  { .signal-grid{grid-template-columns:1fr 1fr; gap:10px;} }
  @media (max-width:500px)  { .signal-grid{grid-template-columns:1fr; gap:8px;} }

  /* ── GLASS CARD ─────────────────────────────────────────── */
  .gc {
    background: var(--glass-bg); backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    border: 1px solid var(--glass-bd); border-radius: 8px; padding: 24px;
    box-shadow: 0 6px 28px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.06);
    transition: border-color .3s, box-shadow .3s, transform .25s; position: relative; overflow: hidden;
  }
  .gc::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(247,147,26,.25),transparent); }
  .gc:hover { border-color:rgba(247,147,26,.2); box-shadow:0 12px 40px rgba(0,0,0,.5),0 0 0 1px rgba(247,147,26,.06),inset 0 1px 0 rgba(255,255,255,.08); transform:translateY(-1px); }
  .gc-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; gap:12px; }
  .gc-title { font-family:'Poison',monospace; font-size:.72rem; font-weight:700; color:var(--t1); text-transform:uppercase; letter-spacing:.08em; }
  @media (max-width:600px) { .gc { padding:14px 12px; } }

  /* ── ATOMS ──────────────────────────────────────────────── */
  .eyebrow { font-size:.58rem; font-weight:500; text-transform:uppercase; letter-spacing:.12em; color:var(--t2); }
  .eyebrow.orange { color:var(--orange); }
  .eyebrow.dn { color:var(--dn); }
  .dim { font-size:.64rem; color:var(--t2); }
  .ts  { font-size:.58rem; color:var(--t3); font-variant-numeric:tabular-nums; }
  .up  { color:var(--up)!important; }
  .dn  { color:var(--dn)!important; }
  .muted { color:var(--t3); opacity:.3; }
  .err-msg { font-size:.72rem; color:var(--dn); padding:10px 14px; border:1px solid rgba(239,68,68,.2); border-radius:4px; background:rgba(239,68,68,.05); }
  .pbar  { height:2px; background:rgba(255,255,255,.06); border-radius:1px; overflow:hidden; }
  .pfill { height:100%; border-radius:1px; transition:width .7s cubic-bezier(.4,0,.2,1); }

  /* ── SIGNAL CARD ────────────────────────────────────────── */
  .signal-card { background:linear-gradient(180deg,rgba(247,147,26,.08) 0%,var(--glass-bg) 80px); position:relative; overflow:hidden; }
  .signal-card .gc-head { position:relative; z-index:2; }
  .signal-bar  { position:absolute; top:0; left:0; right:0; height:2px; border-radius:6px 6px 0 0; z-index:3; }

  /* Zone background GIF layer */
  .zone-bg {
    position:absolute; inset:0; z-index:0; overflow:hidden;
  }
  .zone-bg-img {
    width:100%; height:100%; object-fit:cover; object-position:center 30%;
    opacity:0.18; filter:blur(4px) saturate(120%);
    animation:zoneFadeIn .8s ease-out, gifGlitch 9s ease-in-out 3s infinite;
  }
  /* Frosted glass overlay on top of GIF */
  .zone-glass {
    position:absolute; inset:0; z-index:1;
    background:linear-gradient(180deg, rgba(14,14,14,.72) 0%, rgba(14,14,14,.55) 40%, rgba(14,14,14,.7) 100%);
    backdrop-filter:blur(2px);
    -webkit-backdrop-filter:blur(2px);
    animation:glassGlitch 9s ease-in-out 3s infinite;
  }
  @keyframes zoneFadeIn { from{opacity:0;} to{opacity:1;} }

  /* DCA Signal tile — periodic glitch: briefly unblurs GIF + reduces glass opacity */
  @keyframes gifGlitch {
    0%, 78%, 100% { opacity:0.18; filter:blur(4px) saturate(120%); transform:translateX(0); }
    79%  { opacity:0.45; filter:blur(1.5px) saturate(150%); transform:translateX(3px); }
    80%  { opacity:0.60; filter:blur(0px) saturate(180%); transform:translateX(-4px); }
    81%  { opacity:0.50; filter:blur(0.5px) saturate(160%); transform:translateX(2px); }
    82%  { opacity:0.35; filter:blur(2px) saturate(140%); transform:translateX(-1px); }
    83%  { opacity:0.20; filter:blur(3.5px) saturate(125%); transform:translateX(0); }
  }
  @keyframes glassGlitch {
    0%, 78%, 100% { opacity:1; }
    79%  { opacity:0.55; }
    80%  { opacity:0.35; }
    81%  { opacity:0.5; }
    82%  { opacity:0.7; }
    83%  { opacity:1; }
  }

  /* Accessibility: disable glitch animations for users who prefer reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .zone-bg-img { animation: zoneFadeIn .8s ease-out; }
    .zone-glass  { animation: none; }
  }

  /* Light mode: brighter overlay to keep text readable */
  :global(html.light) .zone-glass {
    background:linear-gradient(180deg, rgba(255,255,255,.78) 0%, rgba(255,255,255,.6) 40%, rgba(255,255,255,.75) 100%);
  }
  :global(html.light) .zone-bg-img { opacity:0.12; filter:blur(5px) saturate(80%); }
  :global(html.light) .signal-card { background:linear-gradient(180deg,rgba(247,147,26,.04) 0%,rgba(255,255,255,.72) 80px); }

  /* Mobile: slightly more opaque overlay for readability */
  @media (max-width:700px) {
    .zone-bg-img { opacity:0.14; filter:blur(5px); }
    .zone-glass { background:linear-gradient(180deg, rgba(14,14,14,.78) 0%, rgba(14,14,14,.62) 40%, rgba(14,14,14,.76) 100%); }
    :global(html.light) .zone-glass { background:linear-gradient(180deg, rgba(255,255,255,.82) 0%, rgba(255,255,255,.65) 40%, rgba(255,255,255,.8) 100%); }
  }
  .dca-hero    { text-align:center; padding:18px 0 16px; position:relative; z-index:2; }
  .dca-n       { display:block; font-size:clamp(3rem,7vw,5rem); font-weight:800; line-height:1; letter-spacing:-.045em; transition:color .5s,text-shadow .5s; }
  .dca-sub     { font-size:.62rem; color:var(--t2); text-transform:uppercase; letter-spacing:.12em; margin-top:8px; }
  @media (max-width:700px) {
    .dca-hero { padding:10px 0 10px; }
    .dca-n    { font-size:clamp(1.8rem,8vw,2.8rem); }
    .dca-sub  { margin-top:5px; }
  }

  /* Zone bar — redesigned with visual zones */
  .vband       { margin-bottom:18px; position:relative; z-index:2; }
  .vband-row   { display:flex; justify-content:space-between; align-items:center; margin-bottom:7px; }
  .vband-l     { font-size:.58rem; font-weight:600; }
  .vband-l.up  { color:var(--up); } .vband-l.dn { color:var(--dn); }
  .vband-track { height:8px; background:rgba(255,255,255,.04); border-radius:4px; overflow:hidden; position:relative; }
  .vband-zones { display:flex; height:100%; }
  .vzone { height:100%; }
  .vzone--low  { flex:1; background:linear-gradient(90deg,rgba(34,197,94,.4),rgba(34,197,94,.15)); }
  .vzone--mid  { flex:1; background:linear-gradient(90deg,rgba(247,147,26,.15),rgba(247,147,26,.25),rgba(247,147,26,.15)); }
  .vzone--high { flex:1; background:linear-gradient(90deg,rgba(239,68,68,.15),rgba(239,68,68,.4)); }
  .vband-dot {
    position:absolute; top:50%; transform:translate(-50%,-50%);
    width:14px; height:14px; border-radius:50%;
    background:var(--t1); border:2px solid var(--orange);
    box-shadow:0 0 10px rgba(247,147,26,.5);
    transition:left .8s cubic-bezier(.4,0,.2,1);
  }
  .vband-labels { display:flex; justify-content:space-between; margin-top:5px; font-size:.54rem; color:var(--t3); font-weight:500; }

  /* Signals */
  .sigs  { display:flex; flex-direction:column; gap:9px; padding:14px 0 0; border-top:1px solid rgba(255,255,255,.05); position:relative; z-index:2; }
  .sig   { display:flex; align-items:center; gap:11px; transition:opacity .2s; cursor:default; }
  .sig:not(.sig--on) { opacity:.28; }
  .pip-wrap  { position:relative; width:14px; height:14px; flex-shrink:0; }
  .pip       { width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.15); transition:all .25s; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); }
  .pip--on   { background:var(--orange); border-color:var(--orange); box-shadow:0 0 10px rgba(247,147,26,.6); }
  .pip-ring  { position:absolute; inset:0; border-radius:50%; background:rgba(247,147,26,.14); animation:rp 2s ease-out infinite; }
  @keyframes rp { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(2.6);opacity:0} }
  .sig-body  { flex:1; display:flex; flex-direction:column; gap:2px; min-width:0; }
  .sig-label { font-size:.72rem; color:var(--t1); opacity:.85; line-height:1.3; }
  .sig-val   { font-size:.58rem; color:var(--orange); opacity:.8; font-variant-numeric:tabular-nums; font-weight:600; }
  .sig-badge { font-size:.6rem; color:var(--orange); font-weight:600; background:rgba(247,147,26,.1); border:1px solid rgba(247,147,26,.22); padding:2px 8px; border-radius:3px; white-space:nowrap; flex-shrink:0; }
  :global(html.light) .sig-val { color:#c77a10; }

  /* ── LATEST BLOCK / MEMPOOL ──────────────────────────────── */
  .latest-block { margin-bottom:16px; padding-bottom:14px; border-bottom:1px solid rgba(255,255,255,.05); }
  .lb-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
  .lb-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  .lb-item { display:flex; flex-direction:column; gap:3px; align-items:center; text-align:center; }
  .lb-label { font-size:.56rem; text-transform:uppercase; letter-spacing:.1em; color:var(--t2); font-weight:500; }
  .lb-val { font-size:.82rem; font-weight:600; color:var(--t1); line-height:1.2; }
  .lb-miner { color:var(--orange); }
  .mempool-bar { margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,.05); }
  .mp-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  @media (max-width:500px) {
    .lb-grid, .mp-stats { grid-template-columns:repeat(2,1fr); gap:8px; }
    .lb-label { font-size:.54rem; }
    .lb-val { font-size:.78rem; }
  }

  /* Network + Stack shared */
  .met3  { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:14px; }
  .met   { display:flex; flex-direction:column; gap:7px; text-align:center; align-items:center; }
  .met-n { font-size:1.4rem; font-weight:700; letter-spacing:-.03em; line-height:1; color:var(--t1); }
  .met-u { font-size:.48em; color:var(--t2); font-weight:400; margin-left:2px; }
  .btc-pill  { display:flex; align-items:baseline; padding:12px 14px; background:rgba(247,147,26,.05); border:1px solid rgba(247,147,26,.12); border-radius:8px; margin-bottom:16px; flex-wrap:wrap; gap:4px; }
  .goal-head { display:flex; justify-content:space-between; margin-bottom:7px; }
  @media (max-width:500px) {
    .met3 { grid-template-columns:repeat(3,1fr); gap:6px; margin-top:10px; }
    .met-n { font-size:1rem; }
    .met { gap:4px; }
    .btc-pill { padding:8px 10px; margin-bottom:12px; }
  }

  /* ── HASH RATE ROW ───────────────────────────────────────── */
  .hash-row { display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,.05); }
  .hash-val { font-size:1rem; font-weight:700; color:var(--t1); font-variant-numeric:tabular-nums; }
  :global(html.light) .hash-row { border-top-color:rgba(0,0,0,.06); }

  /* ── PRICE SCENARIOS ─────────────────────────────────────── */
  .price-scen { margin-top:16px; padding-top:14px; border-top:1px solid rgba(255,255,255,.05); }
  .scen-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
  .scen-item { display:flex; flex-direction:column; gap:3px; align-items:center; text-align:center;
    background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); border-radius:8px; padding:10px 6px;
    transition:transform .2s, border-color .2s;
  }
  .scen-item:hover { transform:translateY(-2px); border-color:rgba(247,147,26,.15); }
  .scen-price { font-size:.54rem; color:var(--t2); font-weight:600; text-transform:uppercase; letter-spacing:.06em; }
  .scen-val { font-size:.8rem; font-weight:700; letter-spacing:-.02em; line-height:1.2; }
  .scen-pct { font-size:.58rem; font-weight:600; }
  :global(html.light) .price-scen { border-top-color:rgba(0,0,0,.06); }
  :global(html.light) .scen-item { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.06); }
  @media (max-width:500px) { .scen-grid { grid-template-columns:repeat(2,1fr); } }

  /* ── PORTFOLIO GRID ─────────────────────────────────────── */
  .port-grid { display:grid; grid-template-columns:1fr 1.6fr; gap:14px; }
  @media (max-width:1000px) { .port-grid{grid-template-columns:1fr;} }

  .asset-panels { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:4px; }
  .ap {
    background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07);
    border-radius:8px; padding:16px 14px; position:relative; overflow:hidden;
    transition:transform .3s, border-color .3s, box-shadow .25s; text-align:center;
  }
  .ap::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; background:linear-gradient(90deg,transparent,var(--pc,rgba(247,147,26,.5)),transparent); }
  .ap:hover { transform:translateY(-4px); border-color:rgba(255,255,255,.14); box-shadow:0 10px 28px rgba(0,0,0,.3); }
  .ap-top { display:flex; align-items:center; gap:9px; margin-bottom:12px; }
  .ap-icon { font-size:1.2rem; line-height:1; }
  .ap-ticker { font-size:.8rem; font-weight:700; }
  .ap-name { font-size:.58rem; color:var(--t2); margin-top:1px; }
  .ap-pct { font-size:1.9rem; font-weight:800; letter-spacing:-.04em; line-height:1; margin-bottom:3px; }
  .ap-sub { font-size:.62rem; color:var(--t2); margin-bottom:0; font-variant-numeric:tabular-nums; }
  .ap-live { font-size:.5em; color:var(--up); margin-left:4px; animation:blink 2s ease-in-out infinite; vertical-align:middle; }
  @keyframes apPulse { 0%,100%{opacity:.4} 50%{opacity:.8} }
  @media (max-width:400px) { .asset-panels { grid-template-columns:1fr; } .ap-pct { font-size:1.5rem; } }

  .gf-hero { display:flex; align-items:flex-end; gap:20px; flex-wrap:wrap; margin-bottom:18px; }
  .gf-nw   { font-size:2.4rem; font-weight:700; letter-spacing:-.045em; line-height:1; color:var(--t1); }
  .gf-cpi  { opacity:.5; cursor:help; }
  .gf-est  { font-size:.5em; opacity:.6; }
  .gf-perf { display:flex; align-items:flex-end; gap:18px; flex-wrap:wrap; flex:1; border-left:1px solid rgba(255,255,255,.06); padding-left:20px; min-width:0; }
  .gfp     { display:flex; flex-direction:column; gap:6px; }
  .gfp-v   { font-size:1.2rem; font-weight:700; letter-spacing:-.025em; line-height:1; }
  /* Live indicator dot (used in portfolio and loading states) */
  .live-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--up); flex-shrink:0; }
  .bench   { display:flex; border:1px solid rgba(255,255,255,.07); border-radius:8px; overflow:hidden; margin-bottom:18px; background:rgba(255,255,255,.02); flex-wrap:wrap; }
  .bench-c { flex:1; padding:14px; border-right:1px solid rgba(255,255,255,.06); display:flex; flex-direction:column; gap:5px; min-width:80px; align-items:center; text-align:center; }
  .bench-c:last-child { border-right:none; }
  .bench-v { font-size:1.15rem; font-weight:700; letter-spacing:-.025em; line-height:1; }
  .bench-vs { font-size:.6rem; }
  .holdings-wrap { border-top:1px solid rgba(255,255,255,.05); padding-top:16px; }
  .holdings-head { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
  .sort-btns { display:flex; gap:2px; background:rgba(255,255,255,.05); border-radius:6px; padding:2px; }
  .sort-btn { padding:3px 10px; font-size:.52rem; font-weight:700; letter-spacing:.08em;
    background:none; border:none; color:var(--t2); cursor:pointer; border-radius:4px; transition:all .2s; text-transform:uppercase; }
  .sort-btn--active { background:rgba(247,147,26,.7); color:#fff; box-shadow:0 1px 6px rgba(247,147,26,.3); }
  .hgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(148px,1fr)); gap:8px; margin-top:14px; }
  .h-card { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); border-radius:8px; padding:14px; transition:transform .25s, border-color .25s, box-shadow .25s; }
  .h-card:hover { transform:translateY(-3px); border-color:rgba(247,147,26,.18); box-shadow:0 8px 24px rgba(0,0,0,.25); }
  .h-top  { display:flex; justify-content:space-between; align-items:flex-start; gap:6px; margin-bottom:3px; }
  .h-sym  { font-size:.88rem; font-weight:700; color:var(--t1); }
  .h-cls  { font-size:.48rem; font-weight:600; padding:2px 6px; border-radius:999px; text-transform:uppercase; letter-spacing:.06em; white-space:nowrap; flex-shrink:0; margin-top:2px; display:inline-block; }
  .h-pct  { font-size:.68rem; font-weight:600; white-space:nowrap; }
  .h-name { font-size:.6rem; color:var(--t2); margin-bottom:0; }
  .h-foot { display:flex; justify-content:space-between; font-size:.62rem; color:var(--t2); }

  /* ── GHOSTFOLIO SUMMARY STRIP ────────────────────────────── */
  .gf-summary { display:flex; flex-wrap:wrap; gap:12px; margin:0 0 16px; border:1px solid rgba(255,255,255,.06); border-radius:8px; padding:14px 16px; background:rgba(255,255,255,.02); }
  .gf-sum-item { display:flex; flex-direction:column; gap:5px; flex:1; min-width:80px; }
  .gf-sum-v { font-size:1rem; font-weight:700; letter-spacing:-.02em; color:var(--t1); line-height:1; }
  :global(html.light) .gf-summary { border-color:rgba(0,0,0,.08); background:rgba(0,0,0,.02); }

  /* Small icon refresh button */
  .btn-icon {
    display:inline-flex; align-items:center; justify-content:center;
    width:26px; height:26px; padding:0; border-radius:50%;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1);
    color:rgba(255,255,255,.4); font-size:.72rem; cursor:pointer; transition:all .2s;
    flex-shrink:0;
  }
  .btn-icon:hover { border-color:rgba(247,147,26,.3); color:var(--orange); background:rgba(247,147,26,.06); transform:rotate(45deg); }
  :global(html.light) .btn-icon { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.12); color:rgba(0,0,0,.5); }
  :global(html.light) .btn-icon:hover { border-color:rgba(247,147,26,.3); color:#c77a10; background:rgba(247,147,26,.06); }

  /* ── ASSET CLASS ALLOCATION ──────────────────────────────── */
  .alloc-wrap { margin-bottom:18px; padding-top:16px; border-top:1px solid rgba(255,255,255,.05); }
  .alloc-bar { height:8px; border-radius:4px; overflow:hidden; display:flex; gap:1px; margin-bottom:12px; background:rgba(255,255,255,.03); }
  .alloc-seg { height:100%; transition:width .5s ease; min-width:2px; }
  .alloc-legend { display:flex; flex-wrap:wrap; gap:8px 14px; }
  .alloc-item { display:flex; align-items:center; gap:5px; }
  .alloc-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
  .alloc-name { font-size:.6rem; color:var(--t2); }
  .alloc-pct { font-size:.6rem; font-weight:700; color:var(--t1); }
  :global(html.light) .alloc-wrap { border-top-color:rgba(0,0,0,.06); }
  :global(html.light) .alloc-bar { background:rgba(0,0,0,.04); }
  :global(html.light) .sort-btns { background:rgba(0,0,0,.06); }
  @media (max-width:600px) {
    .gf-nw { font-size:1.8rem; }
    .gf-perf { border-left:none; padding-left:0; border-top:1px solid rgba(255,255,255,.06); padding-top:14px; width:100%; }
    .gfp-v { font-size:1rem; }
    .bench-c { padding:10px 12px; min-width:70px; }
    .bench-v { font-size:1rem; }
  }

  /* ── INTEL TOGGLE — Apple-style ────────────────────────── */
  .intel-toggle-wrap { display:flex; align-items:center; gap:8px; margin-left:auto; }
  .toggle-icon { font-size:.9rem; color:var(--t3); transition:color .3s; line-height:1; cursor:default; }
  .toggle-icon--active { color:var(--orange); }
  .apple-toggle {
    position:relative; width:44px; height:26px;
    background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.15);
    border-radius:13px; cursor:pointer;
    transition:background .3s, border-color .3s;
    padding:0; flex-shrink:0;
  }
  .apple-toggle--classic { background:var(--orange); border-color:var(--orange); }
  .apple-knob {
    position:absolute; top:3px; left:3px;
    width:18px; height:18px; border-radius:50%;
    background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.35);
    transition:transform .3s cubic-bezier(.4,0,.2,1);
  }
  .apple-toggle--classic .apple-knob { transform:translateX(18px); }
  :global(html.light) .apple-toggle { background:rgba(0,0,0,.15); border-color:rgba(0,0,0,.2); }
  :global(html.light) .apple-toggle--classic { background:var(--orange); border-color:var(--orange); }
  :global(html.light) .toggle-icon { color:rgba(0,0,0,.3); }
  :global(html.light) .toggle-icon--active { color:#c77a10; }

  /* ── INTEL GRID ─────────────────────────────────────────── */
  .intel-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  @media (max-width:900px) { .intel-grid{grid-template-columns:1fr;} }
  @media (max-width:700px) {
    .intel-grid .gc { overflow:hidden; padding:12px 10px; }
  }

  /* ── MARKETS LOADING SKELETON ────────────────────────────── */
  .markets-loading { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; padding:4px 0; }
  @media (max-width:900px) { .markets-loading { grid-template-columns:repeat(2,1fr); } }
  @media (max-width:600px) { .markets-loading { grid-template-columns:1fr; } }

  /* ── POLYMARKET CARD GRID — max 3 columns (3x4 = 12 tiles) ── */
  .pm-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  @media (max-width:900px) { .pm-grid { grid-template-columns:repeat(2,1fr); } }
  @media (max-width:600px) { .pm-grid { grid-template-columns:1fr; } }
  .pm-card {
    display:flex; flex-direction:column; gap:8px;
    background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07); border-radius:10px;
    padding:16px 14px; text-decoration:none; transition:transform .2s, border-color .25s, box-shadow .25s;
    position:relative; overflow:hidden;
  }
  .pm-card::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent); }
  .pm-card:hover { transform:translateY(-4px); border-color:rgba(247,147,26,.22); box-shadow:0 10px 28px rgba(0,0,0,.35); }
  .pm-card-tags { display:flex; gap:4px; flex-wrap:wrap; }
  .pm-tag { font-size:.54rem; font-weight:600; text-transform:uppercase; letter-spacing:.07em; padding:2px 8px; border-radius:999px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); color:var(--t2); }
  .pm-pin { background:rgba(247,147,26,.09); border-color:rgba(247,147,26,.26); color:var(--orange); }
  .pm-news-src { background:rgba(247,147,26,.09); border-color:rgba(247,147,26,.26); color:var(--orange); }
  .pm-card-q { font-size:.84rem; color:var(--t1); line-height:1.5; font-weight:500; flex:1; }
  .pm-outcomes { display:flex; gap:8px; }
  .pm-outcomes--multi { flex-wrap:wrap; }
  .pm-outcomes--multi .pm-outcome { flex:1; min-width:calc(33% - 6px); }
  .pm-outcome { display:flex; align-items:center; justify-content:space-between; gap:6px;
    flex:1; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07); border-radius:6px; padding:8px 10px; }
  .pm-outcome-name { font-size:.64rem; font-weight:700; color:var(--t1); text-transform:uppercase; letter-spacing:.05em; }
  .pm-outcome-pct { font-size:1.1rem; font-weight:800; letter-spacing:-.03em; line-height:1; }
  .pm-bar { height:4px; background:rgba(255,255,255,.05); border-radius:2px; overflow:hidden; display:flex; }
  .pm-fill { height:100%; border-radius:2px 0 0 2px; transition:width .6s; opacity:.75; }
  .pm-fill-rest { height:100%; border-radius:0 2px 2px 0; background:rgba(255,255,255,.04); transition:width .6s; }
  .pm-meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  @media (max-width:600px) {
    .pm-grid { grid-template-columns:1fr; }
    .pm-card-q { font-size:.78rem; }
    .pm-outcome-pct { font-size:.95rem; }
  }
  :global(html.light) .pm-card { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.07); }
  :global(html.light) .pm-card:hover { border-color:rgba(247,147,26,.2); }
  :global(html.light) .pm-tag { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.08); color:rgba(0,0,0,.5); }
  :global(html.light) .pm-card-q { color:rgba(0,0,0,.75); }
  :global(html.light) .pm-outcome { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.07); }
  :global(html.light) .pm-bar { background:rgba(0,0,0,.05); }
  :global(html.light) .pm-fill-rest { background:rgba(0,0,0,.04); }

  /* ── NEWS CARD (Classic view — matches Polymarket card style) ─── */
  .news-card-img {
    width:100%; height:100px; border-radius:6px; overflow:hidden;
    background-size:cover; background-position:center;
    flex-shrink:0;
    filter:saturate(80%);
  }
  .news-card-desc { font-size:.68rem; color:var(--t2); line-height:1.55; opacity:.75; }
  :global(html.light) .news-card-desc { color:rgba(0,0,0,.45); }
  :global(html.light) .pm-news-src { background:rgba(247,147,26,.08); border-color:rgba(247,147,26,.25); color:#c77a10; }

  /* Intel section: no forced full-height — content determines height */
  #intel.section { min-height: auto; padding-bottom: 64px; }
  @media (max-width:700px) {
    #intel.section { padding-top: 20px; }
    #intel .section-header { margin-bottom: 10px; }
  }

  /* ── FEED CAROUSEL ───────────────────────────────────────── */
  /* Desktop: normal vertical list flow */
  .feed-carousel { display:block; }

  /* Animation keyframes kept for potential future use */
  @keyframes feedScroll {
    from { transform:translateX(0); }
    to   { transform:translateX(-50%); }
  }

  @media (max-width:700px) {
    /* Mobile: static vertical list, no auto-scroll */
    .feed-carousel { display:block; }

    /* Limit feed to first 5 items on mobile */
    .news-slide:nth-child(n+6),
    .mkt-slide:nth-child(n+6) { display:none; }

    /* Restore normal block layout for slides */
    .news-slide, .mkt-slide {
      min-width:unset;
      flex-shrink:unset;
    }
  }

  /* Prediction market — PolyMarket-inspired */
  .mkt {
    display:block; border-bottom:1px solid rgba(255,255,255,.05);
    text-decoration:none; transition:background .2s; border-radius:6px; margin:0 -8px; padding:12px 8px;
  }
  .mkt:last-child { border-bottom:none; }
  .mkt:hover { background:rgba(255,255,255,.04); }
  .mkt-row { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; margin-bottom:8px; }
  .mkt-left { flex:1; min-width:0; }
  .mkt-right { flex-shrink:0; text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:5px; }
  .mkt-tags { margin-bottom:5px; }
  .mkt-q { font-size:.84rem; color:var(--t1); line-height:1.5; display:block; margin-bottom:5px; font-weight:500; }
  .mkt-prob { font-size:1.9rem; font-weight:800; line-height:1; letter-spacing:-.04em; }
  .mkt-pct { font-size:.65rem; font-weight:600; opacity:.55; }
  .mkt-outcome-badge { font-size:.58rem; font-weight:700; padding:3px 8px; border-radius:4px; border:1px solid; white-space:nowrap; text-transform:uppercase; letter-spacing:.04em; }
  .mkt-bar { height:5px; background:rgba(255,255,255,.04); border-radius:3px; overflow:hidden; display:flex; }
  .mkt-fill { height:100%; border-radius:3px 0 0 3px; transition:width .7s; opacity:.75; }
  .mkt-fill-rest { height:100%; border-radius:0 3px 3px 0; background:rgba(255,255,255,.04); transition:width .7s; }
  .mkt-meta-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:3px; }
  .mkt-tag { font-size:.56rem; font-weight:600; text-transform:uppercase; letter-spacing:.07em; padding:3px 8px; border-radius:999px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); color:var(--t2); }
  .mkt-pin { background:rgba(247,147,26,.09); border-color:rgba(247,147,26,.24); color:var(--orange); }
  @media (max-width:500px) { .mkt-prob { font-size:1.5rem; } .mkt-q { font-size:.78rem; } }

  .news {
    display:block; padding:0; border-bottom:1px solid rgba(255,255,255,.05); text-decoration:none;
    overflow:hidden; border-radius:10px; margin-bottom:10px; transition:transform .2s, box-shadow .25s;
  }
  .news:last-child { border-bottom:none; margin-bottom:0; }
  .news:hover { transform:translateY(-2px); box-shadow:0 6px 20px rgba(0,0,0,.3); }
  /* News item with image */
  .news-img {
    position:relative; background-size:cover; background-position:center; border-radius:8px;
    min-height:120px; display:flex; flex-direction:column; justify-content:flex-end; overflow:hidden;
  }
  .news-img::before {
    content:''; position:absolute; inset:-6px;
    background:inherit; background-size:cover; background-position:center;
    filter:blur(8px) saturate(110%) sepia(15%); z-index:0; border-radius:8px;
    transform:scale(1.05);
  }
  .news-img-overlay {
    position:absolute; inset:0; z-index:1; background:linear-gradient(180deg, rgba(247,147,26,.07) 0%, rgba(15,7,0,.72) 55%, rgba(8,3,0,.92) 100%);
    border-radius:8px;
  }
  .news-img-content {
    position:relative; z-index:2; padding:14px 14px 12px;
  }
  .news-img-content .news-title { color:#fff; opacity:.95; margin-bottom:5px; font-size:.82rem; line-height:1.45; }
  .news-img-content .news-meta { opacity:.8; }
  /* News item without image */
  .news-title { display:block; font-size:.82rem; color:var(--t1); opacity:.75; line-height:1.5; margin-bottom:5px; transition:opacity .2s; padding:10px 0 0; font-weight:500; }
  .news:hover .news-title { opacity:1; }
  .news-meta { display:flex; gap:10px; align-items:center; padding-bottom:10px; }
  .news-src { font-size:.62rem; color:var(--orange); font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
  .news-desc { font-size:.68rem; color:var(--t2); line-height:1.55; margin-bottom:6px; opacity:.75; }
  :global(html.light) .news-desc { color:rgba(0,0,0,.45); }
  :global(html.light) .news { border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .news-title { color:rgba(0,0,0,.65); }
  :global(html.light) .news:hover .news-title { color:#111; }
  :global(html.light) .news-src { color:#c77a10; }
  :global(html.light) .news-img-overlay { background:linear-gradient(180deg, rgba(0,0,0,.08) 0%, rgba(0,0,0,.6) 70%, rgba(0,0,0,.82) 100%); }

  /* ── LIGHT MODE OVERRIDES (page-level) ────────────────── */
  :global(html.light) .price-label-usd { color:rgba(0,0,0,.45); }
  :global(html.light) .sats-cur { color:#111; }
  :global(html.light) .pbar { background:rgba(0,0,0,.06); }
  :global(html.light) .vband-track { background:rgba(0,0,0,.04); }
  :global(html.light) .vband-dot { background:#fff; border-color:var(--orange); }
  :global(html.light) .vzone--low  { background:linear-gradient(90deg,rgba(22,163,74,.25),rgba(22,163,74,.08)); }
  :global(html.light) .vzone--mid  { background:linear-gradient(90deg,rgba(200,122,16,.08),rgba(200,122,16,.15),rgba(200,122,16,.08)); }
  :global(html.light) .vzone--high { background:linear-gradient(90deg,rgba(220,38,38,.08),rgba(220,38,38,.25)); }
  :global(html.light) .vband-labels { color:rgba(0,0,0,.35); }
  :global(html.light) .latest-block { border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .mempool-bar { border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .lb-miner { color:#c77a10; }
  :global(html.light) .lb-label { color:rgba(0,0,0,.45); }
  :global(html.light) .sigs { border-top-color:rgba(0,0,0,.06); }
  :global(html.light) .pip { background:rgba(0,0,0,.06); border-color:rgba(0,0,0,.12); }
  :global(html.light) .mkt { border-bottom-color:rgba(0,0,0,.06); }
  :global(html.light) .mkt:hover { background:rgba(0,0,0,.02); }
  :global(html.light) .mkt-bar { background:rgba(0,0,0,.04); }
  :global(html.light) .mkt-fill { opacity:.55; }
  :global(html.light) .mkt-fill-rest { background:rgba(0,0,0,.04); }
  :global(html.light) .mkt-tag { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.08); color:rgba(0,0,0,.5); }
  :global(html.light) .mkt-q { color:rgba(0,0,0,.75); }
  :global(html.light) .btc-pill { background:rgba(247,147,26,.04); border-color:rgba(247,147,26,.15); }
  :global(html.light) .ap { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.06); }
  :global(html.light) .ap:hover { border-color:rgba(0,0,0,.12); }
  :global(html.light) .gf-perf { border-left-color:rgba(0,0,0,.08); }
  :global(html.light) .bench { border-color:rgba(0,0,0,.08); background:rgba(0,0,0,.02); }
  :global(html.light) .bench-c { border-right-color:rgba(0,0,0,.06); }
  :global(html.light) .h-card { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.06); }
  :global(html.light) .h-card:hover { border-color:rgba(247,147,26,.2); }
  :global(html.light) .holdings-wrap { border-top-color:rgba(0,0,0,.06); }
</style>
