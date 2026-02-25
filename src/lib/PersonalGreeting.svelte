<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getStoredSettings, getGreetingByTime, fetchWeather,
    requestGeolocation, setStoredCoords,
    type WeatherData,
  } from './personalization';

  let greeting  = '';
  let username  = '';
  let weather: WeatherData | null = null;
  let weatherError = false;

  onMount(async () => {
    const s = getStoredSettings();
    username = s.username;
    greeting = getGreetingByTime();

    // Try to get weather
    try {
      let lat = s.lat;
      let lon = s.lon;

      if (lat === null || lon === null) {
        const coords = await requestGeolocation();
        lat = coords.lat;
        lon = coords.lon;
        setStoredCoords(lat, lon);
      }

      weather = await fetchWeather(lat, lon);
    } catch {
      weatherError = true;
    }
  });
</script>

<div class="pg-wrap" aria-label="Personal greeting">
  <p class="pg-greeting">{greeting}, <span class="pg-name">{username}</span>.</p>
  {#if weather}
    <p class="pg-weather">
      {#if weather.city}{weather.city} · {/if}{weather.temp}°C · {weather.condition}
    </p>
  {:else if !weatherError}
    <p class="pg-weather pg-weather--loading">—</p>
  {/if}
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
  .pg-weather {
    margin: 0;
    font-size: 13px;
    font-weight: 400;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.60);
  }
  .pg-weather--loading {
    opacity: 0.4;
  }

  /* Light mode overrides */
  :global(.light-mode) .pg-greeting { color: rgba(0, 0, 0, 0.85); }
  :global(.light-mode) .pg-name     { color: #c77a10; }
  :global(.light-mode) .pg-weather  { color: rgba(0, 0, 0, 0.55); }
</style>
