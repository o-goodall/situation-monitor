<script lang="ts">
  import { settings, saved, lightMode, persistSettings } from '$lib/store';
  import SettingsPersonalizationToggle from '$lib/SettingsPersonalizationToggle.svelte';
  import type { FeedCategory } from '$lib/settings';

  let showDcaFormula = false;
  let newSource = '';
  let newSourceName = '';

  const FEED_CATEGORIES: { key: FeedCategory; label: string; hint: string }[] = [
    { key: 'global',   label: '🌍 Global / Major News', hint: 'Breaking world events' },
    { key: 'business', label: '📈 Business & Markets',  hint: 'Finance & economy' },
    { key: 'tech',     label: '💻 Technology',           hint: 'Tech news & innovation' },
    { key: 'security', label: '🛡 Security & Defence',   hint: 'Cyber & geopolitical risk' },
    { key: 'crypto',   label: '₿ Crypto',                hint: 'Cryptocurrency news' },
  ];

  function toggleCategory(cat: FeedCategory) {
    const anyEnabled = $settings.news.defaultFeeds.some(f => f.category === cat && f.enabled);
    $settings.news.defaultFeeds = $settings.news.defaultFeeds.map(f => f.category === cat ? { ...f, enabled: !anyEnabled } : f);
  }
  function toggleCustomFeed(i: number) { $settings.news.customFeeds[i].enabled = !$settings.news.customFeeds[i].enabled; $settings.news.customFeeds = [...$settings.news.customFeeds]; }
  function removeSource(i: number) { $settings.news.customFeeds = $settings.news.customFeeds.filter((_,j)=>j!==i); }
  function handleAddSource() {
    if (newSource.trim()) {
      const name = newSourceName.trim() || (() => { try { return new URL(newSource.trim()).hostname.replace('www.','').replace('feeds.',''); } catch { return 'Custom'; } })();
      $settings.news.customFeeds = [...$settings.news.customFeeds, { url: newSource.trim(), name, enabled: true }];
      newSource = ''; newSourceName = '';
    }
  }
  function saveAll() { persistSettings($settings); }
  function toggleLightMode() { $lightMode = !$lightMode; try { localStorage.setItem('sm_lightMode', String($lightMode)); } catch {} }
  $: if (typeof document !== 'undefined') { document.documentElement.classList.toggle('light', $lightMode); }
</script>

