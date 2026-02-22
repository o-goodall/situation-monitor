import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export async function GET({ url }: RequestEvent) {
  const range = url.searchParams.get('range') ?? '1d';
  const validRanges = ['1d', '7d', '30d', 'ytd', '1y', '5y', 'max'];
  const safeRange = validRanges.includes(range) ? range : '1d';

  // Compute Jan 1 of the current year once; used by the ytd case for both day
  // count and clipping so the two calculations always stay in sync.
  const ytdJan1 = new Date(new Date().getFullYear(), 0, 1).getTime();

  let days: string;
  switch (safeRange) {
    case '7d':   days = '7';    break;
    case '30d':  days = '30';   break;
    case 'ytd': {
      // Request enough days to cover Jan 1 with daily granularity.
      // CoinGecko returns daily data only when days > 90; use at least 92.
      const daysSince = Math.ceil((Date.now() - ytdJan1) / 86400000);
      days = String(Math.max(92, daysSince + 5));
      break;
    }
    case '1y':   days = '365';  break;
    case '5y':   days = '1825'; break;
    case 'max':  days = 'max';  break;
    default:     days = '1';
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    let prices = (data.prices ?? []).map(([t, p]: [number, number]) => ({ t, p }));

    // Clip to Jan 1 of the current year for the ytd range
    if (safeRange === 'ytd') {
      const idx = prices.findIndex((pt: { t: number }) => pt.t >= ytdJan1);
      prices = idx >= 0 ? prices.slice(idx) : prices;
    }

    return json({ prices });
  } catch {
    return json({ prices: [] });
  }
}
