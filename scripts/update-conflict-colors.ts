/**
 * update-conflict-colors.ts
 *
 * Fetches the Wikipedia "List of ongoing armed conflicts" page via the
 * MediaWiki API, parses the wikitext, extracts conflict names and
 * associated countries, assigns conflict severity based on casualty
 * thresholds, then writes the result to static/data/conflicts.json.
 *
 * Severity thresholds (CLED Conflict Index):
 *   Extreme   — 10,000+ casualties
 *   High      — 1,000–9,999 casualties
 *   Turbulent — 100–999 casualties
 *   Low       — 1–99 casualties
 *
 * Usage:
 *   npx tsx scripts/update-conflict-colors.ts
 *
 * Requirements: Node 18+, tsx (or ts-node)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

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
const OUTPUT_PATH   = path.resolve(
  fileURLToPath(import.meta.url),
  '../../static/data/conflicts.json',
);
const REVISION_CACHE_PATH = path.resolve(
  fileURLToPath(import.meta.url),
  '../../static/data/.last-revision',
);

/** Casualty count thresholds → severity */
const SEVERITY_THRESHOLDS: Array<{ min: number; severity: ConflictSeverity }> = [
  { min: 10_000, severity: 'Extreme'   },
  { min:  1_000, severity: 'High'      },
  { min:    100, severity: 'Turbulent' },
  { min:      1, severity: 'Low'       },
];

// ── Helper: fetch Wikipedia revision ──────────────────────────────────────

async function fetchLatestRevision(): Promise<WikiRevision> {
  const params = new URLSearchParams({
    action:    'query',
    titles:    PAGE_TITLE,
    prop:      'revisions',
    rvprop:    'ids|content',
    rvslots:   'main',
    formatversion: '2',
    format:    'json',
  });

  const url = `${WIKIPEDIA_API}?${params}`;
  console.log(`[update-conflict-colors] Fetching: ${url}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'SituationMonitor/1.0 (conflict-colors-updater)' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Wikipedia API responded with HTTP ${res.status}`);

  const data = await res.json() as {
    query: { pages: Array<{ revisions: Array<{ revid: number; slots: { main: { content: string } } }> }> }
  };

  const page = data.query.pages[0];
  const rev  = page.revisions[0];
  return { revid: rev.revid, content: rev.slots.main.content };
}

// ── Helper: read/write cached revision ID ─────────────────────────────────

