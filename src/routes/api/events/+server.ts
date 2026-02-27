import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import nlp from 'compromise';

const parser = new Parser();

// ── RSS feeds to scrape ────────────────────────────────────────
// Al Jazeera is the exclusive source for live geopolitical/conflict events.
const RSS_FEEDS = [
  'https://www.aljazeera.com/xml/rss/subjects/conflict.xml',
  'https://www.aljazeera.com/xml/rss/all.xml',
];

const ARTICLES_PER_FEED = 8;

// ── Max geocode calls per invocation (caps worst-case latency) ─
const MAX_GEOCODE_CALLS = 12;

// ── Validation configuration ───────────────────────────────────
/** Events older than this threshold are rejected (recency constraint) */
const RECENCY_HOURS = 72;

/** Minimum severity score required for an event to be included in the map feed */
const SEVERE_THRESHOLD = 8;

/**
 * Enable debug mode to log rejection reasons to the server console.
 * Set to true during threshold tuning; leave false in production.
 */
const DEBUG_EVENTS = false;

/**
 * Contextual noise keywords — titles containing these are likely book reviews,
 * documentaries, historical discussions, or other non-event narratives.
 * Events matching these are rejected UNLESS fatalities > 0.
 */
const NOISE_KEYWORDS = [
  'book',
  'novel',
  'documentary',
  'film',
  'anniversary',
  'museum',
  'exhibition',
  'history of',
  'memoir',
  'biography',
  'podcast',
  'interview',
  'review',
  'analysis',
  'retrospective',
  'explainer',
  'opinion',
  'op-ed',
];

// ── Severity keywords ──────────────────────────────────────────
const SEVERITY_CRITICAL = /\b(missile|airstrike|nuclear|chemical|massacre|genocide)\b/i;
const SEVERITY_HIGH     = /\b(war|attack|explosion|bombing|killed|death|casualties)\b/i;
const SEVERITY_ELEVATED = /\b(conflict|clashes|military|tension|troops|invasion)\b/i;

/** Per-level weights for severity scoring (fatalities unavailable from RSS) */
const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 20,
  high:     15,
  elevated:  8,
  low:       2,
};

export type EventLevel = 'critical' | 'high' | 'elevated' | 'low';

export interface ThreatEvent {
  id: string;
  title: string;
  location: string;
  lat: number;
  lon: number;
  level: EventLevel;
  score: number;
  pubDate: string;
  link: string;
  /** Country name from Nominatim reverse-geocode (used client-side to deduplicate against threat markers) */
  country?: string;
}

// ── In-memory geocode cache ────────────────────────────────────
const geoCache: Record<string, { lat: number; lon: number; country?: string } | null> = {};

// ── Module-level response cache (5-minute TTL) ─────────────────
let _cachedResponse: { events: ThreatEvent[]; updatedAt: string } | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function classifySeverity(title: string): EventLevel {
  if (SEVERITY_CRITICAL.test(title)) return 'critical';
  if (SEVERITY_HIGH.test(title))     return 'high';
  if (SEVERITY_ELEVATED.test(title)) return 'elevated';
  return 'low';
}

function extractLocation(title: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const places: string[] = (nlp(title) as any).places().out('array');
  return places.length > 0 ? places[0] : null;
}

