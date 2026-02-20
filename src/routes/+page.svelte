<script lang="ts">
  import {
    settings, btcPrice, priceFlash, btcBlock, btcFees,
    halvingBlocksLeft, halvingDays, halvingDate, halvingProgress,
    dcaUpdated, dca, accentColor, priceColor, btcAud, satsPerAud,
    goldPriceUsd, goldYtdPct, sp500Price, sp500YtdPct, cpiAnnual,
    gfNetWorth, gfTotalInvested, gfNetGainPct, gfNetGainYtdPct,
    gfTodayChangePct, gfHoldings, gfError, gfLoading, gfUpdated,
    markets, newsItems
  } from '$lib/store';

  let showHoldings = false;

  const n   = (v:number, dec=0) => v.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
  const pct = (v:number|null)   => v===null?'—':(v>=0?'+':'')+v.toFixed(2)+'%';
  const sc  = (v:number|null)   => v===null?'#555':v>=0?'var(--up)':'var(--dn)';
  const fmtVol  = (v:number) => v>=1e6?`$${(v/1e6).toFixed(1)}m`:v>=1e3?`$${(v/1e3).toFixed(0)}k`:`$${v}`;
  const fmtDate = (d:string) => {try{return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'});}catch{return '';}};
  const pc  = (p:number) => p>=70?'#22c55e':p>=40?'var(--orange)':'var(--dn)';
  const ago = (d:string) => {try{const m=Math.floor((Date.now()-new Date(d).getTime())/60000);return m<60?`${m}m`:m<1440?`${Math.floor(m/60)}h`:`${Math.floor(m/1440)}d`;}catch{return '';}};

  $: s        = $settings.dca;
  $: dcaDays  = Math.max(0,Math.floor((Date.now()-new Date(s.startDate).getTime())/86400000));
  $: invested = dcaDays*s.dailyAmount;
  $: currentVal = s.btcHeld*$btcPrice;
  $: perf     = invested>0?((currentVal-invested)/invested)*100:0;
  $: goalPct  = s.goalBtc>0?Math.min(100,(s.btcHeld/s.goalBtc)*100):0;
  $: satsHeld = Math.round(s.btcHeld*1e8);
  $: satsLeft = Math.max(0,Math.round((s.goalBtc-s.btcHeld)*1e8));

  $: inflAdj = (()=>{if($gfNetWorth===null||$cpiAnnual===null)return null;const y=dcaDays/365.25;return $gfNetWorth/Math.pow(1+$cpiAnnual/100,y);})();
  $: cpiLoss = (()=>{if($cpiAnnual===null)return 0;const y=Math.max(.1,dcaDays/365.25);return(1-1/Math.pow(1+$cpiAnnual/100,y))*100;})();
  $: portCAGR= (()=>{if($gfNetGainPct===null)return null;const y=Math.max(.1,dcaDays/365.25);return(Math.pow(1+$gfNetGainPct/100,1/y)-1)*100;})();

  async function refreshGF() {
    const token=$settings.ghostfolio?.token?.trim();if(!token)return;
    $gfLoading=true;$gfError='';
    try{const d=await fetch(`/api/ghostfolio?token=${encodeURIComponent(token)}`).then(r=>r.json());if(d.error){$gfError=d.error;}else{$gfNetWorth=d.netWorth;$gfTotalInvested=d.totalInvested;$gfNetGainPct=d.netGainPct;$gfNetGainYtdPct=d.netGainYtdPct;$gfTodayChangePct=d.todayChangePct;$gfHoldings=d.holdings??[];$gfUpdated=new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});}}
    catch{$gfError='Connection failed';}finally{$gfLoading=false;}
  }
</script>

<!-- ══════════════════════════════════════════════════════════
  ① SIGNAL SECTION
