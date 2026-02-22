import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export async function GET({ url }: RequestEvent) {
  const range = url.searchParams.get('range') ?? '6m';
  const validRanges = ['3m', '6m', '1y', '2y'];
  const safeRange = validRanges.includes(range) ? range : '6m';

  try {
    const res = await fetch(`https://mempool.space/api/v1/mining/hashrate/${safeRange}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    // avgHashrate is in H/s — convert to EH/s (÷ 1e18)
    const hashrates = (data.hashrates ?? []).map((h: { timestamp: number; avgHashrate: number }) => ({
      t: h.timestamp * 1000,
      p: parseFloat((h.avgHashrate / 1e18).toFixed(2)),
    }));
    return json({ hashrates });
  } catch {
    return json({ hashrates: [] });
  }
}
