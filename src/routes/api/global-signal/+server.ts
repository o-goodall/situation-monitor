import { json } from '@sveltejs/kit';
import Parser from 'rss-parser';
import type { GlobalSignal } from '../update-global-signal/+server.js';

// ── RSS sources for on-demand conflict signal ─────────────────────────────────
// Using no-auth RSS feeds so the signal works without any API credentials.
const SIGNAL_FEEDS = [
  'https://www.aljazeera.com/xml/rss/subjects/conflict.xml',
  'https://reliefweb.int/updates/rss.xml',
];

const CONFLICT_KW_RE =
  /\b(killed|dead|attack|bombing|shelling|massacre|clashes|casualties|war|conflict|airstrike|air\s*strike|militants|rebels|displaced|violence|explosion|offensive|assault|troops|military)\b/i;

// ── DEFCON bands (must match update-global-signal) ────────────────────────────
const DEFCON_BANDS = [
  { min: 40, level: 1, label: 'Critical Global Instability' },
  { min: 25, level: 2, label: 'High Risk Environment' },
  { min: 15, level: 3, label: 'Elevated Tension' },
  { min:  5, level: 4, label: 'Low Risk Environment' },
  { min:  0, level: 5, label: 'Stable Environment' },
];

// ── Fallback when computation fails ──────────────────────────────────────────
const FALLBACK: GlobalSignal = {
  date: new Date().toISOString().slice(0, 10),
  defcon: 5,
  label: 'Stable Environment',
  report_count: 0,
  country_count: 0,
  summary: 'No conflict data available yet. Signal will update at the next scheduled run.',
  updated_at: new Date().toISOString()
};

// ── Module-level cache (1-hour TTL) ──────────────────────────────────────────
let _cached: GlobalSignal | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const _parser = new Parser();

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  if (_cached && Date.now() < _cacheExpiresAt) {
    return json(_cached);
  }

  try {
    const results = await Promise.allSettled(
      SIGNAL_FEEDS.map(url => _parser.parseURL(url))
    );

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let report_count = 0;
    const countries = new Set<string>();

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value.items) {
        if (!item.pubDate) continue;
        if (new Date(item.pubDate).getTime() < cutoff) continue;
        const text = `${item.title ?? ''} ${item.contentSnippet ?? item.summary ?? ''}`;
        if (!CONFLICT_KW_RE.test(text)) continue;
        report_count++;
        for (const cat of item.categories ?? []) {
          if (typeof cat === 'string' && cat.length > 0) countries.add(cat);
        }
      }
    }

    const band = DEFCON_BANDS.find(b => report_count >= b.min) ?? DEFCON_BANDS[DEFCON_BANDS.length - 1];
    const now = new Date();
    const signal: GlobalSignal = {
      date: now.toISOString().slice(0, 10),
      defcon: band.level,
      label: band.label,
      report_count,
      country_count: countries.size,
      summary: `${report_count} verified conflict-related report${report_count !== 1 ? 's' : ''} in the past 24 hours.`,
      updated_at: now.toISOString(),
    };

    _cached = signal;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return json(signal);
  } catch (err) {
    console.error('[global-signal] compute error:', err);
    return json(FALLBACK);
  }
}
