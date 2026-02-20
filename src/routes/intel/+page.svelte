<script lang="ts">
  import { markets, newsItems } from '$lib/store';

  const fmtVol  = (v: number) => v>=1e6 ? `$${(v/1e6).toFixed(1)}m` : v>=1e3 ? `$${(v/1e3).toFixed(0)}k` : `$${v}`;
  const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'}); } catch { return ''; } };
  const pColor  = (p: number) => p>=70?'#22c55e':p>=40?'#f7931a':'#f43f5e';
  const timeAgo = (d: string) => { try { const m=Math.floor((Date.now()-new Date(d).getTime())/60000); return m<60?`${m}m`:m<1440?`${Math.floor(m/60)}h`:`${Math.floor(m/1440)}d`; } catch { return ''; } };
</script>

<!-- HERO -->
<section class="hero">
  <div class="hero-inner">
    <p class="hero-eyebrow">Markets · News · Intelligence</p>
    <h1 class="hero-title">INTEL FEED</h1>
    <p class="hero-desc">Live prediction markets and news curated for Bitcoin investors.</p>
  </div>
</section>

<!-- GRID -->
<div class="pg">

  <!-- POLYMARKET -->
  <div class="col-markets">
    <p class="sect-label">PREDICTION MARKETS</p>
    <div class="gc">
      <div class="card-head" style="margin-bottom:20px;">
        <div>
          <p class="ch-t">Live Markets</p>
          <p class="dim" style="margin-top:3px;">Crowd-sourced probability pricing</p>
        </div>
        <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" class="ch-link">Polymarket ↗</a>
      </div>

      {#if $markets.length === 0}
        <p class="dim" style="padding:8px 0;">Fetching live markets…</p>
      {:else}
        {#each $markets.slice(0,8) as m}
          <div class="mkt">
            <div class="mkt-meta">
              <span class="mkt-tag" class:mkt-tag--pin={m.pinned}>{m.pinned ? '★ Pinned' : m.tag}</span>
              {#if m.endDate}<span class="dim">{fmtDate(m.endDate)}</span>{/if}
            </div>
            <div class="mkt-body">
              <a href="{m.url}" target="_blank" rel="noopener noreferrer" class="mkt-q">{m.question}</a>
              <div class="mkt-prob-wrap">
                <span class="mkt-prob" style="color:{pColor(m.probability)};">{m.probability}</span>
                <span class="mkt-pct">%</span>
              </div>
            </div>
            <div class="mkt-track"><div class="mkt-fill" style="width:{m.probability}%; background:{pColor(m.probability)};"></div></div>
            <div class="mkt-foot">
              <span style="font-size:0.64rem; color:{pColor(m.probability)}; font-weight:500;">{m.topOutcome}</span>
              <span class="dim">{fmtVol(m.volume)}</span>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- NEWS -->
  <div class="col-news">
    <p class="sect-label">LATEST NEWS</p>
    <div class="gc">
      <div class="card-head" style="margin-bottom:20px;">
        <p class="ch-t">News Feed</p>
      </div>
      {#if $newsItems.length === 0}
        <p class="dim">Fetching RSS feeds…</p>
      {:else}
        {#each $newsItems as item}
          <div class="news">
            <a href={item.link} target="_blank" rel="noopener noreferrer" class="news-title">{item.title}</a>
            <div class="news-meta">
              <span class="news-src">{item.source}</span>
              <span class="dim">{timeAgo(item.pubDate)} ago</span>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

</div>

<style>
  .hero { padding:60px 24px 48px; text-align:center; position:relative; overflow:hidden; }
  .hero::before { content:''; position:absolute; top:50%; left:50%; width:60%; height:60%; background:radial-gradient(circle,rgba(247,147,26,0.04) 0%,transparent 70%); transform:translate(-50%,-50%); animation:hp 12s ease-in-out infinite; z-index:-1; }
  @keyframes hp { 0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.6} 50%{transform:translate(-50%,-50%) scale(1.4);opacity:1} }
  .hero-inner { max-width:600px; margin:0 auto; }
  .hero-eyebrow { font-size:.7rem; font-weight:500; color:var(--orange); text-transform:uppercase; letter-spacing:.3em; margin-bottom:18px; }
  .hero-title { font-size:clamp(1.8rem,5vw,3.8rem); font-weight:800; letter-spacing:-.025em; margin-bottom:16px; background:linear-gradient(135deg,#f7931a 0%,#ffd080 40%,#f7931a 70%,#e06000 100%); background-size:300% 300%; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; animation:tf 8s ease infinite; }
  @keyframes tf { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
  .hero-desc { font-size:.95rem; color:rgba(255,255,255,.4); line-height:1.7; font-weight:300; }

  .pg { display:grid; grid-template-columns:1fr 1fr; gap:14px; padding:0 14px 40px; max-width:1440px; margin:0 auto; align-items:start; }
  .col-markets, .col-news { display:flex; flex-direction:column; gap:14px; }
  @media (max-width:900px) { .pg { grid-template-columns:1fr; } }
  @media (max-width:600px) { .pg { padding:0 8px 40px; gap:8px; } }

  .sect-label { font-size:.64rem; font-weight:700; text-transform:uppercase; letter-spacing:.22em; background:linear-gradient(90deg,var(--orange),rgba(247,147,26,.5)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:4px; padding-left:2px; }
  .gc { background:rgba(255,255,255,.04); backdrop-filter:blur(28px) saturate(160%); -webkit-backdrop-filter:blur(28px) saturate(160%); border:1px solid rgba(255,255,255,.08); border-radius:22px; padding:28px; box-shadow:0 8px 40px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06); transition:transform .4s cubic-bezier(.4,0,.2,1),border-color .3s; }
  .gc:hover { transform:translateY(-4px); border-color:rgba(247,147,26,.15); }
  .eyebrow { font-size:.59rem; font-weight:500; text-transform:uppercase; letter-spacing:.12em; color:rgba(255,255,255,.22); }
  .dim { font-size:.62rem; color:rgba(255,255,255,.25); }
  .card-head { display:flex; justify-content:space-between; align-items:flex-start; }
  .ch-t { font-size:.84rem; font-weight:600; color:#f0f0f0; }
  .ch-link { font-size:.62rem; color:rgba(255,255,255,.25); text-decoration:none; transition:color .2s; }
  .ch-link:hover { color:var(--orange); }

  .mkt { padding:16px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  .mkt:last-child { border-bottom:none; padding-bottom:0; }
  .mkt-meta { display:flex; align-items:center; gap:8px; margin-bottom:9px; }
  .mkt-tag { font-size:.56rem; font-weight:600; text-transform:uppercase; letter-spacing:.08em; padding:2px 8px; border-radius:5px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); color:rgba(255,255,255,.3); }
  .mkt-tag--pin { background:rgba(247,147,26,.09); border-color:rgba(247,147,26,.22); color:var(--orange); }
  .mkt-body { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; }
  .mkt-q { font-size:.8rem; color:rgba(255,255,255,.55); line-height:1.5; flex:1; text-decoration:none; transition:color .2s; }
  .mkt-q:hover { color:#f0f0f0; }
  .mkt-prob-wrap { display:flex; align-items:baseline; gap:1px; white-space:nowrap; }
  .mkt-prob { font-size:1.8rem; font-weight:800; line-height:1; letter-spacing:-.03em; }
  .mkt-pct { font-size:.8rem; opacity:.55; }
  .mkt-track { height:2px; background:rgba(255,255,255,.05); border-radius:1px; overflow:hidden; margin:8px 0 5px; }
  .mkt-fill { height:100%; border-radius:1px; opacity:.5; transition:width .7s cubic-bezier(.4,0,.2,1); }
  .mkt-foot { display:flex; justify-content:space-between; align-items:center; }

  .news { padding:14px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  .news:last-child { border-bottom:none; }
  .news-title { display:block; font-size:.8rem; color:rgba(255,255,255,.55); text-decoration:none; line-height:1.52; margin-bottom:6px; transition:color .2s; }
  .news-title:hover { color:#f0f0f0; }
  .news-meta { display:flex; gap:10px; align-items:center; }
  .news-src { font-size:.6rem; color:var(--orange); font-weight:600; }
</style>
