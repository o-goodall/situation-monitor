<script lang="ts">
  /**
   * Tile — standardized Liquid Glass card wrapper.
   *
   * Slots:
   *   default  — card body content
   *   header   — optional right-side controls placed in gc-head (e.g. refresh button)
   *
   * Props:
   *   title      — gc-title eyebrow text (omit to skip gc-head entirely)
   *   subtitle   — optional secondary line below the title
   *   extraClass — additional CSS classes forwarded to the root .gc element
   */
  export let title = '';
  export let subtitle = '';
  export let extraClass = '';
</script>

<div class="gc {extraClass}">
  {#if title || $$slots.header}
    <div class="gc-head">
      <div>
        {#if title}
          <p class="gc-title">{title}</p>
        {/if}
        {#if subtitle}
          <p class="ts" style="margin-top:2px;">{subtitle}</p>
        {/if}
      </div>
      {#if $$slots.header}
        <div style="display:flex;align-items:center;gap:8px;">
          <slot name="header" />
        </div>
      {/if}
    </div>
  {/if}
  <slot />
</div>
