<script lang="ts">
  import { markets, marketsUpdated, newsItems } from '$lib/store';
  import WorldMap from '$lib/WorldMap.svelte';
  import Modal from '$lib/components/Modal.svelte';

  // ── MODAL STATE ──────────────────────────────────────────────
  let openModal: 'news' | 'polymarket' | null = null;
  let newsLoaded = false;
  let polyLoaded = false;
  let modalOriginX = '50%';
  let modalOriginY = '50%';

  $: if (openModal === 'news') newsLoaded = true;
  $: if (openModal === 'polymarket') polyLoaded = true;

  function handleTileClick(tile: 'news' | 'polymarket', e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Approximate modal dimensions to compute transform-origin relative to modal box
    const modalW = Math.min(window.innerWidth * 0.92, 920);
    const modalH = window.innerHeight * 0.82;
    const modalLeft = (window.innerWidth - modalW) / 2;
    const modalTop  = (window.innerHeight - modalH) / 2;
    const originX = rect.left + rect.width  / 2 - modalLeft;
    const originY = rect.top  + rect.height / 2 - modalTop;
    modalOriginX = `${Math.round(Math.max(0, Math.min(modalW, originX)))}px`;
    modalOriginY = `${Math.round(Math.max(0, Math.min(modalH, originY)))}px`;
    openModal = tile;
  }

  function closeModal() { openModal = null; }

  const INTEL_TILE_LIMIT = 12;

  const POLY_CONFLICT_RE = /war|attack|strike|missile|invasion|troops|military|conflict|bomb|nuclear|airstrike|assault|drone|ceasefire|hostage|coup|crisis/i;
  $: polymarketThreats = $markets.filter(m =>
    m.trending && m.probability >= 50 && POLY_CONFLICT_RE.test(m.question)
  ).map(m => ({ question: m.question, url: m.url, probability: m.probability, topOutcome: m.topOutcome }));

  function fmtEndDate(daysLeft: number | null, endDate: string): string {
    if (daysLeft === null) return '';
    if (daysLeft < 0) return 'Closed';
    if (daysLeft === 0) return 'Closes today';
    if (daysLeft <= 30) return `${daysLeft}d left`;
    try {
      return 'Resolves ' + new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  const ago = (d:string) => {try{const m=Math.floor((Date.now()-new Date(d).getTime())/60000);return m<60?`${m}m`:m<1440?`${Math.floor(m/60)}h`:`${Math.floor(m/1440)}d`;}catch{return '';}};
  const pc  = (p:number) => p>=70?'var(--up)':p>=40?'var(--orange)':'var(--dn)';
</script>

<section id="intel" class="section" aria-label="Intel">
  <div class="section-header">
    <h2 class="sect-title">Intel</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-left:auto;">
      <button class="btn-ghost" on:click={(e) => handleTileClick('news', e)} aria-haspopup="dialog" aria-label="Open news feed modal">News</button>
      <button class="btn-ghost" on:click={(e) => handleTileClick('polymarket', e)} aria-haspopup="dialog" aria-label="Open Poly Market predictions modal">Markets</button>
    </div>
  </div>

  <!-- ── GLOBE: Global Threat Monitor ── -->
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

  <!-- ── TILE MODALS ── -->
  <Modal
    open={openModal !== null}
    label={openModal === 'news' ? 'News Feed' : 'Geopolitics'}
    originX={modalOriginX}
    originY={modalOriginY}
    on:close={closeModal}
  >
        <!-- ── NEWS MODAL CONTENT (lazy) ── -->
        {#if openModal === 'news' && newsLoaded}
          <div class="gc-head" style="margin-bottom:16px;">
            <p class="gc-title">News Feed</p>
            <span class="dim">{Math.min($newsItems.length, INTEL_TILE_LIMIT)} articles</span>
          </div>
          {#if $newsItems.length === 0}
            <p class="dim">Fetching RSS feeds…</p>
          {:else}
            <div class="pm-grid news-pm-grid">
              {#each $newsItems.slice(0, INTEL_TILE_LIMIT) as item}
                <a href={item.link} target="_blank" rel="noopener noreferrer" class="pm-card pm-card--intel" aria-label="{item.title}">
                  <div class="pm-card-tags">
                    <span class="pm-tag pm-news-src">{item.source}</span>
                    <span class="pm-tag">{ago(item.pubDate)} ago</span>
                  </div>
                  <p class="pm-card-q">{item.title}</p>
                </a>
              {/each}
            </div>
          {/if}
        {/if}

        <!-- ── POLY MARKET MODAL CONTENT (lazy) ── -->
        {#if openModal === 'polymarket' && polyLoaded}
          <div class="gc-head" style="margin-bottom:16px;">
            <div>
              <p class="gc-title">Geopolitics</p>
              {#if $marketsUpdated}<p class="dim" style="margin-top:3px;">Updated {$marketsUpdated}</p>{/if}
            </div>
            <a href="https://polymarket.com/markets/geopolitics" target="_blank" rel="noopener noreferrer" class="btn-ghost" aria-label="Open Polymarket Geopolitics in new tab">polymarket.com ↗</a>
          </div>
          {#if $markets.length === 0}
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
                  <div class="pm-card-tags">
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
                  <p class="pm-card-q">{m.question}</p>
                  <div class="pm-binary-prob">
                    <span class="pm-binary-outcome" style="color:{pc(topPct)};" aria-label="Leading outcome: {topOutcome}">{topOutcome}</span>
                    <span class="pm-binary-pct" style="color:{pc(topPct)};" aria-label="Probability: {topPct} percent">{topPct}%</span>
                  </div>
                  {#if m.outcomes.length > 2}
                    <div class="pm-secondary-outcomes" aria-label="Other contenders">
                      {#each m.outcomes.slice(1, 4) as o}
                        <span class="pm-secondary-item">
                          <span class="pm-secondary-name">{o.name}</span>
                          <span class="pm-secondary-pct" style="color:{pc(o.probability)};">{o.probability}%</span>
                        </span>
                      {/each}
                    </div>
                  {/if}
                  <div class="pm-card-prob-bar">
                    <div class="pm-prob-fill" style="width:{topPct}%;background:{pc(topPct)};"></div>
                  </div>
                </a>
              {/each}
            </div>
          {/if}
        {/if}

  </Modal>

</section>
