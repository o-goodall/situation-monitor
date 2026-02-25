import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';

/**
 * GET /api/conflict-summary
 *
 * Fetches verified conflict/crisis RSS feeds and produces a DEFCON-style
 * global threat level + daily summary.  Entirely rule-based — no AI.
 *
 * Sources:
 *  • International Crisis Group  https://www.crisisgroup.org/rss-0
 *  • Army Recognition Conflicts  https://www.armyrecognition.com/focus-analysis-conflicts/army/conflicts-in-the-world/feed/rss
 *
 * Scoring:
 *  • Each article is scanned for violent-event keywords.
 *  • A severity weight is assigned per event type detected in the title/description.
 *  • Scores are summed and normalized to 0–100, then mapped to DEFCON 1–5.
 */

// ── RSS sources ──────────────────────────────────────────────────
const CONFLICT_FEEDS = [
  { url: 'https://www.crisisgroup.org/rss-0',           name: 'Crisis Group' },
  { url: 'https://www.armyrecognition.com/focus-analysis-conflicts/army/conflicts-in-the-world/feed/rss', name: 'Army Recognition' },
];

// ── Event-type keyword → severity weight ────────────────────────
// Higher weight = more severe event
const EVENT_WEIGHTS: { pattern: RegExp; type: string; weight: number }[] = [
  { pattern: /nuclear|nuke|chemical weapon|wmd/i,                                        type: 'WMD',       weight: 10 },
  { pattern: /airstrike|air strike|aerial bombardment|bombing campaign/i,               type: 'airstrike',  weight:  4 },
  { pattern: /battle|offensive|counter-offensive|ground assault|major attack/i,         type: 'battle',     weight:  3 },
  { pattern: /missile|rocket attack|ballistic|drone strike/i,                           type: 'missile',    weight:  3 },
  { pattern: /bomb|explosion|blast|ied/i,                                               type: 'bombing',    weight:  2 },
  { pattern: /killed|fatalities|dead|deaths|casualties|wounded|civilians killed/i,      type: 'fatalities', weight:  2 },
  { pattern: /clash|fighting|armed conflict|gunfire|shelling|artillery/i,               type: 'clash',      weight:  1 },
  { pattern: /coup|overthrow|putsch/i,                                                  type: 'coup',       weight:  2 },
  { pattern: /ceasefire broken|resumed fighting|violated ceasefire/i,                  type: 'escalation', weight:  2 },
  { pattern: /displacement|refugee|flee|evacuation/i,                                  type: 'crisis',     weight:  1 },
];

// Minimum weight for an article to be included as a "conflict event"
const MIN_SEVERITY = 1;

// Normalization ceiling — a global_score at or above this value maps to the
// maximum DEFCON level.  Tuned so ~50 violent articles at mixed severity → 100.
const SCORE_CEILING = 150;

// ── DEFCON mapping ───────────────────────────────────────────────
interface DefconBand { min: number; level: number; label: string }
const DEFCON_BANDS: DefconBand[] = [
  { min: 76, level: 1, label: 'Severe global crisis / multiple large-scale wars' },
  { min: 51, level: 2, label: 'High global conflict / multiple ongoing wars' },
  { min: 31, level: 3, label: 'Medium global tensions / regional wars' },
  { min: 11, level: 4, label: 'Minor tensions / isolated conflicts' },
  { min:  0, level: 5, label: 'Minimal global tension' },
];

function scoreToDefcon(score: number): DefconBand {
  return DEFCON_BANDS.find(b => score >= b.min) ?? DEFCON_BANDS[DEFCON_BANDS.length - 1];
}

