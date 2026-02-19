import { json } from '@sveltejs/kit';

// Fetch Yahoo Finance chart data — no API key required
async function yahooChart(symbol: string, range: string): Promise<{ current: number; yearStart: number; ytdPct: number; oneYearPct: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    const d = await res.json();
    const closes: number[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    if (!closes.length) return null;
    const current = closes[closes.length - 1];
    const yearStart = closes[0];
    if (!current || !yearStart) return null;
    const ytdPct = ((current - yearStart) / yearStart) * 100;

    // For 1Y change we need a 1y range specifically
    let oneYearPct = ytdPct;
    if (range === '1y') oneYearPct = ytdPct;

    return { current, yearStart, ytdPct, oneYearPct };
  } catch {
    return null;
  }
}

// World Bank CPI — free, no key
// Returns latest annual CPI % change for US
async function getCPI(): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.worldbank.org/v2/country/US/indicator/FP.CPI.TOTL.ZG?format=json&mrv=2&per_page=2'
    );
    if (!res.ok) return null;
    const d = await res.json();
    const values: number[] = (d?.[1] ?? [])
      .map((r: any) => r?.value)
      .filter((v: any) => v !== null && !isNaN(v));
    return values[0] ?? null; // Most recent available year
  } catch {
    return null;
  }
}

export async function GET() {
  const [spRes, goldRes, cpiRes] = await Promise.allSettled([
    yahooChart('%5EGSPC', '1y'),   // S&P 500
    yahooChart('GC%3DF', '1y'),    // Gold futures
    getCPI(),
  ]);

  const sp500 = spRes.status === 'fulfilled' ? spRes.value : null;
  const gold = goldRes.status === 'fulfilled' ? goldRes.value : null;
  const cpiAnnual = cpiRes.status === 'fulfilled' ? cpiRes.value : null;

  return json({
    sp500: sp500 ? {
      price: sp500.current,
      ytdPct: sp500.ytdPct,
      oneYearPct: sp500.oneYearPct,
    } : null,
    gold: gold ? {
      priceUsd: gold.current,        // USD per troy oz
      ytdPct: gold.ytdPct,
      oneYearPct: gold.oneYearPct,
    } : null,
    cpiAnnual,                        // Latest annual CPI % (e.g. 3.1 = 3.1% per year)
  });
}
