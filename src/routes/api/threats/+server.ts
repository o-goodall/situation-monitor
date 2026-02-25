import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { DEFAULT_THREATS, type Threat, type ThreatLevel } from '$lib/settings';

/**
 * GET /api/threats
 *
 * Returns live global conflict hotspots for the World Map.
 *
 * Data sources (all free, no API key required):
 *
 * 1. GDELT Events 2.0 (https://api.gdeltproject.org) — primary source
 *   — updated every 15 minutes
 *   — Strict physical-violence CAMEO codes only:
 *       18: assault (abduct, torture, kill, etc.)
 *       19: fight (armed battle, air strike, etc.)
 *       20: mass violence (genocide, mass atrocity, etc.)
 *   — Diplomatic/coercive codes (17, 143, 145, 152, 154) intentionally excluded
 *   — Dual-period comparison (current vs. prior rolling window) for acceleration
 *   — Multi-factor threat score:
 *       Score = (Event Volume × Base Weight) × (1 + Acceleration Modifier)
 *   — Only threats meeting ACTIVE_THRESHOLD are included in the response
 *
 * 2. ReliefWeb (https://reliefweb.int) — UN OCHA humanitarian crisis data
 *   — ongoing disasters and crises aggregated by country
 *
 * 3. UCDP (https://ucdp.uu.se) — Uppsala Conflict Data Program
 *   — georeferenced conflict events from the most recent available year
 *
 * 4. CEWARN (https://cewarn.org) — East Africa Conflict Early Warning System
 *   — IGAD regional conflict incident reports (best-effort)
 *
 * All secondary sources (2–4) are fetched in parallel and merged into GDELT
 * results. Each secondary source failure is handled gracefully — only the
 * affected source is skipped; GDELT output is preserved.
 *
 * Falls back to curated static DEFAULT_THREATS on any error.
 *
 * Response: { threats: Threat[], conflictCountryIds: string[], updatedAt: string }
 */

// ── GDELT Events 2.0 API ──────────────────────────────────────
// No API key required; https://api.gdeltproject.org
//
// Strict physical-violence CAMEO codes only (Layer 1 — Raw Event Stream):
//   • 18 = assault (abduct, torture, kill, etc.)
//   • 19 = fight   (armed battle, air strike, etc.)
//   • 20 = mass violence (genocide, mass atrocity, etc.)
//
// Codes 143, 145 (violent protest/riot), 152, 154 (military posture/mobilize),
// and 17 (coerce/sanctions/threats) are intentionally excluded — they generate
// diplomatic and non-combat false positives on the conflict map.
const GDELT_QUERY = 'cameo:18 OR cameo:19 OR cameo:20';

/**
 * Rolling window for event aggregation (configurable).
 * Current: 7 days — provides a stable weekly signal.
 * Set to 3 for a tighter 72-hour window (higher precision, lower volume).
 */
const ROLLING_WINDOW_DAYS = 7;
const GDELT_TIMESPAN_MINS = ROLLING_WINDOW_DAYS * 24 * 60; // e.g. 10_080 minutes for 7 days
const GDELT_MAX_ROWS = 500;

// Layer 2 — Signal Engine: Violence Code Multiplier
// With only codes 18/19/20, each event is a confirmed violence signal.
// Approximate weighted average across physical violence codes ≈ 2.0
const BASE_WEIGHT = 2.0;

// Risk classification thresholds (after acceleration adjustment)
const SCORE_CRITICAL = 300;
const SCORE_HIGH     = 80;
const SCORE_ELEVATED = 15;

/**
 * Minimum severity score for a threat to be marked as ACTIVE and shown on the map.
 * Threats with score < ACTIVE_THRESHOLD are classified as 'inactive' and excluded.
 * Threats between ACTIVE_THRESHOLD and ESCALATING_THRESHOLD are 'escalating_tension'.
 */
const ACTIVE_THRESHOLD      = 10;
const ESCALATING_THRESHOLD  = 20;

/**
 * Enable debug mode to log threat rejection reasons to the server console.
 * Set to true during threshold tuning; leave false in production.
 */
const DEBUG_THREATS = false;

