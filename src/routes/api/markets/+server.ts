import { json } from '@sveltejs/kit';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// freegoldapi.com — completely free, no API key, CORS-enabled
// Returns array of {date, price} objects sorted oldest→newest
async function getGold(): Promise<{ current: number; yearAgo: number; ytdPct: number } | null> {
  try {
    const res = await fetch('https://freegoldapi.com/data/latest.json', { headers: HEADERS });
    if (!res.ok) return null;
    const data: { date: string; price: number }[] = await res.json();
    if (!Array.isArray(data) || data.length < 2) return null;

    const latest = data[data.length - 1];
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // Find the record closest to 1 year ago
    const yearAgoEntry = data.reduce((closest, entry) => {
      const d = new Date(entry.date).getTime();
      const target = oneYearAgo.getTime();
      const prevD = new Date(closest.date).getTime();
      return Math.abs(d - target) < Math.abs(prevD - target) ? entry : closest;
    });

    if (!latest.price || !yearAgoEntry.price) return null;
    const ytdPct = ((latest.price - yearAgoEntry.price) / yearAgoEntry.price) * 100;
    return { current: latest.price, yearAgo: yearAgoEntry.price, ytdPct };
  } catch {
    return null;
  }
}

// Yahoo Finance unofficial chart API — works server-side, no key needed
async function getYahooChart(ticker: string): Promise<{ current: number; yearAgo: number; ytdPct: number } | null> {
  try {
    const encoded = encodeURIComponent(ticker);
    // Try query1 first, fall back to query2
    const urls = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1mo&includePrePost=false`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1mo&includePrePost=false`,
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
        const yearAgo = valid[0];
        const ytdPct = ((current - yearAgo) / yearAgo) * 100;
        return { current, yearAgo, ytdPct };
      } catch { continue; }
    }
    return null;
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

export async function GET() {
  const [goldRes, spRes, cpiRes] = await Promise.allSettled([
    getGold(),
    getYahooChart('^GSPC'),
    getCPI(),
  ]);

  const gold    = goldRes.status === 'fulfilled' ? goldRes.value : null;
  const sp500   = spRes.status === 'fulfilled' ? spRes.value : null;
  const cpiAnnual = cpiRes.status === 'fulfilled' ? cpiRes.value : null;

  return json({
    gold:  gold  ? { priceUsd: gold.current, ytdPct: gold.ytdPct } : null,
    sp500: sp500 ? { price: sp500.current, ytdPct: sp500.ytdPct } : null,
    cpiAnnual,
  });
}
