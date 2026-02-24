import { json } from '@sveltejs/kit';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// Fallback static values — updated to latest available published data
// Median total income (ABS, FY2023): ~$67,600 pa; full-time average ~$100,028 (AWE Nov 2024)
// Median house price (PropTrack/CoreLogic, Dec 2024): ~$815,000 nationally
const FALLBACK = {
  medianIncome: 100028,
  incomePctChange: 4.2,
  medianHousePrice: 815000,
  housePctChange: 5.4,
  source: 'static',
};

/**
 * Fetch Average Weekly Earnings from ABS API.
 * Dataset: Average Weekly Total Earnings, Full-time adults, seasonally adjusted.
 * Returns annualised figure (weekly * 52).
 */
async function fetchAWE(): Promise<{ value: number; pctChange: number } | null> {
  try {
    // ABS AWE — Ordinary time earnings, Full-time adults, Total, Australia, seasonally adjusted
    const url =
      'https://api.data.abs.gov.au/data/ABS,AWE,1.0.0/1.2.3.TOTAL.FTOT.SEASONALLY_ADJUSTED.AUS?format=jsondata&detail=dataonly&lastNObservations=4';
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const d = await res.json();
    // SDMX-JSON: d.data.dataSets[0].series["0:0:0:0:0:0:0"].observations
    const dataSets: any[] = d?.data?.dataSets ?? [];
    if (!dataSets.length) return null;
    const seriesKeys = Object.keys(dataSets[0]?.series ?? {});
    if (!seriesKeys.length) return null;
    const obs: Record<string, number[]> = dataSets[0].series[seriesKeys[0]]?.observations ?? {};
    const periods = Object.keys(obs).map(Number).sort((a, b) => a - b);
    if (periods.length < 2) return null;
    const latest = obs[periods[periods.length - 1]]?.[0];
    const prev   = obs[periods[periods.length - 2]]?.[0];
    if (!latest || latest <= 0) return null;
    const pctChange = prev && prev > 0 ? ((latest - prev) / prev) * 100 : 0;
    // AWE is weekly; annualise
    return { value: Math.round(latest * 52), pctChange: parseFloat(pctChange.toFixed(1)) };
  } catch {
    return null;
  }
}

/**
 * Fetch Residential Property Price Index (8 capital cities combined) from ABS API.
 * Uses the index to compute approximate median price, anchored to a known base.
 * Base: 2023-Q3 index=151.2 at median $860,000 (8-city weighted average, PropTrack).
 */
async function fetchRPPI(): Promise<{ value: number; pctChange: number } | null> {
  try {
    const url =
      'https://api.data.abs.gov.au/data/ABS,RPPI,1.0.0/1.1.10001.Q?format=jsondata&detail=dataonly&lastNObservations=6';
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const d = await res.json();
    const dataSets: any[] = d?.data?.dataSets ?? [];
    if (!dataSets.length) return null;
    const seriesKeys = Object.keys(dataSets[0]?.series ?? {});
    if (!seriesKeys.length) return null;
    const obs: Record<string, number[]> = dataSets[0].series[seriesKeys[0]]?.observations ?? {};
    const periods = Object.keys(obs).map(Number).sort((a, b) => a - b);
    if (periods.length < 2) return null;
    const latest = obs[periods[periods.length - 1]]?.[0];
    const prevIdx = periods.length >= 5 ? periods[periods.length - 5] : periods[0]; // ~1 year ago
    const prev   = obs[prevIdx]?.[0];
    if (!latest || latest <= 0) return null;
    // Anchor: index 151.2 ≈ $860,000 median (Q3-2023 base)
    const BASE_INDEX = 151.2;
    const BASE_PRICE = 860000;
    const estimatedPrice = Math.round((latest / BASE_INDEX) * BASE_PRICE);
    const pctChange = prev && prev > 0 ? ((latest - prev) / prev) * 100 : 0;
    return { value: estimatedPrice, pctChange: parseFloat(pctChange.toFixed(1)) };
  } catch {
    return null;
  }
}

export async function GET() {
  const [awe, rppi] = await Promise.allSettled([fetchAWE(), fetchRPPI()]);

  const incomeData  = awe.status  === 'fulfilled' ? awe.value  : null;
  const houseData   = rppi.status === 'fulfilled' ? rppi.value : null;

  const medianIncome    = incomeData?.value       ?? FALLBACK.medianIncome;
  const incomePctChange = incomeData?.pctChange   ?? FALLBACK.incomePctChange;
  const medianHousePrice= houseData?.value        ?? FALLBACK.medianHousePrice;
  const housePctChange  = houseData?.pctChange    ?? FALLBACK.housePctChange;

  // Affordability ratio: house price / annual income
  const affordabilityRatio = medianIncome > 0
    ? parseFloat((medianHousePrice / medianIncome).toFixed(1))
    : null;

  return json({
    medianIncome,
    incomePctChange,
    medianHousePrice,
    housePctChange,
    affordabilityRatio,
    source: (incomeData || houseData) ? 'live' : 'static',
  });
}