═══════════════════════════════════════════════════════════ -->
<section id="signal" class="section">
  <div class="section-header">
    <h2 class="sect-title">Signal Analysis</h2>
    <span class="live-badge"><span class="blink" style="color:var(--orange);">●</span> Live</span>
  </div>

  <!-- KEY METRICS STRIP -->
  <div class="stat-strip">
    <div class="stat-tile">
      <span class="stat-n" style="color:{$priceColor};transition:color .5s;">{$btcPrice>0?'$'+n($btcPrice):'—'}</span>
      <span class="stat-l">BTC / USD</span>
    </div>
    <div class="stat-tile">
      <span class="stat-n" style="color:var(--orange);">{$satsPerAud?$satsPerAud.toLocaleString():'—'}</span>
      <span class="stat-l">Sats per A$1</span>
    </div>
    <div class="stat-tile">
      {#if $dca&&$dca.finalAud>0}
        <span class="stat-n" style="color:{$accentColor};">${$dca.finalAud.toLocaleString()}</span>
        <span class="stat-l">DCA Signal (AUD)</span>
      {:else if $dca&&$dca.finalAud===0}
        <span class="stat-n" style="color:var(--dn);">PASS</span>
        <span class="stat-l">DCA Signal</span>
      {:else}
        <span class="stat-n" style="color:rgba(255,255,255,.15);">—</span>
        <span class="stat-l">DCA Signal</span>
      {/if}
    </div>
    <div class="stat-tile">
      <span class="stat-n">{$halvingDays>0?$halvingDays.toLocaleString():'—'}</span>
      <span class="stat-l">Days to Halving</span>
    </div>
    <div class="stat-tile">
      <span class="stat-n" style="color:rgba(255,255,255,.7);">{$btcAud?'A$'+n($btcAud,0):'—'}</span>
      <span class="stat-l">BTC / AUD</span>
    </div>
  </div>

  <!-- SIGNAL + NETWORK + STACK GRID -->
  <div class="signal-grid">

    <!-- DCA SIGNAL CARD -->
    <div class="gc signal-card" style="--ac:{$accentColor};">
      <div class="signal-bar" style="background:linear-gradient(90deg,{$accentColor}33,{$accentColor},{$accentColor}33);"></div>
      <div class="gc-head">
        <div>
          <p class="eyebrow orange">DCA Signal</p>
          <p class="dim" style="margin-top:3px;">Fortnightly buy recommendation</p>
        </div>
        <span class="ts">{$dcaUpdated||'—'}</span>
      </div>

      <div class="dca-hero">
        {#if !$dca}
          <span class="dca-n muted">—</span>
        {:else if $dca.finalAud===0}
          <span class="dca-n" style="color:var(--dn);text-shadow:0 0 60px rgba(239,68,68,.3);">PASS</span>
        {:else}
          <span class="dca-n" style="color:{$accentColor};text-shadow:0 0 70px {$accentColor}30;">${$dca.finalAud.toLocaleString()}</span>
        {/if}
        <p class="dca-sub">AUD · fortnightly</p>
      </div>

      <!-- Valuation band -->
      {#if $btcPrice>0}
      <div class="vband">
        <div class="vband-row">
          <span class="vband-l up">$55k CHEAP</span>
          <span class="dim" style="font-size:.56rem;">Valuation Band</span>
          <span class="vband-l dn">EXPENSIVE $125k</span>
        </div>
        <div class="vband-track">
          {#if $btcPrice<=55000}
            <div class="vband-fill" style="width:2%;background:var(--up);"></div>
          {:else if $btcPrice>=125000}
            <div class="vband-fill" style="width:100%;background:var(--dn);"></div>
          {:else}
            <div class="vband-fill" style="width:{(($btcPrice-55000)/70000)*100}%;background:linear-gradient(90deg,var(--up),var(--orange),var(--dn));"></div>
          {/if}
        </div>
      </div>
      {/if}

      <!-- Signal conditions -->
      {#if $dca}
      <div class="sigs">
        {#each $dca.signals as sig}
          <div class="sig" class:sig--on={sig.active}>
            <div class="pip-wrap">
              <div class="pip" class:pip--on={sig.active}></div>
              {#if sig.active}<div class="pip-ring"></div>{/if}
            </div>
            <span class="sig-label">{sig.name}</span>
            {#if sig.active}<span class="sig-badge">+{sig.boost}%</span>{/if}
          </div>
        {/each}
      </div>
      {/if}
    </div>

    <!-- BITCOIN NETWORK -->
    <div class="gc">
      <div class="gc-head">
        <p class="gc-title">Bitcoin Network</p>
        <a href="https://mempool.space" target="_blank" rel="noopener noreferrer" class="btn-ghost">mempool ↗</a>
      </div>
      <div class="met3">
        <div class="met"><p class="eyebrow">Block Height</p><p class="met-n">{n($btcBlock)||'—'}</p></div>
        <div class="met"><p class="eyebrow">Fee · Low</p><p class="met-n up">{$btcFees.low||'—'}<span class="met-u">sat/vb</span></p></div>
        <div class="met"><p class="eyebrow">Fee · High</p><p class="met-n dn">{$btcFees.high||'—'}<span class="met-u">sat/vb</span></p></div>
      </div>
      {#if $halvingBlocksLeft>0}
      <div class="halving">
        <div class="halving-row">
          <div><p class="eyebrow">Next Halving</p><p class="halving-days">{$halvingDays.toLocaleString()}<span class="halving-u"> days</span></p></div>
          <div style="text-align:right;"><p class="eyebrow">{$halvingProgress.toFixed(1)}% complete</p><p class="dim" style="margin-top:2px;">{$halvingBlocksLeft.toLocaleString()} blocks</p></div>
        </div>
        <div class="pbar"><div class="pfill" style="width:{$halvingProgress}%;background:linear-gradient(90deg,rgba(247,147,26,.5),var(--orange));"></div></div>
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
        <span style="color:rgba(255,255,255,.3);margin:0 6px;">BTC</span>
        <span style="color:rgba(255,255,255,.22);font-size:.72rem;">{n(satsHeld)} sats</span>
      </div>
      <div><div class="goal-head"><p class="eyebrow">Goal · {s.goalBtc} BTC</p><p class="eyebrow orange">{goalPct.toFixed(1)}%</p></div>
        <div class="pbar"><div class="pfill" style="width:{goalPct}%;background:linear-gradient(90deg,rgba(247,147,26,.6),var(--orange));"></div></div>
        <p class="dim" style="text-align:right;margin-top:4px;">{n(satsLeft)} sats remaining</p>
      </div>
    </div>

  </div><!-- /signal-grid -->
</section>

<div class="section-divider"></div>

<!-- ══════════════════════════════════════════════════════════
  ② PORTFOLIO SECTION
═══════════════════════════════════════════════════════════ -->
<section id="portfolio" class="section">
  <div class="section-header">
    <h2 class="sect-title">Portfolio</h2>
    <span class="dim">Assets &amp; Performance</span>
  </div>

  <div class="port-grid">

    <!-- ASSET COMPARISON -->
    <div class="gc">
      <div class="gc-head"><p class="gc-title">Asset Comparison</p><p class="dim">1-Year Performance</p></div>
      <div class="asset-panels">
        {#each [
          {ticker:'BTC', name:'Bitcoin',  icon:'₿', pct:null,        color:'#f7931a', sub:$btcPrice?'$'+n($btcPrice):'—'},
          {ticker:'XAU', name:'Gold',     icon:'◈', pct:$goldYtdPct, color:'#c9a84c', sub:$goldPriceUsd?'$'+n($goldPriceUsd,0)+'/oz':'—'},
          {ticker:'SPX', name:'S&P 500',  icon:'↗', pct:$sp500YtdPct,color:'#888',    sub:$sp500Price?n($sp500Price,0):'—'},
          {ticker:'CPI', name:'Inflation',icon:'↓', pct:$cpiAnnual,  color:'#ef4444', sub:'Annual rate'},
        ] as a}
          <div class="ap" style="--pc:{a.color};">
            <div class="ap-top"><span class="ap-icon" style="color:{a.color};">{a.icon}</span><div><p class="ap-ticker" style="color:{a.color};">{a.ticker}</p><p class="ap-name">{a.name}</p></div></div>
            <p class="ap-pct" style="color:{a.pct===null?a.color:a.pct>=0?'var(--up)':'var(--dn)'};">
              {a.pct!==null?(a.pct>=0?'+':'')+a.pct.toFixed(1)+'%':'live'}
            </p>
            <p class="ap-sub">{a.sub}</p>
            <div class="pbar" style="margin-top:8px;">{#if a.pct!==null}<div class="pfill" style="width:{Math.min(100,Math.max(2,(a.pct/150)*100+50))}%;background:{a.pct>=0?'var(--up)':'var(--dn)'};opacity:.55;"></div>{:else}<div class="pfill" style="width:70%;background:{a.color};animation:apPulse 3s ease-in-out infinite;"></div>{/if}</div>
          </div>
        {/each}
      </div>
      {#if $cpiAnnual!==null}<p class="dim" style="margin-top:14px;line-height:1.6;">Purchasing power erosion since DCA start: <span style="color:var(--dn);">−{cpiLoss.toFixed(1)}%</span></p>{/if}
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
            {#if $gfLoading}<span class="live-dot blink"></span>{/if}
            {#if $gfUpdated&&!$gfLoading}<span class="dim">{$gfUpdated}</span>{/if}
            <button on:click={refreshGF} class="btn-ghost">↻ Refresh</button>
          </div>
        </div>
        {#if $gfError}
          <p class="err-msg">{$gfError} — check token in Settings.</p>
        {:else}
          <!-- Net worth hero row -->
          <div class="gf-hero">
            <div><p class="eyebrow">Net Worth</p><p class="gf-nw">{$gfNetWorth!==null?'$'+n($gfNetWorth,0):'—'}</p><p class="eyebrow" style="margin-top:4px;">{$settings.ghostfolio.currency||'AUD'}</p></div>
            {#if inflAdj!==null}<div style="opacity:.4;"><p class="eyebrow">Real Value</p><p class="gf-nw">{inflAdj!==null?'$'+n(inflAdj,0):'—'}</p><p class="eyebrow" style="margin-top:4px;">CPI-adjusted</p></div>{/if}
            <div class="gf-perf">
              <div class="gfp"><p class="eyebrow">Today</p><p class="gfp-v" style="color:{sc($gfTodayChangePct)};">{pct($gfTodayChangePct)}</p></div>
              <div class="gfp"><p class="eyebrow">YTD</p><p class="gfp-v" style="color:{sc($gfNetGainYtdPct)};">{pct($gfNetGainYtdPct)}</p></div>
              <div class="gfp"><p class="eyebrow">All-time</p><p class="gfp-v" style="color:{sc($gfNetGainPct)};">{pct($gfNetGainPct)}</p></div>
              <div class="gfp"><p class="eyebrow">Invested</p><p class="gfp-v">{$gfTotalInvested!==null?'$'+n($gfTotalInvested,0):'—'}</p></div>
            </div>
          </div>
          <!-- Benchmarks -->
          {#if portCAGR!==null||$cpiAnnual!==null||$goldYtdPct!==null}
          <div class="bench">
            {#if portCAGR!==null}<div class="bench-c"><p class="eyebrow orange">Portfolio CAGR</p><p class="bench-v" style="color:{portCAGR>=0?'var(--up)':'var(--dn)'};">{portCAGR>=0?'+':''}{portCAGR.toFixed(1)}<span style="font-size:.55em;opacity:.5;">%/yr</span></p>{#if $cpiAnnual!==null}<p class="bench-vs" style="color:{portCAGR>$cpiAnnual?'var(--up)':'var(--dn)'};">{portCAGR>$cpiAnnual?'▲':'▼'} {Math.abs(portCAGR-$cpiAnnual).toFixed(1)}% vs CPI</p>{/if}</div>{/if}
            {#if $cpiAnnual!==null}<div class="bench-c"><p class="eyebrow dn">Inflation</p><p class="bench-v dn">+{$cpiAnnual.toFixed(1)}<span style="font-size:.55em;opacity:.5;">%/yr</span></p></div>{/if}
            {#if $goldYtdPct!==null}<div class="bench-c"><p class="eyebrow" style="color:#c9a84c;">Gold 1Y</p><p class="bench-v" style="color:{$goldYtdPct>=0?'#c9a84c':'var(--dn)'};">{$goldYtdPct>=0?'+':''}{$goldYtdPct.toFixed(1)}<span style="font-size:.55em;opacity:.5;">%</span></p></div>{/if}
            {#if $sp500YtdPct!==null}<div class="bench-c"><p class="eyebrow">S&P 500</p><p class="bench-v" style="color:{$sp500YtdPct>=0?'rgba(255,255,255,.8)':'var(--dn)'};">{$sp500YtdPct>=0?'+':''}{$sp500YtdPct.toFixed(1)}<span style="font-size:.55em;opacity:.5;">%</span></p></div>{/if}
          </div>
          {/if}
          <!-- Holdings toggle -->
          {#if $gfHoldings.length>0}
          <div class="holdings-wrap">
            <button class="btn-secondary" on:click={()=>showHoldings=!showHoldings} style="font-size:.62rem;padding:7px 16px;">
              {showHoldings?'▲':'▼'} Holdings ({$gfHoldings.length})
            </button>
            {#if showHoldings}
            <div class="hgrid">
              {#each $gfHoldings as h}
                {@const hp=h.netPerformancePercentWithCurrencyEffect}
                <div class="h-card">
                  <div class="h-top"><span class="h-sym">{h.symbol}</span><span class="h-pct" style="color:{hp>=0?'var(--up)':'var(--dn)'};">{hp>=0?'+':''}{hp.toFixed(1)}%</span></div>
                  {#if h.name!==h.symbol}<p class="h-name">{h.name.slice(0,22)}</p>{/if}
                  <div class="pbar" style="margin:8px 0 6px;"><div class="pfill" style="width:{Math.min(100,h.allocationInPercentage)}%;background:linear-gradient(90deg,rgba(247,147,26,.55),var(--orange));"></div></div>
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

  </div><!-- /port-grid -->
</section>

<div class="section-divider"></div>

<!-- ══════════════════════════════════════════════════════════
  ③ INTEL SECTION
═══════════════════════════════════════════════════════════ -->
<section id="intel" class="section">
  <div class="section-header">
    <h2 class="sect-title">Intel</h2>
    <span class="dim">Markets &amp; News</span>
  </div>

  <div class="intel-grid">

    <!-- POLYMARKET -->
    <div class="gc">
      <div class="gc-head" style="margin-bottom:18px;">
        <div><p class="gc-title">Prediction Markets</p><p class="dim" style="margin-top:2px;">Crowd-sourced probability</p></div>
        <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" class="btn-ghost">Polymarket ↗</a>
      </div>
      {#if $markets.length===0}
        <p class="dim">Fetching live markets…</p>
      {:else}
        {#each $markets.slice(0,8) as m}
          <div class="mkt">
            <div class="mkt-meta"><span class="mkt-tag" class:mkt-pin={m.pinned}>{m.pinned?'★ Pinned':m.tag}</span>{#if m.endDate}<span class="dim">{fmtDate(m.endDate)}</span>{/if}</div>
            <div class="mkt-body">
              <a href="{m.url}" target="_blank" rel="noopener noreferrer" class="mkt-q">{m.question}</a>
              <div class="mkt-prob-wrap"><span class="mkt-prob" style="color:{pc(m.probability)};">{m.probability}</span><span style="font-size:.75rem;opacity:.45;">%</span></div>
            </div>
            <div class="pbar" style="margin:6px 0 4px;"><div class="pfill" style="width:{m.probability}%;background:{pc(m.probability)};opacity:.45;transition:width .7s;"></div></div>
            <div class="mkt-foot"><span style="font-size:.62rem;color:{pc(m.probability)};font-weight:500;">{m.topOutcome}</span><span class="dim">{fmtVol(m.volume)}</span></div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- NEWS -->
    <div class="gc">
      <div class="gc-head" style="margin-bottom:18px;"><p class="gc-title">News Feed</p></div>
      {#if $newsItems.length===0}
        <p class="dim">Fetching RSS feeds…</p>
      {:else}
        {#each $newsItems as item}
          <div class="news">
            <a href={item.link} target="_blank" rel="noopener noreferrer" class="news-title">{item.title}</a>
            <div class="news-meta"><span class="news-src">{item.source}</span><span class="dim">{ago(item.pubDate)} ago</span></div>
          </div>
        {/each}
      {/if}
    </div>

  </div><!-- /intel-grid -->
</section>

<style>
  /* ── LAYOUT ──────────────────────────────────────────────── */
  .section {
    max-width: 1440px; margin: 0 auto;
    padding: 48px 24px 0;
  }
  .section-header {
    display: flex; align-items: baseline; gap: 16px; margin-bottom: 28px;
  }
  .live-badge { font-size:.65rem; color:rgba(255,255,255,.35); display:flex; align-items:center; gap:5px; }
  .live-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--orange); box-shadow:0 0 10px var(--orange); }

  /* Electric Xtra-inspired section divider */
  .section-divider {
    max-width:1440px; margin:48px auto 0;
    height:1px;
    background:linear-gradient(90deg,transparent,rgba(247,147,26,.5),rgba(0,200,255,.25),transparent);
    position:relative;
  }
  .section-divider::after {
    content:''; position:absolute; top:-1px; left:50%; transform:translateX(-50%);
    width:60px; height:3px;
    background:linear-gradient(90deg,#f7931a,#00c8ff);
    box-shadow:0 0 12px rgba(247,147,26,.6);
  }

  /* ── STAT STRIP ─────────────────────────────────────────── */
  .stat-strip {
    display: grid; grid-template-columns: repeat(5,1fr); gap: 12px;
    margin-bottom: 20px;
  }
  .stat-tile {
    padding: 16px 12px 14px; text-align: center;
    background: rgba(255,255,255,.055);
    border: 1px solid rgba(247,147,26,.14);
    border-radius: 6px;
    backdrop-filter: blur(16px);
    transition: transform .25s, border-color .25s, box-shadow .25s;
    /* Electric Xtra active border effect */
    position: relative; overflow: hidden;
  }
  .stat-tile::before {
    content:''; position:absolute; bottom:0; left:0;
    width:0; height:2px;
    background:linear-gradient(90deg,#f7931a,#00c8ff);
    box-shadow:0 0 10px rgba(247,147,26,.7);
    transition:width .3s ease;
  }
  .stat-tile:hover { transform:translateY(-4px); border-color:rgba(247,147,26,.28); box-shadow:0 10px 28px rgba(247,147,26,.1); }
  .stat-tile:hover::before { width:100%; }
  .stat-n { display:block; font-size:1.45rem; font-weight:700; letter-spacing:-.025em; margin-bottom:6px; line-height:1.1; color:#eaeaea; }
  .stat-l { font-size:.57rem; color:rgba(255,255,255,.28); text-transform:uppercase; letter-spacing:.1em; }
  @media (max-width:800px) { .stat-strip{ grid-template-columns:repeat(3,1fr); } }
  @media (max-width:500px) { .stat-strip{ grid-template-columns:repeat(2,1fr); } }

  /* ── SIGNAL GRID ────────────────────────────────────────── */
  .signal-grid { display:grid; grid-template-columns:1.1fr 1fr 1fr; gap:14px; }
  @media (max-width:1100px) { .signal-grid{grid-template-columns:1fr 1fr;} }
  @media (max-width:700px)  { .signal-grid{grid-template-columns:1fr;} }

  /* ── GLASS CARD ─────────────────────────────────────────── */
  .gc {
    background: rgba(255,255,255,.055);
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    border: 1px solid rgba(255,255,255,.10);
    border-radius: 6px; padding: 24px;
    box-shadow: 0 6px 28px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.06);
    transition: border-color .3s, box-shadow .3s;
    position: relative; overflow: hidden;
  }
  .gc::before {
    content:''; position:absolute; top:0; left:0; right:0; height:1px;
    background:linear-gradient(90deg,transparent,rgba(247,147,26,.25),transparent);
  }
  .gc:hover { border-color:rgba(247,147,26,.2); box-shadow:0 10px 38px rgba(0,0,0,.48),0 0 0 1px rgba(247,147,26,.06),inset 0 1px 0 rgba(255,255,255,.08); }

  .gc-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; }
  .gc-title { font-family:'Orbitron',monospace; font-size:.72rem; font-weight:700; color:rgba(234,234,234,.9); text-transform:uppercase; letter-spacing:.08em; }

  /* ── ATOMS ──────────────────────────────────────────────── */
  .eyebrow { font-size:.57rem; font-weight:500; text-transform:uppercase; letter-spacing:.12em; color:rgba(255,255,255,.22); }
  .eyebrow.orange { color:var(--orange); }
  .eyebrow.dn { color:var(--dn); }
  .dim { font-size:.62rem; color:rgba(255,255,255,.28); }
  .ts  { font-size:.57rem; color:rgba(255,255,255,.2); font-variant-numeric:tabular-nums; }
  .up  { color:var(--up)!important; }
  .dn  { color:var(--dn)!important; }
  .muted { color:rgba(255,255,255,.08); }
  .err-msg { font-size:.72rem; color:var(--dn); padding:10px 14px; border:1px solid rgba(239,68,68,.2); border-radius:4px; background:rgba(239,68,68,.05); }

  /* Progress bar (global reuse) */
  .pbar  { height:2px; background:rgba(255,255,255,.06); border-radius:1px; overflow:hidden; }
  .pfill { height:100%; border-radius:1px; transition:width .7s cubic-bezier(.4,0,.2,1); }

  /* ── SIGNAL CARD ────────────────────────────────────────── */
  .signal-card { background:linear-gradient(180deg,rgba(247,147,26,.08) 0%,rgba(255,255,255,.055) 80px); }
  .signal-bar  { position:absolute; top:0; left:0; right:0; height:2px; border-radius:6px 6px 0 0; }
  .dca-hero    { text-align:center; padding:22px 0 20px; }
  .dca-n       { display:block; font-size:clamp(3.2rem,7vw,5.5rem); font-weight:800; line-height:1; letter-spacing:-.045em; transition:color .5s,text-shadow .5s; }
  .dca-sub     { font-size:.57rem; color:rgba(255,255,255,.2); text-transform:uppercase; letter-spacing:.15em; margin-top:10px; }
  .vband       { margin-bottom:18px; }
  .vband-row   { display:flex; justify-content:space-between; align-items:center; margin-bottom:7px; }
  .vband-l     { font-size:.56rem; font-weight:600; }
  .vband-l.up  { color:var(--up); } .vband-l.dn { color:var(--dn); }
  .vband-track { height:3px; background:rgba(255,255,255,.06); border-radius:2px; overflow:hidden; }
  .vband-fill  { height:100%; border-radius:2px; transition:width .8s cubic-bezier(.4,0,.2,1); }

  /* Signals */
  .sigs  { display:flex; flex-direction:column; gap:9px; padding:14px 0 0; border-top:1px solid rgba(255,255,255,.05); }
  .sig   { display:flex; align-items:center; gap:11px; transition:opacity .2s; }
  .sig:not(.sig--on) { opacity:.25; }
  .pip-wrap  { position:relative; width:14px; height:14px; flex-shrink:0; }
  .pip       { width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.15); transition:all .25s; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); }
  .pip--on   { background:var(--orange); border-color:var(--orange); box-shadow:0 0 10px rgba(247,147,26,.6); }
  .pip-ring  { position:absolute; inset:0; border-radius:50%; background:rgba(247,147,26,.14); animation:rp 2s ease-out infinite; }
  @keyframes rp { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(2.6);opacity:0} }
  .sig-label { font-size:.70rem; color:rgba(234,234,234,.8); flex:1; line-height:1.3; }
  .sig-badge { font-size:.59rem; color:var(--orange); font-weight:600; background:rgba(247,147,26,.1); border:1px solid rgba(247,147,26,.22); padding:2px 8px; border-radius:3px; white-space:nowrap; }

  /* Network + Stack shared */
  .met3  { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:14px; }
  .met   { display:flex; flex-direction:column; gap:7px; }
  .met-n { font-size:1.45rem; font-weight:700; letter-spacing:-.03em; line-height:1; color:#eaeaea; }
  .met-u { font-size:.45em; color:rgba(255,255,255,.3); font-weight:400; margin-left:2px; }
  .halving { border-top:1px solid rgba(255,255,255,.06); margin-top:18px; padding-top:16px; }
  .halving-row { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; }
  .halving-days { font-size:1.5rem; font-weight:700; letter-spacing:-.03em; color:var(--orange); line-height:1; }
  .halving-u { font-size:.55em; color:rgba(247,147,26,.7); font-weight:400; }
  .btc-pill  { display:flex; align-items:baseline; padding:11px 14px; background:rgba(247,147,26,.05); border:1px solid rgba(247,147,26,.12); border-radius:4px; margin-bottom:16px; }
  .goal-head { display:flex; justify-content:space-between; margin-bottom:7px; }

  /* ── PORTFOLIO GRID ─────────────────────────────────────── */
  .port-grid { display:grid; grid-template-columns:1fr 1.6fr; gap:14px; }
  @media (max-width:1000px) { .port-grid{grid-template-columns:1fr;} }

  /* Asset panels */
  .asset-panels { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:4px; }
  .ap { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07); border-radius:5px; padding:16px 14px; position:relative; overflow:hidden; transition:transform .3s,border-color .3s; }
  .ap::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,var(--pc,rgba(247,147,26,.3)),transparent); }
  .ap:hover { transform:translateY(-4px); border-color:rgba(255,255,255,.12); }
  .ap-top { display:flex; align-items:center; gap:9px; margin-bottom:12px; }
  .ap-icon { font-size:1.2rem; line-height:1; }
  .ap-ticker { font-size:.8rem; font-weight:700; }
  .ap-name { font-size:.56rem; color:rgba(255,255,255,.28); margin-top:1px; }
  .ap-pct { font-size:1.9rem; font-weight:800; letter-spacing:-.04em; line-height:1; margin-bottom:3px; }
  .ap-sub { font-size:.58rem; color:rgba(255,255,255,.25); margin-bottom:0; }
  @keyframes apPulse { 0%,100%{opacity:.4} 50%{opacity:.8} }

  /* GF widget */
  .gf-hero { display:flex; align-items:flex-end; gap:20px; flex-wrap:wrap; margin-bottom:18px; }
  .gf-nw   { font-size:2.4rem; font-weight:700; letter-spacing:-.045em; line-height:1; color:#eaeaea; }
  .gf-perf { display:flex; align-items:flex-end; gap:18px; flex-wrap:wrap; flex:1; border-left:1px solid rgba(255,255,255,.06); padding-left:20px; }
  .gfp     { display:flex; flex-direction:column; gap:6px; }
  .gfp-v   { font-size:1.2rem; font-weight:700; letter-spacing:-.025em; line-height:1; }
  .bench   { display:flex; border:1px solid rgba(255,255,255,.07); border-radius:5px; overflow:hidden; margin-bottom:18px; background:rgba(255,255,255,.02); flex-wrap:wrap; }
  .bench-c { flex:1; padding:14px 14px; border-right:1px solid rgba(255,255,255,.06); display:flex; flex-direction:column; gap:5px; min-width:75px; }
  .bench-c:last-child { border-right:none; }
  .bench-v { font-size:1.15rem; font-weight:700; letter-spacing:-.025em; line-height:1; }
  .bench-vs { font-size:.58rem; }
  .holdings-wrap { border-top:1px solid rgba(255,255,255,.05); padding-top:16px; }
  .hgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(148px,1fr)); gap:8px; margin-top:14px; }
  .h-card { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); border-radius:5px; padding:13px; transition:transform .3s,border-color .3s; }
  .h-card:hover { transform:translateY(-3px); border-color:rgba(247,147,26,.16); }
  .h-top  { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:3px; }
  .h-sym  { font-size:.88rem; font-weight:700; color:#eaeaea; }
  .h-pct  { font-size:.68rem; font-weight:600; }
  .h-name { font-size:.58rem; color:rgba(255,255,255,.25); margin-bottom:0; }
  .h-foot { display:flex; justify-content:space-between; font-size:.6rem; color:rgba(255,255,255,.25); }

  /* ── INTEL GRID ─────────────────────────────────────────── */
  .intel-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  @media (max-width:900px) { .intel-grid{grid-template-columns:1fr;} }

  .mkt { padding:13px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  .mkt:last-child { border-bottom:none; padding-bottom:0; }
  .mkt-meta { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
  .mkt-tag { font-size:.54rem; font-weight:600; text-transform:uppercase; letter-spacing:.07em; padding:2px 7px; border-radius:3px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); color:rgba(255,255,255,.3); }
  .mkt-pin { background:rgba(247,147,26,.09); border-color:rgba(247,147,26,.24); color:var(--orange); }
  .mkt-body { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  .mkt-q { font-size:.76rem; color:rgba(255,255,255,.5); line-height:1.5; flex:1; text-decoration:none; transition:color .2s; }
  .mkt-q:hover { color:#eaeaea; }
  .mkt-prob-wrap { display:flex; align-items:baseline; gap:1px; white-space:nowrap; }
  .mkt-prob { font-size:1.65rem; font-weight:800; line-height:1; letter-spacing:-.03em; }
  .mkt-foot { display:flex; justify-content:space-between; align-items:center; margin-top:3px; }

  .news { padding:11px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  .news:last-child { border-bottom:none; }
  .news-title { display:block; font-size:.76rem; color:rgba(255,255,255,.5); text-decoration:none; line-height:1.52; margin-bottom:5px; transition:color .2s; }
  .news-title:hover { color:#eaeaea; }
  .news-meta { display:flex; gap:10px; align-items:center; }
  .news-src { font-size:.58rem; color:var(--orange); font-weight:600; }
</style>
