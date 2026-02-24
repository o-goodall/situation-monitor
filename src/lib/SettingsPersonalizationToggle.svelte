<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getStoredSettings,
    setPersonalizationEnabled,
    setUsername,
  } from './personalization';

  let enabled = false;

  let username = '';
  let showNameInput = false;
  let nameInputValue = '';

  onMount(() => {
    const s = getStoredSettings();
    enabled  = s.enabled;
    username = s.username;
  });

  function handleToggle() {
    enabled = !enabled;
    setPersonalizationEnabled(enabled);

    if (enabled && !username) {
      showNameInput = true;
    }
  }

  function saveName() {
    const trimmed = nameInputValue.trim();
    if (!trimmed) return;
    username = trimmed;
    setUsername(trimmed);
    showNameInput = false;
    nameInputValue = '';
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') saveName();
    if (e.key === 'Escape') { showNameInput = false; nameInputValue = ''; }
  }
</script>

<div class="spt-wrap">
  <label class="spt-label">
    <input
      type="checkbox"
      class="spt-checkbox"
      checked={enabled}
      on:change={handleToggle}
    />
    <span class="spt-text">Enable Personal Greeting &amp; Weather</span>
  </label>

  {#if showNameInput}
    <div class="spt-name-row">
      <input
        class="spt-name-inp"
        type="text"
        bind:value={nameInputValue}
        placeholder="Your name"
        on:keydown={handleNameKeydown}
        autofocus
        maxlength="50"
      />
      <button class="spt-name-save" on:click={saveName}>Save</button>
    </div>
  {:else if enabled && username}
    <p class="spt-hint">Greeting shown as: {username}</p>
  {/if}
</div>

<style>
  .spt-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .spt-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }
  .spt-checkbox {
    width: 14px;
    height: 14px;
    accent-color: var(--accent, #f7931a);
    cursor: pointer;
    flex-shrink: 0;
  }
  .spt-text {
    font-size: 13px;
    color: var(--text, rgba(255,255,255,0.85));
    line-height: 1.4;
  }
  .spt-name-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .spt-name-inp {
    flex: 1;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 4px;
    color: rgba(255,255,255,0.9);
    font-size: 13px;
    padding: 5px 8px;
    outline: none;
    transition: border-color .15s;
    min-width: 0;
  }
  .spt-name-inp:focus { border-color: var(--accent, #f7931a); }
  .spt-name-save {
    background: var(--accent, #f7931a);
    color: #000;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 12px;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity .15s;
  }
  .spt-name-save:hover { opacity: 0.85; }
  .spt-hint {
    margin: 0;
    font-size: 12px;
    color: rgba(255,255,255,0.45);
  }
</style>
