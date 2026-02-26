<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { activeSection } from '$lib/store';

  const country = $page.params.country;

  interface Story {
    title: string;
    summary: string;
    casualties: number | null;
    date: string;
    link: string;
    source: string;
  }

  interface ThreatData {
    country: string;
    severity: 'extreme' | 'high' | 'turbulent';
    stories: Story[];
    isTrending: boolean;
  }

  let threat: ThreatData | null = null;
  let loading = true;
  let error = '';

  const SEVERITY_COLOR: Record<string, string> = {
    extreme: '#b91c1c',
    high: '#f97316',
    turbulent: '#eab308',
  };

  const SEVERITY_LABEL: Record<string, string> = {
    extreme: 'Extreme',
    high: 'High',
    turbulent: 'Turbulent',
  };

  function ago(d: string): string {
    try {
      const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
      return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
    } catch { return ''; }
  }

  function goBack() {
    $activeSection = 'intel';
    // On desktop the global monitor is at '/'; '/intel' only exists as a mobile route
    if (window.innerWidth > 768) {
      goto('/');
    } else {
      goto('/intel', { replaceState: true });
    }
  }

  afterNavigate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  });

  onMount(async () => {
    try {
      const res = await fetch('/api/global-threats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const found = data.threats?.find((t: ThreatData) =>
        t.country.toLowerCase() === country.toLowerCase()
      );
      if (found) {
        threat = found;
      } else {
        error = `No data found for "${country}".`;
      }
    } catch (e) {
      error = 'Failed to load threat data.';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>{country} — Intel</title>
</svelte:head>

<div class="country-page">
  <div class="country-inner">
    {#if loading}
      <div class="state-wrap">
        <span class="spinner"></span>
        <span class="state-text">Loading…</span>
      </div>
    {:else if error}
      <div class="state-wrap">
        <p class="err-msg">{error}</p>
        <button class="back-btn" on:click={goBack}>← Return to Intel</button>
      </div>
    {:else if threat}
      <div class="country-header">
        <button class="back-btn" on:click={goBack} aria-label="Back to Intel">← Back</button>
        <h1 class="country-name">{threat.country}</h1>
        {#if threat.severity}
          <span class="severity-badge" style="background:{SEVERITY_COLOR[threat.severity]}22;border-color:{SEVERITY_COLOR[threat.severity]}55;color:{SEVERITY_COLOR[threat.severity]};">
            {#if threat.isTrending}🔥 Trending · {/if}{SEVERITY_LABEL[threat.severity] ?? threat.severity}
          </span>
        {/if}
      </div>

      {#if threat.stories.length === 0}
        <p class="no-stories">No recent stories for this region. Check back later.</p>
      {:else}
        <p class="story-count">{threat.stories.length} recent {threat.stories.length === 1 ? 'story' : 'stories'}</p>
        <div class="stories-list">
          {#each threat.stories as story}
            <a
              href={story.link}
              target="_blank"
              rel="noopener noreferrer"
              class="story-card"
              aria-label="{story.title}"
            >
              <div class="story-meta">
                <span class="story-source">{story.source}</span>
                <span class="story-age">{ago(story.date)}</span>
                {#if story.casualties !== null}
                  <span class="story-cas">~{story.casualties} casualties</span>
                {/if}
              </div>
              <p class="story-title">{story.title}</p>
              {#if story.summary}
                <p class="story-summary">{story.summary}</p>
              {/if}
            </a>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .country-page {
    min-height: 100vh;
    background: var(--bg, #0a0f1a);
    padding: 0 0 80px;
  }
  .country-inner {
    max-width: 700px;
    margin: 0 auto;
    padding: 24px 20px;
  }
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 1px solid rgba(255,255,255,.15);
    border-radius: 6px;
    color: rgba(255,255,255,.6);
    font-size: .75rem;
    padding: 6px 12px;
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color .15s, color .15s;
  }
  .back-btn:hover {
    border-color: rgba(255,255,255,.35);
    color: rgba(255,255,255,.9);
  }
  .country-header {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 20px;
    padding-top: 8px;
  }
  .country-name {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    color: rgba(255,255,255,.92);
    line-height: 1.1;
  }
  .severity-badge {
    font-size: .65rem;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    padding: 3px 10px;
    border-radius: 4px;
    border: 1px solid;
    white-space: nowrap;
  }
  .story-count {
    font-size: .7rem;
    color: rgba(255,255,255,.4);
    margin: 0 0 16px;
  }
  .no-stories {
    color: rgba(255,255,255,.4);
    font-size: .82rem;
    margin-top: 16px;
  }
  .stories-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .story-card {
    display: block;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 10px;
    padding: 14px 16px;
    text-decoration: none;
    transition: background .2s, border-color .2s;
  }
  .story-card:hover {
    background: rgba(255,255,255,.07);
    border-color: rgba(255,255,255,.16);
  }
  .story-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .story-source {
    font-size: .58rem;
    font-weight: 700;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: rgba(0,200,255,.7);
    font-family: monospace;
  }
  .story-age {
    font-size: .58rem;
    color: rgba(255,255,255,.35);
    font-family: monospace;
  }
  .story-cas {
    font-size: .58rem;
    color: #f87171;
    font-family: monospace;
  }
  .story-title {
    margin: 0 0 6px;
    font-size: .88rem;
    font-weight: 600;
    color: rgba(255,255,255,.88);
    line-height: 1.4;
  }
  .story-summary {
    margin: 0;
    font-size: .75rem;
    color: rgba(255,255,255,.5);
    line-height: 1.55;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .state-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 60px 0;
  }
  .spinner {
    width: 24px; height: 24px; border-radius: 50%;
    border: 2px solid rgba(247,147,26,.2);
    border-top-color: #f7931a;
    animation: spin .9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .state-text { font-size: .8rem; color: rgba(255,255,255,.4); }
  .err-msg { color: #f43f5e; font-size: .82rem; }

  /* Light mode */
  :global(.light-mode) .country-page { background: #f4f5f7; }
  :global(.light-mode) .country-name { color: rgba(0,0,0,.88); }
  :global(.light-mode) .story-card { background: rgba(0,0,0,.04); border-color: rgba(0,0,0,.08); }
  :global(.light-mode) .story-card:hover { background: rgba(0,0,0,.07); border-color: rgba(0,0,0,.14); }
  :global(.light-mode) .story-title { color: rgba(0,0,0,.85); }
  :global(.light-mode) .story-summary { color: rgba(0,0,0,.5); }
  :global(.light-mode) .back-btn { border-color: rgba(0,0,0,.15); color: rgba(0,0,0,.6); }
  :global(.light-mode) .back-btn:hover { border-color: rgba(0,0,0,.35); color: rgba(0,0,0,.9); }
</style>
