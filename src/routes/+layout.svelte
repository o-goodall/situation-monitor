<script lang="ts">
  import '../app.css';
  import { onMount, onDestroy } from 'svelte';
  import { loadSettings } from '$lib/settings';
  import {
    settings, showSettings, saved, time,
    btcPrice, prevPrice, priceFlash, btcBlock, btcFees,
    halvingBlocksLeft, halvingDays, halvingDate, halvingProgress,
    fearGreed, fearGreedLabel, difficultyChange, fundingRate, audUsd, dcaUpdated,
    markets, newsItems,
    goldPriceUsd, goldYtdPct, sp500Price, sp500YtdPct, cpiAnnual,
    gfNetWorth, gfTotalInvested, gfNetGainPct, gfNetGainYtdPct,
    gfTodayChangePct, gfHoldings, gfError, gfLoading, gfUpdated,
    persistSettings
  } from '$lib/store';

  let newKeyword = '', newSource = '';
  let clockInterval: ReturnType<typeof setInterval>;
  let intervals:     ReturnType<typeof setInterval>[] = [];
  let scrolled = false;

  function tick() {
    $time = new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  async function fetchBtc() {
    try {
      const d = await fetch('/api/bitcoin').then(r=>r.json());
      $prevPrice=$btcPrice; $btcPrice=d.price??0; $btcBlock=d.blockHeight??0;
      $btcFees=d.fees??{low:0,medium:0,high:0};
      if(d.halving){$halvingBlocksLeft=d.halving.blocksRemaining;$halvingDays=d.halving.daysRemaining;$halvingDate=d.halving.estimatedDate;$halvingProgress=d.halving.progressPct;}
      if($prevPrice&&$btcPrice!==$prevPrice){$priceFlash=$btcPrice>$prevPrice?'up':'down';setTimeout(()=>$priceFlash='',1200);}
    } catch {}
  }
  async function fetchDCA() {
    try {
      const d=await fetch('/api/dca').then(r=>r.json());
      $fearGreed=d.fearGreed;$fearGreedLabel=d.fearGreedLabel;$difficultyChange=d.difficultyChange;$fundingRate=d.fundingRate;$audUsd=d.audUsd;
      $dcaUpdated=new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});
    } catch {}
  }
  async function fetchPoly() {
    try { const kw=encodeURIComponent(JSON.stringify($settings.polymarket.keywords)); $markets=(await fetch(`/api/polymarket?keywords=${kw}`).then(r=>r.json())).markets??[]; } catch {}
  }
  async function fetchNews() {
    try { const src=encodeURIComponent(JSON.stringify($settings.news.sources)); $newsItems=(await fetch(`/api/news?sources=${src}`).then(r=>r.json())).items??[]; } catch {}
  }
  async function fetchMarkets() {
    try {
      const d=await fetch('/api/markets').then(r=>r.json());
      $goldPriceUsd=d.gold?.priceUsd??null;$goldYtdPct=d.gold?.ytdPct??null;$sp500Price=d.sp500?.price??null;$sp500YtdPct=d.sp500?.ytdPct??null;$cpiAnnual=d.cpiAnnual??null;
    } catch {}
  }
  export async function fetchGhostfolio() {
    const token=$settings.ghostfolio?.token?.trim(); if(!token) return;
    $gfLoading=true;$gfError='';
    try {
      const d=await fetch(`/api/ghostfolio?token=${encodeURIComponent(token)}`).then(r=>r.json());
      if(d.error){$gfError=d.error;}
      else{$gfNetWorth=d.netWorth;$gfTotalInvested=d.totalInvested;$gfNetGainPct=d.netGainPct;$gfNetGainYtdPct=d.netGainYtdPct;$gfTodayChangePct=d.todayChangePct;$gfHoldings=d.holdings??[];$gfUpdated=new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'});}
    } catch {$gfError='Connection failed';} finally {$gfLoading=false;}
  }
  function saveAll() {
    persistSettings($settings);
    fetchPoly();fetchNews();if($settings.ghostfolio?.token)fetchGhostfolio();
  }
  const addKeyword=(()=>{if(newKeyword.trim()){$settings.polymarket.keywords=[...$settings.polymarket.keywords,newKeyword.trim()];newKeyword='';}}); // will be overridden below
  const removeKeyword=(i:number)=>{$settings.polymarket.keywords=$settings.polymarket.keywords.filter((_,j)=>j!==i);};
  const addSource=(()=>{});
  const removeSource=(i:number)=>{$settings.news.sources=$settings.news.sources.filter((_,j)=>j!==i);};

  function handleAddKeyword(){if(newKeyword.trim()){$settings.polymarket.keywords=[...$settings.polymarket.keywords,newKeyword.trim()];newKeyword='';}}
  function handleAddSource(){if(newSource.trim()){$settings.news.sources=[...$settings.news.sources,newSource.trim()];newSource='';}}

  function handleScroll(){scrolled=window.scrollY>40;}

  onMount(()=>{
    $settings=loadSettings();tick();
    clockInterval=setInterval(tick,1000);
    fetchBtc();fetchDCA();fetchPoly();fetchNews();fetchMarkets();
    if($settings.ghostfolio?.token)fetchGhostfolio();
    intervals=[setInterval(fetchBtc,60000),setInterval(fetchDCA,300000),setInterval(fetchPoly,300000),setInterval(fetchNews,300000),setInterval(fetchMarkets,300000),setInterval(()=>{if($settings.ghostfolio?.token)fetchGhostfolio();},300000)];
    window.addEventListener('scroll',handleScroll,{passive:true});
  });
  onDestroy(()=>{clearInterval(clockInterval);intervals.forEach(clearInterval);window.removeEventListener('scroll',handleScroll);});
</script>

<!-- ══ CYBER HORNET SWARM CANVAS ══════════════════════════════ -->
<canvas id="hornet-canvas" aria-hidden="true"></canvas>

<!-- ══ HEADER — shrinks on scroll like Electric Xtra ═════════ -->
<header class="hdr" class:hdr--scrolled={scrolled}>
  <!-- Brand -->
  <a href="/" class="brand">
    <div class="globe-wrap" aria-hidden="true">
      <div class="globe">
        <div class="wire w-eq"></div>
        <div class="wire w-lg1"></div>
        <div class="wire w-lg2"></div>
        <div class="wire w-lt1"></div>
        <div class="wire w-lt2"></div>
        <div class="ping ping-1"></div>
        <div class="ping ping-2"></div>
        <div class="ping ping-3"></div>
        <div class="ping ping-4"></div>
        <div class="ping ping-5"></div>
      </div>
    </div>
    <span class="brand-name">
      <span class="b-gl">gl</span><span class="b-4">4</span><span class="b-nce">nce</span><span class="b-dot">.</span>
    </span>
  </a>

  <!-- Section anchors — Electric Xtra nav-link style -->
  <nav class="page-nav">
    <a href="#signal"    class="nav-link">₿ Signal</a>
    <a href="#portfolio" class="nav-link">↗ Portfolio</a>
    <a href="#intel"     class="nav-link">◈ Intel</a>
  </nav>

  <!-- Right -->
  <div class="hdr-right">
    <span class="hdr-clock">{$time}</span>
    <button class="btn-ghost settings-btn" class:settings-btn--on={$showSettings}
      on:click={()=>$showSettings=!$showSettings} aria-label="Settings">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>
  </div>
</header>

<!-- ══ SETTINGS DRAWER ════════════════════════════════════════ -->
{#if $showSettings}
<div class="drawer">
  <div class="drawer-inner">
    <div class="dg"><p class="dg-hd">DCA Stack</p>
      <div class="dfields">
        <label class="df"><span class="dlbl">Start date</span><input type="date" bind:value={$settings.dca.startDate} class="dinp"/></label>
        <label class="df"><span class="dlbl">Daily AUD</span><input type="number" bind:value={$settings.dca.dailyAmount} class="dinp"/></label>
        <label class="df"><span class="dlbl">BTC held</span><input type="number" step="0.00000001" bind:value={$settings.dca.btcHeld} class="dinp"/></label>
        <label class="df"><span class="dlbl">Goal BTC</span><input type="number" step="0.001" bind:value={$settings.dca.goalBtc} class="dinp"/></label>
      </div>
    </div>
    <div class="dg"><p class="dg-hd">Watchlist <span class="dhint">pinned in markets feed</span></p>
      <div class="dtags">{#each $settings.polymarket.keywords as kw,i}<span class="dtag">{kw}<button on:click={()=>removeKeyword(i)} class="dtag-x">×</button></span>{/each}</div>
      <div class="dinp-row"><input bind:value={newKeyword} on:keydown={(e)=>e.key==='Enter'&&handleAddKeyword()} placeholder="Add keyword…" class="dinp"/><button on:click={handleAddKeyword} class="btn-ghost" style="white-space:nowrap;">Add</button></div>
    </div>
    <div class="dg"><p class="dg-hd">News RSS</p>
      <div class="dsrcs">{#each $settings.news.sources as src,i}<div class="dsrc"><span class="dsrc-url">{src}</span><button on:click={()=>removeSource(i)} class="dtag-x">×</button></div>{/each}</div>
      <div class="dinp-row"><input type="url" bind:value={newSource} on:keydown={(e)=>e.key==='Enter'&&handleAddSource()} placeholder="https://…" class="dinp"/><button on:click={handleAddSource} class="btn-ghost" style="white-space:nowrap;">Add</button></div>
    </div>
    <div class="dg"><p class="dg-hd">Ghostfolio <span class="dhint">token stored locally</span></p>
      <div class="dfields" style="max-width:500px;">
        <label class="df" style="flex:3;"><span class="dlbl">Security token</span><input type="password" bind:value={$settings.ghostfolio.token} placeholder="your-security-token" class="dinp"/></label>
        <label class="df"><span class="dlbl">Currency</span><input bind:value={$settings.ghostfolio.currency} placeholder="AUD" class="dinp" style="width:72px;"/></label>
      </div>
    </div>
    <button on:click={saveAll} class="btn-primary" class:d-save--ok={$saved}>{$saved?'✓ Saved':'Save Settings'}</button>
  </div>
</div>
{/if}

<!-- ══ PAGE ═══════════════════════════════════════════════════ -->
<main class="page-wrap"><slot /></main>

<!-- ══ FOOTER ════════════════════════════════════════════════ -->
<footer class="site-footer">
  <span class="footer-brand">gl<span style="color:var(--orange);">4</span>nce.</span>
  <span class="footer-sources">mempool.space · alternative.me · binance · exchangerate-api · ghostfol.io · worldbank</span>
</footer>

<!-- ══ HORNET SWARM SCRIPT ════════════════════════════════════ -->
<script>
// Cyber-hornet swarm — hive-mind particle system
// Each hornet: small angular body, drifts slowly, occasionally surges
// toward nearby hornets (flocking), emits a faint electric trail
(function() {
  const canvas = document.getElementById('hornet-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, hornets = [], animId;
  const ORANGE = 'rgba(247,147,26,';
  const ELECTRIC = 'rgba(0,200,255,';
  const COUNT = 55;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  class Hornet {
    constructor() { this.reset(true); }
    reset(init) {
      this.x  = Math.random() * (W || window.innerWidth);
      this.y  = Math.random() * (H || window.innerHeight);
      // Slow base velocity — hive-mind drift
      this.vx = (Math.random() - 0.5) * 0.55;
      this.vy = (Math.random() - 0.5) * 0.55;
      this.size = 2.2 + Math.random() * 2.0;
      // Each hornet cycles between orange and electric-blue
      this.hue  = Math.random() < 0.72 ? 'o' : 'e'; // orange dominant
      this.alpha = 0.18 + Math.random() * 0.45;
      this.angle = Math.random() * Math.PI * 2;
      this.spin  = (Math.random() - 0.5) * 0.02;
      // Surge state — occasionally a hornet accelerates like it's targeting
      this.surgeTimer = 60 + Math.floor(Math.random() * 200);
      this.surging = false;
      // Trail history
      this.trail = [];
      this.trailLen = 6 + Math.floor(Math.random() * 8);
    }

    update(all) {
      // Trail
      this.trail.push({x:this.x, y:this.y});
      if (this.trail.length > this.trailLen) this.trail.shift();

      this.angle += this.spin;
      this.surgeTimer--;

      if (this.surgeTimer <= 0) {
        this.surging = !this.surging;
        this.surgeTimer = this.surging
          ? 20 + Math.floor(Math.random() * 40)   // surge lasts ~30 frames
          : 80 + Math.floor(Math.random() * 180);  // rest lasts ~130 frames
        if (this.surging) {
          // Surge toward a random nearby hornet — hive-mind targeting
          const target = all[Math.floor(Math.random() * all.length)];
          const dx = target.x - this.x, dy = target.y - this.y;
          const dist = Math.sqrt(dx*dx+dy*dy) || 1;
          const spd = 1.4 + Math.random() * 1.0;
          this.vx = (dx/dist) * spd;
          this.vy = (dy/dist) * spd;
        } else {
          // Return to slow drift
          this.vx = (Math.random()-0.5)*0.55;
          this.vy = (Math.random()-0.5)*0.55;
        }
      }

      this.x += this.vx;
      this.y += this.vy;

      // Wrap edges softly
      if (this.x < -20) this.x = W + 20;
      if (this.x > W+20) this.x = -20;
      if (this.y < -20) this.y = H + 20;
      if (this.y > H+20) this.y = -20;
    }

    draw() {
      const col = this.hue === 'o' ? ORANGE : ELECTRIC;

      // Trail — fading electric streak
      if (this.trail.length > 1) {
        for (let i = 1; i < this.trail.length; i++) {
          const t  = i / this.trail.length;
          const a  = t * this.alpha * 0.45;
          ctx.beginPath();
          ctx.moveTo(this.trail[i-1].x, this.trail[i-1].y);
          ctx.lineTo(this.trail[i].x,   this.trail[i].y);
          ctx.strokeStyle = col + a + ')';
          ctx.lineWidth   = this.size * t * 0.55;
          ctx.stroke();
        }
      }

      // Hornet body — angular chevron shape, rotated by angle
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);

      const s = this.size;
      const glow = this.surging ? this.alpha * 1.6 : this.alpha;

      // Outer glow
      ctx.shadowBlur  = this.surging ? 10 : 5;
      ctx.shadowColor = col + '0.8)';

      // Body — two small triangles forming a chevron/stinger
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.6);    // tip
      ctx.lineTo(-s * 0.9, s);     // left wing
      ctx.lineTo(0, s * 0.4);      // inner notch
      ctx.lineTo(s * 0.9, s);      // right wing
      ctx.closePath();
      ctx.fillStyle = col + Math.min(glow, 0.9) + ')';
      ctx.fill();

      // Electric accent stripe down body
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.4);
      ctx.lineTo(0, s * 0.3);
      ctx.strokeStyle = (this.hue === 'o' ? ELECTRIC : ORANGE) + (glow * 0.7) + ')';
      ctx.lineWidth = 0.7;
      ctx.shadowBlur = 4;
      ctx.stroke();

      ctx.restore();
    }
  }

  function init() {
    hornets = [];
    for (let i = 0; i < COUNT; i++) hornets.push(new Hornet());
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);

    // Draw faint connection lines between very close hornets — hive network
    for (let i = 0; i < hornets.length; i++) {
      for (let j = i+1; j < hornets.length; j++) {
        const dx = hornets[i].x - hornets[j].x;
        const dy = hornets[i].y - hornets[j].y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if (dist < 90) {
          const a = (1 - dist/90) * 0.08;
          ctx.beginPath();
          ctx.moveTo(hornets[i].x, hornets[i].y);
          ctx.lineTo(hornets[j].x, hornets[j].y);
          ctx.strokeStyle = ORANGE + a + ')';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    hornets.forEach(h=>{ h.update(hornets); h.draw(); });
    animId = requestAnimationFrame(loop);
  }

  resize();
  init();
  loop();
  window.addEventListener('resize', ()=>{ resize(); init(); }, {passive:true});
})();
</script>

<style>
  /* Canvas — fixed, behind everything */
  #hornet-canvas {
    position: fixed; inset: 0;
    width: 100%; height: 100%;
    z-index: -1; pointer-events: none;
  }

  /* HEADER */
  .hdr {
    position: fixed; top: 0; left: 0; right: 0; z-index: 300;
    display: flex; align-items: center; gap: 20px;
    height: 64px; padding: 0 32px;
    background: rgba(10,10,10,0.82);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border-bottom: 1px solid rgba(247,147,26,0.12);
    transition: height 0.3s ease, background 0.3s ease, box-shadow 0.3s ease;
  }
  .hdr--scrolled {
    height: 52px;
    background: rgba(10,10,10,0.96);
    box-shadow: 0 4px 28px rgba(247,147,26,0.15);
    border-bottom-color: rgba(247,147,26,0.22);
  }

  /* BRAND */
  .brand { display:flex; align-items:center; gap:11px; text-decoration:none; flex-shrink:0; }

  /* GLOBE */
  .globe-wrap { width:30px; height:30px; position:relative; flex-shrink:0; }
  .globe {
    width:100%; height:100%; position:relative; border-radius:50%;
    background: radial-gradient(circle at 38% 35%, rgba(247,147,26,0.28) 0%, rgba(247,147,26,0.06) 55%, transparent 75%);
    box-shadow: 0 0 0 1px rgba(247,147,26,0.32), 0 0 14px rgba(247,147,26,0.35), inset 0 0 8px rgba(247,147,26,0.1);
    overflow: hidden;
  }
  .wire { position:absolute; border:1px solid rgba(247,147,26,0.2); border-radius:50%; top:50%; left:50%; transform:translate(-50%,-50%); pointer-events:none; }
  .w-eq  { width:100%; height:28%; }
  .w-lg1 { width:52%;  height:100%; }
  .w-lg2 { width:22%;  height:100%; }
  .w-lt1 { width:80%;  height:20%; top:28%; }
  .w-lt2 { width:80%;  height:20%; top:70%; }
  .ping { position:absolute; left:0; right:0; height:2px; background:linear-gradient(90deg,transparent 8%,rgba(247,147,26,0.9) 35%,rgba(255,200,80,1) 50%,rgba(247,147,26,0.9) 65%,transparent 92%); border-radius:1px; top:-2px; animation:pingDrop 2.5s linear infinite; opacity:0; box-shadow:0 0 4px rgba(247,147,26,0.6); }
  .ping-1{animation-delay:0s} .ping-2{animation-delay:.5s} .ping-3{animation-delay:1s} .ping-4{animation-delay:1.5s} .ping-5{animation-delay:2s}
  @keyframes pingDrop { 0%{top:-2px;opacity:0} 4%{top:2%;opacity:1} 24%{top:98%;opacity:.9} 28%{top:102%;opacity:0} 100%{top:102%;opacity:0} }

  /* gl4nce WORDMARK */
  .brand-name { font-family:'Orbitron',monospace; font-weight:900; font-size:1rem; letter-spacing:.06em; line-height:1; }
  .b-gl,.b-nce { color:rgba(234,234,234,.92); }
  .b-4 { color:var(--orange); text-shadow:0 0 14px rgba(247,147,26,.8),0 0 28px rgba(247,147,26,.4); animation:fourGlow 3s ease-in-out infinite; display:inline-block; }
  .b-dot { color:var(--orange); opacity:.7; }
  @keyframes fourGlow { 0%,100%{text-shadow:0 0 12px rgba(247,147,26,.8),0 0 24px rgba(247,147,26,.4)} 50%{text-shadow:0 0 20px rgba(247,147,26,1),0 0 44px rgba(247,147,26,.5),0 0 70px rgba(247,147,26,.18)} }

  /* NAV — Electric Xtra anchor-scroll style */
  .page-nav { flex:1; display:flex; justify-content:center; gap:4px; }
  .nav-link {
    padding: 8px 18px; border-radius: 3px;
    font-family: 'Orbitron', monospace; font-size: .68rem; font-weight: 700;
    color: rgba(255,255,255,.5); text-decoration: none;
    text-transform: uppercase; letter-spacing: .08em;
    position: relative; border: 1px solid transparent;
    transition: all 0.25s ease;
  }
  .nav-link::after {
    content: ''; position: absolute; bottom: 0; left: 0;
    width: 0; height: 2px;
    background: linear-gradient(90deg, #f7931a, #00c8ff);
    box-shadow: 0 0 8px rgba(247,147,26,.7);
    transition: width .3s ease;
  }
  .nav-link:hover {
    color: rgba(255,255,255,.9);
    border-color: rgba(247,147,26,.3);
    box-shadow: inset 0 0 12px rgba(247,147,26,.08);
  }
  .nav-link:hover::after { width: 100%; }

  .hdr-right { display:flex; align-items:center; gap:12px; flex-shrink:0; }
  .hdr-clock { font-size:.72rem; font-weight:500; color:rgba(255,255,255,.22); font-variant-numeric:tabular-nums; letter-spacing:.07em; }
  .settings-btn { padding:7px 11px; }
  .settings-btn--on { border-color:rgba(247,147,26,.4)!important; color:var(--orange)!important; }

  @media (max-width:700px) {
    .hdr { height:54px; padding:0 16px; gap:12px; }
    .hdr--scrolled { height:46px; }
    .hdr-clock { display:none; }
    .nav-link { padding:6px 10px; font-size:.6rem; }
    .brand-name { font-size:.85rem; }
    .globe-wrap { width:24px; height:24px; }
  }
  @media (max-width:480px) {
    .nav-link span.nav-ico { display:none; }
  }

  /* SETTINGS DRAWER */
  .drawer { background:rgba(8,8,8,.97); backdrop-filter:blur(24px); border-bottom:1px solid rgba(247,147,26,.15); position:relative; z-index:200; }
  .drawer-inner { max-width:900px; margin:0 auto; padding:28px 24px; display:flex; flex-direction:column; gap:22px; }
  .dg-hd { font-size:.72rem; font-weight:600; color:rgba(255,255,255,.5); margin-bottom:12px; display:flex; align-items:center; gap:8px; font-family:'Orbitron',monospace; letter-spacing:.06em; text-transform:uppercase; }
  .dhint { font-size:.62rem; color:rgba(255,255,255,.2); font-weight:400; font-family:'Inter',sans-serif; text-transform:none; letter-spacing:0; }
  .dfields { display:flex; gap:10px; flex-wrap:wrap; }
  .df { display:flex; flex-direction:column; gap:5px; flex:1; min-width:100px; }
  .dlbl { font-size:.58rem; color:rgba(255,255,255,.25); font-weight:500; text-transform:uppercase; letter-spacing:.1em; }
  .dinp { width:100%; background:rgba(255,255,255,.04); border:1px solid rgba(255,94,0,.22); border-radius:3px; padding:10px 12px; color:#eaeaea; font-family:'Inter',sans-serif; font-size:.82rem; transition:border-color .2s,box-shadow .2s; }
  .dinp:focus { outline:none; border-color:var(--orange); box-shadow:0 0 0 2px rgba(247,147,26,.15),0 0 16px rgba(247,147,26,.2); }
  .dtags { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
  .dtag { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; background:rgba(247,147,26,.07); border:1px solid rgba(247,147,26,.2); border-radius:3px; font-size:.68rem; color:rgba(255,255,255,.55); }
  .dtag-x { background:none; border:none; color:rgba(255,255,255,.25); cursor:pointer; font-size:1rem; padding:0; line-height:1; transition:color .15s; }
  .dtag-x:hover { color:var(--dn); }
  .dinp-row { display:flex; gap:8px; }
  .dsrcs { max-height:68px; overflow-y:auto; margin-bottom:8px; }
  .dsrc { display:flex; justify-content:space-between; align-items:center; padding:3px 0; font-size:.62rem; color:rgba(255,255,255,.25); }
  .dsrc-url { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:300px; }
  .d-save--ok { background:linear-gradient(45deg,#22c55e,#15803d)!important; }
  @media (max-width:600px) { .drawer-inner{padding:18px 14px;} .dfields{flex-direction:column;} }

  .page-wrap { padding-top: 64px; min-height: 100vh; }
  @media (max-width:700px) { .page-wrap { padding-top: 54px; } }

  /* FOOTER */
  .site-footer { border-top:1px solid rgba(247,147,26,.12); padding:18px 32px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; background:rgba(0,0,0,.5); }
  .footer-brand { font-family:'Orbitron',monospace; font-size:.62rem; font-weight:900; color:rgba(255,255,255,.25); letter-spacing:.1em; }
  .footer-sources { font-size:.56rem; color:rgba(255,255,255,.14); }
  @media (max-width:600px) { .site-footer{display:none;} }

  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  :global(.blink) { animation:blink 2s step-end infinite; }
</style>
