<script lang="ts">
  import { onMount } from 'svelte';

  let visible = true;
  let dismissed = false;
  let taglineVisible = false;
  let hintVisible = false;

  const SLOGAN = 'Everything. At a Glance.';
  const LEET: Record<string, string> = {
    'E': '3', 'e': '3',
    'A': '4', 'a': '4',
    'T': '7', 't': '7',
    'I': '1', 'i': '1',
    'G': '6', 'g': '6',
  };

  type CharState = { orig: string; disp: string; state: 'normal' | 'leet' | 'done' };
  let chars: CharState[] = SLOGAN.split('').map(c => ({ orig: c, disp: c, state: 'normal' }));

  let leetInterval: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    // Show tagline after 0.5s delay
    setTimeout(() => { taglineVisible = true; }, 500);
    // Show hint after 1.8s
    setTimeout(() => { hintVisible = true; }, 1800);

    // Start leet sweep 0.7s after mount (0.2s after tagline begins fading in)
    // Step every 150ms so the sweep moves slowly like an orange foil sheen
    setTimeout(() => {
      if (dismissed) return;
      let i = 0;
      leetInterval = setInterval(() => {
        if (dismissed || i >= chars.length) {
          clearInterval(leetInterval!);
          leetInterval = null;
          return;
        }
        const idx = i++;
        const orig = chars[idx].orig;
        const leetChar = LEET[orig];
        if (leetChar) {
          chars[idx] = { orig, disp: leetChar, state: 'leet' };
          chars = [...chars];
          setTimeout(() => {
            chars[idx] = { orig, disp: orig, state: 'done' };
            chars = [...chars];
          }, 120);
        }
      }, 150);
    }, 700);
  });

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (leetInterval) {
      clearInterval(leetInterval);
      leetInterval = null;
    }
    setTimeout(() => { visible = false; }, 350);
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="welcome-screen"
    class:dismissed
    on:click={dismiss}
    role="presentation"
  >
    <div class="welcome-content">
      <!-- GL4NCE eye logo — larger version of header logo -->
      <div class="welcome-logo" aria-hidden="true">
        <div class="welcome-eye-wrap">
          <svg class="welcome-eye-svg" viewBox="0 0 60 24" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <clipPath id="wEyeClip">
                <path d="M30,3.5 C18,3.5 6,12 6,12 C6,12 18,20.5 30,20.5 C42,20.5 54,12 54,12 C54,12 42,3.5 30,3.5 Z"/>
              </clipPath>
              <filter id="wOutlineGlow" x="-10%" y="-30%" width="120%" height="160%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="0.7" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <path d="M30,3.5 C18,3.5 6,12 6,12 C6,12 18,20.5 30,20.5 C42,20.5 54,12 54,12 C54,12 42,3.5 30,3.5 Z" fill="#040201"/>
            <path d="M6,12 C18,3.5 42,3.5 54,12" fill="none" stroke="rgba(247,147,26,0.55)" stroke-width="0.7" stroke-linecap="round"/>
            <path
              class="w-eye-outline"
              filter="url(#wOutlineGlow)"
              d="M30,3.5 C18,3.5 6,12 6,12 C6,12 18,20.5 30,20.5 C42,20.5 54,12 54,12 C54,12 42,3.5 30,3.5 Z"
              fill="none" stroke="#f7931a" stroke-width="0.85" opacity="0.78"
            />
            <circle cx="6"  cy="12" r="1.1" fill="rgba(247,147,26,0.6)"/>
            <circle cx="54" cy="12" r="1.1" fill="rgba(247,147,26,0.6)"/>
            <g clip-path="url(#wEyeClip)">
              <circle class="w-eye-iris"  cx="30" cy="12" r="5"   fill="rgba(247,147,26,0.12)" stroke="rgba(247,147,26,0.75)" stroke-width="0.55"/>
              <circle class="w-eye-pupil" cx="30" cy="12" r="2.2" fill="rgba(14,2,1,0.92)"     stroke="rgba(247,147,26,0.38)" stroke-width="0.3"/>
            </g>
          </svg>
          <span class="welcome-brand-name">GL<span class="w-b4">4</span>NCE</span>
        </div>
      </div>

      <!-- Tagline — fade in after delay, leet sweep left to right -->
      <p class="welcome-tagline" class:tagline-visible={taglineVisible} aria-live="polite">
        {#each chars as char}<span
          class="slogan-char"
          class:slogan-leet={char.state === 'leet'}
          class:slogan-done={char.state === 'done'}
        >{char.disp}</span>{/each}
      </p>

      <!-- Hint -->
      <span class="welcome-hint" class:hint-visible={hintVisible}>Tap anywhere to enter</span>
    </div>
  </div>
{/if}

<style>
  /* Only shown on mobile */
  .welcome-screen {
    display: none;
  }

  @media (max-width: 768px) {
    .welcome-screen {
      display: flex;
      position: fixed;
      inset: 0;
      z-index: 1000;
      align-items: center;
      justify-content: center;
      background: radial-gradient(ellipse at 50% 40%, rgba(20,10,0,1) 0%, #000 70%);
      transition: opacity 0.35s ease, transform 0.35s ease;
      cursor: pointer;
      /* safe area support */
      padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
    }

    .welcome-screen.dismissed {
      opacity: 0;
      transform: scale(1.04);
      pointer-events: none;
    }

    .welcome-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 0 32px;
      text-align: center;
    }

    /* Logo — pulsing scale animation */
    .welcome-logo {
      animation: welcomeScale 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
      filter: drop-shadow(0 0 24px rgba(247,147,26,0.4)) drop-shadow(0 0 8px rgba(247,147,26,0.2));
    }

    @keyframes welcomeScale {
      0%   { transform: scale(0.8); opacity: 0.6; }
      60%  { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(1.0); opacity: 1; }
    }

    .welcome-eye-wrap {
      width: 220px;
      height: 88px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .welcome-eye-svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }

    /* Eye outline pulse */
    @keyframes wEyeOutlinePulse { 0%,100%{opacity:.78} 50%{opacity:.98} }
    .w-eye-outline { animation: wEyeOutlinePulse 2.5s ease-in-out infinite; }
    .w-eye-iris { opacity: 1; }
    .w-eye-pupil { opacity: 1; }

    .welcome-brand-name {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
      font-weight: 900;
      font-size: 1.5rem;
      letter-spacing: .12em;
      color: #eaeaea;
      text-transform: uppercase;
      pointer-events: none;
      z-index: 1;
    }

    .w-b4 { color: #f7931a; }

    /* Tagline — fade in + glow */
    .welcome-tagline {
      font-family: inherit;
      font-size: 1rem;
      font-weight: 400;
      color: rgba(255,255,255,0.82);
      letter-spacing: .06em;
      opacity: 0;
      transition: opacity 1s ease, text-shadow 1s ease;
      text-shadow: none;
    }

    .welcome-tagline.tagline-visible {
      opacity: 1;
      text-shadow: 0 0 16px rgba(247,147,26,0.4), 0 0 32px rgba(247,147,26,0.15);
    }

    /* Per-character leet sweep */
    .slogan-char {
      display: inline;
      color: inherit;
      transition: color 0.35s ease;
    }
    .slogan-char.slogan-leet {
      color: #f7931a;
    }
    .slogan-char.slogan-done {
      color: #ffffff;
    }

    /* Hint text */
    .welcome-hint {
      font-family: inherit;
      font-size: .62rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: .14em;
      color: rgba(255,255,255,0.25);
      opacity: 0;
      transition: opacity 0.6s ease;
    }

    .welcome-hint.hint-visible {
      opacity: 1;
      animation: hintBlink 2.5s ease-in-out 0.6s infinite;
    }

    @keyframes hintBlink {
      0%, 80%, 100% { opacity: 1; }
      40% { opacity: 0.3; }
    }

    @media (prefers-reduced-motion: reduce) {
      .welcome-logo { animation: none; transform: scale(1); opacity: 1; }
      .w-eye-outline { animation: none; }
      .welcome-hint { animation: none; }
    }
  }
</style>
