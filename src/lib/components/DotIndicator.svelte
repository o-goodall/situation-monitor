<script lang="ts">
  // ── Props ─────────────────────────────────────────────────────────────────
  export let defcon: number = 5;
  export let animated: boolean = true;

  // ── 5 dots total; filled count = 6 - defcon (DEFCON 1 → 5 filled, 5 → 1) ─
  $: filledCount = 6 - defcon;
</script>

<div class="dot-row" aria-label="DEFCON {defcon} indicator">
  {#each { length: 5 } as _, i}
    <span
      class="dot"
      class:filled={i < filledCount}
      class:animate={animated}
      style="animation-delay: {animated ? i * 100 : 0}ms"
    ></span>
  {/each}
</div>

<style>
  .dot-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    flex-shrink: 0;
  }

  .dot.filled {
    background: rgba(247, 147, 26, 0.70); /* Bitcoin orange at 70% */
  }

  .dot.animate {
    opacity: 0;
    animation: fadein 200ms ease forwards;
  }

  @keyframes fadein {
    to { opacity: 1; }
  }
</style>
