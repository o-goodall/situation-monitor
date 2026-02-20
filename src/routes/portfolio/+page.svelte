<script lang="ts">
  import {
    settings, btcPrice,
    goldPriceUsd, goldYtdPct, sp500Price, sp500YtdPct, cpiAnnual,
    gfNetWorth, gfTotalInvested, gfNetGainPct, gfNetGainYtdPct,
    gfTodayChangePct, gfHoldings, gfError, gfLoading, gfUpdated
  } from '$lib/store';

  let showHoldings = false;

  const n   = (v: number, dec = 0) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const pct = (v: number | null)   => v === null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const signColor = (v: number | null) => v === null ? '#52525b' : v >= 0 ? '#22c55e' : '#f43f5e';

  $: s = $settings.dca;
  $: dcaDays = Math.max(0, Math.floor((Date.now() - new Date(s.startDate).getTime()) / 86400000));

  $: inflationAdjNW = (() => {
    if ($gfNetWorth === null || $cpiAnnual === null) return null;
    const yrs = dcaDays / 365.25;
    return $gfNetWorth / Math.pow(1 + $cpiAnnual / 100, yrs);
  })();

  $: cpiCumLoss = (() => {
    if ($cpiAnnual === null) return 0;
    const yrs = Math.max(0.1, dcaDays / 365.25);
    return (1 - 1 / Math.pow(1 + $cpiAnnual / 100, yrs)) * 100;
  })();

  $: portCAGR = (() => {
    if ($gfNetGainPct === null) return null;
    const yrs = Math.max(0.1, dcaDays / 365.25);
    return (Math.pow(1 + $gfNetGainPct / 100, 1 / yrs) - 1) * 100;
  })();

  async function fetchGhostfolio() {
    const token = $settings.ghostfolio?.token?.trim();
    if (!token) return;
    $gfLoading = true; $gfError = '';
    try {
      const d = await fetch(`/api/ghostfolio?token=${encodeURIComponent(token)}`).then(r => r.json());
      if (d.error) { $gfError = d.error; }
      else {
        $gfNetWorth = d.netWorth; $gfTotalInvested = d.totalInvested;
        $gfNetGainPct = d.netGainPct; $gfNetGainYtdPct = d.netGainYtdPct;
        $gfTodayChangePct = d.todayChangePct; $gfHoldings = d.holdings ?? [];
        $gfUpdated = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      }
    } catch { $gfError = 'Connection failed'; }
    finally { $gfLoading = false; }
  }
</script>

<!-- HERO -->
<section class="hero">
  <div class="hero-inner">
    <p class="hero-eyebrow">Assets · Performance · Holdings</p>
    <h1 class="hero-title">PORTFOLIO</h1>
    <p class="hero-desc">Track your stack against gold, equities, and inflation.<br>See what's really happening to your wealth.</p>
  </div>
</section>

