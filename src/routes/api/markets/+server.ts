import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// Yahoo Finance unofficial chart API — works server-side, no key needed.
// Returns current price, the price at the start of the range, and % change.
async function getYahooChart(
  ticker: string,
  sinceDate?: Date
): Promise<{ current: number; startPrice: number; pctChange: number } | null> {
  try {
    const encoded = encodeURIComponent(ticker);
    const queryStrings: string[] = [];

    if (sinceDate) {
      const period1 = Math.floor(sinceDate.getTime() / 1000);
      const period2 = Math.floor(Date.now() / 1000);
      // Prioritize range=ytd (most reliable for current-year queries), then date-range fallbacks
      queryStrings.push(`range=ytd&interval=1d&includePrePost=false`);
      queryStrings.push(`period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`);
      queryStrings.push(`period1=${period1}&period2=${period2}&interval=1wk&includePrePost=false`);
    } else {
      queryStrings.push('range=1y&interval=1mo&includePrePost=false');
      queryStrings.push('range=1y&interval=1wk&includePrePost=false');
    }

    for (const queryStr of queryStrings) {
      const urls = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?${queryStr}`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?${queryStr}`,
      ];
      for (const url of urls) {
        try {
          const res = await fetch(url, { headers: HEADERS });
          if (!res.ok) continue;
          const d = await res.json();
          const closes: number[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
          const valid = closes.filter((v: any) => v !== null && !isNaN(v));
          if (valid.length < 2) continue;
          const current = valid[valid.length - 1];
          const startPrice = valid[0];
          const pctChange = ((current - startPrice) / startPrice) * 100;
          return { current, startPrice, pctChange };
        } catch { continue; }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Gold in USD: primary source is Yahoo Finance GC=F (gold futures, USD-denominated).
// Falls back to freegoldapi.com (converted via audUsd rate if needed).
async function getGold(sinceDate?: Date): Promise<{ current: number; pctChange: number } | null> {
  // Primary: Yahoo Finance gold futures (GC=F) — quoted in USD per troy oz
  const yf = await getYahooChart('GC=F', sinceDate);
  if (yf && yf.current > 100) {
    return { current: yf.current, pctChange: yf.pctChange };
  }

  // Fallback: freegoldapi.com (may return AUD; convert if audUsd available)
  try {
    const res = await fetch('https://freegoldapi.com/data/latest.json', { headers: HEADERS });
    if (!res.ok) return null;
    const data: { date: string; price: number }[] = await res.json();
    if (!Array.isArray(data) || data.length < 2) return null;

    const latest = data[data.length - 1];
    const refDate = sinceDate ?? (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; })();
    const refEntry = data.reduce((closest, entry) => {
      const d = new Date(entry.date).getTime();
      const target = refDate.getTime();
      const prevD = new Date(closest.date).getTime();
      return Math.abs(d - target) < Math.abs(prevD - target) ? entry : closest;
    });

    if (!latest.price || !refEntry.price) return null;
    const pctChange = ((latest.price - refEntry.price) / refEntry.price) * 100;
    return { current: latest.price, pctChange };
  } catch {
    return null;
  }
}

// CoinGecko history: price of Bitcoin on a specific date (DD-MM-YYYY format).
async function getBtcPriceOnDate(date: Date): Promise<number | null> {
  try {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const formatted = `${dd}-${mm}-${yyyy}`;
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${formatted}&localization=false`,
      { headers: HEADERS }
    );
    if (!res.ok) return null;
    const d = await res.json();
    return d?.market_data?.current_price?.usd ?? null;
  } catch {
    return null;
  }
}

// BTC performance: use CoinGecko history for start price, current from simple/price.
async function getBtcPerformance(
  sinceDate?: Date
): Promise<{ currentPrice: number; pctChange: number } | null> {
  try {
    // Current price
    const curRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { headers: HEADERS }
    );
    const currentPrice: number = curRes.ok
      ? ((await curRes.json())?.bitcoin?.usd ?? 0)
      : 0;

    if (!currentPrice) return null;

    if (!sinceDate) {
      // Fall back to 1-year Yahoo Finance data
      const yf = await getYahooChart('BTC-USD');
      if (!yf) return { currentPrice, pctChange: 0 };
      return { currentPrice, pctChange: yf.pctChange };
    }

    const startPrice = await getBtcPriceOnDate(sinceDate);
    if (!startPrice) return { currentPrice, pctChange: 0 };
    const pctChange = ((currentPrice - startPrice) / startPrice) * 100;
    return { currentPrice, pctChange };
  } catch {
    return null;
  }
}

// World Bank CPI — free, no key, returns latest annual US CPI % change
async function getCPI(): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.worldbank.org/v2/country/US/indicator/FP.CPI.TOTL.ZG?format=json&mrv=2&per_page=2',
      { headers: HEADERS }
    );
    if (!res.ok) return null;
    const d = await res.json();
    const values: number[] = (d?.[1] ?? [])
      .map((r: any) => r?.value)
      .filter((v: any) => v !== null && !isNaN(v));
    return values[0] ?? null;
  } catch {
    return null;
  }
}

// S&P 500: primary via Yahoo chart, fallback to v7/finance/quote, then stooq.com CSV
async function getSP500(sinceDate?: Date): Promise<{ current: number; pctChange: number } | null> {
  // Primary: Yahoo Finance ^GSPC chart
  const chart = await getYahooChart('^GSPC', sinceDate);
  if (chart && chart.current > 100) return chart;

  // Fallback 1: v7 finance/quote for current price + chart for YTD % change
  const quoteUrls = [
    'https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EGSPC',
    'https://query2.finance.yahoo.com/v7/finance/quote?symbols=%5EGSPC',
  ];
  for (const quoteUrl of quoteUrls) {
    try {
      const res = await fetch(quoteUrl, { headers: HEADERS });
      if (!res.ok) continue;
      const d = await res.json();
      const q = d?.quoteResponse?.result?.[0];
      const current = q?.regularMarketPrice;
      if (!current || current < 100) continue;
      // ytdReturn is the preferred metric (true YTD return as a fraction, e.g. 0.05 = 5%).
      // regularMarketChangePercent is only today's % change — a rough estimate used as a
      // last resort when ytdReturn is unavailable (e.g. outside US market hours or
      // if the quote response omits ytdReturn entirely).
      const pctChange = typeof q?.ytdReturn === 'number'
        ? q.ytdReturn * 100
        : (q?.regularMarketChangePercent ?? 0);
      return { current, pctChange };
    } catch { continue; }
  }

  // Fallback 2: stooq.com CSV — free, no auth required
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const ref = sinceDate ?? oneYearAgo;
    const fmt = (d: Date) =>
      `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const url = `https://stooq.com/q/d/l/?s=%5Espx&d1=${fmt(ref)}&d2=${fmt(new Date())}&i=d`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const text = await res.text();
    // CSV: Date,Open,High,Low,Close,Volume — newest row last
    const lines = text.trim().split('\n').filter(l => /^\d{4}/.test(l));
    if (lines.length < 2) return null;
    const parseClose = (line: string) => {
      const cols = line.split(',');
      return cols.length >= 5 ? parseFloat(cols[4]) : NaN;
    };
    const current = parseClose(lines[lines.length - 1]);
    const startPrice = parseClose(lines[0]);
    if (isNaN(current) || isNaN(startPrice) || current < 100) return null;
    const pctChange = ((current - startPrice) / startPrice) * 100;
    return { current, pctChange };
  } catch { return null; }
}

export async function GET({ url }: RequestEvent) {
  // Optional ?since=YYYY-MM-DD for DCA-period performance comparison
  const sinceParam = url.searchParams.get('since');
  let sinceDate: Date | undefined;
  if (sinceParam) {
    const parsed = new Date(sinceParam);
    if (!isNaN(parsed.getTime())) sinceDate = parsed;
  }

  const [goldRes, spRes, cpiRes, btcRes] = await Promise.allSettled([
    getGold(sinceDate),
    getSP500(sinceDate),
    getCPI(),
    getBtcPerformance(sinceDate),
  ]);

  const gold      = goldRes.status === 'fulfilled' ? goldRes.value : null;
  const sp500     = spRes.status === 'fulfilled' ? spRes.value : null;
  const cpiAnnual = cpiRes.status === 'fulfilled' ? cpiRes.value : null;
  const btc       = btcRes.status === 'fulfilled' ? btcRes.value : null;

  return json({
    gold:  gold  ? { priceUsd: gold.current, ytdPct: gold.pctChange } : null,
    sp500: sp500 ? { price: sp500.current, ytdPct: sp500.pctChange } : null,
    btc:   btc   ? { ytdPct: btc.pctChange } : null,
    cpiAnnual,
    sinceDate: sinceDate ? sinceDate.toISOString().split('T')[0] : null,
  });
}
