<script lang="ts">
  import { markets, marketsUpdated, newsItems } from '$lib/store';
  import WorldMap from '$lib/WorldMap.svelte';
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { browser } from '$app/environment';
  import { onDestroy } from 'svelte';

  // ── MODAL STATE ──────────────────────────────────────────────
  let openModal: 'news' | 'polymarket' | null = null;
  let newsLoaded = false;
  let polyLoaded = false;
  let modalOriginX = '50%';
  let modalOriginY = '50%';

  $: if (openModal === 'news') newsLoaded = true;
  $: if (openModal === 'polymarket') polyLoaded = true;

  // Prevent body scroll while modal is open
  $: if (browser) document.body.style.overflow = openModal !== null ? 'hidden' : '';
  onDestroy(() => { if (browser) document.body.style.overflow = ''; });

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

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) closeModal();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && openModal !== null) {
      e.preventDefault();
      closeModal();
    }
  }

  const INTEL_TILE_LIMIT = 12;

  const POLY_CONFLICT_RE = /war|attack|strike|missile|invasion|troops|military|conflict|bomb|nuclear|airstrike|assault|drone|ceasefire|hostage|coup|crisis/i;
  $: polymarketThreats = $markets.filter(m =>
    m.trending && m.probability >= 50 && POLY_CONFLICT_RE.test(m.question)
  ).map(m => ({ question: m.question, url: m.url, probability: m.probability, topOutcome: m.topOutcome }));

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

<svelte:window on:keydown={handleKeydown} />

<section id="intel" class="section" aria-label="Intel">
  <div class="section-header">
    <h2 class="sect-title">Intel</h2>
  </div>

  <div class="intel-dashboard-grid">
    <!-- ── GLOBE: Global Threat Monitor (always visible) ── -->
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

    <!-- ── SUMMARY TILES ROW: News + Poly Market ── -->
    <div class="intel-summary-row">

      <!-- News tile -->
      <button
        class="gc intel-summary-tile"
        on:click={(e) => handleTileClick('news', e)}
        aria-haspopup="dialog"
        aria-label="Open News Feed"
      >
        <div class="gc-head" style="margin-bottom:6px;">
          <p class="gc-title">News Feed</p>
          {#if $newsItems.length > 0}
            <span class="dim" style="font-size:.58rem;">{$newsItems.length} articles</span>
          {/if}
        </div>
        {#if $newsItems.length > 0}
          <div class="intel-tile-preview">
            {#each $newsItems.slice(0, 3) as item}
              <div class="intel-tile-preview-item">
                <span class="pm-tag pm-news-src" style="width:fit-content;">{item.source}</span>
                <span class="intel-tile-preview-title">{item.title}</span>
              </div>
            {/each}
          </div>
        {:else}
          <p class="dim" style="font-size:.75rem;flex:1;">Fetching RSS feeds…</p>
        {/if}
        <div class="intel-tile-open-hint">Open ↗</div>
      </button>

      <!-- Poly Market tile -->
      <button
        class="gc intel-summary-tile"
        on:click={(e) => handleTileClick('polymarket', e)}
        aria-haspopup="dialog"
        aria-label="Open Poly Market"
      >
        <div class="gc-head" style="margin-bottom:6px;">
          <p class="gc-title">Poly Market</p>
          {#if $marketsUpdated}
            <span class="dim" style="font-size:.58rem;">{$marketsUpdated}</span>
          {/if}
        </div>
        {#if $markets.length > 0}
          {@const top = $markets[0]}
          <div class="intel-tile-preview">
            <div class="intel-tile-preview-item">
              <span class="pm-tag" style="width:fit-content;">{top.tag || 'Market'}</span>
              <span class="intel-tile-preview-title">{top.question}</span>
            </div>
            <div class="pm-binary-prob" style="margin-top:auto;">
              <span class="pm-binary-outcome" style="color:{pc(top.probability)};">{top.topOutcome}</span>
              <span class="pm-binary-pct" style="color:{pc(top.probability)};">{top.probability}%</span>
            </div>
          </div>
        {:else}
          <p class="dim" style="font-size:.75rem;flex:1;">Loading markets…</p>
        {/if}
        <div class="intel-tile-open-hint">Open ↗</div>
      </button>

    </div>
  </div>

  <!-- ── TILE MODALS ── -->
  {#if openModal !== null}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="tile-modal-backdrop"
      on:click={handleBackdropClick}
      transition:fade={{ duration: 180 }}
    >
      <div
        class="gc tile-modal"
        style="transform-origin: {modalOriginX} {modalOriginY};"
        role="dialog"
        aria-modal="true"
        aria-label={openModal === 'news' ? 'News Feed' : 'Poly Market'}
        transition:scale={{ duration: 320, start: 0.78, easing: backOut }}
      >
        <button class="tile-modal-close" on:click={closeModal} aria-label="Close modal">✕</button>

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
                  <div class="pm-card-frosted-overlay"></div>
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
                  <p class="pm-card-q" style="position:relative;z-index:1;">{m.question}</p>
                  <div class="pm-binary-prob" style="position:relative;z-index:1;">
                    <span class="pm-binary-outcome" style="color:{pc(topPct)};" aria-label="Leading outcome: {topOutcome}">{topOutcome}</span>
                    <span class="pm-binary-pct" style="color:{pc(topPct)};" aria-label="Probability: {topPct} percent">{topPct}%</span>
                  </div>
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
                  <div class="pm-card-prob-bar" style="position:relative;z-index:1;">
                    <div class="pm-prob-fill" style="width:{topPct}%;background:{pc(topPct)};"></div>
                  </div>
                </a>
              {/each}
            </div>
          {/if}
        {/if}

      </div>
    </div>
  {/if}

</section>