<div class="settings-page">
  <div class="settings-page-header">
    <h2 class="settings-page-title">Settings</h2>
  </div>
  <div class="settings-page-body">
    <div class="mob-appearance-row">
      <span class="mob-appearance-label">Appearance</span>
      <button class="mob-theme-btn" on:click={toggleLightMode} aria-label="Switch to {$lightMode ? 'dark' : 'light'} mode">
        {#if $lightMode}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          Dark
        {:else}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          Light
        {/if}
      </button>
    </div>
    <div class="mobile-settings">
      <div class="dg"><p class="dg-hd">DCA Stack</p>
        <div class="dfields">
          <label class="df"><span class="dlbl">Low Price (USD)</span><input type="number" bind:value={$settings.dca.lowPrice} class="dinp"/></label>
          <label class="df"><span class="dlbl">High Price (USD)</span><input type="number" bind:value={$settings.dca.highPrice} class="dinp"/></label>
          <label class="df"><span class="dlbl">Max DCA (AUD)</span><input type="number" bind:value={$settings.dca.maxDcaAud} class="dinp"/></label>
          <label class="df"><span class="dlbl">DCA Frequency</span>
            <select bind:value={$settings.dca.dcaFrequency} class="dinp">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
        <button class="dca-explain-btn" on:click={() => showDcaFormula = !showDcaFormula} aria-expanded={showDcaFormula}>
          {showDcaFormula ? '▴ Hide Explanation' : '? Explanation'}
        </button>
        {#if showDcaFormula}
        <div class="dca-formula-box">
          <ol class="formula-steps">
            <li><strong>Price position</strong> — 100% allocation at your low price target, tapering linearly to 0% at high.</li>
            <li><strong>Signal boosts</strong> increase allocation when conditions are favourable:
              <ul>
                <li>Fear &amp; Greed ≤ 40 → <span class="formula-boost">+10%</span> <span class="dim">(≤ 20 → +20%)</span></li>
                <li>Mining difficulty drop &gt; 5% → <span class="formula-boost">+10%</span></li>
                <li>Futures funding rate negative → <span class="formula-boost">+10%</span></li>
                <li>Within 365 days of halving → <span class="formula-boost">+10%</span></li>
              </ul>
            </li>
            <li><strong>Final amount</strong> = Max DCA × price% × (1 + boosts%). Rounded to nearest $50 AUD.</li>
            <li>Price above your high target → <strong style="color:var(--dn);">PASS</strong>.</li>
          </ol>
        </div>
        {/if}
      </div>
      <div class="dg"><p class="dg-hd">Display Currency <span class="dhint">BTC price second currency</span></p>
        <div class="dfields" style="align-items:flex-end;">
          <label class="df" style="max-width:120px;">
            <span class="dlbl">Currency code</span>
            <input bind:value={$settings.displayCurrency} placeholder="AUD" class="dinp" style="text-transform:uppercase;" maxlength="3"/>
          </label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;padding-bottom:2px;">
            {#each ['AUD','EUR','GBP','CAD','JPY','CHF','NZD','SGD'] as c}
              <button class="curr-preset" class:curr-preset--active={($settings.displayCurrency||'AUD').toUpperCase()===c}
                on:click={()=>$settings.displayCurrency=c}>{c}</button>
            {/each}
          </div>
        </div>
      </div>
      <div class="dg"><p class="dg-hd">News Feeds <span class="dhint">toggle categories on/off</span></p>
        <div class="feed-list" style="margin-bottom:8px;">
          {#each FEED_CATEGORIES as cat}
            {@const anyEnabled = $settings.news.defaultFeeds.some(f => f.category === cat.key && f.enabled)}
            <label class="feed-toggle" title={cat.hint}>
              <input type="checkbox" checked={anyEnabled} on:change={() => toggleCategory(cat.key)} />
              <span class="feed-name">{cat.label}</span>
            </label>
          {/each}
        </div>
        {#if $settings.news.customFeeds.length>0}
        <div class="feed-list" style="margin-top:6px;">
          {#each $settings.news.customFeeds as feed, i}
            <div class="feed-custom">
              <label class="feed-toggle">
                <input type="checkbox" checked={feed.enabled} on:change={()=>toggleCustomFeed(i)} />
                <span class="feed-name">{feed.name}</span>
              </label>
              <button on:click={()=>removeSource(i)} class="dtag-x" aria-label="Remove {feed.name}">×</button>
            </div>
          {/each}
        </div>
        {/if}
        <p class="dlbl" style="margin:12px 0 6px;">Add Custom Feed</p>
        <div class="dinp-row"><input type="url" bind:value={newSource} on:keydown={(e)=>e.key==='Enter'&&handleAddSource()} placeholder="https://example.com/feed.xml" class="dinp" style="flex:2;"/><input bind:value={newSourceName} placeholder="Feed name (optional)" class="dinp" style="flex:1;"/><button on:click={handleAddSource} class="btn-ghost" style="white-space:nowrap;">Add</button></div>
      </div>
      <div class="dg"><p class="dg-hd">Ghostfolio Token <span class="dhint">token stored locally</span></p>
        <div class="dfields" style="max-width:500px;">
          <label class="df" style="flex:3;"><span class="dlbl">Security token</span><input type="password" bind:value={$settings.ghostfolio.token} placeholder="your-security-token" class="dinp"/></label>
          <label class="df"><span class="dlbl">Currency</span><input bind:value={$settings.ghostfolio.currency} placeholder="AUD" class="dinp" style="max-width:80px;"/></label>
        </div>
      </div>
      <div class="dg"><p class="dg-hd">Personalization</p>
        <SettingsPersonalizationToggle />
      </div>
      <button on:click={saveAll} class="btn-primary" class:d-save--ok={$saved} style="width:100%;margin-top:8px;">{$saved?'✓ Saved':'Save Settings'}</button>
    </div>
  </div>
</div>

<style>
  .settings-page { max-width: 600px; margin: 0 auto; padding: 20px 16px 80px; }
  .settings-page-header { margin-bottom: 20px; }
  .settings-page-title { font-size: 1.1rem; font-weight: 700; color: var(--t1); }
  .settings-page-body { display: flex; flex-direction: column; }
</style>
