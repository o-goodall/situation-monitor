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
    markets, newsItems, btcDisplayPrice, btcWsConnected,
    btcHashrate, gfPortfolioChart
  } from '$lib/store';
  import Sparkline from '$lib/Sparkline.svelte';
  import PriceChart from '$lib/PriceChart.svelte';
  $: displayCur = ($settings.displayCurrency ?? 'AUD').toUpperCase();

  let btcChartRange: '1D' | '1W' | '1Y' = '1D';
  let btcChartData: { t: number; p: number }[] = [];
  let btcChartLoading = false;

  async function fetchBtcChart(r = btcChartRange) {
    btcChartLoading = true;
    try {
      const map: Record<string,string> = { '1D':'1d', '1W':'7d', '1Y':'1y' };
      const d = await fetch(`/api/bitcoin/history?range=${map[r]}`).then(res => res.json());
      btcChartData = d.prices ?? [];
    } catch { btcChartData = []; }
    finally { btcChartLoading = false; }
  }

  async function setBtcChartRange(r: '1D' | '1W' | '1Y') {
    btcChartRange = r;
    await fetchBtcChart(r);
  }

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

  let intelView: 'cutting-edge'|'classic' = 'classic';
  let intelTransitioning = false;
  const BLUR_DURATION_MS = 400;   // blur phase before content swap
  const REVEAL_DURATION_MS = 600; // reveal phase after content swap
  function switchIntelView() {
    intelTransitioning = true;
    setTimeout(() => {
      intelView = intelView === 'cutting-edge' ? 'classic' : 'cutting-edge';
      setTimeout(() => { intelTransitioning = false; }, REVEAL_DURATION_MS);
    }, BLUR_DURATION_MS);
  }
  const INTEL_TILE_LIMIT = 12; // 3 columns × 4 rows
  const MOBILE_CAROUSEL_LIMIT = 6; // max items shown per view on mobile carousel
  const CAROUSEL_GAP_PX = 12; // gap between carousel cards (matches CSS gap:12px)
  const CAROUSEL_AUTO_ADVANCE_MS = 4000; // auto-advance interval for mobile carousel

  let mktCarouselTrack: HTMLElement | null = null;
  let newsCarouselTrack: HTMLElement | null = null;
  let mktCarouselPage = 0;
  let newsCarouselPage = 0;

  function getCarouselCardSize(track: HTMLElement): number {
    const first = track.firstElementChild as HTMLElement | null;
    if (!first) return track.clientHeight;
    // Carousel is vertical on mobile (overflow-y); height-based measurement is used.
    return first.getBoundingClientRect().height + CAROUSEL_GAP_PX;
  }
  function carouselGo(track: HTMLElement | null, page: number) {
    if (!track) return;
    track.scrollTo({ top: page * getCarouselCardSize(track), behavior: 'smooth' });
  }
  function onMktScroll() {
    if (!mktCarouselTrack) return;
    mktCarouselPage = Math.round(mktCarouselTrack.scrollTop / getCarouselCardSize(mktCarouselTrack));
  }
  function onNewsScroll() {
    if (!newsCarouselTrack) return;
    newsCarouselPage = Math.round(newsCarouselTrack.scrollTop / getCarouselCardSize(newsCarouselTrack));
  }

  /** Detect topic keyword for frosted background tint */
  const TOPIC_MAP: [RegExp, string][] = [
    [/trump|maga|republican|gop/, '🇺🇸'],
    [/iran|tehran|persian/, '🇮🇷'],
    [/china|beijing|xi jinping/, '🇨🇳'],
    [/russia|moscow|putin|kremlin/, '🇷🇺'],
    [/bitcoin|btc|crypto|ethereum/, '₿'],
    [/fed|federal reserve|interest rate|inflation/, '🏛️'],
    [/israel|gaza|hamas|palestine/, '⚔️'],
    [/ukraine|kyiv|zelensky/, '🇺🇦'],
    [/oil|opec|energy|gas/, '🛢️'],
    [/election|vote|ballot|poll/, '🗳️'],
    [/war|military|missile|nuclear/, '⚠️'],
    [/trade|tariff|sanction/, '📊'],
  ];
  function detectTopic(text: string): string {
    const t = text.toLowerCase();
    for (const [re, icon] of TOPIC_MAP) { if (re.test(t)) return icon; }
    return '◈';
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

  // Mobile feed carousels — duplicate items so the CSS loop is seamless
  $: newsLoop = $newsItems.length ? [...$newsItems, ...$newsItems] : [];

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
    const map: Record<string,string> = { '1D':'1d', '1W':'7d', '1Y':'1y' };
    return map[r] ?? '1d';
  }

  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

  onMount(() => {
    fetchBtcChart();
    fetchHashrateChart();

    // Auto-advance the Intel carousel on mobile
    const mq = window.matchMedia('(max-width:700px)');
    let autoTimer: ReturnType<typeof setInterval> | null = null;

    function carouselTick() {
      if (!mq.matches) return;
      if (intelView === 'cutting-edge' && mktCarouselTrack) {
        const n = Math.min(mktCarouselTrack.children.length, MOBILE_CAROUSEL_LIMIT);
        if (n > 1) { mktCarouselPage = (mktCarouselPage + 1) % n; carouselGo(mktCarouselTrack, mktCarouselPage); }
      } else if (intelView === 'classic' && newsCarouselTrack) {
        const n = Math.min(newsCarouselTrack.children.length, MOBILE_CAROUSEL_LIMIT);
        if (n > 1) { newsCarouselPage = (newsCarouselPage + 1) % n; carouselGo(newsCarouselTrack, newsCarouselPage); }
      }
    }
    function startAutoAdvance() {
      if (autoTimer) clearInterval(autoTimer);
      if (mq.matches) autoTimer = setInterval(carouselTick, CAROUSEL_AUTO_ADVANCE_MS);
    }
    startAutoAdvance();
    mq.addEventListener('change', startAutoAdvance);

    return () => { if (autoTimer) clearInterval(autoTimer); mq.removeEventListener('change', startAutoAdvance); };
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
        {#if $halvingDate}<span class="halving-date halving-date--glow">{$halvingDate}</span>{/if}
      {:else}
        <span class="stat-n muted">—</span>
        <span class="stat-l">Days to Halving</span>
      {/if}
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

        {:else}
          <!-- BACK FACE — formula explanation -->
          <div class="dca-face">
            <div class="dca-formula-head">
              <p class="eyebrow orange">The Formula</p>
              <button class="btn-ghost" on:click={() => dcaFlipped = false} aria-label="Back to signal view">↩ Back</button>
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
      <div class="chart-header" style="margin-bottom:12px;">
        <p class="gc-title">Bitcoin Hashrate</p>
        <div class="chart-range-btns" role="group" aria-label="Hashrate chart range">
          <button class="crb" class:crb--active={hashrateChartRange==='1Y'} on:click={() => setHashrateChartRange('1Y')}>1Y</button>
          <button class="crb" class:crb--active={hashrateChartRange==='2Y'} on:click={() => setHashrateChartRange('2Y')}>2Y</button>
          <button class="crb" class:crb--active={hashrateChartRange==='All'} on:click={() => setHashrateChartRange('All')}>All</button>
        </div>
      </div>
      <div class="chart-container">
        {#if hashrateLoading}
          <div class="skeleton" style="height:100%;min-height:160px;border-radius:6px;"></div>
        {:else if hashrateData.length >= 2}
          <PriceChart prices={hashrateData} fillParent={true} range={hashrateChartRange === 'All' ? 'max' : hashrateChartRange === '2Y' ? '5y' : '1y'} formatY={(v) => `${v.toFixed(0)} EH/s`} />
        {:else}
          <p class="dim" style="text-align:center;padding:40px 0;">Loading hashrate data…</p>
        {/if}
      </div>
      {#if $btcHashrate !== null}
      <div class="hash-row">
        <span class="eyebrow">Current Hash Rate</span>
        <span class="hash-val">{$btcHashrate.toFixed(1)}<span class="met-u"> EH/s</span></span>
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
    <div class="gc">
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
      <p class="gc-title">Bitcoin Price</p>
      <div class="chart-controls">
        <!-- Range buttons -->
        <div class="chart-range-btns" role="group" aria-label="Chart time range">
          <button class="crb" class:crb--active={btcChartRange==='1D'} on:click={() => setBtcChartRange('1D')}>1D</button>
          <button class="crb" class:crb--active={btcChartRange==='1W'} on:click={() => setBtcChartRange('1W')}>1W</button>
          <button class="crb" class:crb--active={btcChartRange==='1Y'} on:click={() => setBtcChartRange('1Y')}>1Y</button>
        </div>
      </div>
    </div>

    <div class="chart-container">
      {#if btcChartLoading}
        <div class="skeleton" style="height:160px;border-radius:6px;"></div>
      {:else if btcChartData.length >= 2}
        <PriceChart
          prices={btcChartData}
          height={160}
          range={btcChartRange === '1D' ? '1d' : '1y'}
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
    <!-- Toggle: Cutting Edge / Classic — Apple-style -->
    <div class="intel-toggle-wrap" role="group" aria-label="Intel view">
      <span class="toggle-icon" class:toggle-icon--active={intelView==='cutting-edge'} title="Cutting Edge — prediction markets">◈</span>
      <button
        class="apple-toggle"
        class:apple-toggle--classic={intelView==='classic'}
        on:click={switchIntelView}
        role="switch"
        aria-checked={intelView === 'cutting-edge'}
        aria-label="Switch intel view. Currently {intelView === 'cutting-edge' ? 'Cutting Edge' : 'Classic'}"
      >
        <span class="apple-knob"></span>
      </button>
      <span class="toggle-icon" class:toggle-icon--active={intelView==='classic'} title="Classic — news feed">☰</span>
    </div>
  </div>

  <!-- Transition wrapper — fixed container prevents layout shift -->
  <div class="intel-view-wrap" class:intel-view-wrap--transitioning={intelTransitioning}>
    <div class="intel-foil-sweep" class:intel-foil-sweep--active={intelTransitioning}></div>

    {#if intelView === 'cutting-edge'}
    <!-- ── CUTTING EDGE: Polymarket Geopolitics card grid ── -->
    <div class="gc intel-gc" style="padding:20px 18px;">
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
        <div class="carousel-wrap">
          <div class="pm-grid pm-carousel" bind:this={mktCarouselTrack} on:scroll={onMktScroll}>
            {#each $markets.slice(0, INTEL_TILE_LIMIT) as m}
              <a href="{m.url}" target="_blank" rel="noopener noreferrer" class="pm-card pm-card--intel" aria-label="{m.question}">
                <div class="pm-card-frosted-overlay"></div>
                <!-- Tag row -->
                <div class="pm-card-tags" style="position:relative;z-index:1;">
                  {#if m.pinned}
                    <span class="pm-tag pm-pin">★ Watching</span>
                  {:else}
                    <span class="pm-tag">{m.tag}</span>
                  {/if}
                  <span class="pm-tag pm-prob-tag" style="color:{pc(m.probability)};" aria-label="{m.topOutcome} probability {m.probability} percent">{m.topOutcome} {m.probability}%</span>
                </div>
                <!-- Question -->
                <p class="pm-card-q" style="position:relative;z-index:1;">{m.question}</p>
                <!-- Top outcomes list for multi-outcome markets (e.g. FIFA, elections) -->
                {#if m.outcomes.length > 2}
                  <ul class="pm-outcomes" style="position:relative;z-index:1;" aria-label="Top contenders">
                    {#each m.outcomes.slice(0, 4) as o}
                      <li class="pm-outcome-row">
                        <span class="pm-outcome-name">{o.name}</span>
                        <span class="pm-outcome-pct" style="color:{pc(o.probability)};">{o.probability}%</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
                <!-- Enhanced data row -->
                <div class="pm-card-data" style="position:relative;z-index:1;">
                  <span class="pm-data-vol" title="Total volume">{fmtVol(m.volume)}</span>
                  {#if m.volume24hr > 0}
                    <span class="pm-data-vol24" title="24h volume">24h {fmtVol(m.volume24hr)}</span>
                  {/if}
                  {#if m.probability >= 70}
                    <span class="pm-data-trend pm-data-trend--high" title="High probability">▲ Likely</span>
                  {:else if m.probability <= 30}
                    <span class="pm-data-trend pm-data-trend--low" title="Low probability">▼ Unlikely</span>
                  {:else}
                    <span class="pm-data-trend pm-data-trend--mid" title="Contested">◆ Contested</span>
                  {/if}
                </div>
                <!-- Probability bar -->
                <div class="pm-card-prob-bar" style="position:relative;z-index:1;">
                  <div class="pm-prob-fill" style="width:{m.probability}%;background:{pc(m.probability)};"></div>
                </div>
              </a>
            {/each}
          </div>
          <!-- Mobile carousel navigation -->
          <div class="carousel-nav" aria-label="Carousel navigation">
            <button class="carousel-btn" on:click={() => { mktCarouselPage = Math.max(0, mktCarouselPage - 1); carouselGo(mktCarouselTrack, mktCarouselPage); }} aria-label="Previous market">‹</button>
            <div class="carousel-dots" aria-hidden="true">
              {#each $markets.slice(0, MOBILE_CAROUSEL_LIMIT) as _, i}
                <button class="carousel-dot" class:carousel-dot--active={i === mktCarouselPage} on:click={() => { mktCarouselPage = i; carouselGo(mktCarouselTrack, mktCarouselPage); }} aria-label="Market {i + 1} of {Math.min($markets.length, MOBILE_CAROUSEL_LIMIT)}"></button>
              {/each}
            </div>
            <button class="carousel-btn" on:click={() => { mktCarouselPage = Math.min(Math.min($markets.length, MOBILE_CAROUSEL_LIMIT) - 1, mktCarouselPage + 1); carouselGo(mktCarouselTrack, mktCarouselPage); }} aria-label="Next market">›</button>
          </div>
        </div>
      {/if}
    </div>

    {:else}
    <!-- ── CLASSIC: News RSS feeds ── -->
    <div class="gc intel-gc" style="padding:20px 18px;">
      <div class="gc-head" style="margin-bottom:16px;"><p class="gc-title">News Feed</p><span class="dim">{Math.min($newsItems.length, INTEL_TILE_LIMIT)} articles</span></div>
      {#if $newsItems.length===0}
        <p class="dim">Fetching RSS feeds…</p>
      {:else}
        <div class="carousel-wrap">
          <div class="pm-grid news-pm-grid pm-carousel" bind:this={newsCarouselTrack} on:scroll={onNewsScroll}>
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
          <!-- Mobile carousel navigation -->
          <div class="carousel-nav" aria-label="Carousel navigation">
            <button class="carousel-btn" on:click={() => { newsCarouselPage = Math.max(0, newsCarouselPage - 1); carouselGo(newsCarouselTrack, newsCarouselPage); }} aria-label="Previous story">‹</button>
            <div class="carousel-dots" aria-hidden="true">
              {#each $newsItems.slice(0, MOBILE_CAROUSEL_LIMIT) as _, i}
                <button class="carousel-dot" class:carousel-dot--active={i === newsCarouselPage} on:click={() => { newsCarouselPage = i; carouselGo(newsCarouselTrack, newsCarouselPage); }} aria-label="Story {i + 1} of {Math.min($newsItems.length, MOBILE_CAROUSEL_LIMIT)}"></button>
              {/each}
            </div>
            <button class="carousel-btn" on:click={() => { newsCarouselPage = Math.min(Math.min($newsItems.length, MOBILE_CAROUSEL_LIMIT) - 1, newsCarouselPage + 1); carouselGo(newsCarouselTrack, newsCarouselPage); }} aria-label="Next story">›</button>
          </div>
        </div>
      {/if}
    </div>
    {/if}
  </div>

</section>

<style>
  /* ── LAYOUT ──────────────────────────────────────────────── */
  .section { max-width: 1440px; margin: 0 auto; padding: 48px 24px 0; min-height: 100vh; scroll-snap-align: start; scroll-snap-stop: always; position: relative; overflow: clip; }
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
    .section { padding:20px 12px 0; min-height:auto; scroll-snap-align:none; }
    .section-header {
      margin-bottom:16px;
    }
    .section-divider { margin-top:24px; }
    /* Bottom padding for each section so content doesn't abut next section */
    #signal    { padding-bottom:32px; }
    #portfolio { padding-bottom:32px; }
  }
  @media (max-width:600px) {
    .section-header { margin-bottom:14px; }
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
    .price-usd { font-size:1.2rem; }
    .price-alt { font-size:1.2rem; }
    .price-sep { font-size:.8rem; }
  }

  /* Sats per currency — large SATS display */
  .sats-display { display:flex; align-items:baseline; gap:6px; justify-content:center; margin-bottom:4px; }
  .sats-cur { font-size:1.4rem; font-weight:700; color:#e2e2e8; letter-spacing:-.025em; line-height:1.1; }
  @media (max-width:500px) {
    .sats-cur { font-size:1.15rem; }
  }

  .stat-n { display:block; font-size:1.4rem; font-weight:700; letter-spacing:-.025em; margin-bottom:6px; line-height:1.1; color:var(--t1); }
  .stat-l { font-size:.58rem; color:var(--t2); text-transform:uppercase; letter-spacing:.1em; }

  /* Halving number — same size as price-alt for uniformity */
  .halving-n { font-size:1.4rem; font-weight:700; letter-spacing:-.025em; }

  /* Projected halving date label */
  .halving-date { font-size:.58rem; color:var(--orange); margin-top:4px; font-variant-numeric:tabular-nums; letter-spacing:.03em; position:relative; display:inline-block; }

  /* Subtle foil sweep — fires once every ~10 s, single pass */
  @keyframes halvingFoil {
    0%   { background-position: -200% center; }
    15%  { background-position: 200% center; }
    100% { background-position: 200% center; }
  }
  .halving-date--glow {
    background: linear-gradient(105deg, var(--orange) 30%, #ffe0a0 50%, var(--orange) 70%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: halvingFoil 10s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .halving-date--glow { animation: none; -webkit-text-fill-color: var(--orange); color: var(--orange); }
  }

  /* Static stat tile — no hover lift or underline animation */
  .stat-tile--static { cursor:default; }
  .stat-tile--static:hover { transform:none !important; border-color:var(--glass-bd) !important; box-shadow:none !important; }
  .stat-tile--static:hover::before { width:0 !important; }

  @media (max-width:800px) { .stat-strip{ grid-template-columns:repeat(3,1fr); } }
  @media (max-width:500px) {
    /* BTC price tile spans full width; sats + halving sit side-by-side below */
    .stat-strip{ grid-template-columns:1fr 1fr; gap:10px; }
    .stat-tile--chart { grid-column:1 / -1; }
    .stat-n { font-size:1.25rem; }
    .stat-tile { padding:16px 12px; }
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
  @media (max-width:700px)  { .signal-grid{grid-template-columns:1fr; gap:10px;} }

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

  /* Hashrate tile — flex column so the chart fills remaining tile height */
  .gc--hashrate { display:flex; flex-direction:column; }
  .gc--hashrate .chart-container { flex:1; min-height:160px; }
  .gc--hashrate .hash-row { margin-top:auto; padding-top:10px; }

  /* ── MOBILE: hide supplementary sections, limit intel stories ── */
  @media (max-width:768px) {
    .btc-network-card,
    .btc-hashrate-card,
    .btc-chart-card { display:none; }
  }

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
  .dca-flip-scene { perspective:900px; position:relative; z-index:2; }
  .dca-face { animation:dcaFaceIn .38s cubic-bezier(.25,.46,.45,.94) both; position:relative; }
  @keyframes dcaFaceIn {
    from { opacity:0; transform:rotateY(72deg) scale(.97); }
    to   { opacity:1; transform:rotateY(0deg)  scale(1);   }
  }
  @media (prefers-reduced-motion:reduce) { .dca-face { animation:none; } }
  /* On mobile, lock the flip-scene to a minimum height equal to the front face
     so flipping to the back doesn't collapse the tile.
     280px: enough to show header + hero amount + brief loading state.
     200px: minimum for the formula back-face list items. */
  @media (max-width:700px) {
    .signal-card { min-height:280px; }
    .dca-flip-scene { min-height:200px; }
  }

  /* Small "?" info button — bottom-right corner of the DCA front face */
  .dca-info-btn {
    position:absolute; bottom:8px; right:8px; z-index:3;
    width:22px; height:22px; padding:0; border-radius:50%;
    background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14);
    color:rgba(255,255,255,.38); font-size:.62rem; font-weight:700;
    line-height:1; cursor:pointer;
    transition:background .2s, border-color .2s, color .2s, box-shadow .2s;
    display:flex; align-items:center; justify-content:center;
    overflow:hidden;
  }
  .dca-info-btn::after {
    content:''; position:absolute; inset:0; border-radius:50%; pointer-events:none;
    background:linear-gradient(105deg,transparent 25%,rgba(255,255,255,.55) 50%,transparent 75%);
    background-size:200% 100%; background-position:-200% center;
    transition:background-position .4s ease;
  }
  .dca-info-btn:hover {
    background:rgba(247,147,26,.14); border-color:rgba(247,147,26,.45);
    color:var(--orange); box-shadow:0 0 8px rgba(247,147,26,.25);
  }
  .dca-info-btn:hover::after { background-position:200% center; }
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
    width:26px; height:26px; padding:0; border-radius:50%;
    background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.1);
    color:rgba(255,255,255,.4); font-size:.72rem; cursor:pointer; transition:all .2s;
    flex-shrink:0;
  }
  .btn-icon:hover { border-color:rgba(247,147,26,.3); color:var(--orange); background:rgba(247,147,26,.06); transform:rotate(45deg); }
  :global(html.light) .btn-icon { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.12); color:rgba(0,0,0,.5); }
  :global(html.light) .btn-icon:hover { border-color:rgba(247,147,26,.3); color:#c77a10; background:rgba(247,147,26,.06); }

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
  .intel-foil-sweep {
    position:absolute; inset:0; z-index:10; pointer-events:none; opacity:0;
    background:linear-gradient(105deg,transparent 30%,rgba(247,147,26,.18) 45%,rgba(255,224,160,.22) 50%,rgba(247,147,26,.18) 55%,transparent 70%);
    background-size:250% 100%; border-radius:8px;
  }
  .intel-foil-sweep--active {
    opacity:1;
    animation:intelFoilSweep .8s ease-out forwards;
  }
  @keyframes intelFoilSweep {
    0%   { background-position:-100% center; opacity:1; }
    80%  { opacity:1; }
    100% { background-position:200% center; opacity:0; }
  }
  @media (prefers-reduced-motion:reduce) {
    .intel-view-wrap--transitioning { opacity:1; }
    .intel-foil-sweep--active { animation:none; opacity:0; }
  }

  /* ── INTEL CONSISTENT GC CONTAINER ─────────────────────── */
  .intel-gc { min-height:280px; }

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

  /* ── POLYMARKET OUTCOMES LIST (multi-outcome markets) ──────── */
  .pm-outcomes {
    list-style:none; margin:0; padding:0;
    display:flex; flex-direction:column; gap:3px;
    margin-top:2px;
  }
  .pm-outcome-row {
    display:flex; justify-content:space-between; align-items:center;
    font-size:.72rem; line-height:1.3;
  }
  .pm-outcome-name {
    color:var(--t2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:70%;
  }
  .pm-outcome-pct {
    font-weight:700; font-size:.72rem; flex-shrink:0;
  }
  :global(html.light) .pm-outcome-name { color:rgba(0,0,0,.55); }

  /* ── POLYMARKET DATA ROW ───────────────────────────────── */
  .pm-card-data {
    display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:auto;
  }
  .pm-data-vol, .pm-data-vol24 {
    font-size:.54rem; font-weight:600; color:var(--t3); text-transform:uppercase; letter-spacing:.05em;
    padding:1px 6px; border-radius:4px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.05);
  }
  .pm-data-vol24 { color:var(--t2); }
  .pm-data-trend {
    font-size:.54rem; font-weight:700; letter-spacing:.04em; margin-left:auto;
  }
  .pm-data-trend--high { color:var(--up); }
  .pm-data-trend--low { color:var(--dn); }
  .pm-data-trend--mid { color:var(--orange); }
  :global(html.light) .pm-data-vol, :global(html.light) .pm-data-vol24 {
    background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.06); color:rgba(0,0,0,.4);
  }
  :global(html.light) .pm-data-vol24 { color:rgba(0,0,0,.55); }

  /* ── PROBABILITY BAR ───────────────────────────────────── */
  .pm-card-prob-bar {
    height:3px; background:rgba(255,255,255,.04); border-radius:2px; overflow:hidden; margin-top:4px;
  }
  .pm-prob-fill { height:100%; border-radius:2px; transition:width .7s ease; opacity:.7; }
  :global(html.light) .pm-card-prob-bar { background:rgba(0,0,0,.04); }
  :global(html.light) .pm-prob-fill { opacity:.5; }

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
    /* Both pm-grid types use a vertical scroll on mobile */
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
  /* ── INTEL CAROUSEL (mobile) ──────────────────────────────── */
  /* Desktop: carousel-nav hidden, pm-carousel behaves as normal pm-grid */
  .carousel-wrap { position:relative; }
  .carousel-nav { display:none; }

  @media (max-width:700px) {
    /* Remove the old max-height overflow constraint — vertical carousel replaces it */
    .intel-gc { max-height:unset; overflow-y:visible; }

    /* Vertical scroll carousel track.
       max-height: ~2.5 cards visible at once, prompting the user to scroll for more. */
    .pm-carousel {
      display:flex !important;
      flex-direction:column !important;
      overflow-y:auto;
      overflow-x:hidden;
      max-height:480px;
      scroll-snap-type:y mandatory;
      -webkit-overflow-scrolling:touch;
      scrollbar-width:none;
      gap:10px;
      padding-bottom:4px;
    }
    .pm-carousel::-webkit-scrollbar { display:none; }

    /* Each card fills full width */
    .pm-carousel .pm-card {
      flex:none !important;
      width:100% !important;
      scroll-snap-align:start;
      min-height:auto;
    }

    /* Hide items beyond MOBILE_CAROUSEL_LIMIT (6) on mobile — update if MOBILE_CAROUSEL_LIMIT changes */
    .pm-carousel .pm-card:nth-child(n+7) { display:none !important; }

    /* Vertical scroll is intuitive — hide prev/next nav, keep dots as scroll indicator */
    .carousel-nav { display:none; }
  }
  :global(html.light) .carousel-btn { background:rgba(0,0,0,.05); border-color:rgba(0,0,0,.1); color:rgba(0,0,0,.7); }
  :global(html.light) .carousel-btn:hover { background:rgba(0,0,0,.1); }
  :global(html.light) .carousel-dot { background:rgba(0,0,0,.18); }
  :global(html.light) .carousel-dot--active { background:#c77a10; }
  :global(html.light) .pm-card { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.07); }
  :global(html.light) .pm-card:hover { border-color:rgba(247,147,26,.2); }
  :global(html.light) .pm-tag { background:rgba(0,0,0,.03); border-color:rgba(0,0,0,.08); color:rgba(0,0,0,.5); }
  :global(html.light) .pm-card-q { color:rgba(0,0,0,.75); }

  :global(html.light) .pm-news-src { background:rgba(247,147,26,.08); border-color:rgba(247,147,26,.25); color:#c77a10; }

  /* ── MOBILE NEWS/MARKET CAROUSEL ────────────────────────────── */
  /* (scroll-snap applied to all .pm-grid on mobile in the block above) */

  /* Intel section padding on mobile */
  #intel.section { padding-bottom: 80px; }
  @media (max-width:700px) {
    #intel.section { min-height: auto; padding-top: 20px; padding-bottom: 40px; }
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
  :global(html.light) .gf-perf { border-top-color:rgba(0,0,0,.08); }
  :global(html.light) .gfp { background:rgba(0,0,0,.02); border-color:rgba(0,0,0,.06); }
</style>
