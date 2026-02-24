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
  '5y':  '1825',
};

// Yahoo Finance range/interval per range
const YF_PARAMS: Record<string, { range: string; interval: string }> = {
  '1d':  { range: '1d',  interval: '30m' },
  '7d':  { range: '5d',  interval: '60m' },
  '1y':  { range: '1y',  interval: '1d'  },
  '5y':  { range: '5y',  interval: '1wk' },
};

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
    fetchYahooHistory('GC=F', yfRange, yfInterval),
  ]);

  return json({ btc, sp500, gold });
}
