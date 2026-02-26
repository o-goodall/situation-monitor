<!--
  LiquidGlassTile — fixed Apple-style liquid glass tile.
  Drop content inside the default slot; styling is non-configurable.
-->
<div class="lg-tile">
  <!-- gradient sheen overlay -->
  <div class="lg-sheen" aria-hidden="true"></div>
  <slot />
</div>

<style>
  .lg-tile {
    position: relative;
    /* ~25% opacity white background — reads equally well on dark & light backdrops */
    background: rgba(255, 255, 255, 0.25);
    /* Apple liquid-glass blur + saturation boost */
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
    /* Soft border */
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 16px;
    /* Subtle depth shadow */
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 0.55);
    /* Ensure content layers above the sheen */
    overflow: hidden;
    /* Smooth interactions */
    transition: box-shadow 0.25s ease, border-color 0.25s ease, transform 0.2s ease;
  }

  .lg-tile:hover {
    transform: translateY(-2px);
    border-color: rgba(255, 255, 255, 0.5);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.65);
  }

  /* Diagonal gradient sheen — mimics Apple's light-refraction highlight */
  .lg-sheen {
    pointer-events: none;
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.18) 0%,
      rgba(255, 255, 255, 0.04) 50%,
      transparent 100%
    );
    border-radius: inherit;
    z-index: 0;
  }

  /* Ensure slotted content sits above the sheen */
  .lg-tile > :global(*:not(.lg-sheen)) {
    position: relative;
    z-index: 1;
  }

  /* Responsive: tighten border-radius on small screens */
  @media (max-width: 600px) {
    .lg-tile {
      border-radius: 12px;
      /* Reduce blur cost on mobile GPUs */
      backdrop-filter: blur(12px) saturate(160%);
      -webkit-backdrop-filter: blur(12px) saturate(160%);
    }
  }
</style>
