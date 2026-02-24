import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { DEFAULT_THREATS } from '$lib/settings';

/**
 * GET /api/threats
 *
 * Returns the active global threat hotspots for the World Map.
 *
 * Attempts to use live ACLED conflict data (/api/acled) first.
 * Falls back to curated static hotspots (DEFAULT_THREATS) when ACLED
 * credentials are not configured or the upstream call fails.
 *
 * Response: { threats: Threat[], conflictCountryIds: string[], updatedAt: string }
 */
export async function GET({ url, fetch: svelteKitFetch }: RequestEvent) {
  try {
    // Try live ACLED data first (server-to-server via SvelteKit's fetch)
    const acledRes = await svelteKitFetch('/api/acled');
    if (acledRes.ok && acledRes.status !== 204) {
      const acledData = await acledRes.json();
      if (acledData && Array.isArray(acledData.threats) && acledData.threats.length > 0) {
        return json(acledData, {
          headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=300' },
        });
      }
    }
  } catch {
    // ACLED unavailable — fall through to static defaults
  }

  // Fallback: curated static hotspots
  const conflictCountryIds = DEFAULT_THREATS
    .filter(t => t.countryId)
    .map(t => t.countryId as string);

  return json({
    threats: DEFAULT_THREATS,
    conflictCountryIds,
    updatedAt: new Date().toISOString(),
  });
}
