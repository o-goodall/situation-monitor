/**
 * conflict-colors-shared.ts
 *
 * Shared Wikipedia fetch + parse logic and module-level cache used by both
 * /api/conflicts (serve) and /api/update-conflict-colors (cron refresh).
 *
 * The cache has a 7-day TTL matching the weekly Vercel Cron schedule.
 * On a cache miss the module fetches Wikipedia and parses the wikitext.
 * If Wikipedia is unreachable the bundled seed data is returned so the globe
 * always has something to display.
 */

import seedConflicts from '../../static/data/conflicts.json';

// ── Types ──────────────────────────────────────────────────────────────────

export type ConflictSeverity = 'Extreme' | 'High' | 'Turbulent' | 'Low';

export interface ConflictEntry {
  conflict: string;
  countries: string[];
  severity: ConflictSeverity;
}

interface WikiRevision {
  revid: number;
  content: string;
}

interface WikiTable {
  rows: WikiTableRow[];
}

interface WikiTableRow {
  cells: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const PAGE_TITLE    = 'List_of_ongoing_armed_conflicts';

const SEVERITY_THRESHOLDS: Array<{ min: number; severity: ConflictSeverity }> = [
  { min: 10_000, severity: 'Extreme'   },
  { min:  1_000, severity: 'High'      },
  { min:    100, severity: 'Turbulent' },
  { min:      1, severity: 'Low'       },
];

/** 7-day TTL matches the weekly cron schedule */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Module-level cache ─────────────────────────────────────────────────────

interface ConflictsCache {
  entries:   ConflictEntry[];
  updatedAt: string;
  revid:     number;
  expiresAt: number;
}

let _cache: ConflictsCache | null = null;
/** In-flight refresh promise — deduplicates concurrent Wikipedia fetches */
let _refreshPromise: Promise<ConflictsResult> | null = null;

// ── Wikipedia helpers ──────────────────────────────────────────────────────

async function fetchLatestRevision(): Promise<WikiRevision> {
  const params = new URLSearchParams({
    action:        'query',
    titles:        PAGE_TITLE,
    prop:          'revisions',
    rvprop:        'ids|content',
    rvslots:       'main',
    formatversion: '2',
    format:        'json',
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`, {
    headers: { 'User-Agent': 'SituationMonitor/1.0 (conflict-colors-updater)' },
    signal:  AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Wikipedia API HTTP ${res.status}`);

  const data = await res.json() as {
    query: {
      pages: Array<{
        revisions: Array<{ revid: number; slots: { main: { content: string } } }>;
      }>;
    };
  };

  const rev = data.query.pages[0].revisions[0];
  return { revid: rev.revid, content: rev.slots.main.content };
}

// ── Wikitext parsing ───────────────────────────────────────────────────────

export function parseWikitextTables(wikitext: string): WikiTable[] {
  const tables: WikiTable[] = [];
  for (const chunk of wikitext.split(/\{\|/).slice(1)) {
    const endIdx   = chunk.indexOf('|}');
    const body     = endIdx >= 0 ? chunk.slice(0, endIdx) : chunk;
    const rows: WikiTableRow[] = [];
    let cells: string[] = [];

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('|-')) {
        if (cells.length > 0) { rows.push({ cells }); cells = []; }
      } else if (line.startsWith('!')) {
        // header — skip
      } else if (line.startsWith('|')) {
        for (const cell of line.slice(1).split('||')) {
          const pi  = cell.lastIndexOf('|');
          const val = pi >= 0 && !/^\s*\[/.test(cell.slice(0, pi))
            ? cell.slice(pi + 1)
            : cell;
          cells.push(val.trim());
        }
      }
    }
    if (cells.length > 0) rows.push({ cells });
    if (rows.length > 0)  tables.push({ rows });
  }
  return tables;
}

export function normalizeCountryName(raw: string): string {
  return raw
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[<>]/g, '')          // strip all angle brackets (removes HTML tags)
    .replace(/\[\w+\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractCountries(cellText: string): string[] {
  const raw = normalizeCountryName(cellText);
  if (!raw) return [];
  return raw
    .split(/[,;\n•·]/)
    .map(s => s.replace(/^[\s*#:]+/, '').trim())
    .filter(s => s.length > 1);
}

const KNOWN_COUNTRY_NAMES = new Set<string>([
  'Afghanistan','Albania','Algeria','Angola','Argentina','Armenia','Australia',
  'Austria','Azerbaijan','Bangladesh','Belarus','Belgium','Belize','Benin','Bolivia','Bosnia',
  'Brazil','Bhutan','Bulgaria','Burkina Faso','Burundi','Cambodia','Cameroon','Canada',
  'Central African Republic','Chad','Chile','China','Colombia','Croatia','Cuba',
  'Czech Republic','DR Congo','Democratic Republic of the Congo','Denmark',
  'Ecuador','Egypt','El Salvador','Eritrea','Ethiopia','Finland','France',
  'Gambia','Georgia','Germany','Ghana','Greece','Guatemala','Guinea','Guinea-Bissau',
  'Haiti','Honduras','Hungary','India','Indonesia','Iran','Iraq','Ireland',
  'Israel','Italy','Ivory Coast','Japan','Jordan','Kazakhstan','Kenya',
  'Kosovo','Kuwait','Kyrgyzstan','Laos','Lebanon','Libya','Lithuania','Madagascar',
  'Malawi','Malaysia','Mali','Mauritania','Mexico','Moldova','Morocco',
  'Mozambique','Myanmar','Nagorno-Karabakh','Namibia','Nepal','Netherlands',
  'Nicaragua','Niger','Nigeria','North Korea','Norway','Pakistan','Palestine',
  'Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland',
  'Portugal','Romania','Russia','Rwanda','Saudi Arabia','Sahrawi Republic','Senegal',
  'Sierra Leone','Somalia','South Africa','South Korea','South Sudan','Spain',
  'Sri Lanka','Sudan','Sweden','Syria','Taiwan','Tajikistan','Tanzania',
  'Thailand','Togo','Tunisia','Turkey','Turkmenistan','Uganda','Ukraine',
  'United Arab Emirates','United Kingdom','United States','Uzbekistan','Venezuela','Vietnam',
  'Yemen','Zambia','Zimbabwe',
]);

/** Lowercase mirror for O(1) case-insensitive lookups */
const KNOWN_COUNTRY_LOWER = new Set<string>(
  [...KNOWN_COUNTRY_NAMES].map(n => n.toLowerCase())
);

export function validateCountry(name: string, extraNames?: Set<string>): boolean {
  const n = name.trim();
  if (!n || n.length < 2) return false;
  if (KNOWN_COUNTRY_NAMES.has(n)) return true;
  if (extraNames?.has(n)) return true;
  return KNOWN_COUNTRY_LOWER.has(n.toLowerCase());
}

const CASUALTY_RE = /(\d[\d,._\s]*(?:,\d{3})*(?:\+|–|-)?)/g;

function parseCasualties(text: string): number {
  const clean = text
    .replace(/[<>]/g, '')          // strip all angle brackets (removes HTML tags)
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1');
  let max = 0, m: RegExpExecArray | null;
  CASUALTY_RE.lastIndex = 0;
  while ((m = CASUALTY_RE.exec(clean)) !== null) {
    const n = parseInt(m[1].replace(/[,._\s]/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

function assignSeverity(casualties: number): ConflictSeverity {
  for (const { min, severity } of SEVERITY_THRESHOLDS) {
    if (casualties >= min) return severity;
  }
  return 'Low';
}

// ── Parse Wikipedia wikitext into ConflictEntry[] ─────────────────────────

function parseConflicts(content: string): ConflictEntry[] {
  const tables = parseWikitextTables(content);
  const conflictMap = new Map<string, ConflictEntry>();

  for (const table of tables) {
    for (const row of table.rows) {
      if (row.cells.length < 2) continue;

      const conflictName = normalizeCountryName(row.cells[0] ?? '');
      if (!conflictName || conflictName.length < 3) continue;

      const validCountries = extractCountries(row.cells[1] ?? '')
        .filter(c => validateCountry(c));
      if (validCountries.length === 0) continue;

      const casualties = parseCasualties(row.cells.slice(2).join(' '));
      const severity   = casualties > 0 ? assignSeverity(casualties) : 'Low';
      const key        = conflictName.toLowerCase();
      const existing   = conflictMap.get(key);

      if (existing) {
        const existingRank = SEVERITY_THRESHOLDS.findIndex(t => t.severity === existing.severity);
        const newRank      = SEVERITY_THRESHOLDS.findIndex(t => t.severity === severity);
        if (newRank < existingRank) existing.severity = severity;
        for (const c of validCountries) {
          if (!existing.countries.includes(c)) existing.countries.push(c);
        }
      } else {
        conflictMap.set(key, { conflict: conflictName, countries: [...validCountries], severity });
      }
    }
  }

  return Array.from(conflictMap.values())
    .map(e => ({ ...e, countries: [...e.countries].sort() }))
    .sort((a, b) => a.conflict.localeCompare(b.conflict));
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface ConflictsResult {
  entries:      ConflictEntry[];
  updatedAt:    string;
  revid:        number;
  fromWikipedia: boolean;
}

/**
 * Returns conflict data.
 *
 * - Returns the in-memory cache if still fresh (< 7 days old).
 * - Otherwise fetches from Wikipedia, parses, updates the cache.
 * - Falls back to the bundled seed data if Wikipedia is unreachable.
 * - Deduplicates concurrent fetches: if a refresh is already in flight,
 *   all concurrent callers await the same promise.
 *
 * @param forceRefresh - When true, bypasses the TTL and always refetches.
 */
export async function getConflicts(forceRefresh = false): Promise<ConflictsResult> {
  // Return cached data if still valid
  if (!forceRefresh && _cache && Date.now() < _cache.expiresAt) {
    return {
      entries:       _cache.entries,
      updatedAt:     _cache.updatedAt,
      revid:         _cache.revid,
      fromWikipedia: true,
    };
  }

  // Deduplicate concurrent refresh requests
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async (): Promise<ConflictsResult> => {
    try {
      const { revid, content } = await fetchLatestRevision();

      // Skip re-parsing if the revision hasn't changed
      if (!forceRefresh && _cache && _cache.revid === revid) {
        _cache.expiresAt = Date.now() + CACHE_TTL_MS;
        return {
          entries:       _cache.entries,
          updatedAt:     _cache.updatedAt,
          revid:         _cache.revid,
          fromWikipedia: true,
        };
      }

      const entries   = parseConflicts(content);
      const updatedAt = new Date().toISOString();
      _cache = { entries, updatedAt, revid, expiresAt: Date.now() + CACHE_TTL_MS };
      console.log(`[conflict-colors] Updated cache: ${entries.length} conflict(s), revid=${revid}`);
      return { entries, updatedAt, revid, fromWikipedia: true };
    } catch (err) {
      console.error('[conflict-colors] Wikipedia fetch failed, using seed data:', err);
      const entries = seedConflicts as ConflictEntry[];
      return { entries, updatedAt: new Date().toISOString(), revid: 0, fromWikipedia: false };
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}