// ── Country/conflict name extraction helpers ─────────────────────
const KNOWN_CONFLICTS: { pattern: RegExp; name: string; country: string }[] = [
  { pattern: /russia.{0,10}ukraine|ukraine.{0,10}russia|war in ukraine/i, name: 'Russia–Ukraine War',  country: 'Ukraine' },
  { pattern: /yemen/i,                                                      name: 'Yemen Civil War',     country: 'Yemen' },
  { pattern: /sudan/i,                                                      name: 'Sudan Conflict',      country: 'Sudan' },
  { pattern: /gaza|israel.{0,10}hamas|hamas.{0,10}israel/i,               name: 'Israel–Gaza War',     country: 'Gaza' },
  { pattern: /myanmar|burma/i,                                             name: 'Myanmar Civil War',   country: 'Myanmar' },
  { pattern: /syria/i,                                                     name: 'Syrian Conflict',     country: 'Syria' },
  { pattern: /ethiopia|tigray/i,                                           name: 'Ethiopia Conflict',   country: 'Ethiopia' },
  { pattern: /somalia/i,                                                   name: 'Somalia Conflict',    country: 'Somalia' },
  { pattern: /mali|sahel/i,                                                name: 'Sahel Conflict',      country: 'Mali' },
  { pattern: /democratic republic.{0,6}congo|drc\b/i,                     name: 'DRC Conflict',        country: 'DR Congo' },
  { pattern: /haiti/i,                                                     name: 'Haiti Crisis',        country: 'Haiti' },
  { pattern: /nagorno.karabakh|armenia.{0,10}azerbaijan/i,                name: 'Armenia–Azerbaijan',  country: 'Armenia' },
  { pattern: /taiwan strait|taiwan\b/i,                                   name: 'Taiwan Strait Crisis', country: 'Taiwan' },
  { pattern: /north korea|dprk/i,                                         name: 'Korean Peninsula',    country: 'North Korea' },
  { pattern: /iraq/i,                                                      name: 'Iraq Instability',    country: 'Iraq' },
  { pattern: /afghanistan/i,                                               name: 'Afghanistan',         country: 'Afghanistan' },
  { pattern: /libya/i,                                                     name: 'Libya Conflict',      country: 'Libya' },
  { pattern: /pakistan/i,                                                  name: 'Pakistan Instability', country: 'Pakistan' },
  { pattern: /sahel|burkina|niger\b/i,                                     name: 'Sahel Jihadism',      country: 'Burkina Faso' },
];

// ── Parser instance ──────────────────────────────────────────────
const parser = new Parser({ timeout: 8000 });

// ── In-memory cache (1 hour) ─────────────────────────────────────
interface CacheEntry { data: ConflictSummary; at: number }
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Types ────────────────────────────────────────────────────────
interface ConflictEvent {
  title: string;
  link: string;
  source: string;
  pubDate: string;
  severity: number;
  eventType: string;
  conflictName: string;
  country: string;
}

interface TopConflict {
  name: string;
  country: string;
  severity_score: number;
}

interface ConflictSummary {
  date: string;
  global_score: number;
  defcon_level: number;
  defcon_label: string;
  summary: string;
  top_conflicts: TopConflict[];
  event_count: number;
  sources_used: string[];
  defcon_description: string;
  source_url: string;
  updated_month: string;
  from_live_source: boolean;
}

// ── Scoring helpers ──────────────────────────────────────────────
function scoreArticle(title: string, description: string): { severity: number; eventType: string } {
  const text = `${title} ${description}`;
  let severity = 0;
  let primaryType = '';
  for (const { pattern, type, weight } of EVENT_WEIGHTS) {
    if (pattern.test(text)) {
      severity += weight;
      if (!primaryType) primaryType = type;
    }
  }
  return { severity, eventType: primaryType || 'conflict' };
}

function detectConflict(title: string, description: string): { name: string; country: string } {
  const text = `${title} ${description}`;
  for (const { pattern, name, country } of KNOWN_CONFLICTS) {
    if (pattern.test(text)) return { name, country };
  }
  return { name: 'Other Conflict', country: 'Unknown' };
}

function buildSummary(defcon: DefconBand, topConflicts: TopConflict[]): string {
  const conflictNames = topConflicts.slice(0, 3).map(c => c.name);
  const prefix = defcon.label.split('/')[0].trim();
  if (conflictNames.length === 0) return `${prefix}.`;
  return `${prefix}: active reporting on ${conflictNames.join(', ')}.`;
}

// ── Scrape DEFCON level from defconlevel.com ─────────────────────
const DEFCON_SOURCE_URL = 'https://www.defconlevel.com/current-level';

