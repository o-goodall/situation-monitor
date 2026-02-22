import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const TICKER_MAP: Record<string, string> = {
  gold:  'GC=F',
  sp500: '%5EGSPC', // ^GSPC URL-encoded for Yahoo Finance
};

// Range → Yahoo Finance params
const RANGE_MAP: Record<string, { range: string; interval: string }> = {
  '1d':  { range: '1d',  interval: '30m' },
  '7d':  { range: '5d',  interval: '60m' },
  '30d': { range: '1mo', interval: '1d'  },
};

async function fetchYahooHistory(
  ticker: string,
  yfRange: string,
  yfInterval: string,
): Promise<{ t: number; p: number }[]> {
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${yfRange}&interval=${yfInterval}&includePrePost=false`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?range=${yfRange}&interval=${yfInterval}&includePrePost=false`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) continue;
      const d = await res.json();
      const timestamps: number[] = d?.chart?.result?.[0]?.timestamp ?? [];
      const closes: (number | null)[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
      const result: { t: number; p: number }[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const p = closes[i];
        if (p === null || p === undefined || isNaN(p)) continue;
        result.push({ t: timestamps[i] * 1000, p });
      }
      if (result.length > 1) return result;
    } catch { continue; }
  }
  return [];
}

export async function GET({ url }: RequestEvent) {
  const range = url.searchParams.get('range') ?? '1d';
  const safeRange = RANGE_MAP[range] ? range : '1d';
  const { range: yfRange, interval: yfInterval } = RANGE_MAP[safeRange];

  const assetParam = url.searchParams.get('assets') ?? '';
  const assets = assetParam.split(',').map(a => a.trim()).filter(a => a in TICKER_MAP);

  const results = await Promise.all(
    assets.map(async (asset) => {
      const ticker = TICKER_MAP[asset];
      const data = await fetchYahooHistory(ticker, yfRange, yfInterval);
      return [asset, data] as [string, { t: number; p: number }[]];
    }),
  );

  return json(Object.fromEntries(results));
}
