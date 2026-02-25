<script lang="ts">
  import { onMount } from 'svelte';
  import DotIndicator from './DotIndicator.svelte';

  // ── Types ─────────────────────────────────────────────────────────────────
  interface GlobalSignal {
    date: string;
    defcon: number;
    label: string;
    report_count: number;
    country_count: number;
    summary: string;
    updated_at: string;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let signal: GlobalSignal | null = null;
  let loading = true;
  let error = false;

  // ── DEFCON color palette ──────────────────────────────────────────────────
  const DEFCON_COLORS: Record<number, string> = {
    5: 'rgba(255,255,255,0.80)',
    4: 'rgba(247,147,26,0.50)',
    3: '#F7931A',
    2: '#D4740A',
    1: '#F7931A'
  };

  const DEFCON_GLOW: Record<number, string> = {
    5: 'none',
    4: 'none',
    3: 'none',
    2: 'none',
    1: '0 0 24px rgba(247,147,26,0.45)'
  };

  $: defconColor = DEFCON_COLORS[signal?.defcon ?? 5] ?? DEFCON_COLORS[5];
  $: defconGlow  = DEFCON_GLOW[signal?.defcon ?? 5] ?? 'none';

  // ── Fetch ──────────────────────────────────────────────────────────────────
  onMount(async () => {
    try {
      const res = await fetch('/api/global-signal');
      if (!res.ok) throw new Error('Bad response');
      signal = await res.json();
    } catch {
      error = true;
    } finally {
      loading = false;
    }
  });

  // ── Format updated_at ─────────────────────────────────────────────────────
  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });
    } catch {
      return iso;
    }
  }
</script>

<div class="card">
  <!-- Header label -->
  <p class="eyebrow">Global Signal</p>

  {#if loading}
    <div class="skeleton defcon-number">—</div>
  {:else if error || !signal}
    <p class="defcon-number" style="color: rgba(255,255,255,0.80)">—</p>
    <p class="defcon-label">Unavailable</p>
  {:else}
    <!-- DEFCON level -->
    <p
      class="defcon-number"
      style="color: {defconColor}; text-shadow: {defconGlow};"
    >
      DEFCON {signal.defcon}
    </p>

    <!-- Label -->
    <p class="defcon-label">{signal.label}</p>

    <!-- Dot indicator -->
    <div class="dots">
      <DotIndicator defcon={signal.defcon} animated={true} />
    </div>

    <!-- Summary -->
    <p class="summary">{signal.summary}</p>

    <!-- Updated time -->
    <p class="updated">Updated {formatTime(signal.updated_at)}</p>
  {/if}
</div>

<style>
  .card {
    background: rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    padding: 32px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .eyebrow {
    font-size: 12px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.60);
    margin: 0;
  }

  .defcon-number {
    font-size: clamp(48px, 6vw, 56px);
    font-weight: 500;
    line-height: 1;
    margin: 0;
    transition: color 0.4s ease, text-shadow 0.4s ease;
  }

  .defcon-label {
    font-size: clamp(18px, 2.5vw, 20px);
    color: rgba(255, 255, 255, 0.80);
    margin: 0;
  }

  .dots {
    margin-top: 4px;
  }

  .summary {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.60);
    margin: 4px 0 0;
    line-height: 1.5;
  }

  .updated {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.50);
    margin: 0;
  }

  .skeleton {
    color: transparent;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }

  /* Mobile */
  @media (max-width: 640px) {
    .card {
      padding: 24px;
    }
  }
</style>