async function readCachedRevisionId(): Promise<number | null> {
  try {
    const raw = await fs.readFile(REVISION_CACHE_PATH, 'utf8');
    const n   = parseInt(raw.trim(), 10);
    return isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

async function writeCachedRevisionId(revid: number): Promise<void> {
  await fs.writeFile(REVISION_CACHE_PATH, String(revid), 'utf8');
}

// ── Helper: parse wikitext tables ─────────────────────────────────────────

/**
 * Parses all wikitext {| tables |} from a wikitext string and returns an
 * array of tables, each containing an array of rows with raw cell strings.
 */
export function parseWikitextTables(wikitext: string): WikiTable[] {
  const tables: WikiTable[] = [];
  // Split on table open markers
  const tableChunks = wikitext.split(/\{\|/);

  for (const chunk of tableChunks.slice(1)) {
    // Find the end of this table
    const endIdx = chunk.indexOf('|}');
    const tableBody = endIdx >= 0 ? chunk.slice(0, endIdx) : chunk;

    const rows: WikiTableRow[] = [];
    let currentCells: string[] = [];

    for (const rawLine of tableBody.split('\n')) {
      const line = rawLine.trim();

      if (line.startsWith('|-')) {
        // Row separator
        if (currentCells.length > 0) {
          rows.push({ cells: currentCells });
          currentCells = [];
        }
      } else if (line.startsWith('!')) {
        // Header cells (ignore for our purposes)
      } else if (line.startsWith('|')) {
        // Data cells — may be pipe-separated inline: | a || b || c
        const cellContent = line.slice(1);
        const inlineCells = cellContent.split('||');
        for (const cell of inlineCells) {
          // Strip cell formatting attributes (e.g. "style=...| value")
          const pipeIdx = cell.lastIndexOf('|');
          const value   = pipeIdx >= 0 && !/^\s*\[/.test(cell.slice(0, pipeIdx))
            ? cell.slice(pipeIdx + 1)
            : cell;
          currentCells.push(value.trim());
        }
      }
    }
    if (currentCells.length > 0) rows.push({ cells: currentCells });
    if (rows.length > 0) tables.push({ rows });
  }

  return tables;
}

// ── Helper: normalise country name ────────────────────────────────────────

/**
 * Strips wikitext markup, HTML tags, footnote references, and common
 * suffixes, then title-cases the result.
 */
export function normalizeCountryName(raw: string): string {
  return raw
    // Remove [[Link|display]] → display
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    // Remove remaining wikitext templates {{...}}
    .replace(/\{\{[^}]*\}\}/g, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // Remove footnote markers [1], [a], etc.
    .replace(/\[\w+\]/g, '')
    // Remove parenthetical notes
    .replace(/\([^)]*\)/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Helper: extract countries from a wikitext cell ────────────────────────

/**
 * Extracts individual country names from a wikitext cell.
 * Countries may be comma/newline/bullet separated or in a wikilist.
 */
export function extractCountries(cellText: string): string[] {
  const raw = normalizeCountryName(cellText);
  if (!raw) return [];

  // Split on commas, semicolons, newlines, or bullet-style separators
  const parts = raw
    .split(/[,;\n•·]/)
    .map(s => s.replace(/^[\s*#:]+/, '').trim())
    .filter(s => s.length > 1);

  return parts;
}

// ── Helper: validate country against known list ────────────────────────────

const KNOWN_COUNTRY_NAMES = new Set<string>([
  'Afghanistan','Albania','Algeria','Angola','Argentina','Armenia','Australia',
  'Austria','Azerbaijan','Bangladesh','Belarus','Belgium','Bolivia','Bosnia',
  'Brazil','Bulgaria','Burkina Faso','Cambodia','Cameroon','Canada','Central African Republic',
  'Chad','Chile','China','Colombia','Croatia','Cuba','Czech Republic',
  'DR Congo','Democratic Republic of the Congo','Denmark','Ecuador','Egypt',
  'El Salvador','Eritrea','Ethiopia','Finland','France','Georgia','Germany','Ghana',
  'Greece','Guatemala','Guinea','Guinea-Bissau','Haiti','Honduras','Hungary',
  'India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Ivory Coast',
  'Japan','Jordan','Kazakhstan','Kenya','Kosovo','Kuwait','Kyrgyzstan',
  'Lebanon','Libya','Lithuania','Madagascar','Malawi','Malaysia','Mali',
  'Mauritania','Mexico','Moldova','Morocco','Mozambique','Myanmar','Nagorno-Karabakh',
  'Namibia','Nepal','Netherlands','Nicaragua','Niger','Nigeria','North Korea',
  'Norway','Pakistan','Palestine','Panama','Papua New Guinea','Paraguay','Peru',
  'Philippines','Poland','Portugal','Romania','Russia','Rwanda',
  'Saudi Arabia','Senegal','Sierra Leone','Somalia','South Africa',
  'South Korea','South Sudan','Spain','Sri Lanka','Sudan','Sweden','Syria',
  'Taiwan','Tajikistan','Tanzania','Thailand','Tunisia','Turkey','Turkmenistan',
  'Uganda','Ukraine','United Kingdom','United States','Uzbekistan',
  'Venezuela','Vietnam','Yemen','Zambia','Zimbabwe',
]);

/**
 * Returns true if the given name is a recognisable country/territory.
 *
 * @param name - Country name to validate.
 * @param extraNames - Optional set of additional valid names, e.g. loaded from
 *   `static/data/world.geo.json` when that file is available.  Pass the set of
 *   `properties.name` values from the GeoJSON FeatureCollection to broaden
 *   validation beyond the built-in list.
 */
export function validateCountry(name: string, extraNames?: Set<string>): boolean {
  const normalised = name.trim();
  if (!normalised || normalised.length < 2) return false;
  if (KNOWN_COUNTRY_NAMES.has(normalised)) return true;
  if (extraNames?.has(normalised)) return true;
  // Fuzzy: check if a known country name contains this string or vice-versa
  for (const known of KNOWN_COUNTRY_NAMES) {
    if (known.toLowerCase() === normalised.toLowerCase()) return true;
  }
  return false;
}

// ── Helper: extract casualty count from wikitext cell ─────────────────────

const CASUALTY_RE = /(\d[\d,._\s]*(?:,\d{3})*(?:\+|–|\-|\+)?)/g;

function parseCasualties(text: string): number {
  const clean = text.replace(/<[^>]+>/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1');
  let max = 0;
  let m: RegExpExecArray | null;
  CASUALTY_RE.lastIndex = 0;
  while ((m = CASUALTY_RE.exec(clean)) !== null) {
    const n = parseInt(m[1].replace(/[,._\s]/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

// ── Helper: assign severity from casualty count ───────────────────────────

function assignSeverity(casualties: number): ConflictSeverity {
  for (const { min, severity } of SEVERITY_THRESHOLDS) {
    if (casualties >= min) return severity;
  }
  return 'Low';
}

// ── Main: update country colours ──────────────────────────────────────────

/**
 * Main entry point.  Fetches the latest Wikipedia revision, parses
 * conflict tables, and writes the output JSON if the content has changed.
 */
export async function updateCountryColors(): Promise<void> {
  console.log('[update-conflict-colors] Starting update…');

  // 1. Fetch latest revision
  const { revid, content } = await fetchLatestRevision();
  console.log(`[update-conflict-colors] Latest revision: ${revid}`);

  // 2. Check if revision has changed
  const cachedRevId = await readCachedRevisionId();
  if (cachedRevId === revid) {
    console.log('[update-conflict-colors] Revision unchanged — nothing to do.');
    return;
  }

  // 3. Parse wikitext tables
  console.log('[update-conflict-colors] Parsing wikitext tables…');
  const tables = parseWikitextTables(content);
  console.log(`[update-conflict-colors] Found ${tables.length} table(s)`);

  // 4. Extract conflict entries
  const conflictMap = new Map<string, ConflictEntry>();

  for (const table of tables) {
    for (const row of table.rows) {
      if (row.cells.length < 2) continue;

      // Column 0: conflict name; Column 1: location/countries; Column N: casualties
      const rawName       = row.cells[0] ?? '';
      const rawCountries  = row.cells[1] ?? '';
      const rawCasualties = row.cells.slice(2).join(' ');

      const conflictName = normalizeCountryName(rawName);
      if (!conflictName || conflictName.length < 3) continue;

      const rawCountryList = extractCountries(rawCountries);
      const validCountries = rawCountryList.filter(c => validateCountry(c));

      if (validCountries.length === 0) continue;

      const casualties = parseCasualties(rawCasualties);
      const severity   = casualties > 0 ? assignSeverity(casualties) : 'Low';

      const key = conflictName.toLowerCase();
      const existing = conflictMap.get(key);
      if (existing) {
        // Merge: take highest severity and union of countries
        const existingRank = SEVERITY_THRESHOLDS.findIndex(t => t.severity === existing.severity);
        const newRank      = SEVERITY_THRESHOLDS.findIndex(t => t.severity === severity);
        if (newRank < existingRank) existing.severity = severity;
        for (const c of validCountries) {
          if (!existing.countries.includes(c)) existing.countries.push(c);
        }
      } else {
        conflictMap.set(key, {
          conflict:  conflictName,
          countries: [...validCountries],
          severity,
        });
      }
    }
  }

  if (conflictMap.size === 0) {
    console.warn('[update-conflict-colors] Warning: No conflict entries extracted — aborting write.');
    return;
  }

  // 5. Sort alphabetically
  const entries: ConflictEntry[] = Array.from(conflictMap.values())
    .map(e => ({ ...e, countries: [...e.countries].sort() }))
    .sort((a, b) => a.conflict.localeCompare(b.conflict));

  console.log(`[update-conflict-colors] Extracted ${entries.length} conflict(s)`);

  // 6. Pretty-print JSON (2-space indent)
  const outputJson = JSON.stringify(entries, null, 2);

  // 7. Only write if content changed
  let existingJson = '';
  try {
    existingJson = await fs.readFile(OUTPUT_PATH, 'utf8');
  } catch {
    // File does not yet exist — will be created
  }

  if (outputJson === existingJson) {
    console.log('[update-conflict-colors] Content unchanged — skipping write.');
  } else {
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, outputJson, 'utf8');
    console.log(`[update-conflict-colors] Wrote ${entries.length} entries to ${OUTPUT_PATH}`);
  }

  // 8. Persist the new revision ID so subsequent runs can skip unchanged content
  await fs.mkdir(path.dirname(REVISION_CACHE_PATH), { recursive: true });
  await writeCachedRevisionId(revid);
  console.log('[update-conflict-colors] Done.');
}

// ── Entry point ───────────────────────────────────────────────────────────

updateCountryColors().catch((err: unknown) => {
  console.error('[update-conflict-colors] Fatal error:', err);
  process.exit(1);
});
