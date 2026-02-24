import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import nlp from 'compromise';

const parser = new Parser();

// ── RSS feeds to scrape ────────────────────────────────────────
const RSS_FEEDS = [
  'https://news.google.com/rss/search?q=war+OR+missile+OR+airstrike&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=explosion+OR+attack+OR+conflict&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=military+clashes&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=ceasefire+OR+sanctions+OR+troops+deployed&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=coup+OR+civil+war+OR+insurgency&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=humanitarian+crisis+OR+drone+strike&hl=en-US&gl=US&ceid=US:en',
];

const ARTICLES_PER_FEED = 8;

// ── Max geocode calls per invocation (caps worst-case latency) ─
const MAX_GEOCODE_CALLS = 12;

// ── Severity keywords ──────────────────────────────────────────
const SEVERITY_CRITICAL = /\b(missile|airstrike|nuclear|chemical|massacre|genocide)\b/i;
const SEVERITY_HIGH     = /\b(war|attack|explosion|bombing|killed|death|casualties)\b/i;
const SEVERITY_ELEVATED = /\b(conflict|clashes|military|tension|troops|invasion)\b/i;

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
}

// ── In-memory geocode cache ────────────────────────────────────
const geoCache: Record<string, { lat: number; lon: number } | null> = {};

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

async function geocode(place: string): Promise<{ lat: number; lon: number } | null> {
  if (place in geoCache) return geoCache[place];

  try {
    const encoded = encodeURIComponent(place);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`,
      { headers: { 'User-Agent': 'situation-monitor/1.0 (https://github.com/o-goodall/situation-monitor)' } }
    );
    if (!res.ok) { geoCache[place] = null; return null; }
    const data: Array<{ lat: string; lon: string }> = await res.json();
    if (!data.length) { geoCache[place] = null; return null; }
    const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
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

    // Extract locations; only geocode items not already in cache to respect
    // Nominatim's rate limit of 1 request/second (1.1s delay between calls).
    // Limit total network geocode calls per invocation to cap worst-case latency.
    const withLocation = unique
      .map(item => ({ ...item, location: extractLocation(item.title) }))
      .filter((item): item is typeof item & { location: string } => item.location !== null);

    const geocoded: (typeof withLocation[0] & { lat: number; lon: number } | null)[] = [];
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

    // Build events array
    const events: ThreatEvent[] = geocoded
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .map(e => {
        const level = classifySeverity(e.title);
        return {
          id:       Buffer.from(e.title.slice(0, 40)).toString('base64'),
          title:    e.title,
          location: e.location,
          lat:      e.lat,
          lon:      e.lon,
          level,
          score:    timeDecayScore(e.pubDate, level),
          pubDate:  e.pubDate,
          link:     e.link,
        };
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
