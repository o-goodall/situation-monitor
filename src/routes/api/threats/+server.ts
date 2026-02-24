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
 *   — Expanded CAMEO code coverage:
 *       143/145: violent protest / riot       (protest escalation)
 *       152/154: military posture / mobilize  (military mobilization)
 *       17:      coerce, sanctions, threats   (government instability)
 *       18:      assault                      (direct violence)
 *       19:      fight                        (armed conflict)
 *       20:      mass violence                (mass killing / atrocity)
 *   — Dual-period comparison (current vs. prior 7 days) for 7-day acceleration
 *   — Multi-factor threat score:
 *       Score = (Event Volume × Base Weight) × (1 + Acceleration Modifier)
 *
 * Falls back to curated static DEFAULT_THREATS on any error.
 *
 * Response: { threats: Threat[], conflictCountryIds: string[], updatedAt: string }
 */

// ── GDELT Events 2.0 API ──────────────────────────────────────
// No API key required; https://api.gdeltproject.org
//
// Expanded CAMEO codes (Layer 1 — Raw Event Stream):
//   • 143 = conduct violent protest
//   • 145 = protest violently / riot
//   • 152 = demonstrate or exhibit military or police power
//   • 154 = mobilize or increase police power
//   • 17  = coerce (all sub-types: embargo, sanction, blockade, threaten)
//   • 18  = assault (all sub-types: abduct, torture, kill, etc.)
//   • 19  = fight (all sub-types: armed battle, air strike, etc.)
//   • 20  = mass violence (all sub-types: genocide, mass atrocity, etc.)
const GDELT_QUERY =
  'cameo:143 OR cameo:145 OR cameo:152 OR cameo:154 OR cameo:17 OR cameo:18 OR cameo:19 OR cameo:20';

const GDELT_TIMESPAN_DAYS = 7;
const GDELT_TIMESPAN_MINS = GDELT_TIMESPAN_DAYS * 24 * 60; // 10_080 minutes
const GDELT_MAX_ROWS = 500;

// Layer 2 — Signal Engine: Violence Code Multiplier
// Reflects the relative severity of each CAMEO parent code group
// Approximate weighted average across all included codes ≈ 1.8
const BASE_WEIGHT = 1.8;

// Risk classification thresholds (after acceleration adjustment)
const SCORE_CRITICAL = 300;
const SCORE_HIGH     = 80;
const SCORE_ELEVATED = 15;

// Acceleration Modifier bounds and weight:
//   NEW_SIGNAL_RATE: assumed 50% growth when a country first appears (no prior data)
//   ACCEL_WEIGHT:    converts raw acceleration rate to a score modifier (30%)
//   ACCEL_MAX_BOOST: caps upward contribution at +30% of base score
//   ACCEL_MAX_PENALTY: caps downward contribution at −15% of base score
const NEW_SIGNAL_RATE  = 0.5;  // moderate growth assumption for first-seen countries
const ACCEL_WEIGHT     = 0.3;  // acceleration contributes up to 30% of base score
const ACCEL_MAX_BOOST  = 0.30; // maximum positive score modifier
const ACCEL_MAX_PENALTY = -0.15; // maximum negative score modifier (cooling dampens less than rising boosts)

function gdeltUrl(opts: { timespan?: number; startDt?: string; endDt?: string }): string {
  const base =
    'https://api.gdeltproject.org/api/v2/events/query' +
    '?query=' + encodeURIComponent(GDELT_QUERY) +
    '&mode=pointdata&format=json' +
    `&MAXROWS=${GDELT_MAX_ROWS}`;
  if (opts.timespan !== undefined) return base + `&TIMESPAN=${opts.timespan}`;
  return base + `&STARTDATETIME=${opts.startDt}&ENDDATETIME=${opts.endDt}`;
}

/** Format a Date as YYYYMMDDHHMMSS for GDELT STARTDATETIME / ENDDATETIME params */
function dtStr(d: Date): string {
  return d.toISOString().slice(0, 19).replace(/[-:T]/g, '');
}

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

// ── GDELT pointdata response shape ────────────────────────────
interface GdeltFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; count?: number };
}
interface GdeltResponse {
  features?: GdeltFeature[];
  data?: GdeltFeature[];
}

/** Aggregate GDELT pointdata features into a per-country count map */
function aggregateByCountry(features: GdeltFeature[]): Map<string, {
  info: CountryInfo; count: number; bestLat: number; bestLon: number; maxCluster: number;
}> {
  const map = new Map<string, {
    info: CountryInfo; count: number; bestLat: number; bestLon: number; maxCluster: number;
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
    if (map.has(country.canonical)) {
      const entry = map.get(country.canonical)!;
      entry.count += count;
      if (count > entry.maxCluster) {
        entry.maxCluster = count;
        entry.bestLat = lat;
        entry.bestLon = lon;
      }
    } else {
      map.set(country.canonical, {
        info: country, count, bestLat: lat, bestLon: lon, maxCluster: count,
      });
    }
  }
  return map;
}

/**
 * Layer 2 — Signal Engine
 *
 * Multi-factor threat score:
 *   Score = (Event Volume × Base Weight) × (1 + Acceleration Modifier)
 *
 * Where:
 *   Base Weight      ≈ 1.8 (weighted average of included CAMEO code severity)
 *   Acceleration Modifier = clamp(accelerationRate × 0.3, −0.15, +0.30)
 *     accelerationRate = (current − prior) / max(1, prior)
 *
 * Risk classification (Layer 3 signal output):
 *   ≥ 300 → Critical  (mass-casualty / open warfare)
 *   ≥  80 → High      (active conflict / serious instability)
 *   ≥  15 → Elevated  (rising tension / recurring violence)
 *   <  15 → Low       (monitored / occasional incidents)
 */
