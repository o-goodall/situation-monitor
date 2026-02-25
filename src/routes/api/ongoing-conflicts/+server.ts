import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * GET /api/ongoing-conflicts
 *
 * @deprecated  This endpoint's functionality has been merged into
 * /api/global-threats, which now always includes all known conflict zones
 * (with static coordinates) supplemented by Al Jazeera RSS stories.
 *
 * This handler permanently redirects callers to /api/global-threats so that
 * any external consumers continue to work without changes.
 */

// Re-export the OngoingConflict type for backwards compatibility with any
// TypeScript consumers that imported it from this module.
export type { CountryThreat as OngoingConflict } from '../global-threats/+server.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function GET(_event: RequestEvent) {
  throw redirect(308, '/api/global-threats');
}
