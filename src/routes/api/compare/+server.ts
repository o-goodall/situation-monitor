import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

type PricePoint = { t: number; p: number };

const MS_PER_DAY = 86400000;

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
  '5y':  '1825',
};

// Yahoo Finance range/interval per range
const YF_PARAMS: Record<string, { range: string; interval: string }> = {
  '1d':  { range: '1d',  interval: '30m' },
  '7d':  { range: '5d',  interval: '60m' },
  '1y':  { range: '1y',  interval: '1d'  },
  '5y':  { range: '5y',  interval: '1wk' },
};

// ── Stooq.com fallback for S&P 500 and Gold history ──────────────────────────
// Stooq provides free CSV historical data without authentication.
const STOOQ_TICKER: Record<string, string> = {
  '%5EGSPC': '%5Espx',  // S&P 500
  'GC=F':    'xauusd',  // Gold (XAU/USD)
};
// Map Yahoo Finance range → { days to look back, Stooq interval }
const STOOQ_RANGE: Record<string, { days: number; interval: string }> = {
  '1d':  { days: 5,    interval: 'd' },
  '5d':  { days: 10,   interval: 'd' },
  '1y':  { days: 366,  interval: 'd' },
  '5y':  { days: 1830, interval: 'w' },
};

function stooqDateStr(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchStooqHistory(ticker: string, yfRange: string): Promise<PricePoint[]> {
  const stooqTicker = STOOQ_TICKER[ticker];
  if (!stooqTicker) return [];
  const { days, interval } = STOOQ_RANGE[yfRange] ?? STOOQ_RANGE['1y'];
  const now = new Date();
  const start = new Date(now.getTime() - days * MS_PER_DAY);
  const url = `https://stooq.com/q/d/l/?s=${stooqTicker}&d1=${stooqDateStr(start)}&d2=${stooqDateStr(now)}&i=${interval}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const text = await res.text();
    // CSV: Date,Open,High,Low,Close,Volume — skip header and any non-data rows.
    // Rows are filtered by leading 4-digit year (YYYY-MM-DD format from Stooq).
    const lines = text.trim().split('\n').filter((l: string) => /^\d{4}-\d{2}-\d{2}/.test(l));
    // Need at least 2 points: one as the normalisation base and one to compare against
    if (lines.length < 2) return [];
    const pts: PricePoint[] = [];
    for (const line of lines) {
      const cols = line.split(',');
      if (cols.length < 5) continue;
      const close = parseFloat(cols[4]);
      if (!close || isNaN(close)) continue;
      const t = new Date(cols[0]).getTime();
      if (isNaN(t)) continue;
      pts.push({ t, p: close });
    }
    // Require at least 2 valid points (normalisation base + 1 comparison point)
    return pts.length > 1 ? pts : [];
  } catch {
    return [];
  }
}

// ── Yahoo Finance crumb authentication ────────────────────────────────────────
// Yahoo Finance requires a session cookie + crumb token for API access.
// Crumbs are cached in-memory for up to 1 hour per function instance.
let _yfCrumb: string | null = null;
let _yfCookie: string | null = null;
let _yfCrumbTs = 0;
const YF_CRUMB_TTL = 60 * 60 * 1000; // 1 hour

async function ensureYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  const now = Date.now();
  if (_yfCrumb && _yfCookie && now - _yfCrumbTs < YF_CRUMB_TTL) {
    return { crumb: _yfCrumb, cookie: _yfCookie };
  }
  try {
    // Step 1: fetch Yahoo Finance home page to obtain session cookies
    const initRes = await fetch('https://finance.yahoo.com/', { headers: HEADERS });
    const rawCookies: string[] =
      (initRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (initRes.headers.get('set-cookie') ?? '').split(/,(?=[^ ])/).filter(Boolean);
    const cookie = rawCookies.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');

    // Step 2: use the session cookie to retrieve the crumb
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...HEADERS, Cookie: cookie },
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    // A valid crumb is a short alphanumeric token (≤20 chars); anything longer or starting with '<' is an error page
    if (!crumb || crumb.startsWith('<') || crumb.length > 64) return null;

    _yfCrumb = crumb;
    _yfCookie = cookie;
    _yfCrumbTs = now;
    return { crumb, cookie };
  } catch {
    return null;
  }
}

// Binance klines params per range — limit = candles needed to cover the period
const BINANCE_PARAMS: Record<string, { interval: string; limit: number }> = {
  '1d':  { interval: '30m', limit: 48  }, // 48 × 30 min = 24 h
  '7d':  { interval: '1h',  limit: 168 }, // 168 × 1 h  =  7 d
  '1y':  { interval: '1d',  limit: 365 }, // 365 × 1 d  =  1 y
  '5y':  { interval: '1w',  limit: 260 }, // 260 × 1 w  =  5 y
};

// Kraken OHLC interval in minutes per range
const KRAKEN_PARAMS: Record<string, { interval: number }> = {
  '1d':  { interval: 30    }, // 30 min candles
  '7d':  { interval: 60    }, // 60 min candles
  '1y':  { interval: 1440  }, // daily candles
  '5y':  { interval: 10080 }, // weekly candles — Kraken returns up to 720, covering ~13.8 y
};

async function fetchKrakenBtcHistory(range: string): Promise<PricePoint[]> {
  const { interval } = KRAKEN_PARAMS[range] ?? KRAKEN_PARAMS['1y'];
  try {
    const url = `https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${interval}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return fetchCoinbaseBtcHistory(range);
    const data = await res.json();
    if (data.error?.length) return fetchCoinbaseBtcHistory(range);
    const ohlc: unknown[] = data.result?.XXBTZUSD ?? [];
    if (!Array.isArray(ohlc)) return fetchCoinbaseBtcHistory(range);
    const pts: PricePoint[] = [];
    for (const candle of ohlc) {
      if (!Array.isArray(candle) || candle.length < 5) continue;
      if (typeof candle[0] !== 'number') continue;
      const t = candle[0] * 1000; // Unix seconds → ms
      const p = parseFloat(String(candle[4])); // close price (Kraken returns strings)
      if (isNaN(t) || isNaN(p)) continue;
      pts.push({ t, p });
    }
    return pts.length > 1 ? pts : fetchCoinbaseBtcHistory(range);
  } catch {
    return fetchCoinbaseBtcHistory(range);
  }
}