// ── 14 Major Conflict Seeds ────────────────────────────────────
// These 14 verified high-severity conflicts are seeded with preliminary status = "active".
// Their severityScore is updated dynamically from live event data (GDELT + secondary sources).
// Conflicts are automatically removed from the map when their score decays below ACTIVE_THRESHOLD.
interface MajorConflict {
  name: string;
  canonical: string; // matches a key in COUNTRY_INDEX for GDELT score boosting
  lat: number;
  lon: number;
  countryId?: string;
}

const MAJOR_CONFLICTS: MajorConflict[] = [
  { name: 'Russia–Ukraine War',      canonical: 'Ukraine',     lat: 49.0, lon:  31.5, countryId: '804' },
  { name: 'Sudan Civil War',         canonical: 'Sudan',       lat: 15.5, lon:  30.0, countryId: '729' },
  { name: 'Gaza War',                canonical: 'Palestine',   lat: 31.5, lon:  34.5, countryId: '275' },
  { name: 'Yemen Civil War',         canonical: 'Yemen',       lat: 15.3, lon:  44.2, countryId: '887' },
  { name: 'DR Congo – M23',          canonical: 'DR Congo',    lat: -4.0, lon:  21.8, countryId: '180' },
  { name: 'Ethiopia Conflict',       canonical: 'Ethiopia',    lat:  9.1, lon:  40.5, countryId: '231' },
  { name: 'Myanmar Civil War',       canonical: 'Myanmar',     lat: 19.7, lon:  96.1, countryId: '104' },
  { name: 'Haiti – Gang Violence',   canonical: 'Haiti',       lat: 18.9, lon: -72.3, countryId: '332' },
  { name: 'Cameroon – Anglophone',   canonical: 'Cameroon',    lat:  3.9, lon:  11.5, countryId: '120' },
  { name: 'Colombia – Armed Groups', canonical: 'Colombia',    lat:  4.6, lon: -74.1, countryId: '170' },
  { name: 'Mexico Drug War',         canonical: 'Mexico',      lat: 23.6, lon:-102.6, countryId: '484' },
  { name: 'South Sudan',             canonical: 'South Sudan', lat:  7.9, lon:  30.2, countryId: '728' },
  { name: 'Northern Triangle',       canonical: 'Honduras',    lat: 14.1, lon: -87.2                   },
  { name: 'Kashmir Tensions',        canonical: 'Kashmir',     lat: 34.0, lon:  74.0, countryId: '356' },
];

// Daily decay rate applied to seed scores when no new GDELT events are detected.
// After 30 days without events: 0.97^30 ≈ 0.40 of original score.
const DECAY_RATE         = 0.97;
const DECAY_INTERVAL_MS  = 24 * 60 * 60 * 1000; // 1 day

// Baseline score for fresh seed conflicts (above ESCALATING_THRESHOLD so they appear on map).
const SEED_INITIAL_SCORE = ESCALATING_THRESHOLD + 5; // 25

// Module-level seed score tracker — persists across cache cycles within the same server instance.
// canonical → current severityScore (float; rounded when used in Threat)
const _seedScores       = new Map<string, number>();
let   _lastDecayApplied = 0; // Unix ms timestamp of last daily decay pass

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
  [/honduras/i,                 { id: '340', lat:  14.1, lon: -87.2, canonical: 'Honduras' }],
  [/guatemala/i,                { id: '320', lat:  15.8, lon: -90.2, canonical: 'Guatemala' }],
  [/el\s*salvador/i,            { id: '222', lat:  13.8, lon: -88.9, canonical: 'El Salvador' }],
  [/kashmir/i,                  { id: '356', lat:  34.0, lon:  74.0, canonical: 'Kashmir' }],
];

const _matchCountryCache = new Map<string, CountryInfo | null>();
function matchCountry(name: string): CountryInfo | null {
  if (_matchCountryCache.has(name)) return _matchCountryCache.get(name)!;
  for (const [re, info] of COUNTRY_INDEX) {
    if (re.test(name)) {
      _matchCountryCache.set(name, info);
      return info;
    }
  }
  _matchCountryCache.set(name, null);
  return null;
}

