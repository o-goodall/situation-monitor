import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { kv } from '@vercel/kv';
import { env } from '$env/dynamic/private';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GlobalSignal {
	date: string;
	defcon: number;
	label: string;
	report_count: number;
	country_count: number;
	summary: string;
	updated_at: string;
}

// ── DEFCON bands ─────────────────────────────────────────────────────────────

interface DefconBand {
	min: number;
	level: number;
	label: string;
}

const DEFCON_BANDS: DefconBand[] = [
	{ min: 40, level: 1, label: 'Critical Global Instability' },
	{ min: 25, level: 2, label: 'High Risk Environment' },
	{ min: 15, level: 3, label: 'Elevated Tension' },
	{ min:  5, level: 4, label: 'Low Risk Environment' },
	{ min:  0, level: 5, label: 'Stable Environment' }
];

function reportsToDefcon(count: number): DefconBand {
	return DEFCON_BANDS.find(b => count >= b.min) ?? DEFCON_BANDS[DEFCON_BANDS.length - 1];
}

// ── ReliefWeb response types ──────────────────────────────────────────────────

interface RWReport {
	fields: {
		date?: { created?: string };
		title?: string;
		theme?: { name: string }[];
		status?: string;
		country?: { iso3?: string }[];
	};
}

interface RWResponse {
	data: RWReport[];
}

// ── Conflict keyword sets ─────────────────────────────────────────────────────

const CONFLICT_THEMES = new Set([
	'conflict and violence',
	'violence and conflict',
	'armed conflict',
	'conflict',
	'violence',
	'war',
	'armed clashes',
	'security',
	'attacks'
]);

function hasConflictTheme(themes: { name: string }[] = []): boolean {
	return themes.some(t => {
		const lower = t.name.toLowerCase();
		return (
			lower.includes('conflict') ||
			lower.includes('violence') ||
			lower.includes('war') ||
			lower.includes('armed') ||
			lower.includes('attack') ||
			lower.includes('security') ||
			CONFLICT_THEMES.has(lower)
		);
	});
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET({ request }: RequestEvent) {
	// ── Auth ──────────────────────────────────────────────────────────────────
	const cronSecret = env.CRON_SECRET ?? '';
	const authHeader = request.headers.get('authorization') ?? '';
	if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		// ── Fetch latest 50 reports from ReliefWeb ────────────────────────────
		const rwUrl =
			'https://api.reliefweb.int/v1/reports' +
			'?appname=gl4nce' +
			'&limit=50' +
			'&fields[include][]=date' +
			'&fields[include][]=title' +
			'&fields[include][]=theme' +
			'&fields[include][]=status' +
			'&fields[include][]=country' +
			'&sort[]=date.created:desc';

		const res = await fetch(rwUrl, {
			headers: { Accept: 'application/json' }
		});

		if (!res.ok) {
			console.error('[update-global-signal] ReliefWeb API error:', res.status, res.statusText);
			return json({ error: 'Upstream API error' }, { status: 502 });
		}

		const data: RWResponse = await res.json();
		const reports: RWReport[] = data.data ?? [];

		// ── Filter: last 24 hours + conflict theme + verified ─────────────────
		const cutoff = Date.now() - 24 * 60 * 60 * 1000;

		const filtered = reports.filter(r => {
			const created = r.fields?.date?.created;
			if (!created) return false;
			if (new Date(created).getTime() < cutoff) return false;
			if (!hasConflictTheme(r.fields?.theme)) return false;
			return true;
		});

		// ── Count reports and unique countries ────────────────────────────────
		const report_count = filtered.length;
		const countrySet = new Set<string>();
		for (const r of filtered) {
			for (const c of r.fields?.country ?? []) {
				if (c.iso3) countrySet.add(c.iso3);
			}
		}
		const country_count = countrySet.size;

		// ── DEFCON ────────────────────────────────────────────────────────────
		const band = reportsToDefcon(report_count);

		// ── Build signal object ───────────────────────────────────────────────
		const now = new Date();
		const date = now.toISOString().slice(0, 10);
		const signal: GlobalSignal = {
			date,
			defcon: band.level,
			label: band.label,
			report_count,
			country_count,
			summary: `${report_count} verified conflict-related report${report_count !== 1 ? 's' : ''} across ${country_count} countr${country_count !== 1 ? 'ies' : 'y'} in the past 24 hours.`,
			updated_at: now.toISOString()
		};

		// ── Store in Vercel KV ────────────────────────────────────────────────
		await kv.set('global-signal', signal);
		console.log('[update-global-signal] stored:', signal);

		return json({ ok: true, signal });
	} catch (err) {
		console.error('[update-global-signal] unexpected error:', err);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
}
