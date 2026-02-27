/**
 * CSS selector for all keyboard-focusable elements.
 * Used by Modal.svelte and layout focus-trap logic.
 */
export const FOCUSABLE_SEL =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
