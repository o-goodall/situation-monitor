import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getConflicts } from '$lib/conflict-colors-shared.js';

/**
 * GET /api/update-conflict-colors
 *
 * Vercel Cron endpoint — runs weekly (Sunday 02:00 UTC, see vercel.json).
 *
 * Fetches the latest "List of ongoing armed conflicts" revision from
 * Wikipedia, parses conflict entries and severity, and refreshes the
 * module-level cache used by /api/conflicts.
 *
 * Protected by CRON_SECRET (same pattern as /api/update-global-signal).
 */
export async function GET({ request }: RequestEvent) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const cronSecret = env.CRON_SECRET ?? '';
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await getConflicts(/* forceRefresh */ true);
    return json({
      ok:            true,
      conflicts:     result.entries.length,
      revid:         result.revid,
      updatedAt:     result.updatedAt,
      fromWikipedia: result.fromWikipedia,
    });
  } catch (err) {
    console.error('[update-conflict-colors] unexpected error:', err);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
