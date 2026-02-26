<script lang="ts">
  import { onMount } from 'svelte';
  import {
    settings, btcPrice, goldPriceUsd, sp500Price, btcYtdPct, goldYtdPct,
    sp500YtdPct, cpiAnnual, gfNetWorth, gfTotalInvested, gfNetGainPct, gfNetGainYtdPct,
    gfTodayChangePct, gfHoldings, gfError, gfLoading, gfUpdated,
    gfDividendTotal, gfDividendYtd, gfCash, gfFirstOrderDate, gfOrdersCount, gfPortfolioChart,
    persistSettings
  } from '$lib/store';
  import PriceChart from '$lib/PriceChart.svelte';
  import CompareChart from '$lib/CompareChart.svelte';

  $: displayCur = ($settings.displayCurrency ?? 'AUD').toUpperCase();

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

  async function setBtcChartRange(r: '1D' | '1W' | '1Y' | '5Y' | 'MAX') {
    btcChartRange = r;
    await fetchBtcChart(r);
    if (btcChartView === 'compare') await fetchCompareChart(r);
  }

  let btcChartView: 'price' | 'compare' = 'price';
  let compareData: { btc: { t: number; p: number }[]; sp500: { t: number; p: number }[]; gold: { t: number; p: number }[] } = { btc: [], sp500: [], gold: [] };
  let compareLoading = false;
  let showCompareAnnual = false;

  async function fetchCompareChart(r = btcChartRange) {
    compareLoading = true;
    try {
      const map: Record<string, string> = { '1D': '1d', '1W': '7d', '1Y': '1y', '5Y': '5y' };
      const d = await fetch(`/api/compare?range=${map[r]}`).then(res => res.json());
      compareData = { btc: d.btc ?? [], sp500: d.sp500 ?? [], gold: d.gold ?? [] };
    } catch { compareData = { btc: [], sp500: [], gold: [] }; }
    finally { compareLoading = false; }
  }

  async function setChartView(view: 'price' | 'compare') {
    btcChartView = view;
    if (view === 'compare') {
      btcChartRange = '5Y';
      await fetchCompareChart('5Y');
    }
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

  let _lastCompareBtcPrice = 0;
  $: if ($btcPrice > 0 && btcChartView === 'compare' && compareData.btc.length > 0) {
    const changePct = _lastCompareBtcPrice > 0 ? Math.abs($btcPrice - _lastCompareBtcPrice) / _lastCompareBtcPrice : 1;
    if (changePct >= 0.0005) {
      _lastCompareBtcPrice = $btcPrice;
      compareData = { ...compareData, btc: [...compareData.btc.slice(0, -1), { t: Date.now(), p: $btcPrice }] };
    }
  }
  let _lastCompareGoldPrice = 0;
  $: if ($goldPriceUsd !== null && $goldPriceUsd > 0 && $goldPriceUsd !== _lastCompareGoldPrice && btcChartView === 'compare' && compareData.gold.length > 0) {
    _lastCompareGoldPrice = $goldPriceUsd;
    compareData = { ...compareData, gold: [...compareData.gold.slice(0, -1), { t: Date.now(), p: $goldPriceUsd }] };
  }
  let _lastCompareSp500Price = 0;
  $: if ($sp500Price !== null && $sp500Price > 0 && $sp500Price !== _lastCompareSp500Price && btcChartView === 'compare' && compareData.sp500.length > 0) {
    _lastCompareSp500Price = $sp500Price;
    compareData = { ...compareData, sp500: [...compareData.sp500.slice(0, -1), { t: Date.now(), p: $sp500Price }] };
  }

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
        $gfFirstOrderDate=d.firstOrderDate??null;
        $gfOrdersCount=d.ordersCount??null;
        $gfPortfolioChart=d.portfolioChart??[];
        $gfUpdated=new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});
      }
    }
    catch{$gfError='Connection failed';}finally{$gfLoading=false;}
  }

  function btcApiRange(r = btcChartRange): string {
    const map: Record<string,string> = { '1D':'1d', '1W':'7d', '1Y':'1y', '5Y':'5y', 'MAX':'max' };
    return map[r] ?? '1d';
  }

  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

  $: annualCpiLoss = (()=>{if($cpiAnnual===null)return 0;return(1-1/Math.pow(1+$cpiAnnual/100,1))*100;})();

  const n   = (v:number, dec=0) => v.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  const pct = (v:number|null)   => v===null?'—':(v>=0?'+':'')+v.toFixed(2)+'%';
  const sc  = (v:number|null)   => v===null?'var(--t3)':v>=0?'var(--up)':'var(--dn)';
  const fmtDate = (d:string) => {try{return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}catch{return '';}};

  onMount(() => {
    fetchBtcChart();
  });
</script>

