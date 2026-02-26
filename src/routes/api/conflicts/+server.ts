import { json } from '@sveltejs/kit';
import { getConflicts } from '$lib/conflict-colors-shared.js';

/**
 * GET /api/conflicts
 *
 * Returns the current Wikipedia-sourced conflict color data.
 * Served from a module-level 7-day cache; falls back to the bundled seed
 * data if Wikipedia is unreachable.
 *
 * Populated weekly by the Vercel Cron at /api/update-conflict-colors.
 */
export async function GET() {
  const result = await getConflicts();
  return json(result.entries, {
    headers: {
      // Fresh for 1 hour; Vercel CDN may serve stale for up to 24 h while revalidating
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
