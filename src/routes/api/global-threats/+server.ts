import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';

const parser = new Parser();

/**
 * GET /api/global-threats
 *
 * Fetches serious global conflict events from trusted RSS sources:
 *   1. Al Jazeera – Conflict Section
 *   2. ReliefWeb – UN OCHA Conflicts & Crises
 *
 * Events are filtered by conflict keywords and casualty threshold,
 * geocoded via Nominatim, and returned as GlobalThreatEvent[].
 *
 * Intended to be called by the Vercel cron job every 30 minutes
 * (configured in vercel.json).
 */

// ── Trusted RSS sources (per spec) ────────────────────────────
const RSS_FEEDS = [
  { url: 'https://www.aljazeera.com/xml/rss/subjects/conflict.xml', source: 'Al Jazeera' },
  { url: 'https://reliefweb.int/updates/rss.xml',                   source: 'ReliefWeb'  },
];

const ARTICLES_PER_FEED = 15;

// ── Conflict keyword filter ────────────────────────────────────
// Only events matching at least one of these keywords are retained.
const CONFLICT_KEYWORDS = [
  'killed', 'dead', 'attack', 'bombing', 'shelling', 'massacre',
  'clashes', 'casualties', 'war', 'conflict', 'airstrike', 'air strike',
  'militants', 'rebels', 'displaced', 'violence', 'explosion', 'strike',
  'offensive', 'assault', 'troops', 'military', 'gunfire', 'artillery',
];
const CONFLICT_KW_RE = new RegExp(`\\b(${CONFLICT_KEYWORDS.join('|')})\\b`, 'i');

// ── Casualty extraction (rough) ───────────────────────────────
// Matches patterns like "killed 45", "45 killed", "150 dead", "over 200 casualties"
const CASUALTY_RE = /(?:(\d{1,5})\s+(?:killed|dead|casualties|deaths|wounded|injured))|(?:(?:killed|dead|casualties|deaths|wounded|injured)\s+(\d{1,5}))/gi;

function extractCasualties(text: string): number | null {
  let max = 0;
  let found = false;
  let m: RegExpExecArray | null;
  CASUALTY_RE.lastIndex = 0;
  while ((m = CASUALTY_RE.exec(text)) !== null) {
    const n = parseInt(m[1] ?? m[2], 10);
    if (!isNaN(n) && n > max) { max = n; found = true; }
  }
  return found ? max : null;
}

// ── Severity classification ────────────────────────────────────
export type GlobalThreatSeverity = 'major' | 'medium' | 'minor';

function classifySeverity(casualties: number | null): GlobalThreatSeverity {
  if (casualties !== null && casualties >= 200) return 'major';
  if (casualties !== null && casualties >= 50)  return 'medium';
  return 'minor';
}

// ── Geocode cache + Nominatim helper ──────────────────────────
const geoCache: Record<string, { lat: number; lon: number } | null> = {};
const MAX_GEOCODE_CALLS = 10;

async function geocode(place: string): Promise<{ lat: number; lon: number } | null> {
  if (place in geoCache) return geoCache[place];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'situation-monitor/1.0 (https://github.com/o-goodall/situation-monitor)' } }
    );
    if (!res.ok) { geoCache[place] = null; return null; }
    const data: Array<{ lat: string; lon: string }> = await res.json();
    if (!data.length)  { geoCache[place] = null; return null; }
    const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    geoCache[place] = result;
    return result;
  } catch {
    geoCache[place] = null;
    return null;
  }
}

// ── Location extraction — simple country/city name lookup ─────
// Matches known high-risk country names in the title/summary.
const KNOWN_LOCATIONS: [RegExp, string][] = [
  [/\bukraine\b/i,            'Ukraine'],
  [/\bgaza\b/i,               'Gaza'],
  [/\bpalestine\b/i,          'Palestine'],
  [/\bisrael\b/i,             'Israel'],
  [/\bsyria\b/i,              'Syria'],
  [/\byemen\b/i,              'Yemen'],
  [/\bsudan\b/i,              'Sudan'],
  [/\bsomalia\b/i,            'Somalia'],
  [/\bafghanistan\b/i,        'Afghanistan'],
  [/\biraq\b/i,               'Iraq'],
  [/\biran\b/i,               'Iran'],
  [/\bmyanmar\b|burma/i,      'Myanmar'],
  [/\bethiopia\b/i,           'Ethiopia'],
  [/\bdrc\b|congo\b/i,        'DR Congo'],
  [/\bmali\b/i,               'Mali'],
  [/\bburnkina\s*faso\b|burkina/i, 'Burkina Faso'],
  [/\bnigeria\b/i,            'Nigeria'],
  [/\bliby/i,                 'Libya'],
  [/\bhaiti\b/i,              'Haiti'],
  [/\blebanon\b/i,            'Lebanon'],
  [/\bpakistan\b/i,           'Pakistan'],
  [/\bindia\b/i,              'India'],
  [/\bkashmir\b/i,            'Kashmir'],
  [/\bnorth\s*korea\b/i,      'North Korea'],
  [/\btaiwan\b/i,             'Taiwan'],
  [/\bcameroon\b/i,           'Cameroon'],
  [/\bmozambique\b/i,         'Mozambique'],
  [/south\s*sudan/i,          'South Sudan'],
  [/\bcolumbia\b|\bcolombia\b/i, 'Colombia'],
  [/\bmexico\b/i,             'Mexico'],
  [/\bvenezuela\b/i,          'Venezuela'],
  [/\bchad\b/i,               'Chad'],
  [/central\s*african\s*republic\b/i, 'Central African Republic'],
];