async function fetchFromDefconLevel(): Promise<{
  level: number;
  description: string;
  updatedMonth: string;
} | null> {
  try {
    const res = await fetch(DEFCON_SOURCE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SituationMonitor/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Strip scripts and styles for cleaner matching
    const stripped = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Extract DEFCON level number (1–5)
    const levelMatch = stripped.match(/DEFCON\s*(?:level\s*)?(\d)/i);
    const level = levelMatch ? parseInt(levelMatch[1]) : null;
    if (!level || level < 1 || level > 5) return null;

    // Extract description — look for a paragraph containing threat/situation keywords
    const descMatches = [...stripped.matchAll(/<p[^>]*>([\s\S]{40,600}?)<\/p>/gi)];
    let description = '';
    for (const m of descMatches) {
      const text = m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (/tension|conflict|war|threat|readiness|elevated|military|global|instabilit/i.test(text)) {
        description = text;
        break;
      }
    }

    // Extract updated month/year
    const dateMatch = stripped.match(/Updated\s+([A-Za-z]+\s+\d{4})/i)
      ?? stripped.match(/([A-Za-z]+\s+\d{4})/);
    const updatedMonth = dateMatch
      ? dateMatch[1]
      : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    return { level, description, updatedMonth };
  } catch {
    return null;
  }
}

// ── Main handler ─────────────────────────────────────────────────
export async function GET(_event: RequestEvent) {
  // Return cached response if still fresh
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return json(cache.data);
  }

  // Try to fetch live DEFCON level from defconlevel.com in parallel with RSS feeds
  const [liveDefcon, rssResults] = await Promise.all([
    fetchFromDefconLevel(),
    Promise.allSettled(
      CONFLICT_FEEDS.map(f => parser.parseURL(f.url).then(feed => ({ feed, name: f.name })))
    ),
  ]);

  try {
    const events: ConflictEvent[] = [];
    const sourcesUsed: string[] = [];

    for (const result of rssResults) {
      if (result.status !== 'fulfilled') continue;
      const { feed, name } = result.value;
      sourcesUsed.push(name);

      for (const item of feed.items ?? []) {
        const title = item.title ?? '';
        const desc = (item.contentSnippet || item.content || '').replace(/<[^>]*>/g, '').slice(0, 500);
        const { severity, eventType } = scoreArticle(title, desc);
        if (severity < MIN_SEVERITY) continue;

        const { name: conflictName, country } = detectConflict(title, desc);
        events.push({
          title,
          link: item.link ?? '',
          source: name,
          pubDate: item.pubDate ?? '',
          severity,
          eventType,
          conflictName,
          country,
        });
      }
    }

    // Aggregate severity per named conflict
    const conflictMap = new Map<string, TopConflict>();
    for (const ev of events) {
      const existing = conflictMap.get(ev.conflictName);
      if (existing) {
        existing.severity_score += ev.severity;
      } else {
        conflictMap.set(ev.conflictName, { name: ev.conflictName, country: ev.country, severity_score: ev.severity });
      }
    }

    const topConflicts: TopConflict[] = [...conflictMap.values()]
      .sort((a, b) => b.severity_score - a.severity_score)
      .slice(0, 6);

    // Global score: sum of all event severities, normalized to 0–100
    const rawScore = events.reduce((s, e) => s + e.severity, 0);
    const globalScore = Math.min(100, Math.round((rawScore / SCORE_CEILING) * 100));

    // Use live DEFCON level from defconlevel.com if available, else RSS-derived
    const defcon = liveDefcon
      ? (DEFCON_BANDS.find(b => b.level === liveDefcon.level) ?? scoreToDefcon(globalScore))
      : scoreToDefcon(globalScore);
    const summary = buildSummary(defcon, topConflicts);

    const updatedMonth = liveDefcon?.updatedMonth
      ?? new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const data: ConflictSummary = {
      date: new Date().toISOString().slice(0, 10),
      global_score: globalScore,
      defcon_level: defcon.level,
      defcon_label: defcon.label,
      summary,
      top_conflicts: topConflicts,
      event_count: events.length,
      sources_used: sourcesUsed,
      defcon_description: liveDefcon?.description ?? summary,
      source_url: DEFCON_SOURCE_URL,
      updated_month: updatedMonth,
      from_live_source: liveDefcon !== null,
    };

    cache = { data, at: Date.now() };
    return json(data);
  } catch {
    // Graceful fallback
    return json({
      date: new Date().toISOString().slice(0, 10),
      global_score: 0,
      defcon_level: liveDefcon?.level ?? 5,
      defcon_label: liveDefcon
        ? (DEFCON_BANDS.find(b => b.level === liveDefcon.level)?.label ?? 'Minimal global tension')
        : 'Minimal global tension',
      summary: liveDefcon?.description ?? 'Unable to fetch conflict feeds. Data unavailable.',
      top_conflicts: [],
      event_count: 0,
      sources_used: [],
      defcon_description: liveDefcon?.description ?? 'Unable to fetch conflict data.',
      source_url: DEFCON_SOURCE_URL,
      updated_month: liveDefcon?.updatedMonth
        ?? new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      from_live_source: liveDefcon !== null,
    });
  }
}