<!-- GRID -->
<div class="pg">

  <!-- ASSET COMPARISON -->
  <div class="asset-col">
    <p class="sect-label">ASSET COMPARISON</p>
    <div class="gc asset-card">
      <div class="card-head" style="margin-bottom:24px;">
        <p class="ch-t">1-Year Performance</p>
        <p class="dim">vs Bitcoin baseline</p>
      </div>

      <div class="asset-panels">
        {#each [
          { ticker:'BTC',  name:'Bitcoin',   icon:'₿', pct:null,          color:'#f7931a', sub: $btcPrice ? '$'+n($btcPrice) : '—' },
          { ticker:'XAU',  name:'Gold',      icon:'◈', pct:$goldYtdPct,   color:'#c9a84c', sub: $goldPriceUsd ? '$'+n($goldPriceUsd,0)+'/oz' : '—' },
          { ticker:'SPX',  name:'S&P 500',   icon:'↗', pct:$sp500YtdPct,  color:'#888888', sub: $sp500Price ? n($sp500Price,0) : '—' },
          { ticker:'CPI',  name:'Inflation', icon:'↓', pct:$cpiAnnual,    color:'#ef4444', sub: 'Annual rate' },
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
              {a.pct!==null?(a.pct>=0?'+':'')+a.pct.toFixed(1)+'%':'live'}
            </p>
            <p class="ap-sub">{a.sub}</p>
            <div class="ap-bar">
              {#if a.pct !== null}
                {@const w = Math.min(100, Math.max(2, (a.pct/150)*100+50))}
                <div class="ap-fill" style="width:{w}%; background:{a.pct>=0?'var(--up)':'var(--dn)'};"></div>
              {:else}
                <div class="ap-fill" style="width:70%; background:{a.color}; animation:apPulse 3s ease-in-out infinite;"></div>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      {#if $cpiAnnual !== null}
        <p class="cpi-note">Purchasing power eroded since DCA start: <span style="color:var(--dn);">−{cpiCumLoss.toFixed(1)}%</span></p>
      {/if}
    </div>
  </div>

  <!-- GHOSTFOLIO -->
  <div class="gf-col">
    <p class="sect-label">PORTFOLIO TRACKER</p>

    {#if !$settings.ghostfolio?.token}
      <div class="gc no-token">
        <p class="ch-t" style="margin-bottom:12px;">Connect Ghostfolio</p>
        <p class="dim" style="line-height:1.6;">Add your Ghostfolio security token in Settings to see your full portfolio performance, holdings, and benchmarks here.</p>
        <p class="dim" style="margin-top:10px;">Your token is stored locally in your browser and never sent to our servers.</p>
      </div>
    {:else}
      <div class="gc">
        <div class="card-head" style="margin-bottom:24px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <p class="ch-t">Portfolio</p>
            <span class="dim">via Ghostfolio</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            {#if $gfLoading}<span class="live-dot blink"></span>{/if}
            {#if $gfUpdated && !$gfLoading}<span class="dim">{$gfUpdated}</span>{/if}
            <button on:click={fetchGhostfolio} class="icon-btn">↻</button>
          </div>
        </div>

        {#if $gfError}
          <p class="err">{$gfError} — check token in Settings.</p>
        {:else}
          <!-- Net worth hero -->
          <div class="gf-hero">
            <div class="gf-nw-block">
              <p class="eyebrow">Net Worth</p>
              <p class="gf-nw">{$gfNetWorth !== null ? '$'+n($gfNetWorth,0) : '—'}</p>
              <p class="eyebrow">{$settings.ghostfolio.currency||'AUD'} · nominal</p>
            </div>
            {#if inflationAdjNW !== null}
            <div class="gf-nw-block" style="opacity:0.45;">
              <p class="eyebrow">Real Value</p>
              <p class="gf-nw">{inflationAdjNW !== null ? '$'+n(inflationAdjNW,0) : '—'}</p>
              <p class="eyebrow">CPI-adjusted</p>
            </div>
            {/if}
            <div class="gf-vline"></div>
            <div class="gf-perf-row">
              <div class="gf-p"><p class="eyebrow">Today</p><p class="gf-pv" style="color:{signColor($gfTodayChangePct)};">{pct($gfTodayChangePct)}</p></div>
              <div class="gf-p"><p class="eyebrow">YTD</p><p class="gf-pv" style="color:{signColor($gfNetGainYtdPct)};">{pct($gfNetGainYtdPct)}</p></div>
              <div class="gf-p"><p class="eyebrow">All-time</p><p class="gf-pv" style="color:{signColor($gfNetGainPct)};">{pct($gfNetGainPct)}</p></div>
              <div class="gf-p"><p class="eyebrow">Invested</p><p class="gf-pv">{$gfTotalInvested!==null?'$'+n($gfTotalInvested,0):'—'}</p></div>
            </div>
          </div>

          <!-- Benchmark strip -->
          {#if portCAGR!==null || $cpiAnnual!==null || $goldYtdPct!==null || $sp500YtdPct!==null}
          <div class="bench">
            {#if portCAGR!==null}
              <div class="bench-cell">
                <p class="eyebrow" style="color:var(--orange);">Portfolio CAGR</p>
                <p class="bench-v" style="color:{portCAGR>=0?'var(--up)':'var(--dn)'};">{portCAGR>=0?'+':''}{portCAGR.toFixed(1)}<span class="bench-u">%/yr</span></p>
                {#if $cpiAnnual!==null}<p class="bench-vs" style="color:{portCAGR>$cpiAnnual?'var(--up)':'var(--dn)'};">{portCAGR>$cpiAnnual?'▲':'▼'} {Math.abs(portCAGR-$cpiAnnual).toFixed(1)}% vs CPI</p>{/if}
              </div>
            {/if}
            {#if $cpiAnnual!==null}
              <div class="bench-cell">
                <p class="eyebrow" style="color:var(--dn);">CPI Inflation</p>
                <p class="bench-v" style="color:var(--dn);">+{$cpiAnnual.toFixed(1)}<span class="bench-u">%/yr</span></p>
              </div>
            {/if}
            {#if $goldYtdPct!==null}
              <div class="bench-cell">
                <p class="eyebrow" style="color:#c9a84c;">Gold 1Y</p>
                <p class="bench-v" style="color:{$goldYtdPct>=0?'#c9a84c':'var(--dn)'};">{$goldYtdPct>=0?'+':''}{$goldYtdPct.toFixed(1)}<span class="bench-u">%</span></p>
              </div>
            {/if}
            {#if $sp500YtdPct!==null}
              <div class="bench-cell">
                <p class="eyebrow">S&P 500 1Y</p>
                <p class="bench-v" style="color:{$sp500YtdPct>=0?'rgba(255,255,255,.85)':'var(--dn)'};">{$sp500YtdPct>=0?'+':''}{$sp500YtdPct.toFixed(1)}<span class="bench-u">%</span></p>
              </div>
            {/if}
          </div>
          {/if}

          <!-- Holdings -->
          {#if $gfHoldings.length > 0}
          <div class="holdings">
            <button class="hold-btn" on:click={() => showHoldings=!showHoldings}>
              <span>Holdings ({$gfHoldings.length})</span>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor"
                style="transform:{showHoldings?'rotate(180deg)':'rotate(0)'}; transition:transform .25s; margin-left:6px; opacity:.35;">
                <path d="M5 7L1 3h8z"/>
              </svg>
            </button>
            {#if showHoldings}
            <div class="hgrid">
              {#each $gfHoldings as h}
                {@const pc = h.netPerformancePercentWithCurrencyEffect}
                <div class="h-card">
                  <div class="h-top"><span class="h-sym">{h.symbol}</span><span class="h-pct" style="color:{pc>=0?'var(--up)':'var(--dn)'};">{pc>=0?'+':''}{pc.toFixed(1)}%</span></div>
                  {#if h.name!==h.symbol}<p class="h-name">{h.name.slice(0,22)}</p>{/if}
                  <div class="h-bar"><div class="h-fill" style="width:{Math.min(100,h.allocationInPercentage)}%;"></div></div>
                  <div class="h-foot"><span>{h.allocationInPercentage.toFixed(1)}%</span><span>${n(h.valueInBaseCurrency,0)}</span></div>
                </div>
              {/each}
            </div>
            {/if}
          </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

</div>

<style>
  .hero { padding:60px 24px 48px; text-align:center; position:relative; overflow:hidden; }
  .hero::before { content:''; position:absolute; top:50%; left:50%; width:60%; height:60%; background:radial-gradient(circle,rgba(247,147,26,0.04) 0%,transparent 70%); transform:translate(-50%,-50%); animation:hp 12s ease-in-out infinite; z-index:-1; }
  @keyframes hp { 0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.6} 50%{transform:translate(-50%,-50%) scale(1.4);opacity:1} }
  .hero-inner { max-width:640px; margin:0 auto; }
  .hero-eyebrow { font-size:.7rem; font-weight:500; color:var(--orange); text-transform:uppercase; letter-spacing:.3em; margin-bottom:18px; }
  .hero-title { font-size:clamp(1.8rem,5vw,3.8rem); font-weight:800; letter-spacing:-.025em; margin-bottom:16px; background:linear-gradient(135deg,#f7931a 0%,#ffd080 40%,#f7931a 70%,#e06000 100%); background-size:300% 300%; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; animation:tf 8s ease infinite; }
  @keyframes tf { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
  .hero-desc { font-size:.95rem; color:rgba(255,255,255,.4); line-height:1.7; font-weight:300; }

  .pg { display:grid; grid-template-columns:1fr 1.8fr; gap:14px; padding:0 14px 40px; max-width:1440px; margin:0 auto; align-items:start; }
  .asset-col, .gf-col { display:flex; flex-direction:column; gap:14px; }
  @media (max-width:1000px) { .pg { grid-template-columns:1fr; } }
  @media (max-width:600px) { .pg { padding:0 8px 40px; gap:8px; } }

  .sect-label { font-size:.64rem; font-weight:700; text-transform:uppercase; letter-spacing:.22em; background:linear-gradient(90deg,var(--orange),rgba(247,147,26,.5)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:4px; padding-left:2px; }
  .gc { background:rgba(255,255,255,.04); backdrop-filter:blur(28px) saturate(160%); -webkit-backdrop-filter:blur(28px) saturate(160%); border:1px solid rgba(255,255,255,.08); border-radius:22px; padding:28px; box-shadow:0 8px 40px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06); transition:transform .4s cubic-bezier(.4,0,.2,1),border-color .3s; }
  .gc:hover { transform:translateY(-4px); border-color:rgba(247,147,26,.15); }
  .eyebrow { font-size:.59rem; font-weight:500; text-transform:uppercase; letter-spacing:.12em; color:rgba(255,255,255,.22); }
  .dim { font-size:.62rem; color:rgba(255,255,255,.25); }
  .card-head { display:flex; justify-content:space-between; align-items:flex-start; }
  .ch-t { font-size:.84rem; font-weight:600; color:#f0f0f0; }
  .err { font-size:.74rem; color:var(--dn); padding:10px 14px; border:1px solid rgba(239,68,68,.2); border-radius:10px; background:rgba(239,68,68,.05); }

  /* ASSET PANELS */
  .asset-panels { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px; }
  .ap { background:linear-gradient(135deg,rgba(255,255,255,.04),rgba(255,255,255,.02)); border:1px solid rgba(255,255,255,.07); border-radius:14px; padding:18px 16px; position:relative; overflow:hidden; transition:transform .35s cubic-bezier(.4,0,.2,1),border-color .3s,box-shadow .35s; }
  .ap::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,var(--pc,rgba(247,147,26,.3)),transparent); opacity:.6; }
  .ap:hover { transform:translateY(-6px) perspective(600px) rotateX(2deg); border-color:rgba(255,255,255,.12); box-shadow:0 18px 40px rgba(0,0,0,.4); }
  .ap-top { display:flex; align-items:center; gap:10px; margin-bottom:14px; }
  .ap-icon { font-size:1.3rem; line-height:1; }
  .ap-ticker { font-size:.85rem; font-weight:700; }
  .ap-name { font-size:.58rem; color:rgba(255,255,255,.3); margin-top:1px; }
  .ap-pct { font-size:2rem; font-weight:800; letter-spacing:-.04em; line-height:1; margin-bottom:4px; }
  .ap-sub { font-size:.6rem; color:rgba(255,255,255,.25); margin-bottom:12px; }
  .ap-bar { height:2px; background:rgba(255,255,255,.06); border-radius:1px; overflow:hidden; }
  .ap-fill { height:100%; border-radius:1px; transition:width .8s cubic-bezier(.4,0,.2,1); }
  @keyframes apPulse { 0%,100%{opacity:.5} 50%{opacity:1} }
  .cpi-note { font-size:.63rem; color:rgba(255,255,255,.25); border-top:1px solid rgba(255,255,255,.05); padding-top:14px; line-height:1.6; }

  /* GHOSTFOLIO */
  .no-token { opacity:.7; }
  .live-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--orange); box-shadow:0 0 10px var(--orange); }
  .icon-btn { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); border-radius:8px; color:rgba(255,255,255,.3); font-size:.85rem; padding:5px 11px; cursor:pointer; transition:all .2s; }
  .icon-btn:hover { border-color:rgba(247,147,26,.25); color:var(--orange); }
  .gf-hero { display:flex; align-items:flex-end; gap:24px; flex-wrap:wrap; margin-bottom:22px; }
  .gf-nw-block { display:flex; flex-direction:column; gap:7px; }
  .gf-nw { font-size:2.6rem; font-weight:700; letter-spacing:-.045em; line-height:1; color:#f0f0f0; }
  .gf-vline { width:1px; height:52px; background:rgba(255,255,255,.06); align-self:center; flex-shrink:0; }
  .gf-perf-row { display:flex; align-items:flex-end; gap:22px; flex-wrap:wrap; flex:1; }
  .gf-p { display:flex; flex-direction:column; gap:7px; }
  .gf-pv { font-size:1.25rem; font-weight:700; letter-spacing:-.025em; line-height:1; }
  .bench { display:flex; border:1px solid rgba(255,255,255,.07); border-radius:14px; overflow:hidden; margin-bottom:22px; background:rgba(255,255,255,.02); flex-wrap:wrap; }
  .bench-cell { flex:1; padding:15px 16px; border-right:1px solid rgba(255,255,255,.06); display:flex; flex-direction:column; gap:5px; min-width:80px; }
  .bench-cell:last-child { border-right:none; }
  .bench-v { font-size:1.2rem; font-weight:700; letter-spacing:-.025em; line-height:1; }
  .bench-u { font-size:.56em; opacity:.5; font-weight:400; }
  .bench-vs { font-size:.6rem; }
  .holdings { border-top:1px solid rgba(255,255,255,.05); padding-top:18px; }
  .hold-btn { background:none; border:none; color:rgba(255,255,255,.3); font-size:.7rem; font-family:'Inter',sans-serif; cursor:pointer; display:flex; align-items:center; padding:0; margin-bottom:16px; transition:color .2s; }
  .hold-btn:hover { color:rgba(255,255,255,.55); }
  .hgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(155px,1fr)); gap:9px; }
  .h-card { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); border-radius:12px; padding:14px; transition:transform .3s,border-color .3s; }
  .h-card:hover { transform:translateY(-4px) perspective(600px) rotateX(2deg); border-color:rgba(247,147,26,.15); }
  .h-top { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px; }
  .h-sym { font-size:.92rem; font-weight:700; color:#f0f0f0; }
  .h-pct { font-size:.7rem; font-weight:600; }
  .h-name { font-size:.6rem; color:rgba(255,255,255,.25); margin-bottom:8px; }
  .h-bar { height:2px; background:rgba(255,255,255,.06); border-radius:1px; overflow:hidden; margin-bottom:8px; }
  .h-fill { height:100%; background:linear-gradient(90deg,rgba(247,147,26,.5),var(--orange)); border-radius:1px; transition:width .7s; }
  .h-foot { display:flex; justify-content:space-between; font-size:.62rem; color:rgba(255,255,255,.25); }
  @media (max-width:800px) { .gf-vline{display:none;} .bench-cell{min-width:calc(50% - 1px);} .gf-nw{font-size:2rem;} }
  @media (max-width:600px) { .hgrid{grid-template-columns:1fr 1fr;} .asset-panels{grid-template-columns:1fr 1fr;} }
</style>
