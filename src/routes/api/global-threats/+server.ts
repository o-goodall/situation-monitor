import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';

const parser = new Parser();

/**
 * GET /api/global-threats
 *
 * Fetches conflict stories from Al Jazeera's RSS feed, aggregated by country.
 * Displays the 50 most severe conflict zones from the CLED Conflict Index,
 * categorised as Extreme, High, or Turbulent.  Stories are sourced exclusively
 * from Al Jazeera's conflict RSS feed and supplement the static zone list.
 *
 * Refreshed every 30 minutes by the Vercel cron job (vercel.json).
 */

// ── Single trusted RSS source ──────────────────────────────────
const RSS_URL = 'https://www.aljazeera.com/xml/rss/subjects/conflict.xml';
const ARTICLES_LIMIT = 50;

// ── Casualty extraction (used for display in tooltips only) ───
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

// ── Severity classification (CLED Conflict Index categories) ──
export type GlobalThreatSeverity = 'extreme' | 'high' | 'turbulent';

const SEVERITY_RANK: Record<GlobalThreatSeverity, number> = { extreme: 2, high: 1, turbulent: 0 };

// ── CLED Conflict Index — 50 most severe conflict zones ───────
// Extreme (10): CLED top tier.  High (40): CLED second tier.
// Stories are populated from Al Jazeera; zones always appear on the map.
const KNOWN_CONFLICT_ZONES: {
  pattern: RegExp;
  country: string;
  lat: number;
  lon: number;
  defaultSeverity: GlobalThreatSeverity;
}[] = [
  // ── Extreme ───────────────────────────────────────────────────
  { pattern: /\bpalestine\b|\bgaza\b/i,               country: 'Palestine',                lat: 31.4,  lon:  34.4,  defaultSeverity: 'extreme' },
  { pattern: /\bmyanmar\b|\bburma\b/i,                country: 'Myanmar',                  lat: 19.7,  lon:  96.1,  defaultSeverity: 'extreme' },
  { pattern: /\bsyria\b/i,                            country: 'Syria',                    lat: 34.8,  lon:  38.5,  defaultSeverity: 'extreme' },
  { pattern: /\bmexico\b/i,                           country: 'Mexico',                   lat: 23.6,  lon: -102.6, defaultSeverity: 'extreme' },
  { pattern: /\bnigeria\b/i,                          country: 'Nigeria',                  lat:  9.1,  lon:   8.7,  defaultSeverity: 'extreme' },
  { pattern: /\becuador\b/i,                          country: 'Ecuador',                  lat: -1.8,  lon: -78.2,  defaultSeverity: 'extreme' },
  { pattern: /\bbrazil\b/i,                           country: 'Brazil',                   lat: -14.2, lon: -51.9,  defaultSeverity: 'extreme' },
  { pattern: /\bhaiti\b/i,                            country: 'Haiti',                    lat: 18.9,  lon: -72.3,  defaultSeverity: 'extreme' },
  { pattern: /\bsudan\b(?!\s+south)/i,                country: 'Sudan',                    lat: 15.5,  lon:  30.0,  defaultSeverity: 'extreme' },
  { pattern: /\bpakistan\b/i,                         country: 'Pakistan',                 lat: 30.4,  lon:  69.3,  defaultSeverity: 'extreme' },
  // ── High ──────────────────────────────────────────────────────
  { pattern: /\bcameroon\b/i,                         country: 'Cameroon',                 lat:  3.8,  lon:  11.5,  defaultSeverity: 'high'    },
  { pattern: /\bdrc\b|democratic\s+republic\s+of\s+congo|(?<!\brepublic\s+of\s+)congo/i, country: 'DR Congo', lat: -4.0, lon: 21.8, defaultSeverity: 'high' },
  { pattern: /\bukraine\b/i,                          country: 'Ukraine',                  lat: 48.4,  lon:  31.2,  defaultSeverity: 'high'    },
  { pattern: /\bcolombia\b|\bcolumbia\b/i,            country: 'Colombia',                 lat:  4.7,  lon: -74.1,  defaultSeverity: 'high'    },
  { pattern: /\byemen\b|\bhouthi\b|\bhuthi\b/i,       country: 'Yemen',                    lat: 15.5,  lon:  48.5,  defaultSeverity: 'high'    },
  { pattern: /\bindia\b/i,                            country: 'India',                    lat: 20.6,  lon:  79.0,  defaultSeverity: 'high'    },
  { pattern: /\bguatemala\b/i,                        country: 'Guatemala',                lat: 15.8,  lon: -90.2,  defaultSeverity: 'high'    },
  { pattern: /\bsomalia\b/i,                          country: 'Somalia',                  lat:  5.2,  lon:  46.2,  defaultSeverity: 'high'    },
  { pattern: /\blebanon\b/i,                          country: 'Lebanon',                  lat: 33.9,  lon:  35.5,  defaultSeverity: 'high'    },
  { pattern: /\brussia\b/i,                           country: 'Russia',                   lat: 61.5,  lon: 105.3,  defaultSeverity: 'high'    },
  { pattern: /\bbangladesh\b/i,                       country: 'Bangladesh',               lat: 23.7,  lon:  90.4,  defaultSeverity: 'high'    },
  { pattern: /\bethiopia\b|\btigray\b/i,              country: 'Ethiopia',                 lat:  9.0,  lon:  40.5,  defaultSeverity: 'high'    },
  { pattern: /\biraq\b/i,                             country: 'Iraq',                     lat: 33.3,  lon:  44.4,  defaultSeverity: 'high'    },
  { pattern: /\bkenya\b/i,                            country: 'Kenya',                    lat: -1.3,  lon:  36.8,  defaultSeverity: 'high'    },
  { pattern: /south\s*sudan/i,                        country: 'South Sudan',              lat:  6.9,  lon:  31.3,  defaultSeverity: 'high'    },
  { pattern: /\bhonduras\b/i,                         country: 'Honduras',                 lat: 15.2,  lon: -86.2,  defaultSeverity: 'high'    },
  { pattern: /\bmali\b|\bsahel\b/i,                   country: 'Mali',                     lat: 12.7,  lon:  -8.0,  defaultSeverity: 'high'    },
  { pattern: /\bjamaica\b/i,                          country: 'Jamaica',                  lat: 18.1,  lon: -77.3,  defaultSeverity: 'high'    },
  { pattern: /central\s*african\s*republic/i,         country: 'Central African Republic', lat:  6.6,  lon:  20.9,  defaultSeverity: 'high'    },
  { pattern: /\bburundi\b/i,                          country: 'Burundi',                  lat: -3.4,  lon:  29.9,  defaultSeverity: 'high'    },
  { pattern: /\bphilippines\b|\bfilipino\b/i,         country: 'Philippines',              lat: 12.9,  lon: 122.0,  defaultSeverity: 'high'    },
  { pattern: /\bafghanistan\b/i,                      country: 'Afghanistan',              lat: 34.5,  lon:  69.2,  defaultSeverity: 'high'    },
  { pattern: /\btrinidad\b/i,                         country: 'Trinidad and Tobago',      lat: 10.7,  lon: -61.5,  defaultSeverity: 'high'    },
  { pattern: /\bvenezuela\b/i,                        country: 'Venezuela',                lat:  6.4,  lon: -66.6,  defaultSeverity: 'high'    },
  { pattern: /\bliby/i,                               country: 'Libya',                    lat: 26.3,  lon:  17.2,  defaultSeverity: 'high'    },
  { pattern: /\bniger\b/i,                            country: 'Niger',                    lat: 17.6,  lon:   8.1,  defaultSeverity: 'high'    },
  { pattern: /\bburkina\b/i,                          country: 'Burkina Faso',             lat: 12.4,  lon:  -1.6,  defaultSeverity: 'high'    },
  { pattern: /\bpuerto\s*rico\b/i,                    country: 'Puerto Rico',              lat: 18.2,  lon: -66.6,  defaultSeverity: 'high'    },
  { pattern: /\bmozambique\b/i,                       country: 'Mozambique',               lat: -18.7, lon:  35.5,  defaultSeverity: 'high'    },
  { pattern: /\biran\b/i,                             country: 'Iran',                     lat: 32.0,  lon:  53.0,  defaultSeverity: 'high'    },
  { pattern: /\buganda\b/i,                           country: 'Uganda',                   lat:  1.4,  lon:  32.3,  defaultSeverity: 'high'    },
  { pattern: /\bisrael\b/i,                           country: 'Israel',                   lat: 31.8,  lon:  35.2,  defaultSeverity: 'high'    },
  { pattern: /\bperu\b/i,                             country: 'Peru',                     lat: -9.2,  lon: -75.0,  defaultSeverity: 'high'    },
  { pattern: /\bghana\b/i,                            country: 'Ghana',                    lat:  7.9,  lon:  -1.0,  defaultSeverity: 'high'    },
  { pattern: /\bindonesia\b/i,                        country: 'Indonesia',                lat: -0.8,  lon: 113.9,  defaultSeverity: 'high'    },
  { pattern: /\bchile\b/i,                            country: 'Chile',                    lat: -35.7, lon: -71.5,  defaultSeverity: 'high'    },
  { pattern: /south\s*africa/i,                       country: 'South Africa',             lat: -30.6, lon:  22.9,  defaultSeverity: 'high'    },
  { pattern: /\bnepal\b/i,                            country: 'Nepal',                    lat: 28.4,  lon:  84.1,  defaultSeverity: 'high'    },
  { pattern: /\bbelize\b/i,                           country: 'Belize',                   lat: 17.2,  lon: -88.5,  defaultSeverity: 'high'    },
  { pattern: /\bchad\b/i,                             country: 'Chad',                     lat: 15.5,  lon:  18.7,  defaultSeverity: 'high'    },
];

// ── TTL constants ──────────────────────────────────────────────
const TTL_MS       = 7 * 24 * 3600 * 1000;  // 7-day story TTL
const NEW_STORY_MS = 24 * 3600 * 1000;       // ping visible for 24 hours

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

    // Filter: within 7-day TTL only (Al Jazeera conflict feed is pre-filtered for conflict stories)
    const filtered = unique.filter(item => {
      const age = now - new Date(item.pubDate).getTime();
      return age <= TTL_MS;
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

      // Severity comes from the CLED Conflict Index (zone.defaultSeverity)
      const severity = zone.defaultSeverity;

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
