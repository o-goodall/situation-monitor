import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export async function GET({ url }: RequestEvent) {
  const range = url.searchParams.get('range') ?? '1d';

  let days: string;
  switch (range) {
    case '7d':  days = '7';  break;
    case '30d': days = '30'; break;
    default:    days = '1';
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const prices = (data.prices ?? []).map(([t, p]: [number, number]) => ({ t, p }));
    return json({ prices });
  } catch {
    return json({ prices: [] });
  }
}
