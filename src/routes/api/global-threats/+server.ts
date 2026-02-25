import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';

const parser = new Parser();

/**
 * GET /api/global-threats
 *
 * Fetches serious global conflict events from Al Jazeera Conflict RSS feed.
 * Events are filtered by conflict keywords and casualty threshold (≥10),
 * geocoded via Nominatim, aggregated by country, and returned as CountryThreat[].
 *
 * Intended to be called by the Vercel cron job every 30 minutes
 * (configured in vercel.json).
 */

// ── Single trusted RSS source ──────────────────────────────────
const RSS_URL = 'https://www.aljazeera.com/xml/rss/subjects/conflict.xml';
const ARTICLES_LIMIT = 20;

// ── Conflict keyword filter ────────────────────────────────────
const CONFLICT_KEYWORDS = [
  'killed', 'dead', 'bombing', 'airstrike', 'attack',
  'massacre', 'clashes', 'shelling', 'war', 'invasion',
  'militants', 'rebels', 'siege', 'offensive',
];
const CONFLICT_KW_RE = new RegExp(`\\b(${CONFLICT_KEYWORDS.join('|')})\\b`, 'i');

// ── Casualty extraction ────────────────────────────────────────
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
export type GlobalThreatSeverity = 'red' | 'orange' | 'green';

const SEVERITY_RANK: Record<GlobalThreatSeverity, number> = { red: 2, orange: 1, green: 0 };

function classifySeverity(casualties: number | null): GlobalThreatSeverity {
  if (casualties !== null && casualties >= 200) return 'red';
  if (casualties !== null && casualties >= 50)  return 'orange';
  return 'green';
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
    if (!data.length) { geoCache[place] = null; return null; }
    const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    geoCache[place] = result;
    return result;
  } catch {
    geoCache[place] = null;
    return null;
  }
}

// ── Location extraction ────────────────────────────────────────
const KNOWN_LOCATIONS: [RegExp, string][] = [
  [/\bukraine\b/i,                       'Ukraine'],
  [/\bgaza\b/i,                          'Gaza'],
  [/\bpalestine\b/i,                     'Palestine'],
  [/\bisrael\b/i,                        'Israel'],
  [/\bsyria\b/i,                         'Syria'],
  [/\byemen\b/i,                         'Yemen'],
  [/\bsudan\b/i,                         'Sudan'],
  [/\bsomalia\b/i,                       'Somalia'],
  [/\bafghanistan\b/i,                   'Afghanistan'],
  [/\biraq\b/i,                          'Iraq'],
  [/\biran\b/i,                          'Iran'],
  [/\bmyanmar\b|burma/i,                 'Myanmar'],
  [/\bethiopia\b/i,                      'Ethiopia'],
  [/\bdrc\b|congo\b/i,                   'DR Congo'],
  [/\bmali\b/i,                          'Mali'],
  [/\bburnkina\s*faso\b|burkina/i,       'Burkina Faso'],
  [/\bnigeria\b/i,                       'Nigeria'],
  [/\bliby/i,                            'Libya'],
  [/\bhaiti\b/i,                         'Haiti'],
  [/\blebanon\b/i,                       'Lebanon'],
  [/\bpakistan\b/i,                      'Pakistan'],
  [/\bindia\b/i,                         'India'],
  [/\bkashmir\b/i,                       'Kashmir'],
  [/\bnorth\s*korea\b/i,                 'North Korea'],
  [/\btaiwan\b/i,                        'Taiwan'],
  [/\bcameroon\b/i,                      'Cameroon'],
  [/\bmozambique\b/i,                    'Mozambique'],
  [/south\s*sudan/i,                     'South Sudan'],
  [/\bcolumbia\b|\bcolombia\b/i,         'Colombia'],
  [/\bmexico\b/i,                        'Mexico'],
  [/\bvenezuela\b/i,                     'Venezuela'],
  [/\bchad\b/i,                          'Chad'],
  [/central\s*african\s*republic\b/i,    'Central African Republic'],
];

function extractLocation(text: string): string | null {
  for (const [re, name] of KNOWN_LOCATIONS) {
    if (re.test(text)) return name;
  }
  return null;
}

// ── TTL constants ──────────────────────────────────────────────
const TTL_MS       = 7 * 24 * 3600 * 1000; // 7-day TTL per spec
const NEW_STORY_MS = 2 * 3600 * 1000;      // story is "new" if published within 2 hours

// ── Output types ───────────────────────────────────────────────
export interface StoryEntry {
  title: string;
  summary: string;
  casualties: number | null;
  date: string;
  link: string;
  source: string;
  createdAt: string;
  expiresAt: string;
}

