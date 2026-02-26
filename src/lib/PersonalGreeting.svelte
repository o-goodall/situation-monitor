<script lang="ts">
  import { onMount } from 'svelte';
  import { getStoredSettings, getGreetingByTime } from './personalization';

  let greeting  = '';
  let username  = '';

  onMount(() => {
    const s = getStoredSettings();
    username = s.username;
    greeting = getGreetingByTime();
  });
</script>

<div class="pg-wrap" aria-label="Personal greeting">
  <p class="pg-greeting">{greeting}, <span class="pg-name">{username}</span>.</p>
</div>

<style>
  .pg-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: transparent;
  }
  .pg-greeting {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
    color: rgba(255, 255, 255, 0.92);
  }
  .pg-name {
    color: #F7931A;
  }

  /* Light mode overrides */
  :global(.light-mode) .pg-greeting { color: rgba(0, 0, 0, 0.85); }
  :global(.light-mode) .pg-name     { color: #c77a10; }
</style>