const LEVEL_ORDER: ThreatLevel[] = ['low', 'elevated', 'high', 'critical'];
/** O(1) rank lookup — avoids repeated indexOf scans across hot loops */
const LEVEL_RANK = new Map<ThreatLevel, number>(LEVEL_ORDER.map((l, i) => [l, i]));

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
function aggregateByCountry(features: GdeltFeature[], batchTimestamp: string): Map<string, {
  info: CountryInfo; count: number; bestLat: number; bestLon: number; maxCluster: number; lastEventTimestamp: string;
}> {
  const map = new Map<string, {
    info: CountryInfo; count: number; bestLat: number; bestLon: number; maxCluster: number; lastEventTimestamp: string;
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
        lastEventTimestamp: batchTimestamp,
      });
    }
  }
  return map;
}

/**
 * Layer 2 — Signal Engine
 *
 * Severity scoring model (per spec):
 *   severityScore = (fatalities * 5) + highSeverityEventWeight + (eventFrequencyDelta * 2)
 *
 * Mapped to GDELT data:
 *   highSeverityEventWeight = Event Volume × Base Weight (confirmed physical violence events)
 *   eventFrequencyDelta     = rolling-window acceleration (current − prior) / max(1, prior)
 *   fatalities              = not available from GDELT pointdata (counted in overall score)
 *
 * Full score formula:
 *   Score = (Event Volume × Base Weight) × (1 + Acceleration Modifier)
 *
 * Where:
 *   Base Weight      ≈ 2.0 (confirmed violence codes 18/19/20 only)
 *   Acceleration Modifier = clamp(accelerationRate × 0.3, −0.15, +0.30)
 *     accelerationRate = (current − prior) / max(1, prior)
 *
 * Decay: when currentCount drops to zero (no events in rolling window), the score
 * is zero — the conflict is automatically classified as 'inactive' and removed from the map.
 *
 * Risk classification (Layer 3 signal output):
 *   ≥ 300 → Critical  (mass-casualty / open warfare)
 *   ≥  80 → High      (active conflict / serious instability)
 *   ≥  15 → Elevated  (rising tension / recurring violence)
 *   <  15 → Low       (monitored / occasional incidents — below ACTIVE_THRESHOLD)
 */
