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
    gfDividendTotal, gfDividendYtd, gfCash, gfFirstOrderDate, gfOrdersCount,
    markets, marketsUpdated, newsItems, breakingNewsLinks, btcDisplayPrice, btcWsConnected,
    btcHashrate, gfPortfolioChart
  } from '$lib/store';
  import Sparkline from '$lib/Sparkline.svelte';
  import PriceChart from '$lib/PriceChart.svelte';
  import WorldMap from '$lib/WorldMap.svelte';
  import CompareChart from '$lib/CompareChart.svelte';
  $: displayCur = ($settings.displayCurrency ?? 'AUD').toUpperCase();

  let btcChartRange: '1D' | '1W' | '1Y' | '5Y' = '1D';
  let btcChartData: { t: number; p: number }[] = [];
  let btcChartLoading = false;
  let btcDayOpenPrice = 0; // price at start of today for daily % change

  async function fetchBtcChart(r = btcChartRange) {
    btcChartLoading = true;
    try {
      const map: Record<string,string> = { '1D':'1d', '1W':'7d', '1Y':'1y', '5Y':'5y' };
      const d = await fetch(`/api/bitcoin/history?range=${map[r]}`).then(res => res.json());
      btcChartData = d.prices ?? [];
      if (r === '1D' && btcChartData.length > 0) btcDayOpenPrice = btcChartData[0].p;
    } catch { btcChartData = []; }
    finally { btcChartLoading = false; }
  }

  async function setBtcChartRange(r: '1D' | '1W' | '1Y' | '5Y') {
    btcChartRange = r;
    await fetchBtcChart(r);
    if (btcChartView === 'compare') await fetchCompareChart(r);
  }

  // ── Chart view toggle: 'price' | 'compare' ───────────────────
  let btcChartView: 'price' | 'compare' = 'price';
  let compareData: { btc: { t: number; p: number }[]; sp500: { t: number; p: number }[]; gold: { t: number; p: number }[] } = { btc: [], sp500: [], gold: [] };
  let compareLoading = false;

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

  // Keep last chart price point in sync with live WebSocket price.
  // Only update when price changes by >0.05% to avoid excessive array copies.
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

  let intelView: 'cutting-edge'|'classic'|'globe' = 'globe';
  let intelTransitioning = false;
  const BLUR_DURATION_MS = 400;   // blur phase before content swap
  const REVEAL_DURATION_MS = 600; // reveal phase after content swap
  function switchIntelView(target: 'cutting-edge'|'classic'|'globe') {
    if (intelView === target) return;
    intelTransitioning = true;
    setTimeout(() => {
      intelView = target;
      setTimeout(() => { intelTransitioning = false; }, REVEAL_DURATION_MS);
    }, BLUR_DURATION_MS);
  }
  const INTEL_TILE_LIMIT = 12; // 3 columns × 4 rows

  /** Conflict/threat keywords to filter polymarket markets for map display */
  const POLY_CONFLICT_RE = /war|attack|strike|missile|invasion|troops|military|conflict|bomb|nuclear|airstrike|assault|drone|ceasefire|hostage|coup|crisis/i;
  /** Derive trending/high-probability conflict markets to show on global map */
  $: polymarketThreats = $markets.filter(m =>
    m.trending && m.probability >= 50 && POLY_CONFLICT_RE.test(m.question)
  ).map(m => ({ question: m.question, url: m.url, probability: m.probability, topOutcome: m.topOutcome }));

  /** Detect topic keyword for frosted background tint */
  const TOPIC_MAP: [RegExp, string][] = [
    [/trump|maga|republican|gop|democrat|harris|biden/, '🇺🇸'],
    [/iran|tehran|persian|khamenei/, '🇮🇷'],
    [/china|beijing|xi jinping|taiwan|pla/, '🇨🇳'],
    [/russia|moscow|putin|kremlin/, '🇷🇺'],
    [/bitcoin|btc|crypto|ethereum|defi/, '₿'],
    [/fed|federal reserve|interest rate|inflation|cpi/, '🏛️'],
    [/israel|gaza|hamas|palestine|idf/, '⚔️'],
    [/ukraine|kyiv|zelensky|donbas/, '🇺🇦'],
    [/oil|opec|energy|gas|petroleum/, '🛢️'],
    [/election|vote|ballot|poll|president/, '🗳️'],
    [/war|military|missile|nuclear|troops/, '⚠️'],
    [/trade|tariff|sanction|wto/, '📊'],
    [/korea|dprk|kim jong/, '🇰🇵'],
    [/india|modi|pakistan|kashmir/, '🌏'],
    [/europe|eu|nato|macron|scholz|uk|britain/, '🌍'],
    [/climate|weather|disaster|earthquake|flood/, '🌡️'],
    [/ai|artificial intelligence|tech|openai/, '🤖'],
  ];
  function detectTopic(text: string): string {
    const t = text.toLowerCase();
    for (const [re, icon] of TOPIC_MAP) { if (re.test(t)) return icon; }
    return '◈';
  }

  /** Format end date as short human-readable "Closes Jan 15" or "3d left" */
  function fmtEndDate(daysLeft: number | null, endDate: string): string {
    if (daysLeft === null) return '';
    if (daysLeft < 0) return 'Closed';
    if (daysLeft === 0) return 'Closes today';
    if (daysLeft <= 30) return `${daysLeft}d left`;
    try {
      return 'Resolves ' + new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

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

  let dcaFlipped = false; // flip state for DCA formula back-face

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

  $: cpiLoss = (()=>{if($cpiAnnual===null)return 0;const y=Math.max(.1,dcaDays/365.25);return(1-1/Math.pow(1+$cpiAnnual/100,y))*100;})();

  // BTC priced in gold troy ounces
  $: btcInGoldOz = ($btcPrice > 0 && $goldPriceUsd !== null && $goldPriceUsd > 0)
    ? parseFloat(($btcPrice / $goldPriceUsd).toFixed(2))
    : null;

  // BTC/gold ratio historical % change (fixed 1-year window)
  let btcGoldPctChange: number | null = null;
  let btcGoldStartRatio: number | null = null;
  let btcGoldRangeLoading = false;

  async function fetchBtcGoldRange() {
    btcGoldRangeLoading = true;
    try {
      const d = await fetch(`/api/bitcoin/gold?range=1y`).then(res => res.json());
      btcGoldPctChange = d.pctChange ?? null;
      btcGoldStartRatio = d.startRatio ?? null;
    } catch { btcGoldPctChange = null; btcGoldStartRatio = null; }
    finally { btcGoldRangeLoading = false; }
  }

  // Australian median income + house price (live data)
  let auMedianIncome: number | null = null;
  let auIncomePct: number | null = null;
  let auMedianHouse: number | null = null;
  let auHousePct: number | null = null;
  let auAffordabilityRatio: number | null = null;

  async function fetchAuData() {
    try {
      const d = await fetch('/api/australia').then(res => res.json());
      auMedianIncome       = d.medianIncome       ?? null;
      auIncomePct          = d.incomePctChange     ?? null;
      auMedianHouse        = d.medianHousePrice    ?? null;
      auHousePct           = d.housePctChange      ?? null;
      auAffordabilityRatio = d.affordabilityRatio  ?? null;
    } catch {}
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
    const map: Record<string,string> = { '1D':'1d', '1W':'7d', '1Y':'1y', '5Y':'5y' };
    return map[r] ?? '1d';
  }

  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

  onMount(() => {
    fetchBtcChart();
    fetchHashrateChart();
    fetchBtcGoldRange();
    fetchAuData();
  });
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
            <span class="price-label-sep"> · </span><span class="price-label-cur">{displayCur}</span>
          {/if}
        </span>
        {#if btcDayChangePct !== null}
          <span class="price-day-change" style="color:{btcDayChangePct >= 0 ? 'var(--up)' : 'var(--dn)'};">{btcDayChangePct >= 0 ? '+' : ''}{btcDayChangePct.toFixed(2)}%</span>
        {/if}
      </div>
    </div>

    <!-- BTC in Gold + AU Snapshot — moved from signal grid -->
    <div class="stat-tile stat-tile--static stat-tile--btc-gold" data-tooltip="Bitcoin priced in gold (troy ounces)">
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
      <!-- Year ago + % change -->
      {#if btcGoldRangeLoading}
        <span class="btc-gold-strip-spot muted">…</span>
      {:else if btcGoldStartRatio !== null && btcGoldPctChange !== null}
        <div class="btc-gold-history">
          <div class="btc-gold-hist-row">
            <span class="btc-gold-hist-label">1yr ago</span>
            <span class="btc-gold-hist-val">{n(btcGoldStartRatio, 2)} oz</span>
          </div>
          <div class="btc-gold-hist-row">
            <span class="btc-gold-hist-label">change</span>
            <span class="btc-gold-hist-pct" style="color:{btcGoldPctChange >= 0 ? 'var(--up)' : 'var(--dn)'}">{btcGoldPctChange >= 0 ? '+' : ''}{btcGoldPctChange.toFixed(1)}%</span>
          </div>
        </div>
      {/if}
      {#if displayCur === 'AUD'}
        <div class="au-strip-rows">
          <div class="au-strip-row">
            <span class="au-strip-label">🇦🇺 Med. Income</span>
            <span class="au-strip-val">
              {auMedianIncome !== null ? '$' + Math.round(auMedianIncome / 1000) + 'k' : '$100k'}
              {#if auIncomePct !== null}<span class="au-chg" style="color:{auIncomePct >= 0 ? 'var(--up)' : 'var(--dn)'}">{auIncomePct >= 0 ? '+' : ''}{auIncomePct.toFixed(1)}%</span>{/if}
            </span>
          </div>
          <div class="au-strip-row">
            <span class="au-strip-label">🇦🇺 Med. House</span>
            <span class="au-strip-val">
              {auMedianHouse !== null ? '$' + Math.round(auMedianHouse / 1000) + 'k' : '$815k'}
              {#if auHousePct !== null}<span class="au-chg" style="color:{auHousePct >= 0 ? 'var(--up)' : 'var(--dn)'}">{auHousePct >= 0 ? '+' : ''}{auHousePct.toFixed(1)}%</span>{/if}
            </span>
          </div>
          {#if auAffordabilityRatio !== null}
            <div class="au-strip-row au-strip-row--ratio">
              <span class="au-strip-label">House/Income Ratio</span>
              <span class="au-strip-val au-ratio-val">{auAffordabilityRatio}× <span class="au-ratio-sub">yr income</span></span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Halving countdown + sats per currency combined -->
    <div class="stat-tile halving-tile stat-tile--static" data-tooltip="Estimated blocks remaining until next Bitcoin halving · Satoshis per {displayCur}">
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
    <div class="gc signal-card"
      class:signal-zone--red={dcaZoneGif.includes('red')}
      class:signal-zone--amber={dcaZoneGif.includes('amber')}
      class:signal-zone--green={dcaZoneGif.includes('green')}
      style="--ac:{$accentColor};">

      <!-- Zone background GIF — behind frosted glass -->
      {#if dcaZoneGif}
        {#key dcaZoneGif}
          <div class="zone-bg">
            <img src={dcaZoneGif} alt="" class="zone-bg-img" loading="lazy" />
          </div>
        {/key}
      {/if}
      <!-- Full-tile zone colour tint -->
      {#if dcaZoneGif}
        <div class="zone-tint" class:zone-tint--red={dcaZoneGif.includes('red')} class:zone-tint--amber={dcaZoneGif.includes('amber')} class:zone-tint--green={dcaZoneGif.includes('green')}></div>
      {/if}
      <div class="zone-glass"></div>

      <!-- Flip container -->
      <div class="dca-flip-scene">
        {#if !dcaFlipped}
          <!-- FRONT FACE — signal view -->
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

        {:else}
          <!-- BACK FACE — formula explanation -->
          <div class="dca-face">
            <div class="dca-formula-head">
              <p class="eyebrow orange">The Formula</p>
            </div>
            <ol class="formula-steps">
              <li><strong>Price position</strong> — 100% allocation at your low price target, tapering linearly to 0% at high.</li>
              <li><strong>Signal boosts</strong> increase allocation when conditions are favourable:
                <ul>
                  <li>Fear &amp; Greed ≤ 40 → <span class="formula-boost">+10%</span> <span class="dim">(extreme ≤ 20 → +20%)</span></li>
                  <li>Mining difficulty drop &gt; 5% → <span class="formula-boost">+10%</span></li>
                  <li>Futures funding rate negative → <span class="formula-boost">+10%</span></li>
                  <li>Within 365 days of halving → <span class="formula-boost">+10%</span></li>
                </ul>
              </li>
              <li><strong>Final amount</strong> = Max DCA × price% × (1 + total boosts%). Rounded to nearest $50 AUD.</li>
              <li>Price above your high target → <strong class="dn">PASS</strong> — skip this period entirely.</li>
            </ol>
          </div>
        {/if}
      </div>
      {#if !dcaFlipped}
        <button class="dca-info-btn" on:click={() => dcaFlipped = true} aria-label="Show DCA formula">?</button>
      {:else}
        <button class="dca-info-btn" on:click={() => dcaFlipped = false} aria-label="Back to signal view">↩</button>
      {/if}
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

<!-- ══════════════════════════════════════════════════════════
  ② PORTFOLIO SECTION
═══════════════════════════════════════════════════════════ -->
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
      {#if $cpiAnnual!==null}<p class="dim" style="margin-top:14px;line-height:1.6;">Purchasing power erosion (annualized): <span style="color:var(--dn);">−{cpiLoss.toFixed(1)}%</span></p>{/if}
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
          <button class="crb" class:crb--active={btcChartRange==='1D'} on:click={() => setBtcChartRange('1D')}>1D</button>
          <button class="crb" class:crb--active={btcChartRange==='1W'} on:click={() => setBtcChartRange('1W')}>1W</button>
          <button class="crb" class:crb--active={btcChartRange==='1Y'} on:click={() => setBtcChartRange('1Y')}>1Y</button>
          <button class="crb" class:crb--active={btcChartRange==='5Y'} on:click={() => setBtcChartRange('5Y')}>5Y</button>
        </div>
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
          />
        {/if}
      {:else if btcChartLoading}
        <div class="skeleton" style="height:160px;border-radius:6px;"></div>
      {:else if btcChartData.length >= 2}
        <PriceChart
          prices={btcChartData}
          height={160}
          range={btcApiRange()}
        />
      {:else}
        <p class="dim" style="text-align:center;padding:60px 0;">Loading chart data…</p>
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
    <!-- Toggle: Markets / News / Globe — segmented buttons -->
    <div class="intel-toggle-wrap" role="group" aria-label="Intel view">
      <button class="crb globe-toggle-btn" class:crb--active={intelView==='globe'} on:click={() => switchIntelView('globe')} aria-pressed={intelView === 'globe'} title="Globe — live world events map">🌐 Globe</button>
      <button class="crb" class:crb--active={intelView==='classic'} on:click={() => switchIntelView('classic')} aria-pressed={intelView === 'classic'} title="Classic — news feed">☰ News</button>
      <button class="crb" class:crb--active={intelView==='cutting-edge'} on:click={() => switchIntelView('cutting-edge')} aria-pressed={intelView === 'cutting-edge'} title="Cutting Edge — prediction markets">◈ Markets</button>
    </div>
  </div>

  <!-- Transition wrapper — fixed container prevents layout shift -->
  <div class="intel-view-wrap" class:intel-view-wrap--transitioning={intelTransitioning}>

    {#if intelView === 'cutting-edge'}
    <!-- ── CUTTING EDGE: Polymarket Geopolitics card grid ── -->
    <div class="gc intel-gc" style="padding:20px 18px;">
      <div class="gc-head" style="margin-bottom:16px;">
        <div>
          <p class="gc-title">Geopolitics</p>
          {#if $marketsUpdated}<p class="dim" style="margin-top:3px;">Updated {$marketsUpdated}</p>{/if}
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
            {@const endLabel = fmtEndDate(m.daysLeft, m.endDate)}
            {@const isUrgent = m.daysLeft !== null && m.daysLeft >= 0 && m.daysLeft <= 7}
            {@const topOutcome = m.outcomes[0]?.name ?? m.topOutcome}
            {@const topPct = m.outcomes[0]?.probability ?? m.probability}
            <a href="{m.url}" target="_blank" rel="noopener noreferrer"
               class="pm-card pm-card--intel"
               class:pm-card--urgent={isUrgent}
               class:pm-card--trending={m.trending && !m.pinned}
               aria-label="{m.question}">
              <div class="pm-card-frosted-overlay"></div>
              <!-- Tag row -->
              <div class="pm-card-tags" style="position:relative;z-index:1;">
                {#if m.pinned}
                  <span class="pm-tag pm-pin">★ Watching</span>
                {:else if m.trending}
                  <span class="pm-tag pm-trending-tag">Trending</span>
                {:else}
                  <span class="pm-tag">{m.tag || 'Market'}</span>
                {/if}
                {#if isUrgent}
                  <span class="pm-tag pm-urgent-tag" title="Resolves soon">{endLabel}</span>
                {:else if endLabel}
                  <span class="pm-tag pm-date-tag">{endLabel}</span>
                {/if}
              </div>
              <!-- Question -->
              <p class="pm-card-q" style="position:relative;z-index:1;">{m.question}</p>
              <!-- Leading outcome: large display for all market types -->
              <div class="pm-binary-prob" style="position:relative;z-index:1;">
                <span class="pm-binary-outcome" style="color:{pc(topPct)};" aria-label="Leading outcome: {topOutcome}">{topOutcome}</span>
                <span class="pm-binary-pct" style="color:{pc(topPct)};" aria-label="Probability: {topPct} percent">{topPct}%</span>
              </div>
              <!-- Secondary outcomes (multi-outcome markets only) -->
              {#if m.outcomes.length > 2}
                <div class="pm-secondary-outcomes" style="position:relative;z-index:1;" aria-label="Other contenders">
                  {#each m.outcomes.slice(1, 4) as o}
                    <span class="pm-secondary-item">
                      <span class="pm-secondary-name">{o.name}</span>
                      <span class="pm-secondary-pct" style="color:{pc(o.probability)};">{o.probability}%</span>
                    </span>
                  {/each}
                </div>
              {/if}
              <!-- Probability bar -->
              <div class="pm-card-prob-bar" style="position:relative;z-index:1;">
                <div class="pm-prob-fill" style="width:{topPct}%;background:{pc(topPct)};"></div>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </div>

    {:else if intelView === 'classic'}
    <!-- ── CLASSIC: News RSS feeds ── -->
    <div class="gc intel-gc" style="padding:20px 18px;">
      <div class="gc-head" style="margin-bottom:16px;"><p class="gc-title">News Feed</p><span class="dim">{Math.min($newsItems.length, INTEL_TILE_LIMIT)} articles</span></div>
      {#if $newsItems.length===0}
        <p class="dim">Fetching RSS feeds…</p>
      {:else}
        <div class="pm-grid news-pm-grid">
          {#each $newsItems.slice(0, INTEL_TILE_LIMIT) as item}
            <a href={item.link} target="_blank" rel="noopener noreferrer" class="pm-card pm-card--intel" aria-label="{item.title}">
              <div class="pm-card-frosted-overlay"></div>
              <div class="pm-card-tags" style="position:relative;z-index:1;">
                <span class="pm-tag pm-news-src">{item.source}</span>
                <span class="pm-tag">{ago(item.pubDate)} ago</span>
              </div>
              <p class="pm-card-q" style="position:relative;z-index:1;">{item.title}</p>
            </a>
          {/each}
        </div>
      {/if}
    </div>

    {:else}
    <!-- ── GLOBE: Live world events map ── -->
    <div class="gc intel-gc globe-gc" style="padding:20px 18px;">
      <div class="gc-head" style="margin-bottom:14px;">
        <div>
          <p class="gc-title">Global Threat Monitor</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="globe-badge">LIVE</span>
        </div>
      </div>
      <WorldMap polymarketThreats={polymarketThreats} />
    </div>
    {/if}
  </div>

</section>

<style>
  /* ── LAYOUT ──────────────────────────────────────────────── */
  .section { max-width: 1440px; margin: 0 auto; padding: 48px 24px 0; min-height: 100vh; position: relative; overflow: clip; }
  /* Desktop scroll snap — align section start to viewport */
  @media (min-width:701px) {
    .section { scroll-snap-align: start; }
  }
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
    .section {
      padding:20px 14px 0;
      /* Fallback for browsers without svh support */
      min-height:100vh;
      /* svh = small viewport height, excludes browser UI chrome on mobile */
      min-height:100svh;
      width:100%;
    }
    /* Fade the bottom of each section so the next section stays hidden until scrolled into view */
    .section::after {
      content:''; pointer-events:none;
      position:sticky; bottom:0; left:0; right:0;
      display:block;
      /* Height large enough to cover any accidental section peek-through */
      height:64px;
      background:linear-gradient(to bottom, transparent, var(--bg));
      margin-top:-64px;
    }
    .section-header {
      margin-bottom:16px;
    }
    .section-divider { margin-top:16px; }
    /* Bottom padding for each section — enough space before the next section */
    #signal    { padding-bottom:32px; }
    #portfolio { padding-bottom:32px; }
    #intel     { padding-bottom:80px; }
    /* Uniform tile gap across all section grids on mobile */
    .port-grid   { gap:8px; }
    .intel-grid  { gap:8px; }
    .signal-grid { gap:8px; }
    .stat-strip  { margin-bottom:8px; }
    /* Hide Connect Ghostfolio tile on mobile when no token is configured */
    .gc--no-token { display:none; }
  }
  @media (max-width:600px) {
    .section-header { margin-bottom:14px; }
  }

  /* ── STAT STRIP ─────────────────────────────────────────── */
  .stat-strip { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 20px; }
  .stat-tile {
    padding: 16px 14px; text-align: center;
    background: var(--glass-bg); border: 1px solid var(--glass-bd);
    border-radius: var(--r-md); backdrop-filter: blur(16px);
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
  .stat-tile:hover { transform:translateY(-4px); border-color:rgba(255,255,255,.14); box-shadow:0 10px 28px rgba(0,0,0,.3); }

  .stat-tile--chart { padding-bottom: 0; cursor:default; }
  .stat-tile--chart::before { display:none; }
  .tile-spark { position: absolute; bottom: 0; left: 0; right: 0; height: 52px; opacity: 0.7; pointer-events: none; }
  .stat-tile--chart .price-pair, .stat-tile--chart .stat-l, .stat-tile--chart .stat-l-row { position: relative; z-index: 1; }
  .stat-tile--chart .stat-l-row { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 3px; padding-bottom: 56px; }

  /* BTC price pair — USD | Currency side by side */
  .price-pair { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; justify-content:center; margin-bottom:4px; position:relative; z-index:1; margin-top:8px; }
  .price-usd { font-size:1.4rem; font-weight:700; letter-spacing:-.025em; line-height:1.1; }
  .price-sep { font-size:.9rem; color:var(--t3); font-weight:400; }
  .price-alt { font-size:1.4rem; font-weight:700; letter-spacing:-.025em; line-height:1.1; }
  .price-label-usd {
    font-weight: 700;
    color: #22c55e;
  }
  .price-label-sep { color:var(--t3); margin-right:3px; }
  .price-label-cur { color:#22c55e; font-weight:700; }
  .price-day-change { font-size:.6rem; font-weight:700; letter-spacing:.04em; }
  @media (max-width:500px) {
    .price-usd { font-size:1.2rem; }
    .price-alt { font-size:1.2rem; }
    .price-sep { font-size:.8rem; }
  }

  /* Sats per currency — large SATS display */
  .sats-display { display:flex; align-items:baseline; gap:6px; justify-content:center; margin-bottom:4px; }
  .sats-cur { font-size:1.4rem; font-weight:700; color:#e2e2e8; letter-spacing:-.025em; line-height:1.1; }
  .sats-label-sats { color:var(--orange); font-weight:700; }
  .sats-label-cur  { color:#22c55e; font-weight:700; }
  @media (max-width:500px) {
    .sats-cur { font-size:1.15rem; }
  }

  .stat-n { display:block; font-size:1.4rem; font-weight:700; letter-spacing:-.025em; margin-bottom:6px; line-height:1.1; color:var(--t1); }
  .stat-l { font-size:.58rem; color:var(--t2); text-transform:uppercase; letter-spacing:.1em; }

  /* Halving number — same size as price-alt for uniformity */
  .halving-n { font-size:1.4rem; font-weight:700; letter-spacing:-.025em; }

  /* Halving date label */
  .halving-date { font-size:.58rem; color:var(--orange); margin-top:4px; font-variant-numeric:tabular-nums; letter-spacing:.03em; position:relative; display:inline-block; }

  /* Static orange labels — no animated foil */
  .halving-date--glow, .btc-glimmer, .eyebrow.orange, .sats-label-sats {
    color: var(--orange);
  }

  /* Static stat tile — no interactive cursor */
  .stat-tile--static { cursor:default; }

  @media (max-width:800px) { .stat-strip{ grid-template-columns:repeat(3,1fr); } }
  @media (max-width:500px) {
    /* Two-column stat strip: BTC price (stat-tile--wide) spans full width, sats + halving side by side */
    .stat-strip { grid-template-columns:1fr 1fr; gap:8px; }
    .stat-tile--wide { grid-column:span 2; } /* spans both columns to fill the row */
    .stat-n { font-size:1.25rem; }
    .stat-tile { padding:14px 12px; }
    .stat-tile--chart .stat-l-row { padding-bottom:52px; }
  }

  /* ── BTC PRICE CHART CARD ───────────────────────────────── */
  .btc-chart-card { padding:16px 18px; margin-bottom:14px; }
  .chart-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px; }
  .chart-controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .overlay-btns { display:flex; gap:4px; }
  .chart-container { width:100%; }
  .chart-range-btns { display:flex; gap:4px; }
  /* Small colour dot inside overlay toggle buttons */
  .crb-dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; vertical-align:middle; flex-shrink:0; }
  .crb {
    display:inline-flex; align-items:center;
    padding:4px 12px; font-size:.62rem; font-weight:700; letter-spacing:.06em;
    text-transform:uppercase; font-family:inherit;
    background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1);
    border-radius:3px; color:rgba(255,255,255,.45); cursor:pointer;
    transition:background .2s, border-color .2s, color .2s, box-shadow .2s;
    position:relative; overflow:hidden;
  }
  .crb::after {
    content:''; position:absolute; inset:0; pointer-events:none; border-radius:inherit;
    background:linear-gradient(105deg,transparent 25%,rgba(255,255,255,.55) 50%,transparent 75%);
    background-size:200% 100%; background-position:-200% center;
    transition:background-position .4s ease, opacity .2s ease;
    opacity:0;
  }
  .crb:hover { color:var(--orange); border-color:rgba(247,147,26,.45); background:rgba(247,147,26,.14); box-shadow:0 0 8px rgba(247,147,26,.25); }
  .crb:hover::after { background-position:200% center; opacity:1; }
  .crb--active { background:rgba(247,147,26,.15); border-color:rgba(247,147,26,.5); color:var(--orange); }
  :global(html.light) .crb { background:rgba(0,0,0,.04); border-color:rgba(0,0,0,.1); color:rgba(0,0,0,.5); }
  :global(html.light) .crb:hover { color:#c77a10; border-color:rgba(200,120,16,.45); background:rgba(247,147,26,.1); box-shadow:0 0 8px rgba(200,120,16,.2); }
  :global(html.light) .crb--active { background:rgba(247,147,26,.1); border-color:rgba(247,147,26,.4); color:#c77a10; }
  @media (max-width:500px) { .btc-chart-card { padding:12px 12px; } }

  /* Comparison chart legend */
  .comp-legend { display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:10px; padding:8px 10px; background:rgba(255,255,255,.03); border-radius:6px; border:1px solid rgba(255,255,255,.06); }
  .comp-item { display:flex; align-items:center; gap:6px; font-size:.65rem; font-weight:600; color:var(--t2); text-transform:uppercase; letter-spacing:.06em; }
  .comp-dot { display:inline-block; width:10px; height:3px; border-radius:2px; flex-shrink:0; }
  .comp-note { font-size:.58rem; color:var(--t3); margin-left:auto; font-style:italic; text-transform:none; letter-spacing:0; }
  :global(html.light) .comp-legend { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.07); }
  :global(html.light) .comp-item { color:rgba(0,0,0,.5); }

  /* ── SIGNAL GRID ────────────────────────────────────────── */
  .signal-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
  @media (max-width:1100px) { .signal-grid{grid-template-columns:1fr 1fr;} }
  @media (max-width:768px)  { .signal-grid{grid-template-columns:1fr; gap:10px;} }

  /* ── GLASS CARD ─────────────────────────────────────────── */
  .gc {
    background: var(--glass-bg); backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    border: 1px solid var(--glass-bd); border-radius: var(--r-md); padding: 24px;
    box-shadow: 0 6px 28px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.06);
    transition: border-color .3s, box-shadow .3s, transform .25s; position: relative; overflow: hidden;
  }
  .gc::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(247,147,26,.25),transparent); }
  .gc:hover { transform:translateY(-4px); border-color:rgba(255,255,255,.14); box-shadow:0 10px 28px rgba(0,0,0,.3); }
  .gc-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; gap:12px; }
  .gc-title { font-family:inherit; font-size:.72rem; font-weight:700; color:var(--t1); text-transform:uppercase; letter-spacing:.08em; }
  @media (max-width:600px) { .gc { padding:16px 14px; border-radius:var(--r-md); } }
  /* Reduce blur on mobile for better paint performance */
  @media (max-width:768px) {
    .gc { backdrop-filter:blur(12px) saturate(140%); -webkit-backdrop-filter:blur(12px) saturate(140%); }
    .stat-tile { backdrop-filter:blur(10px); }
  }

  /* Hashrate tile — flex column so the chart fills remaining tile height */
  .gc--hashrate { display:flex; flex-direction:column; }
  .gc--hashrate .chart-container { flex:1; min-height:200px; }
  .gc--hashrate .hash-row { margin-top:auto; padding-top:10px; }
  .hashrate-legend { display:flex; gap:10px; margin-bottom:6px; }
  .hr-leg { font-size:.6rem; color:var(--c,#f7931a); font-weight:600; letter-spacing:.03em; opacity:.85; }

  /* ── MOBILE: hide supplementary sections, limit intel stories ── */
  @media (max-width:768px) {
    .btc-network-card,
    .btc-hashrate-card { display:none; }
    /* Show BTC price chart on mobile — collapse to single-chart layout */
    .btc-chart-card { margin-top:10px; }
    /* DCA signal: only show the amount to buy on mobile */
    .signal-card .vband,
    .signal-card .sigs,
    .dca-info-btn { display:none; }
    .dca-hero { padding:20px 0 16px; }
    /* Portfolio: hide detailed tiles, show merged summary only */
    .port-grid { display:none; }
    .mobile-port-summary { display:block; }
  }

  /* ── MOBILE MERGED PORTFOLIO SUMMARY ─────────────────────── */
  /* Hidden on desktop — shown only on mobile via the rule above */
  .mobile-port-summary { display:none; }
  .mps-nw-block { text-align:center; padding:10px 0 8px; }
  .mps-nw { font-size:2.8rem; font-weight:700; letter-spacing:-.04em; line-height:1; margin-bottom:4px; }
  .mps-perf-row { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:12px 0 16px; }
  .mps-perf-item {
    display:flex; flex-direction:column; gap:4px; text-align:center;
    background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06);
    border-radius:8px; padding:10px 6px;
  }
  .mps-perf-v { font-size:.9rem; font-weight:700; line-height:1; }
  .mps-assets {
    display:grid; grid-template-columns:repeat(3,1fr); gap:8px;
    padding-top:12px; border-top:1px solid rgba(255,255,255,.06);
  }
  .mps-assets--solo { padding-top:0; border-top:none; }
  .mps-asset-item {
    display:flex; flex-direction:column; gap:3px; text-align:center;
    background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06);
    border-radius:8px; padding:12px 8px;
  }
  .mps-asset-ticker { font-size:.72rem; font-weight:700; margin-bottom:4px; }
  .mps-asset-pct { font-size:1.1rem; font-weight:800; line-height:1; letter-spacing:-.02em; }
  :global(html.light) .mps-perf-item,
  :global(html.light) .mps-asset-item { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.07); }

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
  .signal-card { background:linear-gradient(180deg,rgba(247,147,26,.08) 0%,var(--glass-bg) 80px); position:relative; overflow:hidden; border-color:rgba(247,147,26,.22) !important; box-shadow:0 6px 28px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.06),0 0 0 1px rgba(247,147,26,.1),0 0 20px rgba(247,147,26,.04); }
  /* Zone-specific edge tint — full border glow */
  .signal-zone--red   { background:linear-gradient(180deg,rgba(239,68,68,.09) 0%,var(--glass-bg) 80px) !important; border-color:rgba(239,68,68,.3) !important; box-shadow:0 6px 28px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.06),0 0 0 1px rgba(239,68,68,.2),0 0 20px rgba(239,68,68,.06) !important; }
  .signal-zone--amber { border-color:rgba(251,146,60,.3) !important; box-shadow:0 6px 28px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.06),0 0 0 1px rgba(251,146,60,.2),0 0 20px rgba(251,146,60,.06) !important; }
  .signal-zone--green { background:linear-gradient(180deg,rgba(34,197,94,.09) 0%,var(--glass-bg) 80px) !important; border-color:rgba(34,197,94,.3) !important; box-shadow:0 6px 28px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.06),0 0 0 1px rgba(34,197,94,.2),0 0 20px rgba(34,197,94,.06) !important; }
  .signal-card .gc-head { position:relative; z-index:2; }

  /* Full-tile zone colour tint (absolute overlay, behind glass) */
  .zone-tint {
    position:absolute; inset:0; z-index:0; pointer-events:none;
    background:linear-gradient(180deg,rgba(247,147,26,.05) 0%,rgba(247,147,26,.01) 100%);
    transition:background .7s ease;
  }
  .zone-tint--red   { background:linear-gradient(180deg,rgba(239,68,68,.06) 0%,rgba(239,68,68,.015) 100%); }
  .zone-tint--amber { background:linear-gradient(180deg,rgba(251,146,60,.06) 0%,rgba(251,146,60,.015) 100%); }
  .zone-tint--green { background:linear-gradient(180deg,rgba(34,197,94,.06) 0%,rgba(34,197,94,.015) 100%); }

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

  /* ── DCA FLIP SCENE ─────────────────────────────────────── */
  .dca-flip-scene { position:relative; z-index:2; }
  .dca-face { animation:dcaFaceIn .38s cubic-bezier(.25,.46,.45,.94) both; position:relative; }
  @keyframes dcaFaceIn {
    from { opacity:0; transform:scale(.97); }
    to   { opacity:1; transform:scale(1);   }
  }
  @media (prefers-reduced-motion:reduce) { .dca-face { animation:none; } }

  /* Small "?" info button — bottom-right corner of the DCA front face */
  .dca-info-btn {
    position:absolute; bottom:8px; right:8px; z-index:3;
    width:28px; height:28px; padding:0; border-radius:4px;
    background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14);
    color:rgba(255,255,255,.38); font-size:.62rem; font-weight:700;
    line-height:1; cursor:pointer;
    transition:background .2s, border-color .2s, color .2s, box-shadow .2s;
    display:flex; align-items:center; justify-content:center;
    overflow:hidden;
  }
  .dca-info-btn::after {
    content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
    background:linear-gradient(105deg,transparent 25%,rgba(255,255,255,.55) 50%,transparent 75%);
    background-size:200% 100%; background-position:-200% center;
    transition:background-position .4s ease, opacity .2s ease;
    opacity:0;
  }
  .dca-info-btn:hover {
    background:rgba(247,147,26,.14); border-color:rgba(247,147,26,.45);
    color:var(--orange); box-shadow:0 0 8px rgba(247,147,26,.25);
  }
  .dca-info-btn:hover::after { background-position:200% center; opacity:1; }
  :global(html.light) .dca-info-btn { background:rgba(0,0,0,.04); border-color:rgba(0,0,0,.12); color:rgba(0,0,0,.4); }
  :global(html.light) .dca-info-btn:hover { background:rgba(247,147,26,.1); border-color:rgba(247,147,26,.35); color:#c77a10; }

  /* Formula back face */
  .dca-formula-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
  .formula-steps {
    list-style:none; counter-reset:step; padding:0; margin:0;
    display:flex; flex-direction:column; gap:11px;
  }
  .formula-steps > li {
    position:relative; padding-left:22px; font-size:.66rem; color:var(--t2); line-height:1.65; counter-increment:step;
  }
  .formula-steps > li::before {
    content:counter(step); position:absolute; left:0; top:1px;
    width:14px; height:14px; border-radius:50%;
    background:rgba(247,147,26,.18); color:var(--orange);
    font-size:.5rem; font-weight:700; display:flex; align-items:center; justify-content:center;
  }
  .formula-steps strong { color:var(--t1); }
  .formula-steps ul { margin:5px 0 0; padding-left:10px; border-left:1px solid rgba(255,255,255,.1); display:flex; flex-direction:column; gap:3px; }
  .formula-steps ul li { font-size:.63rem; color:var(--t2); line-height:1.55; }
  .formula-boost { color:var(--up); font-weight:700; }
  :global(html.light) .formula-steps ul { border-left-color:rgba(0,0,0,.1); }
  :global(html.light) .formula-steps > li::before { background:rgba(199,122,16,.15); color:#c77a10; }
  :global(html.light) .signal-zone--red   { background:linear-gradient(180deg,rgba(239,68,68,.06) 0%,rgba(255,255,255,.72) 80px) !important; }
  :global(html.light) .signal-zone--amber { border-color:rgba(251,146,60,.3) !important; }
  :global(html.light) .signal-zone--green { background:linear-gradient(180deg,rgba(34,197,94,.06) 0%,rgba(255,255,255,.72) 80px) !important; }

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

  /* ── BTC IN GOLD TILE ────────────────────────────────────── */
  .btc-gold-card { border-color:rgba(201,168,76,.22) !important; }
  .btc-gold-hero { display:flex; align-items:baseline; gap:8px; padding:18px 0 10px; justify-content:center; flex-wrap:wrap; }
  .btc-gold-n { font-size:clamp(2.4rem,5vw,3.6rem); font-weight:800; letter-spacing:-.04em; line-height:1; color:#c9a84c; }
  .btc-gold-unit { font-size:.9rem; font-weight:600; color:var(--t2); align-self:flex-end; padding-bottom:4px; }
  .btc-gold-sub { font-size:.6rem; color:var(--t2); text-transform:uppercase; letter-spacing:.1em; text-align:center; margin-bottom:14px; }
  .btc-gold-meta { display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid rgba(255,255,255,.05); }
  .btc-gold-spot { font-size:.8rem; font-weight:600; color:var(--t1); font-variant-numeric:tabular-nums; }
  :global(html.light) .btc-gold-meta { border-top-color:rgba(0,0,0,.06); }

  /* ── AUSTRALIA SNAPSHOT TILE ─────────────────────────────── */
  .au-snapshot-card { border-color:rgba(0,0,150,.22) !important; }
  .au-rows { display:flex; flex-direction:column; gap:10px; margin-top:4px; }
  .au-row { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); border-radius:8px; }
  .au-label { font-size:.66rem; color:var(--t2); font-weight:500; }
  .au-val { font-size:.8rem; font-weight:700; color:var(--t1); font-variant-numeric:tabular-nums; }
  .au-chg { font-size:.62rem; font-weight:600; margin-left:5px; }
  :global(html.light) .au-row { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.06); }

  /* ── BTC-IN-GOLD STAT TILE (stat-strip) ─────────────────── */
  .stat-tile--btc-gold { border-color:rgba(201,168,76,.22) !important; }
  /* 1 ₿ badge row */
  .btc-gold-badge-row { display:flex; justify-content:center; margin-bottom:2px; }
  .btc-gold-badge-btc { font-size:1.1rem; font-weight:900; letter-spacing:-.02em; line-height:1; }
  /* label under badge */
  .btc-gold-label { font-size:.52rem; font-weight:600; color:var(--t2); text-transform:uppercase; letter-spacing:.09em; margin-bottom:4px; }
  /* main price hero */
  .btc-gold-strip-hero { display:flex; align-items:baseline; gap:4px; justify-content:center; margin-bottom:4px; }
  .btc-gold-strip-n { font-size:1.35rem; font-weight:700; letter-spacing:-.025em; line-height:1.1; color:#c9a84c; }
  .btc-gold-strip-unit { font-size:.6rem; font-weight:600; color:var(--t2); align-self:flex-end; padding-bottom:2px; }
  /* year-ago + change history rows */
  .btc-gold-history { display:flex; flex-direction:column; gap:3px; width:100%; margin-top:2px; padding-top:5px; border-top:1px solid rgba(201,168,76,.12); }
  .btc-gold-hist-row { display:flex; justify-content:space-between; align-items:center; }
  .btc-gold-hist-label { font-size:.54rem; color:var(--t2); font-weight:500; text-transform:uppercase; letter-spacing:.06em; }
  .btc-gold-hist-val { font-size:.62rem; font-weight:700; color:var(--t1); font-variant-numeric:tabular-nums; }
  .btc-gold-hist-pct { font-size:.72rem; font-weight:800; font-variant-numeric:tabular-nums; }
  /* legacy spot text (loading state) */
  .btc-gold-strip-spot { font-size:.62rem; font-weight:600; color:var(--t2); margin-top:4px; font-variant-numeric:tabular-nums; }
  .crb--xs { padding:2px 7px; font-size:.52rem; }
  @media (max-width:500px) { .btc-gold-strip-n { font-size:1.1rem; } .btc-gold-badge-btc { font-size:.95rem; } }

  /* AU snapshot rows inside stat tile */
  .au-strip-rows { display:flex; flex-direction:column; gap:4px; margin-top:7px; width:100%; }
  .au-strip-row { display:flex; justify-content:space-between; align-items:center; padding:5px 8px;
    background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); border-radius:6px; }
  .au-strip-row--ratio { border-color:rgba(100,160,255,.15); background:rgba(100,160,255,.04); }
  .au-strip-label { font-size:.55rem; color:var(--t2); font-weight:500; }
  .au-strip-val { font-size:.62rem; font-weight:700; color:var(--t1); font-variant-numeric:tabular-nums; }
  .au-ratio-val { color:#7eb8f7 !important; }
  .au-ratio-sub { font-size:.5rem; font-weight:500; color:var(--t2); }
  :global(html.light) .au-strip-row { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.06); }
  :global(html.light) .au-strip-row--ratio { background:rgba(60,100,200,.05); border-color:rgba(60,100,200,.12); }
  :global(html.light) .au-ratio-val { color:#2563eb !important; }

  /* Divider between halving and sats in combined tile */
  .halving-sats-divider { width:40%; height:1px; background:rgba(255,255,255,.08); margin:8px auto 6px; }

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
  @media (max-width:500px) {
    .ap { padding:12px 10px; }
    .ap-top { margin-bottom:8px; }
    .ap-pct { font-size:1.6rem; }
  }
  @media (max-width:350px) { .asset-panels { grid-template-columns:1fr; } .ap-pct { font-size:1.5rem; } }

  .gf-hero { display:flex; flex-direction:column; gap:16px; margin-bottom:18px; }
  .gf-nw   { font-size:4.2rem; font-weight:700; letter-spacing:-.045em; line-height:1; color:var(--t1); }
  .gf-perf { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; padding-top:16px; border-top:1px solid rgba(255,255,255,.06); }
  .gfp     { display:flex; flex-direction:column; gap:6px; padding:14px 16px; background:rgba(255,255,255,.02); border:1px solid rgba(255,255,255,.06); border-radius:8px; }
  .gfp-v   { font-size:1.4rem; font-weight:700; letter-spacing:-.025em; line-height:1; }
  /* Live indicator dot (used in portfolio and loading states) */
  .live-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--up); flex-shrink:0; }

  /* ── GHOSTFOLIO SUMMARY STRIP ────────────────────────────── */
  .gf-summary { display:flex; flex-wrap:wrap; gap:12px; margin:0 0 16px; border:1px solid rgba(255,255,255,.06); border-radius:8px; padding:14px 16px; background:rgba(255,255,255,.02); }
  .gf-sum-item { display:flex; flex-direction:column; gap:5px; flex:1; min-width:80px; }
  .gf-sum-v { font-size:1rem; font-weight:700; letter-spacing:-.02em; color:var(--t1); line-height:1; }
  :global(html.light) .gf-summary { border-color:rgba(0,0,0,.08); background:rgba(0,0,0,.02); }

  /* Small icon refresh button */
  .btn-icon {
    display:inline-flex; align-items:center; justify-content:center;
    width:28px; height:28px; padding:0; border-radius:4px;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1);
    color:rgba(255,255,255,.4); font-size:.72rem; cursor:pointer;
    transition:background .2s, border-color .2s, color .2s, box-shadow .2s;
    flex-shrink:0; position:relative; overflow:hidden;
  }
  .btn-icon::after {
    content:''; position:absolute; inset:0; pointer-events:none; border-radius:inherit;
    background:linear-gradient(105deg,transparent 25%,rgba(255,255,255,.55) 50%,transparent 75%);
    background-size:200% 100%; background-position:-200% center;
    transition:background-position .4s ease, opacity .2s ease;
    opacity:0;
  }
  .btn-icon:hover { border-color:rgba(247,147,26,.45); color:var(--orange); background:rgba(247,147,26,.14); box-shadow:0 0 8px rgba(247,147,26,.25); }
  .btn-icon:hover::after { background-position:200% center; opacity:1; }
  :global(html.light) .btn-icon { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.12); color:rgba(0,0,0,.5); }
  :global(html.light) .btn-icon:hover { border-color:rgba(200,120,16,.45); color:#c77a10; background:rgba(247,147,26,.1); box-shadow:0 0 8px rgba(200,120,16,.2); }

  @media (max-width:600px) {
    .gf-nw { font-size:2.8rem; }
    .gf-perf { grid-template-columns:repeat(2,1fr); padding-top:12px; }
    .gfp-v { font-size:1.1rem; }
  }

  /* ── PORTFOLIO PERFORMANCE CHART ────────────────────────── */
  .perf-chart-wrap { margin-top:16px; padding-top:16px; border-top:1px solid rgba(255,255,255,.05); }
  .perf-chart-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:6px; }
  :global(html.light) .perf-chart-wrap { border-top-color:rgba(0,0,0,.06); }

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

  /* ── INTEL VIEW TRANSITION ─────────────────────────────── */
  .intel-view-wrap { position:relative; transition:opacity .35s ease; }
  .intel-view-wrap--transitioning { opacity:0; pointer-events:none; }
  @media (prefers-reduced-motion:reduce) {
    .intel-view-wrap--transitioning { opacity:1; }
  }

  /* ── INTEL CONSISTENT GC CONTAINER ─────────────────────── */
  .intel-gc { min-height:280px; }
  .globe-gc { min-height:unset; }

  /* ── GLOBE LIVE BADGE ───────────────────────────────────── */
  .globe-badge {
    font-size:.6rem; font-weight:700; letter-spacing:.1em; padding:3px 8px;
    border-radius:4px; border:1px solid rgba(239,68,68,.4);
    background:rgba(239,68,68,.12); color:#f87171; flex-shrink:0;
    animation:badge-blink 2.2s ease-in-out infinite;
  }
  .globe-badge--breaking {
    border-color:rgba(255,224,51,.5); background:rgba(255,224,51,.12); color:#ffe033;
    animation:badge-blink 0.9s step-start infinite;
  }
  @keyframes badge-blink { 0%,100%{opacity:1;} 50%{opacity:.55;} }

  /* ── INTEL CARD – CONSISTENT SIZING FOR BOTH VIEWS ─────── */
  .pm-card--intel { min-height:130px; }
  @media (max-width:600px) {
    .pm-card--intel { min-height:90px; }
    .intel-gc { min-height:unset; }
  }

  /* ── TOPIC ICON BACKGROUND (frosted) ───────────────────── */
  .pm-card-topic-icon {
    position:absolute; top:50%; right:10px; transform:translateY(-50%);
    font-size:2.8rem; line-height:1; opacity:.08; pointer-events:none; z-index:0;
    filter:blur(1px);
  }
  .pm-card-frosted-overlay {
    position:absolute; inset:0; z-index:0; pointer-events:none; border-radius:10px;
    background:linear-gradient(135deg,rgba(247,147,26,.03) 0%,transparent 60%);
  }
  :global(html.light) .pm-card-topic-icon { opacity:.06; }

  /* ── SECONDARY OUTCOMES (multi-outcome markets) ─────────── */
  .pm-secondary-outcomes {
    display:flex; flex-wrap:wrap; gap:4px 10px; margin-top:2px;
  }
  .pm-secondary-item {
    display:inline-flex; align-items:baseline; gap:3px;
  }
  .pm-secondary-name {
    font-size:.62rem; color:var(--t2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:120px;
  }
  .pm-secondary-pct {
    font-size:.62rem; font-weight:700; flex-shrink:0;
  }
  :global(html.light) .pm-secondary-name { color:rgba(0,0,0,.5); }

  /* ── BINARY PROBABILITY DISPLAY ────────────────────────── */
  .pm-binary-prob {
    display:flex; align-items:baseline; gap:6px; margin-top:auto;
  }
  .pm-binary-outcome {
    font-size:.75rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
  }
  .pm-binary-pct {
    font-size:1.4rem; font-weight:800; line-height:1; letter-spacing:-.02em;
  }
  @media (max-width:600px) {
    .pm-binary-pct { font-size:1.2rem; }
  }

  /* ── POLYMARKET DATA ROW ───────────────────────────────── */
  .pm-card-data {
    display:flex; gap:5px; align-items:center; flex-wrap:wrap; margin-top:auto;
  }
  .pm-data-vol, .pm-data-vol24, .pm-data-liq {
    font-size:.54rem; font-weight:600; color:var(--t3); text-transform:uppercase; letter-spacing:.05em;
    padding:1px 6px; border-radius:4px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.05);
  }
  .pm-data-vol24 { color:var(--t2); }
  .pm-data-liq { color:rgba(100,200,255,.7); border-color:rgba(100,200,255,.15); }
  :global(html.light) .pm-data-vol, :global(html.light) .pm-data-vol24, :global(html.light) .pm-data-liq {
    background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.06); color:rgba(0,0,0,.4);
  }
  :global(html.light) .pm-data-vol24 { color:rgba(0,0,0,.55); }
  :global(html.light) .pm-data-liq { color:rgba(0,100,200,.55); }

  /* ── PROBABILITY BAR ───────────────────────────────────── */
  .pm-card-prob-bar {
    height:3px; background:rgba(255,255,255,.04); border-radius:2px; overflow:hidden; margin-top:4px;
  }
  .pm-prob-fill { height:100%; border-radius:2px; transition:width .7s ease; opacity:.7; }
  :global(html.light) .pm-card-prob-bar { background:rgba(0,0,0,.04); }
  :global(html.light) .pm-prob-fill { opacity:.5; }

  /* ── URGENT / TRENDING CARD VARIANTS ──────────────────── */
  .pm-card--urgent { border-color:rgba(255,180,50,.18); }
  .pm-card--urgent::before { background:linear-gradient(90deg,transparent,rgba(255,180,50,.25),transparent); }
  .pm-card--trending { border-color:rgba(255,80,40,.25); box-shadow:0 0 12px rgba(255,80,40,.08); }
  .pm-card--trending::before { background:linear-gradient(90deg,transparent,rgba(255,80,40,.22),transparent); }
  :global(html.light) .pm-card--urgent { border-color:rgba(200,120,0,.2); }
  :global(html.light) .pm-card--trending { border-color:rgba(200,50,50,.2); }

  /* ── TRENDING FOIL ANIMATION ────────────────────────────── */
  /* Removed foil animation — trending tag uses static highlight only */

  /* ── EXTRA TAG VARIANTS ────────────────────────────────── */
  .pm-trending-tag {
    background: rgba(220,60,30,.18);
    color: #ff7755 !important;
    border-color: rgba(255,80,40,.4);
    font-weight: 700;
  }
  @media (prefers-reduced-motion: reduce) {
    .pm-trending-tag { color: #ff6644 !important; background: rgba(255,60,30,.15); }
  }
  :global(html.light) .pm-trending-tag { background: rgba(180,40,20,.1); color: #c03020 !important; border-color: rgba(200,60,40,.35); }
  .pm-urgent-tag { background:rgba(255,180,50,.1); border-color:rgba(255,180,50,.3); color:#ffb432; }
  .pm-date-tag { color:var(--t3); }
  :global(html.light) .pm-urgent-tag { background:rgba(180,110,0,.08); border-color:rgba(180,110,0,.25); color:#946000; }

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
  .pm-prob-tag { font-weight:700; }
  .pm-card-q { font-size:.84rem; color:var(--t1); line-height:1.5; font-weight:500; flex:1; }
  @media (max-width:600px) {
    .pm-grid {
      display:flex; flex-direction:column;
      overflow-x:hidden;
      gap:10px;
    }
    .pm-grid .pm-card {
      width:100%;
      min-height:auto;
      display:flex !important;
    }
    .pm-card-q { font-size:.82rem; }
  }

  :global(html.light) .pm-card { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.07); }
  :global(html.light) .pm-card:hover { border-color:rgba(247,147,26,.2); }
  :global(html.light) .pm-tag { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.08); color:rgba(0,0,0,.5); }
  :global(html.light) .pm-card-q { color:rgba(0,0,0,.75); }

  :global(html.light) .pm-news-src { background:rgba(247,147,26,.08); border-color:rgba(247,147,26,.25); color:#c77a10; }

  /* Intel section padding on mobile */
  #intel.section { padding-bottom: 80px; }
  @media (max-width:700px) {
    #intel.section { padding-top: 20px; padding-bottom: 80px; }
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
    filter:blur(12px) saturate(90%) sepia(25%); z-index:0; border-radius:8px;
    transform:scale(1.05);
  }
  .news-img-overlay {
    position:absolute; inset:0; z-index:1; background:linear-gradient(180deg, rgba(247,147,26,.13) 0%, rgba(15,7,0,.74) 55%, rgba(8,3,0,.93) 100%);
    backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px);
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
  :global(html.light) .price-label-usd { color: #22c55e; }
  :global(html.light) .sats-cur { color:#111; }
  :global(html.light) .sats-label-sats { -webkit-text-fill-color:unset; background:none; color:#c77a10; animation:none; }
  :global(html.light) .sats-label-cur  { color:#16a34a; }
  :global(html.light) .eyebrow.orange  { -webkit-text-fill-color:unset; background:none; color:#c77a10; animation:none; }
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
  :global(html.light) .gc:hover { border-color:rgba(0,0,0,.12); }
  :global(html.light) .gf-perf { border-top-color:rgba(0,0,0,.08); }
  :global(html.light) .gfp { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.06); }
  /* Light-mode: override section bottom-fade to use light background */
  @media (max-width:700px) {
    :global(html.light) .section::after { background:linear-gradient(to bottom, transparent, #f0f0f1); }
  }
</style>