async function geocode(place: string): Promise<{ lat: number; lon: number; country?: string } | null> {
  if (place in geoCache) return geoCache[place];

  try {
    const encoded = encodeURIComponent(place);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&addressdetails=1`,
      { headers: { 'User-Agent': 'situation-monitor/1.0 (https://github.com/o-goodall/situation-monitor)' } }
    );
    if (!res.ok) { geoCache[place] = null; return null; }
    const data: Array<{ lat: string; lon: string; address?: { country?: string } }> = await res.json();
    if (!data.length) { geoCache[place] = null; return null; }
    const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), country: data[0].address?.country };
    geoCache[place] = result;
    return result;
  } catch {
    geoCache[place] = null;
    return null;
  }
}

/** Time-decay score: 1.0 at publish time → 0.1 after 24 h */
function timeDecayScore(pubDate: string, level: EventLevel): number {
  const ageMs = Date.now() - new Date(pubDate).getTime();
  const ageH  = ageMs / 3_600_000;
  const decay = Math.max(0.1, 1 - ageH / 24);

  const levelBoost: Record<EventLevel, number> = {
    critical: 1.0,
    high:     0.75,
    elevated: 0.5,
    low:      0.25,
  };
  return +(decay * levelBoost[level]).toFixed(3);
}

// ── Event validation helpers ───────────────────────────────────

/**
 * Returns true if the event title contains contextual noise keywords indicating
 * a book review, documentary, historical discussion, or other non-event narrative.
 * Events matching noise keywords are always rejected (fatalities from RSS are unknown).
 */
function isContextualNoise(title: string): boolean {
  const lower = title.toLowerCase();
  return NOISE_KEYWORDS.some(kw => lower.includes(kw));
}

/** Returns true if the event was published within the recency window */
function isRecent(pubDate: string): boolean {
  const ageMs = Date.now() - new Date(pubDate).getTime();
  return ageMs <= RECENCY_HOURS * 3_600_000;
}

/**
 * Severity scoring model:
 *   severityScore = (fatalities * 5) + highSeverityEventWeight + (eventFrequencyDelta * 2)
 *
 * For RSS-derived events, fatalities and eventFrequencyDelta are not available from
 * the feed; the weight of the classified severity level is used as the primary signal.
 */
function computeSeverityScore(level: EventLevel, fatalities = 0, eventFrequencyDelta = 0): number {
  return (fatalities * 5) + (SEVERITY_WEIGHTS[level] ?? 0) + (eventFrequencyDelta * 2);
}

/** Log a rejection reason to the server console when DEBUG_EVENTS is enabled */
function debugReject(id: string, source: string, rule: string): void {
  if (DEBUG_EVENTS) {
    console.log(`[events:reject] id=${id} source=${source} rule="${rule}"`);
  }
}

// ── Main handler ───────────────────────────────────────────────
export async function GET(_event: RequestEvent) {
  // Serve from module-level cache if still fresh
  if (_cachedResponse && Date.now() < _cacheExpiresAt) {
    return json(_cachedResponse, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } });
  }

  try {
    // Fetch all feeds in parallel, ignore failures
    const feedResults = await Promise.allSettled(
      RSS_FEEDS.map(url => parser.parseURL(url))
    );

    // Collect headline items
    const raw: Array<{ title: string; link: string; pubDate: string }> = [];
    for (const result of feedResults) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value.items.slice(0, ARTICLES_PER_FEED)) {
        if (item.title && item.link) {
          raw.push({
            title:   item.title,
            link:    item.link,
            pubDate: item.pubDate ?? new Date().toISOString(),
          });
        }
      }
    }

    // Deduplicate by title
    const seen = new Set<string>();
    const unique = raw.filter(item => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // ── Pre-geocode validation: apply recency and contextual noise filters
    // before geocoding to avoid wasting Nominatim API calls on rejected events.
    const preValidated = unique.filter(item => {
      const id = Buffer.from(item.title.slice(0, 40)).toString('base64');
      if (!isRecent(item.pubDate)) {
        debugReject(id, item.link, `recency: older than ${RECENCY_HOURS}h`);
        return false;
      }
      if (isContextualNoise(item.title)) {
        debugReject(id, item.link, 'noise: contextual non-event keyword detected');
        return false;
      }
      return true;
    });

    // Extract locations; only geocode items not already in cache to respect
    // Nominatim's rate limit of 1 request/second (1.1s delay between calls).
    // Limit total network geocode calls per invocation to cap worst-case latency.
    const withLocation = preValidated
      .map(item => ({ ...item, location: extractLocation(item.title) }))
      .filter((item): item is typeof item & { location: string } => item.location !== null);

    const geocoded: (typeof withLocation[0] & { lat: number; lon: number; country?: string } | null)[] = [];
    let networkCallsMade = 0;
    for (const item of withLocation) {
      const alreadyCached = item.location in geoCache;
      if (!alreadyCached && networkCallsMade >= MAX_GEOCODE_CALLS) {
        // Skip further uncached lookups once we've hit the per-invocation cap
        geocoded.push(null);
        continue;
      }
      const geo = await geocode(item.location);
      if (!alreadyCached) {
        networkCallsMade++;
        // Throttle only actual network requests to stay within 1 req/s
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
      geocoded.push(geo ? { ...item, ...geo } : null);
    }

    // Build events array — only include events that meet the severity threshold
    const events: ThreatEvent[] = geocoded
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .flatMap(e => {
        const level = classifySeverity(e.title);
        const id = Buffer.from(e.title.slice(0, 40)).toString('base64');
        const severityScore = computeSeverityScore(level);
        if (severityScore < SEVERE_THRESHOLD) {
          debugReject(id, e.link, `severity: score ${severityScore} < threshold ${SEVERE_THRESHOLD} (level=${level})`);
          return [];
        }
        return [{
          id,
          title:    e.title,
          location: e.location,
          lat:      e.lat,
          lon:      e.lon,
          level,
          score:    timeDecayScore(e.pubDate, level),
          pubDate:  e.pubDate,
          link:     e.link,
          country:  e.country,
        }];
      })
      .sort((a, b) => b.score - a.score);

    const payload = { events, updatedAt: new Date().toISOString() };
    _cachedResponse = payload;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    return json(
      payload,
      { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } }
    );
  } catch {
    return json(
      { events: [], updatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 's-maxage=60' } }
    );
  }
}