function computeScore(currentCount: number, priorCount: number): {
  score: number;
  level: ThreatLevel;
  direction: '↑' | '↓' | '→';
  accelerationPct: number;
} {
  // Rolling-window Acceleration Rate: proportional change from prior period
  // When currentCount is zero → full decay; no events = no active conflict signal
  const accelerationRate = priorCount > 0
    ? (currentCount - priorCount) / priorCount
    : (currentCount > 0 ? NEW_SIGNAL_RATE : 0);

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

/**
 * Classify conflict state from score and acceleration:
 *   active_conflict      — score ≥ ESCALATING_THRESHOLD (shown on map)
 *   escalating_tension   — score ≥ ACTIVE_THRESHOLD but < ESCALATING_THRESHOLD (sidebar only)
 *   inactive             — score < ACTIVE_THRESHOLD (not shown)
 */
function computeConflictState(score: number): 'active_conflict' | 'escalating_tension' | 'inactive' {
  if (score >= ESCALATING_THRESHOLD) return 'active_conflict';
  if (score >= ACTIVE_THRESHOLD)     return 'escalating_tension';
  return 'inactive';
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

// ── Shared fetch headers ───────────────────────────────────────
const FETCH_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'situation-monitor/1.0 (https://github.com/o-goodall/situation-monitor)',
};

// ── ReliefWeb integration ──────────────────────────────────────
// UN OCHA humanitarian crisis data — https://reliefweb.int/help/api
// No API key required; updated continuously.
const RELIEFWEB_URL =
  'https://api.reliefweb.int/v1/disasters' +
  '?appname=situation-monitor' +
  '&profile=list' +
  '&preset=latest' +
  '&slim=1' +
  '&limit=50' +
  '&filter[operator]=AND' +
  '&filter[conditions][0][field]=status' +
  '&filter[conditions][0][value][]=ongoing' +
  '&filter[conditions][0][value][]=alert';

interface ReliefWebFields {
  name?: string;
  status?: string;
  country?: Array<{ name: string; iso3?: string }>;
  type?: Array<{ name: string }>;
}
interface ReliefWebDisaster { id: number; fields: ReliefWebFields }
interface ReliefWebResponse { data?: ReliefWebDisaster[] }

// Disaster types considered conflict/security threats (rather than natural disasters)
const RW_CONFLICT_TYPES = new Set([
  'Armed Conflict',
  'Civil Unrest',
  'Complex Emergency',
  'Extrajudicial Killings',
  'Violence Against Civilians',
  'Epidemic',       // included: public health crises with security implications
  'Famine',         // included: famine often conflict-driven
  'Displacement',
]);

function reliefWebLevel(types: Array<{ name: string }>, status?: string): ThreatLevel {
  const names = types.map(t => t.name);
  if (names.some(n => n === 'Armed Conflict' || n === 'Complex Emergency')) {
    return status === 'alert' ? 'critical' : 'high';
  }
  if (names.some(n => RW_CONFLICT_TYPES.has(n))) {
    return status === 'alert' ? 'high' : 'elevated';
  }
  return 'elevated'; // all ongoing/alert disasters at minimum elevated
}

interface ReliefWebEntry { info: CountryInfo; level: ThreatLevel; types: string[] }

async function fetchReliefWebThreats(): Promise<Map<string, ReliefWebEntry>> {
  const res = await fetch(RELIEFWEB_URL, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`ReliefWeb HTTP ${res.status}`);
  const body: ReliefWebResponse = await res.json();

  const map = new Map<string, ReliefWebEntry>();
  for (const disaster of body.data ?? []) {
    const f = disaster.fields;
    const types = (f.type ?? []).map(t => t.name);
    for (const country of f.country ?? []) {
      const info = matchCountry(country.name);
      if (!info) continue;
      const level = reliefWebLevel(f.type ?? [], f.status);
      const existing = map.get(info.canonical);
      if (!existing || (LEVEL_RANK.get(level) ?? -1) > (LEVEL_RANK.get(existing.level) ?? -1)) {
        map.set(info.canonical, { info, level, types });
      }
    }
  }
  return map;
}

// ── UCDP integration ───────────────────────────────────────────
// Uppsala Conflict Data Program — https://ucdp.uu.se/apidocs/
// GED (Georeferenced Event Dataset): annual snapshots, updated periodically.
// Tries current year first; falls back to prior year if empty.
const UCDP_YEAR = new Date().getFullYear();
const UCDP_BASE = 'https://ucdp.uu.se/api/gedevents/';
const UCDP_PARAMS = '?pagesize=200&page=1';

interface UcdpEvent {
  id?: string;
  conflict_name?: string;
  country_txt?: string;
  latitude?: number;
  longitude?: number;
  deaths_a?: number;
  deaths_b?: number;
  deaths_civilians?: number;
  type_of_violence?: number; // 1=state-based, 2=non-state, 3=one-sided
}
interface UcdpResponse { TotalCount?: number; Result?: UcdpEvent[] }

interface UcdpEntry { info: CountryInfo; level: ThreatLevel; eventCount: number; totalDeaths: number }

function ucdpLevel(totalDeaths: number): ThreatLevel {
  if (totalDeaths >= 50) return 'critical';
  if (totalDeaths >= 25) return 'high';
  if (totalDeaths >= 5)  return 'elevated';
  return 'low';
}

async function fetchUcdpThreats(): Promise<Map<string, UcdpEntry>> {
  async function tryYear(year: number): Promise<UcdpEvent[]> {
    const res = await fetch(`${UCDP_BASE}${year}${UCDP_PARAMS}`, { headers: FETCH_HEADERS });
    if (!res.ok) return [];
    const body: UcdpResponse = await res.json();
    return body.Result ?? [];
  }

  let events = await tryYear(UCDP_YEAR);
  // GED releases typically lag ~1 year; fall back to prior year if current is empty
  if (!events.length) events = await tryYear(UCDP_YEAR - 1);
  if (!events.length) throw new Error('UCDP: no data for current or prior year');

  const map = new Map<string, UcdpEntry>();
  for (const event of events) {
    const info = matchCountry(event.country_txt ?? '');
    if (!info) continue;
    const deaths = (event.deaths_a ?? 0) + (event.deaths_b ?? 0) + (event.deaths_civilians ?? 0);
    const existing = map.get(info.canonical);
    if (existing) {
      existing.eventCount++;
      existing.totalDeaths += deaths;
      const newLevel = ucdpLevel(existing.totalDeaths);
      if ((LEVEL_RANK.get(newLevel) ?? -1) > (LEVEL_RANK.get(existing.level) ?? -1)) {
        existing.level = newLevel;
      }
    } else {
      map.set(info.canonical, {
        info,
        level: ucdpLevel(deaths),
        eventCount: 1,
        totalDeaths: deaths,
      });
    }
  }
  return map;
}

// ── CEWARN integration ─────────────────────────────────────────
// IGAD Conflict Early Warning and Response Mechanism — https://cewarn.org
// Covers East Africa: Ethiopia, Eritrea, Djibouti, Kenya, Somalia,
//   South Sudan, Sudan, Uganda, and adjacent areas.
// Attempts the public incidents endpoint; gracefully skipped if unavailable.
const CEWARN_URL = 'https://api.cewarn.org/v1/incidents?limit=200&format=json';

interface CewarnIncident {
  id?: string | number;
  country?: string;
  fatalities?: number;
  incident_type?: string;
}
interface CewarnResponse {
  incidents?: CewarnIncident[];
  data?: CewarnIncident[];
  results?: CewarnIncident[];
}

interface CewarnEntry { info: CountryInfo; level: ThreatLevel; incidentCount: number; totalFatalities: number }

function cewarnLevel(totalFatalities: number): ThreatLevel {
  if (totalFatalities >= 50) return 'critical';
  if (totalFatalities >= 10) return 'high';
  return 'elevated'; // all CEWARN incidents are conflict-grade by definition
}

async function fetchCewarnThreats(): Promise<Map<string, CewarnEntry>> {
  const res = await fetch(CEWARN_URL, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`CEWARN HTTP ${res.status}`);
  const body: CewarnResponse = await res.json();
  const incidents = body.incidents ?? body.data ?? body.results ?? [];

  const map = new Map<string, CewarnEntry>();
  for (const incident of incidents) {
    const info = matchCountry(incident.country ?? '');
    if (!info) continue;
    const fatalities = incident.fatalities ?? 0;
    const existing = map.get(info.canonical);
    if (existing) {
      existing.incidentCount++;
      existing.totalFatalities += fatalities;
      const newLevel = cewarnLevel(existing.totalFatalities);
      if ((LEVEL_RANK.get(newLevel) ?? -1) > (LEVEL_RANK.get(existing.level) ?? -1)) {
        existing.level = newLevel;
      }
    } else {
      map.set(info.canonical, { info, level: cewarnLevel(fatalities), incidentCount: 1, totalFatalities: fatalities });
    }
  }
  return map;
}

// ── Source merge helpers ───────────────────────────────────────
/**
 * Merge secondary-source threat data into the primary threats array.
 *
 * For countries already present in the primary array:
 *   • The threat level is upgraded if the secondary source reports a higher one.
 *   • The description is annotated with the secondary source label.
 *
 * For countries only present in a secondary source:
 *   • A new Threat entry is created with zero GDELT score and '→' direction.
 *   • conflictState is set to 'escalating_tension' (secondary-only signals are lower confidence).
 */
function mergeSecondarySource(
  threats: Map<string, Threat>,
  source: Map<string, { info: CountryInfo; level: ThreatLevel }>,
  sourceLabel: string,
  batchTimestamp: string,
): void {
  for (const [name, data] of source) {
    const existing = threats.get(name);
    if (existing) {
      // Upgrade level if secondary source is more severe
      if ((LEVEL_RANK.get(data.level) ?? -1) > (LEVEL_RANK.get(existing.level) ?? -1)) {
        existing.level = data.level;
      }
      // Annotate description
      if (!existing.desc.includes(sourceLabel)) {
        existing.desc += ` · ${sourceLabel}`;
      }
    } else {
      // New country not seen in GDELT — secondary-source only
      threats.set(name, {
        id:                 name.toLowerCase().replace(/\s+/g, '-'),
        name,
        lat:                data.info.lat,
        lon:                data.info.lon,
        level:              data.level,
        desc:               `${name} — ${riskLabel(data.level)} (${sourceLabel})`,
        countryId:          data.info.id,
        score:              0,
        direction:          '→',
        accelerationPct:    0,
        recentEventCount:   0,
        lastEventTimestamp: batchTimestamp,
        conflictState:      'escalating_tension',
      });
    }
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
    const batchTimestamp = now.toISOString();
    const priorEndDt   = dtStr(new Date(now.getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000));
    const priorStartDt = dtStr(new Date(now.getTime() - 2 * ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000));

    // Fetch all data sources in parallel:
    //   [0] GDELT current rolling window   (primary)
    //   [1] GDELT prior rolling window     (for acceleration calc)
    //   [2] ReliefWeb ongoing disasters    (secondary — best-effort)
    //   [3] UCDP georeferenced events      (secondary — best-effort)
    //   [4] CEWARN incident reports        (secondary — best-effort)
    const [currentRes, priorRes, rwResult, ucdpResult, cewarnResult] = await Promise.all([
      fetch(gdeltUrl({ timespan: GDELT_TIMESPAN_MINS }), { headers: FETCH_HEADERS }),
      fetch(gdeltUrl({ startDt: priorStartDt, endDt: priorEndDt }), { headers: FETCH_HEADERS }),
      fetchReliefWebThreats().catch(e => { console.warn('ReliefWeb fetch failed:', e); return new Map<string, ReliefWebEntry>(); }),
      fetchUcdpThreats().catch(e => { console.warn('UCDP fetch failed:', e); return new Map<string, UcdpEntry>(); }),
      fetchCewarnThreats().catch(e => { console.warn('CEWARN fetch failed:', e); return new Map<string, CewarnEntry>(); }),
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

    const currentMap = aggregateByCountry(currentFeatures, batchTimestamp);
    const priorMap   = aggregateByCountry(priorFeatures, batchTimestamp);

    // ── Step 1: Apply daily decay to seed scores ──────────────────────────────
    // Seeds are initialized at SEED_INITIAL_SCORE on first load, then decay at
    // DECAY_RATE per day when no GDELT events are detected for that conflict.
    const nowMs = Date.now();
    if (_lastDecayApplied === 0) _lastDecayApplied = nowMs;
    const decayDays = Math.floor((nowMs - _lastDecayApplied) / DECAY_INTERVAL_MS);
    const decayFactor = decayDays > 0 ? Math.pow(DECAY_RATE, decayDays) : 1;
    if (decayDays > 0) {
      for (const [canonical, score] of _seedScores) {
        _seedScores.set(canonical, score * decayFactor);
      }
      _lastDecayApplied += decayDays * DECAY_INTERVAL_MS;
      if (DEBUG_THREATS) console.log(`[threats:decay] Applied ${decayDays} decay step(s), factor=${decayFactor.toFixed(4)}`);
    }
    // Ensure all major conflict seeds are initialised
    for (const seed of MAJOR_CONFLICTS) {
      if (!_seedScores.has(seed.canonical)) {
        _seedScores.set(seed.canonical, SEED_INITIAL_SCORE);
      }
    }

    // ── Step 2: Boost seed scores from GDELT event counts ────────────────────
    for (const [canonical, { count }] of currentMap) {
      if (_seedScores.has(canonical)) {
        const priorCount = priorMap.get(canonical)?.count ?? 0;
        const { score: gdeltScore } = computeScore(count, priorCount);
        // Take the higher of the current seed score and GDELT-derived score
        _seedScores.set(canonical, Math.max(_seedScores.get(canonical)!, gdeltScore));
      }
    }

    // Build initial threat map from GDELT (Layer 1 — Raw Event Stream → Layer 2 Signal Engine)
    // Only conflicts meeting ACTIVE_THRESHOLD are included; lower-signal countries are dropped.
    const threatMap = new Map<string, Threat>();
    for (const [name, { info, count, bestLat, bestLon, lastEventTimestamp }] of currentMap) {
      const priorCount = priorMap.get(name)?.count ?? 0;
      const { score, level, direction, accelerationPct } = computeScore(count, priorCount);
      const conflictState = computeConflictState(score);

      // Apply ACTIVE_THRESHOLD: exclude inactive conflicts from the map
      if (conflictState === 'inactive') {
        if (DEBUG_THREATS) {
          console.log(`[threats:reject] name=${name} score=${score} < threshold=${ACTIVE_THRESHOLD} state=inactive`);
        }
        continue;
      }

      const accelStr = accelerationPct !== 0
        ? ` (${accelerationPct > 0 ? '+' : ''}${accelerationPct}% vs prior ${ROLLING_WINDOW_DAYS}d)`
        : '';

      threatMap.set(name, {
        id:                 name.toLowerCase().replace(/\s+/g, '-'),
        name,
        lat:                bestLat,
        lon:                bestLon,
        level,
        desc:               `${direction} ${name} — ${riskLabel(level)} · ${directionLabel(direction)}${accelStr} · ${count} events/${ROLLING_WINDOW_DAYS}d (GDELT)`,
        countryId:          info.id,
        score,
        direction,
        accelerationPct,
        recentEventCount:   count,
        lastEventTimestamp,
        conflictState,
      });
    }

    // ── Step 3: Merge major conflict seeds into threatMap ─────────────────────
    // For each of the 14 major conflicts:
    //   • If GDELT already detected it (via canonical name match), rename the entry to the
    //     seed's descriptive name so the map shows "Russia–Ukraine War" not just "Ukraine".
    //   • If GDELT did not detect it, add a seed entry if its decayed score is still active.
    //     This ensures all 14 conflicts stay visible until fighting stops.
    for (const seed of MAJOR_CONFLICTS) {
      const seedScore     = _seedScores.get(seed.canonical) ?? SEED_INITIAL_SCORE;
      const conflictState = computeConflictState(Math.round(seedScore));

      const gdeltEntry = threatMap.get(seed.canonical);
      if (gdeltEntry) {
        // Enrich GDELT entry with the seed's descriptive name
        gdeltEntry.name = seed.name;
        gdeltEntry.id   = seed.name.toLowerCase().replace(/[\s–—]+/g, '-').replace(/[^a-z0-9-]/g, '');
        gdeltEntry.desc = gdeltEntry.desc.replace(seed.canonical, seed.name);
        // Ensure countryId is set (GDELT uses info.id which may differ from seed.countryId)
        if (seed.countryId && !gdeltEntry.countryId) gdeltEntry.countryId = seed.countryId;
      } else {
        // Seed not found in GDELT — add from seed state if still active
        if (conflictState === 'inactive') {
          if (DEBUG_THREATS) {
            console.log(`[threats:seed-decay] ${seed.name} score=${seedScore.toFixed(1)} < threshold=${ACTIVE_THRESHOLD} — removed from map`);
          }
          continue;
        }
        const level: ThreatLevel =
          seedScore >= SCORE_CRITICAL ? 'critical' :
          seedScore >= SCORE_HIGH     ? 'high' :
          seedScore >= SCORE_ELEVATED ? 'elevated' : 'low';
        threatMap.set(seed.canonical, {
          id:                 seed.name.toLowerCase().replace(/[\s–—]+/g, '-').replace(/[^a-z0-9-]/g, ''),
          name:               seed.name,
          lat:                seed.lat,
          lon:                seed.lon,
          level,
          desc:               `${seed.name} — ${riskLabel(level)} · Active conflict`,
          countryId:          seed.countryId,
          score:              Math.round(seedScore),
          direction:          '→',
          accelerationPct:    0,
          recentEventCount:   0,
          lastEventTimestamp: batchTimestamp,
          conflictState,
        });
      }
    }

    // Merge secondary sources — each enriches or adds to the GDELT baseline
    mergeSecondarySource(threatMap, rwResult,     'ReliefWeb', batchTimestamp);
    mergeSecondarySource(threatMap, ucdpResult,   'UCDP',      batchTimestamp);
    mergeSecondarySource(threatMap, cewarnResult, 'CEWARN',    batchTimestamp);

    // Only send active_conflict and escalating_tension to the map; inactive are dropped
    const threats = Array.from(threatMap.values())
      .filter(t => t.conflictState !== 'inactive');
    threats.sort((a, b) => (LEVEL_RANK.get(b.level) ?? -1) - (LEVEL_RANK.get(a.level) ?? -1));

    const conflictCountryIds = threats.filter(t => t.countryId).map(t => t.countryId as string);
    const payload = { threats, conflictCountryIds, updatedAt: batchTimestamp };
    _cache = payload;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    return json(payload, { headers: { 'Cache-Control': 's-maxage=900, stale-while-revalidate=120' } });
  } catch (err) {
    console.error('Conflict data fetch failed, using static fallback:', err);
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

