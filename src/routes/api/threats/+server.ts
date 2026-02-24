import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { DEFAULT_THREATS, type Threat, type ThreatLevel } from '$lib/settings';

/**
 * GET /api/threats
 *
 * Returns live global conflict hotspots for the World Map.
 *
 * Data source: GDELT Events 2.0 (https://api.gdeltproject.org)
 *   — completely free, no registration or API key required
 *   — updated every 15 minutes
 *   — CAMEO codes 18 (assault) + 19 (fight) + 20 (mass violence)
 *   — pointdata mode returns geographic clusters with event counts
 *
 * Falls back to curated static DEFAULT_THREATS on any error.
 *
 * Response: { threats: Threat[], conflictCountryIds: string[], updatedAt: string }
 */

// ── GDELT Events 2.0 API ──────────────────────────────────────
// No API key required; https://api.gdeltproject.org
// CAMEO codes: 18 = assault, 19 = fight, 20 = unconventional mass violence
const GDELT_TIMESPAN_DAYS = 7;
const GDELT_TIMESPAN_MINS = GDELT_TIMESPAN_DAYS * 24 * 60; // 10080 minutes
const GDELT_URL =
  'https://api.gdeltproject.org/api/v2/events/query' +
  '?query=' + encodeURIComponent('cameo:18 OR cameo:19 OR cameo:20') +
  `&mode=pointdata&format=json&TIMESPAN=${GDELT_TIMESPAN_MINS}&MAXROWS=250`;

// ── Country name regex → ISO 3166-1 numeric ID + canonical coords ─
interface CountryInfo { id: string; lat: number; lon: number; canonical: string }

const COUNTRY_INDEX: [RegExp, CountryInfo][] = [
  [/ukraine/i,                  { id: '804', lat:  49.0, lon:  31.5, canonical: 'Ukraine' }],
  [/palest|gaza|west\s*bank/i,  { id: '275', lat:  31.5, lon:  34.5, canonical: 'Palestine' }],
  [/israel/i,                   { id: '376', lat:  31.8, lon:  35.2, canonical: 'Israel' }],
  [/south\s*sudan/i,            { id: '728', lat:   7.9, lon:  30.2, canonical: 'South Sudan' }],
  [/\bsudan\b/i,                { id: '729', lat:  15.5, lon:  30.0, canonical: 'Sudan' }],
  [/myanmar|burma/i,            { id: '104', lat:  19.7, lon:  96.1, canonical: 'Myanmar' }],
  [/\biran\b/i,                 { id: '364', lat:  32.0, lon:  53.0, canonical: 'Iran' }],
  [/\byemen\b/i,                { id: '887', lat:  15.3, lon:  44.2, canonical: 'Yemen' }],
  [/\bmali\b/i,                 { id: '466', lat:  17.6, lon:  -2.0, canonical: 'Mali' }],
  [/burkina/i,                  { id: '854', lat:  12.4, lon:  -1.6, canonical: 'Burkina Faso' }],
  [/\bniger\b(?!ia)/i,          { id: '562', lat:  17.6, lon:   8.1, canonical: 'Niger' }],
  [/\bhaiti\b/i,                { id: '332', lat:  18.9, lon: -72.3, canonical: 'Haiti' }],
  [/ethiopia/i,                 { id: '231', lat:   9.1, lon:  40.5, canonical: 'Ethiopia' }],
  [/\bsyria\b/i,                { id: '760', lat:  34.8, lon:  38.5, canonical: 'Syria' }],
  [/\biraq\b/i,                 { id: '368', lat:  33.3, lon:  44.4, canonical: 'Iraq' }],
  [/somalia/i,                  { id: '706', lat:   5.2, lon:  46.2, canonical: 'Somalia' }],
  [/afghan/i,                   { id: '004', lat:  34.5, lon:  69.2, canonical: 'Afghanistan' }],
  [/\bliby/i,                   { id: '434', lat:  26.3, lon:  17.2, canonical: 'Libya' }],
  [/nigeria/i,                  { id: '566', lat:   9.1, lon:   8.7, canonical: 'Nigeria' }],
  [/congo|dem.*rep.*congo|\bdrc\b/i, { id: '180', lat: -4.0, lon:  21.8, canonical: 'DR Congo' }],
  [/cameroon/i,                 { id: '120', lat:   3.9, lon:  11.5, canonical: 'Cameroon' }],
  [/central.african/i,          { id: '140', lat:   6.6, lon:  20.9, canonical: 'Central African Republic' }],
  [/mozambique/i,               { id: '508', lat: -18.7, lon:  35.5, canonical: 'Mozambique' }],
  [/pakistan/i,                 { id: '586', lat:  30.4, lon:  69.3, canonical: 'Pakistan' }],
  [/colombia/i,                 { id: '170', lat:   4.6, lon: -74.1, canonical: 'Colombia' }],
  [/\bmexico\b/i,               { id: '484', lat:  23.6, lon:-102.6, canonical: 'Mexico' }],
  [/lebanon/i,                  { id: '422', lat:  33.9, lon:  35.5, canonical: 'Lebanon' }],
  [/\brussia\b/i,               { id: '643', lat:  55.7, lon:  37.6, canonical: 'Russia' }],
  [/\btaiwan\b/i,               { id: '158', lat:  24.0, lon: 121.0, canonical: 'Taiwan' }],
  [/venezuela/i,                { id: '862', lat:   6.4, lon: -66.6, canonical: 'Venezuela' }],
  [/\bkenya\b/i,                { id: '404', lat:  -1.3, lon:  36.8, canonical: 'Kenya' }],
  [/\bchad\b/i,                 { id: '148', lat:  15.5, lon:  18.7, canonical: 'Chad' }],
  [/senegal/i,                  { id: '686', lat:  14.7, lon: -17.4, canonical: 'Senegal' }],
];

