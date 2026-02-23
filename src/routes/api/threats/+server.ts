import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { DEFAULT_THREATS, type Threat } from '$lib/settings';

/**
 * GET /api/threats
 *
 * Returns the active global threat hotspots for the World Map.
 *
 * Query params:
 *  - disabled  (optional) JSON array of threat IDs to exclude, e.g. ["ukraine","gaza"]
 *  - custom    (optional) JSON array of user-added Threat objects to merge in
 *
 * Response: { threats: Threat[], conflictCountryIds: string[], updatedAt: string }
 */
export async function GET({ url }: RequestEvent) {
  try {
    // Parse optional user overrides passed from the client
    const disabledParam = url.searchParams.get('disabled');
    const customParam   = url.searchParams.get('custom');

    const disabledIds: string[] = disabledParam ? JSON.parse(decodeURIComponent(disabledParam)) : [];
    const customThreats: Threat[] = customParam ? JSON.parse(decodeURIComponent(customParam)) : [];

    // Start from the curated defaults, apply disable list
    const active = DEFAULT_THREATS.filter(t => !disabledIds.includes(t.id));

    // Merge in user-defined custom threats (append — they carry their own IDs)
    const merged: Threat[] = [...active, ...customThreats];

    // Build the set of ISO 3166-1 numeric IDs to shade on the map
    const conflictCountryIds = merged
      .filter(t => t.countryId)
      .map(t => t.countryId as string);

    return json({
      threats: merged,
      conflictCountryIds,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // On parse errors return defaults unfiltered
    const conflictCountryIds = DEFAULT_THREATS
      .filter(t => t.countryId)
      .map(t => t.countryId as string);

    return json({
      threats: DEFAULT_THREATS,
      conflictCountryIds,
      updatedAt: new Date().toISOString(),
    });
  }
}
