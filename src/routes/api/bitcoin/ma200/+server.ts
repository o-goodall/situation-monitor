import { json } from '@sveltejs/kit';

// Fetch ~1400 days of daily BTC closes from CoinGecko free API and compute 200-week MA.
// 200 weeks × 7 days/week = 1400 days.  CoinGecko returns daily granularity for >90 day ranges.
export async function GET() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1400',
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
      }
    );

    if (!res.ok) {
      return json({ ma200: null, error: `CoinGecko returned ${res.status}` });
    }

    const data = await res.json();
    const prices: [number, number][] = data?.prices ?? [];

    if (prices.length < 14) {
      return json({ ma200: null, error: 'Insufficient price data' });
    }

    // Sample weekly closes: take every 7th data point to approximate weekly closes.
    // Starting at index 6 (the 7th element) gives us the first complete week's close.
    const WEEKLY_OFFSET = 6;
    const weekly: number[] = [];
    for (let i = WEEKLY_OFFSET; i < prices.length; i += 7) {
      weekly.push(prices[i][1]);
    }

    // Use the last 200 weekly samples (or fewer if unavailable)
    const window = weekly.slice(-200);
    const ma200 = window.reduce((sum, p) => sum + p, 0) / window.length;

    return json({ ma200: parseFloat(ma200.toFixed(2)), weeks: window.length });
  } catch (err) {
    return json({ ma200: null, error: String(err) });
  }
}
