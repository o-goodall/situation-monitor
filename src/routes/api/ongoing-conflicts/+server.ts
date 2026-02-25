import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';

/**
 * GET /api/ongoing-conflicts
 *
 * Dynamically detects active long-running conflict zones by scanning
 * trusted conflict-tracking RSS feeds (International Crisis Group +
 * Army Recognition).  A conflict zone is considered "ongoing" if it
 * appears in either feed within the last ONGOING_TTL_MS milliseconds.
 * Once it stops appearing (i.e. is resolved or cooling off), it expires
 * automatically — no hardcoded list of "currently active" conflicts.
 *
 * The KNOWN_CONFLICT_ZONES table defines which conflict patterns to track
 * and supplies their geographic coordinates (a static geographical fact).
 * Which zones are actually *active* is determined entirely at runtime from
 * the live feeds.
 */

const parser = new Parser({ timeout: 8_000 });

// ── Live feed sources ──────────────────────────────────────────
const CONFLICT_TRACKING_FEEDS = [
  'https://www.crisisgroup.org/rss-0',
  'https://www.armyrecognition.com/focus-analysis-conflicts/army/conflicts-in-the-world/feed/rss',
];

// ── Known conflict zone catalogue ─────────────────────────────
// Coordinates are static geographic facts; whether each zone is *active*
// is determined dynamically from the feeds above.
const KNOWN_CONFLICT_ZONES: {
  pattern: RegExp;
  name: string;
  country: string;
  lat: number;
  lon: number;
  defaultSeverity: 'red' | 'orange' | 'green';
}[] = [
  {
    pattern: /russia.{0,15}ukraine|ukraine.{0,15}russia|war in ukraine/i,
    name: 'Russia–Ukraine War', country: 'Ukraine',
    lat: 48.4, lon: 31.2, defaultSeverity: 'red',
  },
  {
    pattern: /sudan.{0,15}civil|sudanese.{0,10}war|rsf.{0,10}saf|saf.{0,10}rsf/i,
    name: 'Sudan Civil War', country: 'Sudan',
    lat: 15.5, lon: 30.0, defaultSeverity: 'red',
  },
  {
    pattern: /gaza|israel.{0,15}hamas|hamas.{0,15}israel/i,
    name: 'Israel–Gaza War', country: 'Gaza',
    lat: 31.4, lon: 34.4, defaultSeverity: 'red',
  },
  {
    pattern: /yemen.{0,10}civil|houthi|huthi/i,
    name: 'Yemen Civil War', country: 'Yemen',
    lat: 15.5, lon: 48.5, defaultSeverity: 'red',
  },
  {
    pattern: /congo.{0,10}m23|m23.{0,10}congo|drc.{0,10}rebel|eastern.{0,10}congo/i,
    name: 'DRC – M23 Conflict', country: 'DR Congo',
    lat: -4.0, lon: 21.8, defaultSeverity: 'red',
  },
  {
    pattern: /ethiopia.{0,15}conflict|oromo.{0,10}liberation|fano.{0,10}militia|amhara.{0,10}conflict/i,
    name: 'Ethiopian Civil Conflict', country: 'Ethiopia',
    lat: 9.0, lon: 40.5, defaultSeverity: 'red',
  },
  {
    pattern: /myanmar.{0,10}civil|myanmar.{0,10}military|myanmar.{0,10}coup|burma.{0,10}conflict/i,
    name: 'Myanmar Civil War', country: 'Myanmar',
    lat: 19.7, lon: 96.1, defaultSeverity: 'orange',
  },
  {
    pattern: /haiti.{0,10}gang|haiti.{0,10}violence|haiti.{0,10}crisis/i,
    name: 'Haiti Gang Crisis', country: 'Haiti',
    lat: 18.9, lon: -72.3, defaultSeverity: 'orange',
  },
  {
    pattern: /cameroon.{0,15}anglophone|ambaz/i,
    name: 'Cameroon Anglophone Conflict', country: 'Cameroon',
    lat: 3.8, lon: 11.5, defaultSeverity: 'orange',
  },
  {
    pattern: /colombia.{0,10}farc|farc.{0,10}colombia|eln.{0,10}colombia/i,
    name: 'Colombia Armed Groups', country: 'Colombia',
    lat: 4.7, lon: -74.1, defaultSeverity: 'orange',
  },
  {
    pattern: /mexico.{0,10}cartel|cartel.{0,10}mexico|drug.{0,10}war.{0,10}mexico/i,
    name: 'Mexico Drug War', country: 'Mexico',
    lat: 23.6, lon: -102.6, defaultSeverity: 'orange',
  },
  {
    pattern: /south\s*sudan.{0,15}conflict|south\s*sudan.{0,15}civil|south\s*sudan.{0,15}tension/i,
    name: 'South Sudan Tensions', country: 'South Sudan',
    lat: 6.9, lon: 31.3, defaultSeverity: 'orange',
  },
  {
    pattern: /kashmir.{0,10}conflict|india.{0,15}pakistan.{0,15}kashmir/i,
    name: 'Kashmir Tensions', country: 'Kashmir',
    lat: 33.8, lon: 76.5, defaultSeverity: 'green',
  },
  {
    pattern: /sahel.{0,10}jihadism|burkina.{0,10}islamist|mali.{0,10}jihadist|niger.{0,10}insurgency/i,
    name: 'Sahel Insurgency', country: 'Burkina Faso',
    lat: 12.4, lon: -1.6, defaultSeverity: 'orange',
  },
  {
    pattern: /somalia.{0,10}al.shabaab|shabaab.{0,10}somalia/i,
    name: 'Somalia – Al-Shabaab', country: 'Somalia',
    lat: 5.2, lon: 46.2, defaultSeverity: 'orange',
  },
];