// Coinbase Exchange public klines API — no key required
const COINBASE_GRANULARITY: Record<string, number> = {
  '1d': 1800,  // 30-min candles: 48 per day (≤ 300 limit)
  '7d': 3600,  // 1-hour candles: 168 per 7d (≤ 300 limit)
};

async function fetchCoinbaseBtcHistory(range: string): Promise<PricePoint[]> {
  const granularity = COINBASE_GRANULARITY[range];
  if (!granularity) return fetchCoinDeskBtcHistory(range);
  const nowSec = Math.floor(Date.now() / 1000);
  const days = range === '1d' ? 1 : 7;
  const startSec = nowSec - days * 86400;
  const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${granularity}&start=${startSec}&end=${nowSec}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return fetchCoinDeskBtcHistory(range);
    const data = await res.json();
    if (!Array.isArray(data)) return fetchCoinDeskBtcHistory(range);
    // Coinbase returns [time, low, high, open, close, volume] in DESC order
    const pts: PricePoint[] = data
      .map((c: number[]) => ({ t: c[0] * 1000, p: c[4] }))
      .filter(pt => !isNaN(pt.t) && !isNaN(pt.p) && pt.p > 0)
      .sort((a, b) => a.t - b.t);
    return pts.length > 1 ? pts : fetchCoinDeskBtcHistory(range);
  } catch {
    return fetchCoinDeskBtcHistory(range);
  }
}

// CoinDesk BPI — free daily close prices, no key required
async function fetchCoinDeskBtcHistory(range: string): Promise<PricePoint[]> {
  // CoinDesk only provides daily data — not useful for intraday ranges
  if (range === '1d') return [];
  const now = new Date();
  const days = range === '5y' ? 1825 : range === '1y' ? 365 : 7;
  const start = new Date(now.getTime() - days * MS_PER_DAY);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  try {
    const url = `https://api.coindesk.com/v1/bpi/historical/close.json?start=${fmt(start)}&end=${fmt(now)}`;
    const res = await fetch(url, { headers: HEADERS });
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

async function fetchBinanceBtcHistory(range: string): Promise<PricePoint[]> {
  const { interval, limit } = BINANCE_PARAMS[range] ?? BINANCE_PARAMS['1y'];
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return fetchKrakenBtcHistory(range);
    const data = await res.json();
    if (!Array.isArray(data)) return fetchKrakenBtcHistory(range);
    const pts: PricePoint[] = [];
    for (const k of data) {
      const t = k[0] as number;
      const p = parseFloat(k[4] as string);
      if (isNaN(p) || isNaN(t)) continue;
      pts.push({ t, p });
    }
    return pts.length > 1 ? pts : fetchKrakenBtcHistory(range);
  } catch {
    return fetchKrakenBtcHistory(range);
  }
}

async function fetchBtcHistory(days: string, range: string): Promise<PricePoint[]> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`,
      { headers: HEADERS }
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const pts = (data.prices ?? []).map(([t, p]: [number, number]) => ({ t, p }));
    // Ensure the response actually covers at least 80% of the requested period.
    // CoinGecko's free tier may silently cap historical data (e.g. returning only
    // ~365 days when 1825 days are requested for the 5Y chart), which would cause
    // the comparison chart to show BTC for a much shorter window than S&P/Gold.
    const numDays = parseInt(days, 10);
    const minCoverageMs = numDays * 0.8 * MS_PER_DAY;
    if (pts.length > 1 && (Date.now() - pts[0].t) >= minCoverageMs) return pts;
    throw new Error('insufficient coverage');
  } catch {
    return fetchBinanceBtcHistory(range);
  }
}

async function fetchYahooHistory(ticker: string, yfRange: string, yfInterval: string): Promise<PricePoint[]> {
  const auth = await ensureYahooCrumb();
  const bases = [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
  ];
  const baseQuery = `range=${yfRange}&interval=${yfInterval}&includePrePost=false`;
  const query = auth ? `${baseQuery}&crumb=${encodeURIComponent(auth.crumb)}` : baseQuery;
  const cookieHdr = auth ? { Cookie: auth.cookie } : {};
  try {
    return await Promise.any(
      bases.map(async (base) => {
        const url = `${base}/v8/finance/chart/${ticker}?${query}`;
        const res = await fetch(url, { headers: { ...HEADERS, ...cookieHdr } });
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
    // Yahoo Finance failed — fall back to Stooq.com for supported tickers
    return fetchStooqHistory(ticker, yfRange);
  }
}

export async function GET({ url }: RequestEvent) {
  const range = url.searchParams.get('range') ?? '1y';
  const safeRange = BTC_DAYS[range] ? range : '1y';

  const btcDays = BTC_DAYS[safeRange];
  const { range: yfRange, interval: yfInterval } = YF_PARAMS[safeRange];

  const [btc, sp500, gold] = await Promise.all([
    fetchBtcHistory(btcDays, safeRange),
    fetchYahooHistory('%5EGSPC', yfRange, yfInterval),
    fetchYahooHistory('GC=F', yfRange, yfInterval),
  ]);

  return json({ btc, sp500, gold });
}
