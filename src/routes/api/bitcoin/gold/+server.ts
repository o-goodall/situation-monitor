import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

// Range → CoinGecko days param
const RANGE_TO_DAYS: Record<string, string> = {
  '6m':  '180',
  '1y':  '365',
  '5y':  '1825',
  'max': 'max',
};

type PricePoint = { t: number; p: number };

async function fetchCoinGeckoHistory(coinId: string, days: string): Promise<PricePoint[] | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const prices: PricePoint[] = (data.prices ?? []).map(([t, p]: [number, number]) => ({ t, p }));
    return prices.length >= 2 ? prices : null;
  } catch { return null; }
}

export async function GET({ url }: RequestEvent) {
  const rangeParam = url.searchParams.get('range') ?? '1y';
  const safeRange = RANGE_TO_DAYS[rangeParam] ? rangeParam : '1y';
  const days = RANGE_TO_DAYS[safeRange];

  // BTC price in USD; PAXG (Pax Gold) is redeemable 1:1 for one troy oz of gold
  const [btcPrices, goldPrices] = await Promise.all([
    fetchCoinGeckoHistory('bitcoin', days),
    fetchCoinGeckoHistory('pax-gold', days),
  ]);

  if (!btcPrices || !goldPrices) {
    return json({ pctChange: null, startRatio: null, range: safeRange });
  }

  // Use the shorter series length to align start/end
  const len = Math.min(btcPrices.length, goldPrices.length);
  if (len < 2) {
    return json({ pctChange: null, startRatio: null, range: safeRange });
  }
  const btcStart  = btcPrices[btcPrices.length - len].p;
  const goldStart = goldPrices[goldPrices.length - len].p;
  const btcEnd    = btcPrices[btcPrices.length - 1].p;
  const goldEnd   = goldPrices[goldPrices.length - 1].p;

  if (!btcStart || !btcEnd || btcStart <= 0 || btcEnd <= 0 ||
      !goldStart || !goldEnd || goldStart <= 0 || goldEnd <= 0) {
    return json({ pctChange: null, startRatio: null, range: safeRange });
  }

  const startRatio = btcStart / goldStart;
  const endRatio   = btcEnd   / goldEnd;

  const pctChange = ((endRatio - startRatio) / startRatio) * 100;
  return json({ pctChange: parseFloat(pctChange.toFixed(2)), startRatio: parseFloat(startRatio.toFixed(2)), range: safeRange });
}