// ── TTL constants ──────────────────────────────────────────────
// A conflict zone remains "active" while its ICG/Army Recognition feed
// mentions have been within the last 30 days.  If a conflict goes quiet in
// the press for 30 days it is assumed resolved and drops off the map.
const ONGOING_TTL_MS = 30 * 24 * 3_600_000;
const CACHE_TTL_MS   =  1 * 3_600_000; // 1-hour response cache

// ── Output type ────────────────────────────────────────────────
export interface OngoingConflict {
  name: string;
  country: string;
  lat: number;
  lon: number;
  severity: 'red' | 'orange' | 'green';
  /** ISO date-string: when this conflict was last referenced in the feeds */
  lastSeen: string;
  /** ISO date-string: when this entry will expire if not refreshed */
  expiresAt: string;
}

// ── Module-level response cache ────────────────────────────────
let _cache: { conflicts: OngoingConflict[]; updatedAt: string } | null = null;
let _cacheExpiresAt = 0;

// ── Handler ────────────────────────────────────────────────────
export async function GET(_event: RequestEvent) {
  if (_cache && Date.now() < _cacheExpiresAt) {
    // Filter out anything that has since expired before returning
    const now = Date.now();
    const active = _cache.conflicts.filter(c => now < new Date(c.expiresAt).getTime());
    return json(
      { conflicts: active, updatedAt: _cache.updatedAt },
      { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=120' } }
    );
  }

  try {
    const now = Date.now();

    // Fetch all feed items in parallel; tolerate individual failures
    const feedResults = await Promise.allSettled(
      CONFLICT_TRACKING_FEEDS.map(url => parser.parseURL(url))
    );

    // For each known conflict zone, find the most-recent article date that
    // matches its pattern across all feeds
    const conflictLastSeen = new Map<string, number>();

    for (const result of feedResults) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value.items ?? []) {
        const text = `${item.title ?? ''} ${item.contentSnippet ?? item.content ?? ''}`;
        const pubTs = item.pubDate ? new Date(item.pubDate).getTime() : now;

        for (const zone of KNOWN_CONFLICT_ZONES) {
          if (!zone.pattern.test(text)) continue;
          const existing = conflictLastSeen.get(zone.name);
          if (existing === undefined || pubTs > existing) {
            conflictLastSeen.set(zone.name, pubTs);
          }
        }
      }
    }

    // Build the active list — only zones mentioned within ONGOING_TTL_MS
    const conflicts: OngoingConflict[] = [];
    for (const zone of KNOWN_CONFLICT_ZONES) {
      const lastSeenTs = conflictLastSeen.get(zone.name);
      if (lastSeenTs === undefined) continue;          // never seen in feeds
      if (now - lastSeenTs > ONGOING_TTL_MS) continue; // expired

      conflicts.push({
        name:      zone.name,
        country:   zone.country,
        lat:       zone.lat,
        lon:       zone.lon,
        severity:  zone.defaultSeverity,
        lastSeen:  new Date(lastSeenTs).toISOString(),
        expiresAt: new Date(lastSeenTs + ONGOING_TTL_MS).toISOString(),
      });
    }

    const payload = { conflicts, updatedAt: new Date().toISOString() };
    _cache = payload;
    _cacheExpiresAt = now + CACHE_TTL_MS;

    return json(payload, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=120' } });
  } catch {
    return json(
      { conflicts: [], updatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 's-maxage=60' } }
    );
  }
}
