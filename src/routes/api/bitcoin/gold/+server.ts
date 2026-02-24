import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// Range → Yahoo Finance params
const RANGE_MAP: Record<string, { range: string; interval: string }> = {
  '6m':  { range: '6mo', interval: '1wk' },
  '1y':  { range: '1y',  interval: '1wk' },
  '5y':  { range: '5y',  interval: '1mo' },
  'max': { range: 'max', interval: '3mo' },
};

async function fetchYahooClose(ticker: string, range: string, interval: string): Promise<number[] | null> {
  const bases = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  const encoded = encodeURIComponent(ticker);
  for (const base of bases) {
    try {
      const url = `${base}/v8/finance/chart/${encoded}?range=${range}&interval=${interval}&includePrePost=false`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) continue;
      const d = await res.json();
      const closes: (number | null)[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
      const valid = closes.filter((v): v is number => v !== null && !isNaN(v));
      if (valid.length >= 2) return valid;
    } catch { continue; }
  }
  return null;
}

export async function GET({ url }: RequestEvent) {
  const rangeParam = url.searchParams.get('range') ?? '1y';
  const safeRange = RANGE_MAP[rangeParam] ? rangeParam : '1y';
  const { range, interval } = RANGE_MAP[safeRange];

  const [btcCloses, goldCloses] = await Promise.all([
    fetchYahooClose('BTC-USD', range, interval),
    fetchYahooClose('GC=F',   range, interval),
  ]);

  if (!btcCloses || !goldCloses || btcCloses.length < 2 || goldCloses.length < 2) {
    return json({ pctChange: null, startRatio: null, range: safeRange });
  }

  // Use the shorter series length to align start/end
  const len = Math.min(btcCloses.length, goldCloses.length);
  const startRatio = btcCloses[btcCloses.length - len] / goldCloses[goldCloses.length - len];
  const endRatio   = btcCloses[btcCloses.length - 1]   / goldCloses[goldCloses.length - 1];

  if (!startRatio || !endRatio || startRatio <= 0) {
    return json({ pctChange: null, startRatio: null, range: safeRange });
  }

  const pctChange = ((endRatio - startRatio) / startRatio) * 100;
  return json({ pctChange: parseFloat(pctChange.toFixed(2)), startRatio: parseFloat(startRatio.toFixed(2)), range: safeRange });
}