export interface CountryThreat {
  country: string;
  severity: GlobalThreatSeverity;
  lat: number;
  lon: number;
  hasNew: boolean;
  stories: StoryEntry[];
}

// ── Module-level response cache (30-minute TTL) ────────────────
let _cachedResponse: { threats: CountryThreat[]; updatedAt: string } | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;

// ── Main handler ───────────────────────────────────────────────
export async function GET(_event: RequestEvent) {
  if (_cachedResponse && Date.now() < _cacheExpiresAt) {
    // Filter expired stories before returning cached response
    const now = Date.now();
    const threats = _cachedResponse.threats
      .map(ct => ({ ...ct, stories: ct.stories.filter(s => now < new Date(s.expiresAt).getTime()) }))
      .filter(ct => ct.stories.length > 0);
    return json(
      { threats, updatedAt: _cachedResponse.updatedAt },
      { headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=120' } }
    );
  }

  try {
    const feed = await parser.parseURL(RSS_URL);
    const now = Date.now();

    // Collect raw items
    interface RawItem { title: string; link: string; summary: string; pubDate: string }
    const raw: RawItem[] = [];
    for (const item of feed.items.slice(0, ARTICLES_LIMIT)) {
      if (!item.title || !item.link) continue;
      raw.push({
        title:   item.title,
        link:    item.link,
        summary: item.contentSnippet ?? item.summary ?? item.content ?? '',
        pubDate: item.pubDate ?? new Date().toISOString(),
      });
    }

    // Deduplicate by title prefix
    const seen = new Set<string>();
    const unique = raw.filter(item => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter: within 7-day TTL + conflict keyword match
    const filtered = unique.filter(item => {
      const age = now - new Date(item.pubDate).getTime();
      if (age > TTL_MS) return false;
      return CONFLICT_KW_RE.test(`${item.title} ${item.summary}`);
    });

    // Extract location + casualties; discard events without a known location or <10 casualties
    const withMeta = filtered
      .map(item => {
        const text = `${item.title} ${item.summary}`;
        const location = extractLocation(text);
        const casualties = extractCasualties(text);
        return { ...item, location, casualties };
      })
      .filter((item): item is typeof item & { location: string } => {
        if (item.location === null) return false;
        if (item.casualties !== null && item.casualties < 10) return false;
        return true;
      });

    // Geocode (cache-first; throttle network calls)
    const countryMap = new Map<string, { geo: { lat: number; lon: number }; items: typeof withMeta }>();
    let networkCalls = 0;

    for (const item of withMeta) {
      const alreadyCached = item.location in geoCache;
      if (!alreadyCached && networkCalls >= MAX_GEOCODE_CALLS) continue;

      const geo = await geocode(item.location);
      if (!alreadyCached) {
        networkCalls++;
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
      if (!geo) continue;

      const existing = countryMap.get(item.location);
      if (existing) {
        existing.items.push(item);
      } else {
        countryMap.set(item.location, { geo, items: [item] });
      }
    }

    // Build aggregated CountryThreat objects
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + TTL_MS).toISOString();

    const threats: CountryThreat[] = [];
    for (const [country, { geo, items }] of countryMap) {
      const stories: StoryEntry[] = items.map(item => ({
        title:      item.title,
        summary:    item.summary.slice(0, 300),
        casualties: item.casualties,
        date:       item.pubDate,
        link:       item.link,
        source:     'Al Jazeera',
        createdAt,
        expiresAt,
      }));

      // Highest severity across all stories for this country
      const severity = stories.reduce<GlobalThreatSeverity>((best, s) => {
        const sv = classifySeverity(s.casualties);
        return SEVERITY_RANK[sv] > SEVERITY_RANK[best] ? sv : best;
      }, 'green');

      // hasNew: true if any story was published within the last 2 hours
      const hasNew = stories.some(s => now - new Date(s.date).getTime() < NEW_STORY_MS);

      threats.push({ country, severity, lat: geo.lat, lon: geo.lon, hasNew, stories });
    }

    // Sort: highest severity first, then most-recent story first
    threats.sort((a, b) => {
      const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sd !== 0) return sd;
      const aLatest = Math.max(...a.stories.map(s => new Date(s.date).getTime()));
      const bLatest = Math.max(...b.stories.map(s => new Date(s.date).getTime()));
      return bLatest - aLatest;
    });

    const payload = { threats, updatedAt: new Date().toISOString() };
    _cachedResponse = payload;
    _cacheExpiresAt = now + CACHE_TTL_MS;

    return json(payload, { headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=120' } });
  } catch {
    return json(
      { threats: [], updatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 's-maxage=60' } }
    );
  }
}
