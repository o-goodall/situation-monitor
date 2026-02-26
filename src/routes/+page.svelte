<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import SignalSection from '$lib/sections/SignalSection.svelte';
  import PortfolioSection from '$lib/sections/PortfolioSection.svelte';
  import IntelSection from '$lib/sections/IntelSection.svelte';

  onMount(() => {
    if (window.innerWidth <= 768) goto('/signal', { replaceState: true });
  });
</script>

<SignalSection />
<div class="section-divider"></div>
<PortfolioSection />
<div class="section-divider"></div>
<IntelSection />
