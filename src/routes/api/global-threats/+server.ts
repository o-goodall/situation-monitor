import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';

const parser = new Parser();

/**
 * GET /api/global-threats
 *
 * Fetches conflict stories from Al Jazeera's RSS feed, aggregated by country.
 * Known ongoing conflict zones are always included on the map (using static
 * coordinates) and supplemented with any matching Al Jazeera stories.
 * This endpoint consolidates the previous global-threats + ongoing-conflicts
 * endpoints into a single Al Jazeera-only source.
 *
 * Refreshed every 30 minutes by the Vercel cron job (vercel.json).
 */

// ── Single trusted RSS source ──────────────────────────────────
const RSS_URL = 'https://www.aljazeera.com/xml/rss/subjects/conflict.xml';
const ARTICLES_LIMIT = 30;

// ── Conflict keyword filter (broad — prefer some noise over missing events) ──
const CONFLICT_KEYWORDS = [
  'killed', 'dead', 'bombing', 'airstrike', 'attack',
  'massacre', 'clashes', 'shelling', 'war', 'invasion',
  'militants', 'rebels', 'siege', 'offensive', 'drone',
  'strike', 'troops', 'military', 'conflict', 'violence',
  'casualties', 'wounded', 'deaths',
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

// ── Known conflict zones (static coords + Al Jazeera pattern matching) ────────
// These zones are ALWAYS shown on the map; stories are populated from the feed.
// Consolidated from the former ongoing-conflicts endpoint.
const KNOWN_CONFLICT_ZONES: {
  pattern: RegExp;
  country: string;
  lat: number;
  lon: number;
  defaultSeverity: GlobalThreatSeverity;
}[] = [
  { pattern: /\bukraine\b/i,                          country: 'Ukraine',                  lat: 48.4,  lon:  31.2,  defaultSeverity: 'red'    },
  { pattern: /\bgaza\b|\bpalestine\b/i,               country: 'Gaza',                     lat: 31.4,  lon:  34.4,  defaultSeverity: 'red'    },
  { pattern: /\bisrael\b/i,                           country: 'Israel',                   lat: 31.8,  lon:  35.2,  defaultSeverity: 'red'    },
  { pattern: /\byemen\b|houthi|huthi/i,               country: 'Yemen',                    lat: 15.5,  lon:  48.5,  defaultSeverity: 'red'    },
  { pattern: /\bsudan\b/i,                            country: 'Sudan',                    lat: 15.5,  lon:  30.0,  defaultSeverity: 'red'    },
  { pattern: /\bethiopia\b|tigray/i,                  country: 'Ethiopia',                 lat:  9.0,  lon:  40.5,  defaultSeverity: 'red'    },
  { pattern: /\bmyanmar\b|burma/i,                    country: 'Myanmar',                  lat: 19.7,  lon:  96.1,  defaultSeverity: 'orange' },
  { pattern: /\bhaiti\b/i,                            country: 'Haiti',                    lat: 18.9,  lon: -72.3,  defaultSeverity: 'orange' },
  { pattern: /\bcameroon\b/i,                         country: 'Cameroon',                 lat:  3.8,  lon:  11.5,  defaultSeverity: 'orange' },
  { pattern: /\bcolombia\b|\bcolumbia\b/i,            country: 'Colombia',                 lat:  4.7,  lon: -74.1,  defaultSeverity: 'orange' },
  { pattern: /\bsyria\b/i,                            country: 'Syria',                    lat: 34.8,  lon:  38.5,  defaultSeverity: 'orange' },
  { pattern: /\bsomalia\b/i,                          country: 'Somalia',                  lat:  5.2,  lon:  46.2,  defaultSeverity: 'orange' },
  { pattern: /\bafghanistan\b/i,                      country: 'Afghanistan',              lat: 34.5,  lon:  69.2,  defaultSeverity: 'orange' },
  { pattern: /\biraq\b/i,                             country: 'Iraq',                     lat: 33.3,  lon:  44.4,  defaultSeverity: 'orange' },
  { pattern: /\bmali\b|sahel/i,                       country: 'Mali',                     lat: 12.7,  lon:  -8.0,  defaultSeverity: 'orange' },
  { pattern: /\bburnkina\s*faso\b|burkina/i,          country: 'Burkina Faso',             lat: 12.4,  lon:  -1.6,  defaultSeverity: 'orange' },
  { pattern: /\bdrc\b|congo/i,                        country: 'DR Congo',                 lat: -4.0,  lon:  21.8,  defaultSeverity: 'red'    },
  { pattern: /south\s*sudan/i,                        country: 'South Sudan',              lat:  6.9,  lon:  31.3,  defaultSeverity: 'orange' },
  { pattern: /\blebanon\b/i,                          country: 'Lebanon',                  lat: 33.9,  lon:  35.5,  defaultSeverity: 'green'  },
  { pattern: /\bpakistan\b/i,                         country: 'Pakistan',                 lat: 30.4,  lon:  69.3,  defaultSeverity: 'green'  },
  { pattern: /\bkashmir\b/i,                          country: 'Kashmir',                  lat: 33.8,  lon:  76.5,  defaultSeverity: 'green'  },
  { pattern: /\bmexico\b/i,                           country: 'Mexico',                   lat: 23.6,  lon: -102.6, defaultSeverity: 'orange' },
  { pattern: /\bliby/i,                               country: 'Libya',                    lat: 26.3,  lon:  17.2,  defaultSeverity: 'green'  },
  { pattern: /\bnigeria\b/i,                          country: 'Nigeria',                  lat:  9.1,  lon:   8.7,  defaultSeverity: 'green'  },
  { pattern: /\biran\b/i,                             country: 'Iran',                     lat: 32.0,  lon:  53.0,  defaultSeverity: 'green'  },
];

// ── TTL constants ──────────────────────────────────────────────
const TTL_MS       = 7 * 24 * 3600 * 1000; // 7-day story TTL
const NEW_STORY_MS = 2 * 3600 * 1000;       // story is "new" if published within 2 hours

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
    return json(
      { threats: _cachedResponse.threats, updatedAt: _cachedResponse.updatedAt },
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

    // Filter: within 7-day TTL + broad conflict keyword match
    const filtered = unique.filter(item => {
      const age = now - new Date(item.pubDate).getTime();
      if (age > TTL_MS) return false;
      return CONFLICT_KW_RE.test(`${item.title} ${item.summary}`);
    });

    // Map stories to known conflict zones by pattern matching
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + TTL_MS).toISOString();

    // Build per-country story lists
    const countryStories = new Map<string, StoryEntry[]>();
    for (const item of filtered) {
      const text = `${item.title} ${item.summary}`;
      const casualties = extractCasualties(text);
      for (const zone of KNOWN_CONFLICT_ZONES) {
        if (!zone.pattern.test(text)) continue;
        const story: StoryEntry = {
          title:      item.title,
          summary:    item.summary.slice(0, 300),
          casualties,
          date:       item.pubDate,
          link:       item.link,
          source:     'Al Jazeera',
          createdAt,
          expiresAt,
        };
        const existing = countryStories.get(zone.country);
        if (existing) {
          // Avoid duplicate stories for the same country
          if (!existing.some(s => s.title === story.title)) existing.push(story);
        } else {
          countryStories.set(zone.country, [story]);
        }
        break; // assign each article to the first matching zone only
      }
    }

    // Build CountryThreat[] — always include all known conflict zones
    const threats: CountryThreat[] = [];
    for (const zone of KNOWN_CONFLICT_ZONES) {
      const stories = countryStories.get(zone.country) ?? [];

      // Severity: highest from stories (or zone default if no stories)
      const severity = stories.length > 0
        ? stories.reduce<GlobalThreatSeverity>((best, s) => {
            const sv = classifySeverity(s.casualties);
            return SEVERITY_RANK[sv] > SEVERITY_RANK[best] ? sv : best;
          }, zone.defaultSeverity)
        : zone.defaultSeverity;

      const hasNew = stories.some(s => now - new Date(s.date).getTime() < NEW_STORY_MS);

      threats.push({ country: zone.country, severity, lat: zone.lat, lon: zone.lon, hasNew, stories });
    }

    // Sort: highest severity first, then most-recent story first
    threats.sort((a, b) => {
      const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sd !== 0) return sd;
      if (a.stories.length === 0 && b.stories.length === 0) return 0;
      if (a.stories.length === 0) return 1;
      if (b.stories.length === 0) return -1;
      const aLatest = Math.max(...a.stories.map(s => new Date(s.date).getTime()));
      const bLatest = Math.max(...b.stories.map(s => new Date(s.date).getTime()));
      return bLatest - aLatest;
    });

    const payload = { threats, updatedAt: new Date().toISOString() };
    _cachedResponse = payload;
    _cacheExpiresAt = now + CACHE_TTL_MS;

    return json(payload, { headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=120' } });
  } catch {
    // Even if the RSS feed is unavailable, return all known conflict zones with
    // their default severities so the map always shows monitored hotspots.
    const fallbackThreats: CountryThreat[] = KNOWN_CONFLICT_ZONES.map(zone => ({
      country: zone.country,
      severity: zone.defaultSeverity,
      lat: zone.lat,
      lon: zone.lon,
      hasNew: false,
      stories: [],
    }));
    return json(
      { threats: fallbackThreats, updatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 's-maxage=60' } }
    );
  }
}
