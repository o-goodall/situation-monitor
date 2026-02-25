import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { HEADERS } from '$lib/fetch-headers';

const TICKER_MAP: Record<string, string> = {
  gold:  'GC=F',
  sp500: '%5EGSPC', // ^GSPC URL-encoded for Yahoo Finance
};

/** Returns the Unix timestamp (ms) of Jan 1 of the current year in local time. */
function currentYearJan1(): number {
  return new Date(new Date().getFullYear(), 0, 1).getTime();
}

// Range → Yahoo Finance params
const RANGE_MAP: Record<string, { range: string; interval: string }> = {
  '1d':  { range: '1d',  interval: '30m' },
  '7d':  { range: '5d',  interval: '60m' },
  '30d': { range: '1mo', interval: '1d'  },
  'ytd': { range: 'ytd', interval: '1d'  },
  '1y':  { range: '1y',  interval: '1d'  },
  '5y':  { range: '5y',  interval: '1mo' },
  'max': { range: 'max', interval: '3mo' },
};

async function fetchYahooHistory(
  ticker: string,
  yfRange: string,
  yfInterval: string,
): Promise<{ t: number; p: number }[]> {
  // Build query strings to try in order; for ytd, add period1/period2 fallbacks
  const queries: string[] = [
    `range=${yfRange}&interval=${yfInterval}&includePrePost=false`,
  ];
  if (yfRange === 'ytd') {
    const now = Math.floor(Date.now() / 1000);
    const jan1Sec = Math.floor(currentYearJan1() / 1000);
    queries.push(`period1=${jan1Sec}&period2=${now}&interval=1d&includePrePost=false`);
    queries.push(`range=1y&interval=1d&includePrePost=false`);
  }

  const bases = [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
  ];

  for (const query of queries) {
    // Race both Yahoo Finance mirror hosts for the same query; the first
    // successful response wins, halving latency when one host is slow.
    try {
      const result = await Promise.any(
        bases.map(async (base) => {
          const url = `${base}/v8/finance/chart/${ticker}?${query}`;
          const res = await fetch(url, { headers: HEADERS });
          if (!res.ok) throw new Error(`${res.status}`);
          const d = await res.json();
          const timestamps: number[] = d?.chart?.result?.[0]?.timestamp ?? [];
          const closes: (number | null)[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
          const pts: { t: number; p: number }[] = [];
          for (let i = 0; i < timestamps.length; i++) {
            const p = closes[i];
            if (p === null || p === undefined || isNaN(p)) continue;
            pts.push({ t: timestamps[i] * 1000, p });
          }
          if (pts.length > 1) return pts;
          throw new Error('insufficient data');
        })
      );
      return result;
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

  // For ytd range, clip all results to Jan 1 of the current year
  const ytdStart = safeRange === 'ytd' ? currentYearJan1() : null;

  const results = await Promise.all(
    assets.map(async (asset) => {
      const ticker = TICKER_MAP[asset];
      let data = await fetchYahooHistory(ticker, yfRange, yfInterval);
      if (ytdStart !== null && data.length > 0) {
        const idx = data.findIndex(d => d.t >= ytdStart);
        data = idx >= 0 ? data.slice(idx) : data;
      }
      return [asset, data] as [string, { t: number; p: number }[]];
    }),
  );

  return json(Object.fromEntries(results));
}