function matchCountry(name: string): CountryInfo | null {
  for (const [re, info] of COUNTRY_INDEX) {
    if (re.test(name)) return info;
  }
  return null;
}

const LEVEL_ORDER: ThreatLevel[] = ['low', 'elevated', 'high', 'critical'];

function countToLevel(count: number): ThreatLevel {
  if (count >= 100) return 'critical';
  if (count >= 25)  return 'high';
  if (count >= 5)   return 'elevated';
  return 'low';
}

// ── GDELT pointdata response shape ────────────────────────────
interface GdeltFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; count?: number };
}
interface GdeltResponse {
  features?: GdeltFeature[];
  data?: GdeltFeature[];
}

// ── Module-level cache (1-hour TTL) ───────────────────────────
let _cache: { threats: Threat[]; conflictCountryIds: string[]; updatedAt: string } | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function GET(_event: RequestEvent) {
  if (_cache && Date.now() < _cacheExpiresAt) {
    return json(_cache, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=300' } });
  }

  try {
    const res = await fetch(GDELT_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'situation-monitor/1.0 (https://github.com/o-goodall/situation-monitor)',
      },
    });
    if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);

    const body: GdeltResponse = await res.json();
    const features: GdeltFeature[] = body.features ?? body.data ?? [];

    // Aggregate event clusters by country (multiple GDELT clusters per country)
    const countryMap = new Map<string, {
      info: CountryInfo; totalCount: number; bestLat: number; bestLon: number; maxCluster: number;
    }>();

    for (const f of features) {
      const coords = f.geometry?.coordinates;
      const lat = coords?.[1];   // GeoJSON: [lon, lat]
      const lon = coords?.[0];
      const name = f.properties?.name ?? '';
      const count = f.properties?.count ?? 1;

      if (lat == null || lon == null || !name) continue;

      const country = matchCountry(name);
      if (!country) continue;

      if (countryMap.has(country.canonical)) {
        const entry = countryMap.get(country.canonical)!;
        entry.totalCount += count;
        if (count > entry.maxCluster) {
          entry.maxCluster = count;
          entry.bestLat = lat;
          entry.bestLon = lon;
        }
      } else {
        countryMap.set(country.canonical, {
          info: country, totalCount: count,
          bestLat: lat, bestLon: lon, maxCluster: count,
        });
      }
    }

    if (countryMap.size === 0) throw new Error('GDELT returned no matching conflict locations');

    const threats: Threat[] = [];
    for (const [name, { info, totalCount, bestLat, bestLon }] of countryMap) {
      threats.push({
        id:        name.toLowerCase().replace(/\s+/g, '-'),
        name,
        lat:       bestLat,
        lon:       bestLon,
        level:     countToLevel(totalCount),
        desc:      `⚔️ ${name} — ${totalCount} conflict events in last ${GDELT_TIMESPAN_DAYS} days (GDELT)`,
        countryId: info.id,
      });
    }

    threats.sort((a, b) => LEVEL_ORDER.indexOf(b.level) - LEVEL_ORDER.indexOf(a.level));

    const conflictCountryIds = threats.filter(t => t.countryId).map(t => t.countryId as string);
    const payload = { threats, conflictCountryIds, updatedAt: new Date().toISOString() };
    _cache = payload;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    return json(payload, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=300' } });
  } catch (err) {
    console.error('GDELT conflict fetch failed, using static fallback:', err);
    const conflictCountryIds = DEFAULT_THREATS
      .filter(t => t.countryId)
      .map(t => t.countryId as string);
    return json({
      threats: DEFAULT_THREATS,
      conflictCountryIds,
      updatedAt: new Date().toISOString(),
    });
  }
}