<section id="portfolio" class="section" aria-label="Portfolio">
  <div class="section-header">
    <h2 class="sect-title">Portfolio</h2>
  </div>

  <!-- MOBILE ONLY: merged portfolio summary tile -->
  <div class="gc mobile-port-summary">
    <div class="gc-head" style="margin-bottom:16px;">
      <p class="gc-title">Portfolio</p>
      <div style="display:flex;align-items:center;gap:8px;">
        {#if $gfLoading}<span class="live-dot blink" role="status" aria-label="Loading portfolio data"></span>{/if}
        {#if $gfUpdated && !$gfLoading && $settings.ghostfolio?.token}<span class="ts">{$gfUpdated}</span>{/if}
      </div>
    </div>
    {#if $settings.ghostfolio?.token && !$gfError && $gfNetWorth !== null}
      <div class="mps-nw-block">
        <p class="eyebrow" style="margin-bottom:6px;">Net Worth</p>
        <p class="mps-nw">{$gfNetWorth !== null ? '$'+n($gfNetWorth,0) : '—'}</p>
        <p class="eyebrow" style="margin-top:4px;">{$settings.ghostfolio?.currency||'AUD'}</p>
      </div>
      <div class="mps-perf-row">
        <div class="mps-perf-item">
          <p class="eyebrow">Today</p>
          <p class="mps-perf-v" style="color:{sc($gfTodayChangePct)};">{pct($gfTodayChangePct)}</p>
        </div>
        <div class="mps-perf-item">
          <p class="eyebrow">YTD</p>
          <p class="mps-perf-v" style="color:{sc($gfNetGainYtdPct)};">{pct($gfNetGainYtdPct)}</p>
        </div>
        <div class="mps-perf-item">
          <p class="eyebrow">All-time</p>
          <p class="mps-perf-v" style="color:{sc($gfNetGainPct)};">{pct($gfNetGainPct)}</p>
        </div>
      </div>
    {/if}
    <!-- Compact asset comparison: BTC / Gold / SPX -->
    <div class="mps-assets" class:mps-assets--solo={!($settings.ghostfolio?.token && !$gfError && $gfNetWorth !== null)}>
      {#each [
        {ticker:'BTC', icon:'₿', pct:$btcYtdPct,   color:'#f7931a'},
        {ticker:'XAU', icon:'◈', pct:$goldYtdPct,  color:'#c9a84c'},
        {ticker:'SPX', icon:'↗', pct:$sp500YtdPct, color:'#888'},
      ] as a}
        <div class="mps-asset-item">
          <p class="mps-asset-ticker" style="color:{a.color};">{a.icon} {a.ticker}</p>
          <p class="mps-asset-pct" style="color:{a.pct===null?a.color:a.pct>=0?'var(--up)':'var(--dn)'};">{a.pct !== null ? (a.pct >= 0 ? '+' : '') + a.pct.toFixed(1) + '%' : '—'}</p>
          <p class="eyebrow">YTD</p>
        </div>
      {/each}
    </div>
  </div>

  <div class="port-grid">

    <!-- ASSET COMPARISON -->
    <div class="gc">
      <div class="gc-head">
        <p class="gc-title">Asset Comparison</p>
        <div style="display:flex;align-items:center;gap:8px;">
            <p class="dim" title="Year-to-date performance in USD via Yahoo Finance">YTD (USD)</p>
          </div>
      </div>
      <div class="asset-panels">
        {#each [
          {ticker:'BTC', name:'Bitcoin',  icon:'₿', pct:$btcYtdPct,   color:'#f7931a', sub:$btcPrice?'$'+n($btcPrice):'—'},
          {ticker:'XAU', name:'Gold',     icon:'◈', pct:$goldYtdPct,  color:'#c9a84c', sub:$goldPriceUsd?'$'+n($goldPriceUsd,0)+' USD/oz':'—'},
          {ticker:'SPX', name:'S&P 500',  icon:'↗', pct:$sp500YtdPct, color:'#888',    sub:$sp500Price?'$'+n($sp500Price,0):'—'},
          {ticker:'CPI', name:'Inflation',icon:'↓', pct:$cpiAnnual,   color:'#ef4444', sub:'Annual rate'},
        ] as a}
          <div class="ap" style="--pc:{a.color};">
            <div class="ap-top">
              <span class="ap-icon" style="color:{a.color};">{a.icon}</span>
              <div>
                <p class="ap-ticker" style="color:{a.color};">{a.ticker}</p>
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
      {#if $cpiAnnual!==null}<p class="dim" style="margin-top:14px;line-height:1.6;">Purchasing power erosion (annual): <span style="color:var(--dn);">−{annualCpiLoss.toFixed(1)}%</span></p>{/if}
    </div>

    <!-- GHOSTFOLIO -->
    <div class="gc" class:gc--no-token={!$settings.ghostfolio?.token}>
      {#if !$settings.ghostfolio?.token}
        <div class="gc-head" style="margin-bottom:12px;"><p class="gc-title">Connect Ghostfolio</p></div>
        <p class="dim" style="line-height:1.7;margin-bottom:8px;">Add your Ghostfolio security token in Settings to see full portfolio performance and holdings.</p>
        <p class="dim" style="line-height:1.6;">Your token is stored locally in your browser only.</p>
      {:else}
        <div class="gc-head" style="margin-bottom:20px;">
          <p class="gc-title">Portfolio</p>
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
            <div class="gf-nw-block">
              <p class="eyebrow">Net Worth</p>
              <p class="gf-nw">{$gfNetWorth!==null?'$'+n($gfNetWorth,0):'—'}</p>
              <p class="eyebrow" style="margin-top:4px;">{$settings.ghostfolio.currency||'AUD'}</p>
            </div>
            <div class="gf-perf">
              <div class="gfp"><p class="eyebrow">Today's Increase</p><p class="gfp-v" style="color:{sc($gfTodayChangePct)};">{pct($gfTodayChangePct)}</p></div>
              <div class="gfp" title="Portfolio YTD performance from Ghostfolio"><p class="eyebrow">YTD <span style="font-size:.45rem;opacity:.6;">via GF</span></p><p class="gfp-v" style="color:{sc($gfNetGainYtdPct)};">{pct($gfNetGainYtdPct)}</p></div>
              <div class="gfp" title="Total return since portfolio inception (from Ghostfolio data)">
                <p class="eyebrow">All-Time</p><p class="gfp-v" style="color:{sc($gfNetGainPct)};">{pct($gfNetGainPct)}</p>
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

          <!-- PORTFOLIO PERFORMANCE CHART -->
          {#if $gfPortfolioChart.length >= 2}
          <div class="perf-chart-wrap">
            <div class="perf-chart-head">
              <p class="eyebrow">Performance <span style="opacity:.5;">since inception · % return</span></p>
              {#if $gfFirstOrderDate}<span class="dim">from {fmtDate($gfFirstOrderDate)}</span>{/if}
            </div>
            <PriceChart
              prices={$gfPortfolioChart}
              height={200}
              range="max"
              formatY={fmtPct}
            />
          </div>
          {/if}
        {/if}
      {/if}
    </div>

  </div>

  <!-- BITCOIN PRICE CHART — full width below the two tiles -->
  <div class="gc btc-chart-card" style="margin-top:14px;">
    <div class="chart-header">
      <p class="gc-title">{btcChartView === 'compare' ? 'BTC · S&P · Gold' : 'Bitcoin Price'}</p>
      <div class="chart-controls">
        <!-- View toggle: Price / Compare -->
        <div class="chart-range-btns" role="group" aria-label="Chart view">
          <button class="crb" class:crb--active={btcChartView==='price'} on:click={() => setChartView('price')} aria-pressed={btcChartView==='price'}>Price</button>
          <button class="crb" class:crb--active={btcChartView==='compare'} on:click={() => setChartView('compare')} aria-pressed={btcChartView==='compare'} title="Indexed comparison: BTC vs S&P 500 vs Gold">Compare</button>
        </div>
        <!-- Range buttons -->
        <div class="chart-range-btns" role="group" aria-label="Chart time range">
          {#if btcChartView === 'price'}
            <button class="crb" class:crb--active={btcChartRange==='1D'} on:click={() => setBtcChartRange('1D')}>1D</button>
            <button class="crb" class:crb--active={btcChartRange==='1W'} on:click={() => setBtcChartRange('1W')}>1W</button>
          {/if}
          <button class="crb" class:crb--active={btcChartRange==='1Y'} on:click={() => setBtcChartRange('1Y')}>1Y</button>
          <button class="crb" class:crb--active={btcChartRange==='5Y'} on:click={() => setBtcChartRange('5Y')}>5Y</button>
          {#if btcChartView === 'price'}
            <button class="crb" class:crb--active={btcChartRange==='MAX'} on:click={() => setBtcChartRange('MAX')}>Max</button>
          {/if}
        </div>
        <!-- Compare extras: % annual returns toggle -->
        {#if btcChartView === 'compare'}
          <div class="chart-range-btns" role="group" aria-label="Compare chart options">
            <button class="crb" class:crb--active={showCompareAnnual} on:click={() => showCompareAnnual = !showCompareAnnual} aria-pressed={showCompareAnnual} title="Show annual returns table">%</button>
          </div>
        {/if}
      </div>
    </div>

    <div class="chart-container">
      {#if btcChartView === 'compare'}
        {#if compareLoading}
          <div class="skeleton" style="height:220px;border-radius:6px;"></div>
        {:else}
          <CompareChart
            btc={compareData.btc}
            sp500={compareData.sp500}
            gold={compareData.gold}
            range={btcChartRange}
            showAnnualOverlay={showCompareAnnual}
          />
        {/if}
      {:else if btcChartLoading}
        <div class="skeleton" style="height:160px;border-radius:6px;"></div>
      {:else if btcChartData.length >= 2}
        <PriceChart
          prices={btcChartData}
          fillParent={true}
          range={btcApiRange()}
        />
      {:else}
        <p class="dim" style="text-align:center;padding:60px 0;">Loading chart data…</p>
      {/if}
    </div>
  </div>

</section>
