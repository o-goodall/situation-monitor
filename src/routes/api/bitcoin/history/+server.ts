import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const MS_PER_DAY = 86400000;

type PricePoint = { t: number; p: number };

// Binance klines params — must keep candle count ≤ 1000
const BINANCE_HISTORY_PARAMS: Record<string, { interval: string; limit: number }> = {
  '1d':  { interval: '30m', limit: 48  },
  '7d':  { interval: '1h',  limit: 168 },
  '30d': { interval: '4h',  limit: 180 },
  'ytd': { interval: '1d',  limit: 366 },
  '1y':  { interval: '1d',  limit: 365 },
  '5y':  { interval: '1w',  limit: 260 },
  'max': { interval: '1w',  limit: 1000 },
};

// Kraken OHLC interval in minutes per range
const KRAKEN_HISTORY_PARAMS: Record<string, { interval: number }> = {
  '1d':  { interval: 30    },
  '7d':  { interval: 60    },
  '30d': { interval: 240   },
  'ytd': { interval: 1440  },
  '1y':  { interval: 1440  },
  '5y':  { interval: 10080 },
  'max': { interval: 10080 },
};

async function fetchKrakenHistory(range: string): Promise<PricePoint[]> {
  const { interval } = KRAKEN_HISTORY_PARAMS[range] ?? KRAKEN_HISTORY_PARAMS['1y'];
  try {
    const res = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${interval}`, { headers: HEADERS });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.error?.length) return [];
    const ohlc: unknown[] = data.result?.XXBTZUSD ?? [];
    if (!Array.isArray(ohlc)) return [];
    const pts: PricePoint[] = [];
    for (const candle of ohlc) {
      if (!Array.isArray(candle) || candle.length < 5 || typeof candle[0] !== 'number') continue;
      const t = candle[0] * 1000;
      const p = parseFloat(String(candle[4]));
      if (isNaN(t) || isNaN(p)) continue;
      pts.push({ t, p });
    }
    return pts.length > 1 ? pts : [];
  } catch {
    return [];
  }
}

async function fetchBinanceHistory(range: string): Promise<PricePoint[]> {
  const params = BINANCE_HISTORY_PARAMS[range];
  if (!params) return fetchKrakenHistory(range);
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${params.interval}&limit=${params.limit}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return fetchKrakenHistory(range);
    const data = await res.json();
    if (!Array.isArray(data)) return fetchKrakenHistory(range);
    const pts: PricePoint[] = data
      .map((k: [number, string, string, string, string]) => ({ t: k[0], p: parseFloat(k[4]) }))
      .filter(pt => !isNaN(pt.p) && !isNaN(pt.t));
    return pts.length > 1 ? pts : fetchKrakenHistory(range);
  } catch {
    return fetchKrakenHistory(range);
  }
}

// CoinDesk BPI daily close prices — free, no key
async function fetchCoinDeskHistory(range: string): Promise<PricePoint[]> {
  if (range === '1d') return [];
  const daysMap: Record<string, number> = { '7d': 7, '30d': 30, 'ytd': 366, '1y': 365, '5y': 1825, 'max': 5000 };
  const days = daysMap[range] ?? 365;
  const now = new Date();
  const start = new Date(now.getTime() - days * MS_PER_DAY);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  try {
    const res = await fetch(
      `https://api.coindesk.com/v1/bpi/historical/close.json?start=${fmt(start)}&end=${fmt(now)}`,
      { headers: HEADERS }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const bpi = data.bpi ?? {};
    const pts: PricePoint[] = Object.entries(bpi)
      .map(([date, p]) => ({ t: new Date(date).getTime(), p: p as number }))
      .filter(pt => !isNaN(pt.t) && pt.p > 0)
      .sort((a, b) => a.t - b.t);
    return pts.length > 1 ? pts : [];
  } catch {
    return [];
  }
}

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

  // For 5y range, clip data to the last 5 years from today so fallback sources
  // that return more history (e.g. Kraken returning 13+ years of weekly candles)
  // don't skew the chart.
  const fiveYearCutoff = safeRange === '5y' ? Date.now() - 5 * 365 * MS_PER_DAY : null;

  const clipToRange = (pts: PricePoint[]): PricePoint[] => {
    if (safeRange === 'ytd') {
      const idx = pts.findIndex(pt => pt.t >= ytdJan1);
      return idx >= 0 ? pts.slice(idx) : pts;
    }
    if (fiveYearCutoff !== null) {
      const idx = pts.findIndex(pt => pt.t >= fiveYearCutoff);
      return idx >= 0 ? pts.slice(idx) : pts;
    }
    return pts;
  };

  // CoinGecko primary — falls back through Binance → Kraken → CoinDesk
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`,
      { headers: HEADERS }
    );
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    let prices: PricePoint[] = (data.prices ?? []).map(([t, p]: [number, number]) => ({ t, p }));
    if (prices.length < 2) throw new Error('insufficient data');

    prices = clipToRange(prices);

    return json({ prices });
  } catch { /* fall through to Binance */ }

  // Binance → Kraken → CoinDesk fallback chain
  let prices = clipToRange(await fetchBinanceHistory(safeRange));

  // If still no data, try CoinDesk BPI
  if (prices.length < 2) {
    prices = clipToRange(await fetchCoinDeskHistory(safeRange));
  }

  return json({ prices });
}
