import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { Threat, ThreatLevel } from '$lib/settings';

/**
 * GET /api/acled
 *
 * Fetches live armed conflict data from the ACLED API
 * (https://api.acleddata.com) and converts it to Threat hotspots for
 * display on the World Map.
 *
 * Requires environment variables:
 *   ACLED_API_KEY  – your ACLED access key
 *   ACLED_EMAIL    – your registered ACLED email address
 *
 * Returns: { threats: Threat[], conflictCountryIds: string[], updatedAt: string }
 * Returns 204 No Content when no API credentials are configured.
 */

// ── ACLED event-type → ThreatLevel mapping ─────────────────────
const EVENT_TYPE_LEVEL: Record<string, ThreatLevel> = {
  'Battles':                          'critical',
  'Explosions/Remote violence':       'critical',
  'Violence against civilians':       'high',
  'Protests':                         'elevated',
  'Riots':                            'elevated',
  'Strategic developments':           'low',
};

// ── ISO 3166-1 numeric IDs for selected high-conflict countries ─
const COUNTRY_NUMERIC_ID: Record<string, string> = {
  'Ukraine':              '804',
  'Palestine':            '275',
  'Israel':               '376',
  'Sudan':                '729',
  'Myanmar':              '104',
  'Iran':                 '364',
  'Yemen':                '887',
  'Mali':                 '466',
  'Burkina Faso':         '854',
  'Niger':                '562',
  'Haiti':                '332',
  'Ethiopia':             '231',
  'Syria':                '760',
  'Iraq':                 '368',
  'Somalia':              '706',
  'Afghanistan':          '004',
  'Libya':                '434',
  'Nigeria':              '566',
  'DR Congo':             '180',
  'Democratic Republic of Congo': '180',
  'South Sudan':          '728',
  'Cameroon':             '120',
  'Central African Republic': '140',
  'Mozambique':           '508',
  'Pakistan':             '586',
  'Colombia':             '170',
  'Mexico':               '484',
};

interface AcledEvent {
  country: string;
  latitude: string;
  longitude: string;
  event_type: string;
  sub_event_type: string;
  fatalities: string;
  event_date: string;
  location: string;
  notes: string;
  iso: string;
}

interface AcledResponse {
  status: number;
  success: boolean;
  count: number;
  data: AcledEvent[];
}

// ── Module-level cache (1-hour TTL) ────────────────────────────
let _cache: { threats: Threat[]; conflictCountryIds: string[]; updatedAt: string } | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const LEVEL_ORDER: ThreatLevel[] = ['low', 'elevated', 'high', 'critical'];

/** Internal type to carry eventCount through the sort step */
type ThreatWithCount = Threat & { eventCount: number };

export async function GET(_event: RequestEvent) {
  if (_cache && Date.now() < _cacheExpiresAt) {
    return json(_cache, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=300' } });
  }

  const apiKey = env.ACLED_API_KEY;
  const email  = env.ACLED_EMAIL;

  if (!apiKey || !email) {
    // No credentials — signal caller to fall back to static data
    return json(null, { status: 204 });
  }

  try {
    // Fetch the most recent 30 days of battle/explosion/violence events
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]; // YYYY-MM-DD

    const params = new URLSearchParams({
      key:        apiKey,
      email:      email,
      event_date: since,
      event_date_where: 'BETWEEN',
      event_date2: new Date().toISOString().split('T')[0],
      event_type: 'Battles|Explosions/Remote violence|Violence against civilians|Protests|Riots|Strategic developments',
      fields:     'country,latitude,longitude,event_type,sub_event_type,fatalities,event_date,location,notes,iso',
      limit:      '500',
    });

    const res = await fetch(`https://api.acleddata.com/acled/read?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      console.error(`ACLED API error: HTTP ${res.status}`);
      return json(null, { status: 204 });
    }

    const data: AcledResponse = await res.json();
    if (!data.success || !data.data?.length) {
      return json(null, { status: 204 });
    }

    // Aggregate events by country, counting events and summing fatalities
    const countryMap = new Map<string, {
      country: string;
      lat: number;
      lon: number;
      iso: string;
      eventCount: number;
      fatalities: number;
      worstLevel: ThreatLevel;
    }>();

    for (const ev of data.data) {
      const lat = parseFloat(ev.latitude);
      const lon = parseFloat(ev.longitude);
      if (isNaN(lat) || isNaN(lon)) continue;

      const level: ThreatLevel = EVENT_TYPE_LEVEL[ev.event_type] ?? 'low';
      const fatalities = parseInt(ev.fatalities, 10) || 0;

      if (countryMap.has(ev.country)) {
        const entry = countryMap.get(ev.country)!;
        entry.eventCount++;
        entry.fatalities += fatalities;
        // Escalate level only if the new event is more severe
        if (LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(entry.worstLevel)) {
          entry.worstLevel = level;
          entry.lat = lat;
          entry.lon = lon;
        }
      } else {
        countryMap.set(ev.country, {
          country: ev.country,
          lat,
          lon,
          iso: ev.iso,
          eventCount: 1,
          fatalities,
          worstLevel: level,
        });
      }
    }

    // Convert aggregated data to Threat objects
    // Only include countries with meaningful conflict activity (≥3 events or any fatalities)
    const threats: ThreatWithCount[] = [];

    for (const [, entry] of countryMap) {
      if (entry.eventCount < 3 && entry.fatalities === 0) continue;

      // Boost level if many events or many fatalities
      let level = entry.worstLevel;
      if (entry.fatalities >= 100 || entry.eventCount >= 30) {
        level = 'critical';
      } else if (entry.fatalities >= 20 || entry.eventCount >= 10) {
        const idx = Math.min(LEVEL_ORDER.indexOf(level) + 1, LEVEL_ORDER.length - 1);
        level = LEVEL_ORDER[idx];
      }

      const countryId = COUNTRY_NUMERIC_ID[entry.country] ?? entry.iso;
      const desc = `⚔️ ${entry.country} — ${entry.eventCount} conflict events, ${entry.fatalities} fatalities (last 30 days, ACLED)`;

      threats.push({
        id:         entry.country.toLowerCase().replace(/\s+/g, '-'),
        name:       entry.country,
        lat:        entry.lat,
        lon:        entry.lon,
        level,
        desc,
        countryId:  countryId || undefined,
        eventCount: entry.eventCount,
      });
    }

    // Sort by severity then event count
    threats.sort((a, b) => {
      const diff = LEVEL_ORDER.indexOf(b.level) - LEVEL_ORDER.indexOf(a.level);
      return diff !== 0 ? diff : b.eventCount - a.eventCount;
    });

    // Strip the eventCount helper field before returning (it's not part of the public Threat type)
    const cleanThreats: Threat[] = threats.map(({ eventCount: _ec, ...rest }) => rest);

    const conflictCountryIds = cleanThreats
      .filter(t => t.countryId)
      .map(t => t.countryId as string);

    const payload = { threats: cleanThreats, conflictCountryIds, updatedAt: new Date().toISOString() };
    _cache = payload;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    return json(payload, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=300' } });
  } catch (err) {
    console.error('ACLED fetch failed:', err);
    return json(null, { status: 204 });
  }
}
