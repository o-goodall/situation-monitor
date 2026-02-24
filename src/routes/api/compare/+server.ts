import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

type PricePoint = { t: number; p: number };

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// CoinGecko days param per range
const BTC_DAYS: Record<string, string> = {
  '1d':  '1',
  '7d':  '7',
  '1y':  '365',
};

// Yahoo Finance range/interval per range
const YF_PARAMS: Record<string, { range: string; interval: string }> = {
  '1d':  { range: '1d',  interval: '30m' },
  '7d':  { range: '5d',  interval: '60m' },
  '1y':  { range: '1y',  interval: '1d'  },
};

async function fetchBtcHistory(days: string): Promise<PricePoint[]> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`,
      { headers: HEADERS }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.prices ?? []).map(([t, p]: [number, number]) => ({ t, p }));
  } catch {
    return [];
  }
}

async function fetchYahooHistory(ticker: string, yfRange: string, yfInterval: string): Promise<PricePoint[]> {
  const bases = [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
  ];
  const query = `range=${yfRange}&interval=${yfInterval}&includePrePost=false`;
  try {
    return await Promise.any(
      bases.map(async (base) => {
        const url = `${base}/v8/finance/chart/${ticker}?${query}`;
        const res = await fetch(url, { headers: HEADERS });
        if (!res.ok) throw new Error(`${res.status}`);
        const d = await res.json();
        const timestamps: number[] = d?.chart?.result?.[0]?.timestamp ?? [];
        const closes: (number | null)[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
        const pts: PricePoint[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          const p = closes[i];
          if (p === null || p === undefined || isNaN(p)) continue;
          pts.push({ t: timestamps[i] * 1000, p });
        }
        if (pts.length > 1) return pts;
        throw new Error('insufficient data');
      })
    );
  } catch {
    return [];
  }
}

export async function GET({ url }: RequestEvent) {
  const range = url.searchParams.get('range') ?? '1y';
  const safeRange = BTC_DAYS[range] ? range : '1y';

  const btcDays = BTC_DAYS[safeRange];
  const { range: yfRange, interval: yfInterval } = YF_PARAMS[safeRange];

  const [btc, sp500, gold] = await Promise.all([
    fetchBtcHistory(btcDays),
    fetchYahooHistory('%5EGSPC', yfRange, yfInterval),
    fetchYahooHistory('GC%3DF', yfRange, yfInterval),
  ]);

  return json({ btc, sp500, gold });
}
