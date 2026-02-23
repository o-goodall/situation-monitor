import { json } from '@sveltejs/kit';

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
};

function computeMa200(closes: number[]): number | null {
  const valid = closes.filter((v) => !isNaN(v) && v > 0);
  if (valid.length < 14) return null;
  const window = valid.slice(-200);
  return parseFloat((window.reduce((sum, p) => sum + p, 0) / window.length).toFixed(2));
}

// Primary: Binance 200 weekly candles
async function getMa200Binance(): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=200',
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    type BinanceKline = [number, string, string, string, string, ...unknown[]];
    const closes: number[] = (data as BinanceKline[]).map((k) => parseFloat(k[4]));
    return computeMa200(closes);
  } catch {
    return null;
  }
}

// Fallback: Yahoo Finance 4-year weekly BTC-USD data
// Both mirror hosts are tried in parallel; the first successful result wins.
async function getMa200Yahoo(): Promise<number | null> {
  const urls = [
    'https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?range=4y&interval=1wk&includePrePost=false',
    'https://query2.finance.yahoo.com/v8/finance/chart/BTC-USD?range=4y&interval=1wk&includePrePost=false',
  ];
  try {
    return await Promise.any(
      urls.map(async (url) => {
        const res = await fetch(url, { headers: YF_HEADERS });
        if (!res.ok) throw new Error(`${res.status}`);
        const d = await res.json();
        const closes: number[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
        const ma200 = computeMa200(closes);
        if (ma200 === null) throw new Error('insufficient data');
        return ma200;
      })
    );
  } catch {
    return null;
  }
}

export async function GET() {
  // Fire both sources concurrently; use the first non-null result.
  const [binanceRes, yahooRes] = await Promise.allSettled([
    getMa200Binance(),
    getMa200Yahoo(),
  ]);
  const ma200 =
    (binanceRes.status === 'fulfilled' ? binanceRes.value : null) ??
    (yahooRes.status === 'fulfilled' ? yahooRes.value : null);
  if (ma200 === null) return json({ ma200: null, error: 'Unable to fetch MA200 data' });
  return json({ ma200 });
}
