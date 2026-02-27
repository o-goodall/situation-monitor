<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { browser } from '$app/environment';
  import { FOCUSABLE_SEL } from '$lib/focusable';

  /** Whether the modal is visible. */
  export let open = false;
  /** Accessible label surfaced as aria-label on the dialog element. */
  export let label = 'Dialog';
  /**
   * CSS transform-origin values used to drive the scale-in animation so the
   * modal appears to expand from the tile that triggered it.
   */
  export let originX = '50%';
  export let originY = '50%';

  const dispatch = createEventDispatcher<{ close: void }>();

  let panelEl: HTMLDivElement | null = null;
  /** Element that had focus before the modal opened — restored on close. */
  let returnFocusEl: HTMLElement | null = null;

  // Lock body scroll while modal is open.
  $: if (browser) {
    document.body.style.overflow = open ? 'hidden' : '';
  }

  /**
   * Svelte action: when the panel is mounted (i.e. modal just opened),
   * save the previously-focused element and move focus into the dialog.
   */
  function manageFocus(node: HTMLDivElement) {
    returnFocusEl = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      // The close button is always present, so `first` should never be null.
      // The `?? node` fallback targets the dialog panel (tabindex="-1") as a safe
      // last resort so that focus never escapes the dialog.
      const first = node.querySelector<HTMLElement>(FOCUSABLE_SEL);
      (first ?? node).focus();
    });
    return {
      destroy() {
        returnFocusEl?.focus();
        returnFocusEl = null;
      },
    };
  }

  /**
   * Svelte action: keep Tab / Shift+Tab cycling within the dialog panel.
   */
  function trapFocus(node: HTMLElement) {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)];
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    node.addEventListener('keydown', onKey);
    return { destroy() { node.removeEventListener('keydown', onKey); } };
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) dispatch('close');
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') {
      e.preventDefault();
      dispatch('close');
    }
  }

  onDestroy(() => {
    if (browser) document.body.style.overflow = '';
  });
</script>

<svelte:window on:keydown={handleWindowKeydown} />

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="tile-modal-backdrop"
    on:click={handleBackdropClick}
    transition:fade={{ duration: 180 }}
  >
    <div
      bind:this={panelEl}
      use:manageFocus
      use:trapFocus
      class="gc tile-modal"
      style="transform-origin: {originX} {originY};"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabindex="-1"
      transition:scale={{ duration: 320, start: 0.78, easing: backOut }}
    >
      <button
        class="tile-modal-close"
        on:click={() => dispatch('close')}
        aria-label="Close {label}"
      >✕</button>
      <slot />
    </div>
  </div>
{/if}
