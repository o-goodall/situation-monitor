import { json } from '@sveltejs/kit';
import { kv } from '@vercel/kv';
import type { GlobalSignal } from '../update-global-signal/+server.js';

// ── Fallback when no data has been stored yet ─────────────────────────────────

const FALLBACK: GlobalSignal = {
	date: new Date().toISOString().slice(0, 10),
	defcon: 5,
	label: 'Stable Environment',
	report_count: 0,
	country_count: 0,
	summary: 'No conflict data available yet. Signal will update at the next scheduled run.',
	updated_at: new Date().toISOString()
};

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
	try {
		const stored = await kv.get<GlobalSignal>('global-signal');
		return json(stored ?? FALLBACK);
	} catch (err) {
		console.error('[global-signal] KV read error:', err);
		return json(FALLBACK);
	}
}
