// ── PERSONALIZATION UTILITIES ─────────────────────────────────
// Handles greeting logic, weather fetching, and localStorage
// for the GL4NCE user-personalization module.

const KEY_ENABLED  = 'gl4nce_personalization_enabled';
const KEY_USERNAME = 'gl4nce_username';
const KEY_LAT      = 'gl4nce_lat';
const KEY_LON      = 'gl4nce_lon';

// ── localStorage helpers ──────────────────────────────────────

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}

// ── Exported storage helpers ──────────────────────────────────

export interface StoredSettings {
  enabled: boolean;
  username: string;
  lat: number | null;
  lon: number | null;
}

export function getStoredSettings(): StoredSettings {
  return {
    enabled:  lsGet(KEY_ENABLED)  === 'true',
    username: lsGet(KEY_USERNAME) ?? '',
    lat: lsGet(KEY_LAT)  !== null ? parseFloat(lsGet(KEY_LAT)!)  : null,
    lon: lsGet(KEY_LON)  !== null ? parseFloat(lsGet(KEY_LON)!)  : null,
  };
}

export function setPersonalizationEnabled(val: boolean): void {
  lsSet(KEY_ENABLED, String(val));
}

export function setUsername(name: string): void {
  lsSet(KEY_USERNAME, name.trim());
}

export function setStoredCoords(lat: number, lon: number): void {
  lsSet(KEY_LAT, String(lat));
  lsSet(KEY_LON, String(lon));
}

// ── Greeting logic ────────────────────────────────────────────

export function getGreetingByTime(date: Date = new Date()): string {
  const h = date.getHours();
  if (h >= 5  && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ── Weather condition code → text ─────────────────────────────
// WMO Weather interpretation codes (Open-Meteo)
const WMO_CONDITIONS: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ heavy hail',
};

export interface WeatherData {
  city: string;
  temp: number;
  condition: string;
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weathercode&temperature_unit=celsius&timezone=auto`;

  const res  = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();

  const temp      = Math.round(data.current.temperature_2m);
  const code      = data.current.weathercode as number;
  const condition = WMO_CONDITIONS[code] ?? 'Unknown';

  // Reverse-geocode city name via OpenStreetMap Nominatim
  let city = '';
  try {
    const geo = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'GL4NCE-Dashboard/1.0' } }
    );
    if (geo.ok) {
      const gd = await geo.json();
      city = gd.address?.city || gd.address?.town || gd.address?.village || gd.address?.county || '';
    }
  } catch {}

  return { city, temp, condition };
}

export function requestGeolocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: 10000 }
    );
  });
}