function extractLocation(text: string): string | null {
  for (const [re, name] of KNOWN_LOCATIONS) {
    if (re.test(text)) return name;
  }
  return null;
}

export interface GlobalThreatEvent {
  id: string;
  title: string;
  summary: string;
  location: string;
  lat: number;
  lon: number;
  casualties: number | null;
  severity: GlobalThreatSeverity;
  pubDate: string;
  link: string;
  source: string;
}

// ── Recency filter (7-day TTL per spec) ───────────────────────
const RECENCY_HOURS = 168;
function isRecent(pubDate: string): boolean {
  return Date.now() - new Date(pubDate).getTime() <= RECENCY_HOURS * 3_600_000;
}

// ── Module-level response cache (30-minute TTL) ────────────────
let _cachedResponse: { events: GlobalThreatEvent[]; updatedAt: string } | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes (matches cron schedule)

// ── Main handler ───────────────────────────────────────────────
export async function GET(_event: RequestEvent) {
  if (_cachedResponse && Date.now() < _cacheExpiresAt) {
    return json(_cachedResponse, { headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=120' } });
  }

  try {
    const feedResults = await Promise.allSettled(
      RSS_FEEDS.map(f => parser.parseURL(f.url).then(feed => ({ feed, source: f.source })))
    );

    // Collect raw items from all feeds
    interface RawItem { title: string; link: string; summary: string; pubDate: string; source: string }
    const raw: RawItem[] = [];
    for (const result of feedResults) {
      if (result.status !== 'fulfilled') continue;
      const { feed, source } = result.value;
      for (const item of feed.items.slice(0, ARTICLES_PER_FEED)) {
        if (!item.title || !item.link) continue;
        raw.push({
          title:   item.title,
          link:    item.link,
          summary: item.contentSnippet ?? item.summary ?? item.content ?? '',
          pubDate: item.pubDate ?? new Date().toISOString(),
          source,
        });
      }
    }

    // Deduplicate by title prefix
    const seen = new Set<string>();
    const unique = raw.filter(item => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter: recency + conflict keyword match
    const filtered = unique.filter(item => {
      if (!isRecent(item.pubDate)) return false;
      const text = `${item.title} ${item.summary}`;
      return CONFLICT_KW_RE.test(text);
    });

    // Extract location + casualties, keep only events with a known location
    const withMeta = filtered
      .map(item => {
        const text = `${item.title} ${item.summary}`;
        const location = extractLocation(text);
        const casualties = extractCasualties(text);
        return { ...item, location, casualties };
      })
      .filter((item): item is typeof item & { location: string } => item.location !== null);

    // Geocode (use cache-first approach; throttle actual network calls)
    const events: GlobalThreatEvent[] = [];
    let networkCalls = 0;

    for (const item of withMeta) {
      const alreadyCached = item.location in geoCache;
      if (!alreadyCached && networkCalls >= MAX_GEOCODE_CALLS) continue;

      const geo = await geocode(item.location);
      if (!alreadyCached) {
        networkCalls++;
        await new Promise(resolve => setTimeout(resolve, 1100)); // respect 1 req/s
      }
      if (!geo) continue;

      // Apply casualty threshold: require ≥10 casualties OR keyword match at severity level
      if (item.casualties !== null && item.casualties < 10) continue;

      const severity = classifySeverity(item.casualties);
      const id = Buffer.from(item.title.slice(0, 40)).toString('base64');

      events.push({
        id,
        title:     item.title,
        summary:   item.summary.slice(0, 300),
        location:  item.location,
        lat:       geo.lat,
        lon:       geo.lon,
        casualties: item.casualties,
        severity,
        pubDate:   item.pubDate,
        link:      item.link,
        source:    item.source,
      });
    }

    // Sort: major first, then by recency
    events.sort((a, b) => {
      const severityOrder: Record<GlobalThreatSeverity, number> = { major: 2, medium: 1, minor: 0 };
      const sd = severityOrder[b.severity] - severityOrder[a.severity];
      if (sd !== 0) return sd;
      return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
    });

    const payload = { events, updatedAt: new Date().toISOString() };
    _cachedResponse = payload;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    return json(payload, { headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=120' } });
  } catch {
    return json(
      { events: [], updatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 's-maxage=60' } }
    );
  }
}