function computeScore(currentCount: number, priorCount: number): {
  score: number;
  level: ThreatLevel;
  direction: '↑' | '↓' | '→';
  accelerationPct: number;
} {
  // 7-day Acceleration Rate: proportional change from prior period
  const accelerationRate = priorCount > 0
    ? (currentCount - priorCount) / priorCount
    : (currentCount > 0 ? NEW_SIGNAL_RATE : 0); // no prior data → assume moderate new signal

  // Acceleration Modifier: capped to avoid dominating the base score
  const accelerationMod = Math.max(ACCEL_MAX_PENALTY, Math.min(ACCEL_MAX_BOOST, accelerationRate * ACCEL_WEIGHT));

  const score = Math.round(currentCount * BASE_WEIGHT * (1 + accelerationMod));
  const accelerationPct = Math.round(accelerationRate * 100);

  const direction: '↑' | '↓' | '→' =
    accelerationPct > 10 ? '↑' : accelerationPct < -10 ? '↓' : '→';

  let level: ThreatLevel;
  if (score >= SCORE_CRITICAL) level = 'critical';
  else if (score >= SCORE_HIGH) level = 'high';
  else if (score >= SCORE_ELEVATED) level = 'elevated';
  else level = 'low';

  return { score, level, direction, accelerationPct };
}

function riskLabel(level: ThreatLevel): string {
  switch (level) {
    case 'critical': return 'Critical';
    case 'high':     return 'High';
    case 'elevated': return 'Elevated';
    default:         return 'Monitored';
  }
}

function directionLabel(direction: '↑' | '↓' | '→'): string {
  switch (direction) {
    case '↑': return 'Rising';
    case '↓': return 'Cooling';
    default:  return 'Stable';
  }
}

// ── Module-level cache (15-min TTL — matches GDELT update cadence) ─
let _cache: { threats: Threat[]; conflictCountryIds: string[]; updatedAt: string } | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function GET(_event: RequestEvent) {
  if (_cache && Date.now() < _cacheExpiresAt) {
    return json(_cache, { headers: { 'Cache-Control': 's-maxage=900, stale-while-revalidate=120' } });
  }

  try {
    const now = new Date();
    const priorEndDt   = dtStr(new Date(now.getTime() - GDELT_TIMESPAN_DAYS * 24 * 60 * 60 * 1000));
    const priorStartDt = dtStr(new Date(now.getTime() - 2 * GDELT_TIMESPAN_DAYS * 24 * 60 * 60 * 1000));

    // Layer 1 — Raw Event Stream: fetch current week and prior week in parallel
    const [currentRes, priorRes] = await Promise.all([
      fetch(gdeltUrl({ timespan: GDELT_TIMESPAN_MINS }), {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'situation-monitor/1.0 (https://github.com/o-goodall/situation-monitor)',
        },
      }),
      fetch(gdeltUrl({ startDt: priorStartDt, endDt: priorEndDt }), {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'situation-monitor/1.0 (https://github.com/o-goodall/situation-monitor)',
        },
      }),
    ]);

    if (!currentRes.ok) throw new Error(`GDELT HTTP ${currentRes.status}`);

    const currentBody: GdeltResponse = await currentRes.json();
    const currentFeatures: GdeltFeature[] = currentBody.features ?? currentBody.data ?? [];

    // Prior-period data is best-effort — degrade gracefully if unavailable
    let priorFeatures: GdeltFeature[] = [];
    if (priorRes.ok) {
      try {
        const priorBody: GdeltResponse = await priorRes.json();
        priorFeatures = priorBody.features ?? priorBody.data ?? [];
      } catch { /* ignore parse failures for prior period */ }
    }

    const currentMap = aggregateByCountry(currentFeatures);
    const priorMap   = aggregateByCountry(priorFeatures);

    if (currentMap.size === 0) throw new Error('GDELT returned no matching conflict locations');

    const threats: Threat[] = [];
    for (const [name, { info, count, bestLat, bestLon }] of currentMap) {
      const priorCount = priorMap.get(name)?.count ?? 0;
      const { score, level, direction, accelerationPct } = computeScore(count, priorCount);

      const accelStr = accelerationPct !== 0
        ? ` (${accelerationPct > 0 ? '+' : ''}${accelerationPct}% vs prior week)`
        : '';

      threats.push({
        id:             name.toLowerCase().replace(/\s+/g, '-'),
        name,
        lat:            bestLat,
        lon:            bestLon,
        level,
        desc:           `${direction} ${name} — ${riskLabel(level)} · ${directionLabel(direction)}${accelStr} · ${count} events/7d (GDELT)`,
        countryId:      info.id,
        score,
        direction,
        accelerationPct,
      });
    }

    threats.sort((a, b) => LEVEL_ORDER.indexOf(b.level) - LEVEL_ORDER.indexOf(a.level));

    const conflictCountryIds = threats.filter(t => t.countryId).map(t => t.countryId as string);
    const payload = { threats, conflictCountryIds, updatedAt: new Date().toISOString() };
    _cache = payload;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    return json(payload, { headers: { 'Cache-Control': 's-maxage=900, stale-while-revalidate=120' } });
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
