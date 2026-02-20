<script lang="ts">
  import {
    settings, btcPrice, priceFlash, btcBlock, btcFees,
    halvingBlocksLeft, halvingDays, halvingDate, halvingProgress,
    dcaUpdated, dca, accentColor, priceColor, btcAud, satsPerAud
  } from '$lib/store';

  const n = (v: number, dec = 0) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

  $: s        = $settings.dca;
  $: dcaDays  = Math.max(0, Math.floor((Date.now() - new Date(s.startDate).getTime()) / 86400000));
  $: invested = dcaDays * s.dailyAmount;
  $: currentVal = s.btcHeld * $btcPrice;
  $: perf     = invested > 0 ? ((currentVal - invested) / invested) * 100 : 0;
  $: goalPct  = s.goalBtc > 0 ? Math.min(100, (s.btcHeld / s.goalBtc) * 100) : 0;
  $: satsHeld = Math.round(s.btcHeld * 1e8);
  $: satsLeft = Math.max(0, Math.round((s.goalBtc - s.btcHeld) * 1e8));
</script>

<!-- ══ HERO ════════════════════════════════════════════════════════ -->
<section class="hero">
  <div class="hero-inner">
    <p class="hero-eyebrow">Signal · Network · Stack</p>
    <h1 class="hero-title">SITUATION MONITOR</h1>
    <p class="hero-desc">Real-time on-chain intelligence and DCA analysis.<br>One dashboard. Everything that matters.</p>

    <!-- 4 key stats — the primary numbers, shown once and clearly -->
    <div class="hero-stats">
      <div class="hero-stat">
        <span class="hero-stat-n" style="color:{$priceColor}; transition:color 0.5s;">
          {$btcPrice > 0 ? '$'+n($btcPrice) : '—'}
        </span>
        <span class="hero-stat-l">BTC / USD</span>
      </div>

      <div class="hero-stat">
        <span class="hero-stat-n" style="color:var(--orange);">
          {$satsPerAud ? $satsPerAud.toLocaleString() : '—'}
        </span>
        <span class="hero-stat-l">Sats per A$1</span>
      </div>

      <div class="hero-stat">
        {#if $dca && $dca.finalAud > 0}
          <span class="hero-stat-n" style="color:{$accentColor};">${$dca.finalAud.toLocaleString()}</span>
          <span class="hero-stat-l">DCA Signal (AUD)</span>
        {:else if $dca && $dca.finalAud === 0}
          <span class="hero-stat-n" style="color:var(--dn);">PASS</span>
          <span class="hero-stat-l">DCA Signal</span>
        {:else}
          <span class="hero-stat-n" style="color:rgba(255,255,255,0.15);">—</span>
          <span class="hero-stat-l">DCA Signal</span>
        {/if}
      </div>

      <div class="hero-stat">
        <span class="hero-stat-n">{$halvingDays > 0 ? $halvingDays.toLocaleString() : '—'}</span>
        <span class="hero-stat-l">Days to Halving</span>
      </div>
    </div>
  </div>
</section>

<!-- ══ FULL-WIDTH SIGNAL ANALYSIS ═══════════════════════════════════ -->
<div class="page-content">

  <p class="sect-label">SIGNAL ANALYSIS</p>

  <!-- Main signal card — full width, horizontal layout -->
  <div class="gc signal-card" style="--ac:{$accentColor};">
    <div class="signal-bar" style="background:linear-gradient(90deg,{$accentColor}33,{$accentColor},{$accentColor}33);"></div>

    <div class="signal-layout">

      <!-- LEFT: The big DCA number + valuation band -->
      <div class="signal-left">
        <div class="sl-label">
          <p class="eyebrow" style="color:var(--orange); letter-spacing:0.14em;">DCA Signal</p>
          <p class="dim" style="margin-top:4px;">Fortnightly buy recommendation</p>
        </div>

        <div class="sl-amount">
          {#if !$dca}
            <span class="big-n" style="color:rgba(255,255,255,0.08);">—</span>
          {:else if $dca.finalAud === 0}
            <span class="big-n" style="color:var(--dn); text-shadow:0 0 80px rgba(239,68,68,0.3);">PASS</span>
          {:else}
            <span class="big-n" style="color:{$accentColor}; text-shadow:0 0 80px {$accentColor}33;">
              ${$dca.finalAud.toLocaleString()}
            </span>
          {/if}
          <p class="big-sub">AUD · fortnightly buy</p>
        </div>

        <!-- Valuation band — only shown when price is live -->
        {#if $btcPrice > 0}
        <div class="vband">
          <div class="vband-labels">
            <span style="color:var(--up); font-size:0.58rem; font-weight:600;">$55k CHEAP</span>
            <span class="dim" style="font-size:0.57rem;">Bitcoin Valuation Band</span>
            <span style="color:var(--dn); font-size:0.58rem; font-weight:600;">EXPENSIVE $125k</span>
          </div>
          <div class="vband-track">
            {#if $btcPrice <= 55000}
              <div class="vband-fill" style="width:2%; background:var(--up);"></div>
            {:else if $btcPrice >= 125000}
              <div class="vband-fill" style="width:100%; background:var(--dn);"></div>
            {:else}
              <div class="vband-fill" style="width:{(($btcPrice-55000)/70000)*100}%; background:linear-gradient(90deg,var(--up),var(--orange),var(--dn));"></div>
            {/if}
          </div>
        </div>
        {/if}

        <span class="ts">{$dcaUpdated ? 'Updated '+$dcaUpdated : 'Loading…'}</span>
      </div>

      <!-- RIGHT: Signal conditions grid -->
      {#if $dca}
      <div class="signal-right">
        <p class="eyebrow" style="margin-bottom:14px; color:rgba(255,255,255,0.3);">Active Conditions</p>
        <div class="sigs-grid">
          {#each $dca.signals as sig}
            <div class="sig" class:sig--on={sig.active}>
              <div class="sig-pip-wrap">
                <div class="sig-pip" class:sig-pip--on={sig.active}></div>
                {#if sig.active}<div class="sig-ring"></div>{/if}
              </div>
              <span class="sig-label">{sig.name}</span>
              {#if sig.active}
                <span class="sig-badge">+{sig.boost}%</span>
              {:else}
                <span class="sig-inactive">inactive</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
      {/if}

    </div>
  </div>

  <!-- ══ BOTTOM ROW: Network + Stack side by side ══════════════ -->
  <div class="bottom-row">

    <!-- BITCOIN NETWORK -->
    <div class="gc">
      <div class="card-head">
        <p class="ch-t">Bitcoin Network</p>
        <a href="https://mempool.space" target="_blank" rel="noopener noreferrer" class="ch-link">mempool.space ↗</a>
      </div>
      <div class="metric-trio">
        <div class="mt-item">
          <p class="eyebrow">Block Height</p>
          <p class="metric-n">{n($btcBlock) || '—'}</p>
        </div>
        <div class="mt-item">
          <p class="eyebrow">Fee · Low</p>
          <p class="metric-n" style="color:var(--up);">{$btcFees.low || '—'}<span class="metric-u">sat/vb</span></p>
        </div>
        <div class="mt-item">
          <p class="eyebrow">Fee · High</p>
          <p class="metric-n" style="color:var(--dn);">{$btcFees.high || '—'}<span class="metric-u">sat/vb</span></p>
        </div>
      </div>

      {#if $halvingBlocksLeft > 0}
      <div class="halving">
        <div class="halving-row">
          <div>
            <p class="eyebrow">Next Halving</p>
            <p class="halving-days">{$halvingDays.toLocaleString()} <span class="halving-u">days</span></p>
          </div>
          <div style="text-align:right;">
            <p class="eyebrow">{$halvingProgress.toFixed(1)}% of epoch complete</p>
            <p class="dim" style="margin-top:3px;">{$halvingBlocksLeft.toLocaleString()} blocks · ~{$halvingDate}</p>
          </div>
        </div>
        <div class="hprog"><div class="hprog-fill" style="width:{$halvingProgress}%;"></div></div>
      </div>
      {/if}
    </div>

    <!-- MY STACK -->
    <div class="gc">
      <div class="card-head">
        <p class="ch-t">My Stack</p>
        <p class="ch-accent">${s.dailyAmount}/day · {dcaDays} days in</p>
      </div>
      <div class="metric-trio" style="margin-bottom:22px;">
        <div class="mt-item">
          <p class="eyebrow">Total Invested</p>
          <p class="metric-n">${n(invested)}</p>
        </div>
        <div class="mt-item">
          <p class="eyebrow">Current Value</p>
          <p class="metric-n" style="color:{perf>=0?'var(--up)':'var(--dn)'};">
            {$btcPrice > 0 ? '$'+n(currentVal) : '—'}
          </p>
        </div>
        <div class="mt-item">
          <p class="eyebrow">Total Return</p>
          <p class="metric-n" style="color:{perf>=0?'var(--up)':'var(--dn)'};">
            {$btcPrice > 0 ? (perf>=0?'+':'')+perf.toFixed(1)+'%' : '—'}
          </p>
        </div>
      </div>

      <div class="btc-pill">
        <span style="color:var(--orange); font-weight:700; font-size:0.95rem;">{s.btcHeld.toFixed(8)}</span>
        <span style="color:rgba(255,255,255,0.35); margin:0 7px;">BTC</span>
        <span style="color:rgba(255,255,255,0.25); font-size:0.75rem;">{n(satsHeld)} sats</span>
      </div>

      <div>
        <div class="goal-head">
          <p class="eyebrow">Goal · {s.goalBtc} BTC</p>
          <p class="eyebrow" style="color:var(--orange);">{goalPct.toFixed(1)}%</p>
        </div>
        <div class="goal-track"><div class="goal-fill" style="width:{goalPct}%;"></div></div>
        <p class="dim" style="text-align:right; margin-top:5px;">{n(satsLeft)} sats remaining</p>
      </div>
    </div>

  </div>
</div>

<style>
  /* ── HERO ──────────────────────────────────────────────────── */
  .hero {
    padding: 56px 24px 44px;
    text-align: center;
    position: relative; overflow: hidden;
  }
  .hero::before {
    content: ''; position: absolute; top: 50%; left: 50%;
    width: 70%; height: 70%;
    background: radial-gradient(circle, rgba(247,147,26,0.05) 0%, transparent 70%);
    transform: translate(-50%, -50%);
    animation: heroPulse 12s ease-in-out infinite; z-index: -1;
  }
  @keyframes heroPulse {
    0%,100% { transform: translate(-50%,-50%) scale(1); opacity: .6; }
    50%     { transform: translate(-50%,-50%) scale(1.4); opacity: 1; }
  }
  .hero-inner { max-width: 760px; margin: 0 auto; }
  .hero-eyebrow {
    font-size: .7rem; font-weight: 500; color: var(--orange);
    text-transform: uppercase; letter-spacing: .3em; margin-bottom: 16px;
  }
  .hero-title {
    font-size: clamp(2rem, 5.5vw, 4rem);
    font-weight: 800; letter-spacing: -.025em; line-height: 1.05;
    margin-bottom: 14px;
    background: linear-gradient(135deg, #f7931a 0%, #ffd080 40%, #f7931a 70%, #e06000 100%);
    background-size: 300% 300%;
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
    animation: titleFlow 8s ease infinite;
  }
  @keyframes titleFlow { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
  .hero-desc { font-size: .95rem; color: rgba(255,255,255,.4); line-height: 1.7; margin-bottom: 40px; font-weight: 300; }

  /* Hero stat tiles — 4 across, spacious but not oversized */
  .hero-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    max-width: 680px; margin: 0 auto;
  }
  .hero-stat {
    padding: 18px 12px 16px;
    background: linear-gradient(135deg, rgba(247,147,26,.07), rgba(247,147,26,.03));
    border: 1px solid rgba(247,147,26,.15);
    border-radius: 16px;
    backdrop-filter: blur(10px);
    transition: transform .3s, border-color .3s, box-shadow .3s;
    text-align: center;
  }
  .hero-stat:hover {
    transform: translateY(-5px) scale(1.02);
    border-color: rgba(247,147,26,.3);
    box-shadow: 0 14px 32px rgba(247,147,26,.1);
  }
  .hero-stat-n {
    display: block;
    font-size: 1.55rem; font-weight: 700;
    color: #f0f0f0; letter-spacing: -.025em;
    margin-bottom: 7px; line-height: 1.1;
  }
  .hero-stat-l {
    font-size: .59rem; color: rgba(255,255,255,.3);
    text-transform: uppercase; letter-spacing: .1em;
  }

  @media (max-width: 600px) {
    .hero { padding: 36px 16px 28px; }
    .hero-stats { grid-template-columns: repeat(2, 1fr); gap: 10px; max-width: 100%; }
    .hero-stat-n { font-size: 1.25rem; }
    .hero-desc { font-size: .85rem; margin-bottom: 28px; }
  }

  /* ── PAGE CONTENT ──────────────────────────────────────────── */
  .page-content {
    max-width: 1440px; margin: 0 auto;
    padding: 0 16px 48px;
    display: flex; flex-direction: column; gap: 14px;
  }

  .sect-label {
    font-size: .64rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: .22em;
    background: linear-gradient(90deg, var(--orange), rgba(247,147,26,.5));
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
    padding-left: 2px;
  }

  /* ── GLASS CARD ────────────────────────────────────────────── */
  .gc {
    background: rgba(255,255,255,.04);
    backdrop-filter: blur(28px) saturate(160%);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 22px; padding: 28px;
    box-shadow: 0 8px 40px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
    transition: transform .4s cubic-bezier(.4,0,.2,1), border-color .3s, box-shadow .4s;
  }
  .gc:hover {
    transform: translateY(-4px);
    border-color: rgba(247,147,26,.16);
    box-shadow: 0 20px 50px rgba(0,0,0,.5), 0 0 0 1px rgba(247,147,26,.07), inset 0 1px 0 rgba(255,255,255,.08);
  }

  /* ── SIGNAL CARD ───────────────────────────────────────────── */
  .signal-card {
    background: linear-gradient(160deg, rgba(247,147,26,.07) 0%, rgba(255,255,255,.04) 60px, rgba(255,255,255,.03) 100%);
    position: relative; overflow: hidden;
  }
  .signal-bar { position: absolute; top: 0; left: 0; right: 0; height: 2px; border-radius: 22px 22px 0 0; }

  /* Horizontal split: big amount LEFT, signals grid RIGHT */
  .signal-layout {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 40px;
    align-items: center;
  }

  .signal-left { display: flex; flex-direction: column; gap: 20px; }

  .sl-label { display: flex; flex-direction: column; }

  .sl-amount { }
  .big-n {
    display: block;
    font-size: clamp(3.5rem, 7vw, 6rem);
    font-weight: 800; line-height: 1;
    letter-spacing: -.045em;
    transition: color .5s, text-shadow .5s;
  }
  .big-sub {
    font-size: .6rem; color: rgba(255,255,255,.2);
    text-transform: uppercase; letter-spacing: .16em;
    margin-top: 10px;
  }

  /* Valuation band */
  .vband { }
  .vband-labels { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .vband-track { height: 4px; background: rgba(255,255,255,.06); border-radius: 2px; overflow: hidden; }
  .vband-fill { height: 100%; border-radius: 2px; transition: width .8s cubic-bezier(.4,0,.2,1); }

  .ts { font-size: .58rem; color: rgba(255,255,255,.18); font-variant-numeric: tabular-nums; }

  /* Signals grid — 2 columns on wide screens */
  .signal-right { }
  .sigs-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 24px;
  }
  .sig { display: flex; align-items: center; gap: 10px; transition: opacity .2s; }
  .sig:not(.sig--on) { opacity: .28; }
  .sig-pip-wrap { position: relative; width: 14px; height: 14px; flex-shrink: 0; }
  .sig-pip { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.16); transition: all .25s; position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); }
  .sig-pip--on { background: var(--orange); border-color: var(--orange); box-shadow: 0 0 10px rgba(247,147,26,.6); }
  .sig-ring { position: absolute; inset: 0; border-radius: 50%; background: rgba(247,147,26,.14); animation: ringPulse 2s ease-out infinite; }
  @keyframes ringPulse { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(2.6);opacity:0} }
  .sig-label { font-size: .72rem; color: rgba(255,255,255,.75); flex: 1; line-height: 1.3; }
  .sig-badge { font-size: .6rem; color: var(--orange); font-weight: 600; background: rgba(247,147,26,.1); border: 1px solid rgba(247,147,26,.22); padding: 2px 8px; border-radius: 20px; white-space: nowrap; }
  .sig-inactive { font-size: .58rem; color: rgba(255,255,255,.18); }

  /* Collapse to single column below 900px */
  @media (max-width: 900px) {
    .signal-layout { grid-template-columns: 1fr; gap: 28px; }
    .sigs-grid { grid-template-columns: 1fr 1fr; }
    .big-n { font-size: clamp(3rem, 12vw, 5rem); }
  }
  @media (max-width: 500px) {
    .sigs-grid { grid-template-columns: 1fr; }
  }

  /* ── BOTTOM ROW ────────────────────────────────────────────── */
  .bottom-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  @media (max-width: 800px) { .bottom-row { grid-template-columns: 1fr; } }

  /* ── SHARED ATOMS ──────────────────────────────────────────── */
  .eyebrow { font-size: .59rem; font-weight: 500; text-transform: uppercase; letter-spacing: .12em; color: rgba(255,255,255,.22); }
  .dim { font-size: .62rem; color: rgba(255,255,255,.25); }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
  .ch-t { font-size: .84rem; font-weight: 600; color: #f0f0f0; }
  .ch-link { font-size: .62rem; color: rgba(255,255,255,.25); text-decoration: none; transition: color .2s; }
  .ch-link:hover { color: var(--orange); }
  .ch-accent { font-size: .62rem; color: var(--orange); }

  .metric-trio { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin-top: 16px; }
  .mt-item { display: flex; flex-direction: column; gap: 8px; }
  .metric-n { font-size: 1.5rem; font-weight: 700; letter-spacing: -.03em; line-height: 1; color: #f0f0f0; }
  .metric-u { font-size: .45em; color: rgba(255,255,255,.3); font-weight: 400; margin-left: 2px; }

  .halving { border-top: 1px solid rgba(255,255,255,.06); margin-top: 20px; padding-top: 18px; }
  .halving-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .halving-days { font-size: 1.6rem; font-weight: 700; letter-spacing: -.03em; color: var(--orange); line-height: 1; }
  .halving-u { font-size: .55em; color: rgba(247,147,26,.7); font-weight: 400; }
  .hprog { height: 3px; background: rgba(255,255,255,.06); border-radius: 2px; overflow: hidden; }
  .hprog-fill { height: 100%; background: linear-gradient(90deg, rgba(247,147,26,.5), var(--orange)); border-radius: 2px; transition: width .8s cubic-bezier(.4,0,.2,1); }

  .btc-pill { display: flex; align-items: baseline; padding: 12px 16px; background: rgba(247,147,26,.05); border: 1px solid rgba(247,147,26,.1); border-radius: 10px; margin-bottom: 18px; }
  .goal-head { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .goal-track { height: 3px; background: rgba(255,255,255,.06); border-radius: 2px; overflow: hidden; }
  .goal-fill { height: 100%; background: linear-gradient(90deg, rgba(247,147,26,.6), var(--orange)); border-radius: 2px; transition: width .8s; }
</style>
