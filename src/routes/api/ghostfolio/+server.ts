import { json } from '@sveltejs/kit';

const GF_BASE = 'https://ghostfol.io';

async function getBearerToken(securityToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${GF_BASE}/api/v1/auth/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: securityToken }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d?.authToken ?? null;
  } catch {
    return null;
  }
}

export async function GET({ url }) {
  const securityToken = url.searchParams.get('token');
  if (!securityToken) return json({ error: 'No token' }, { status: 400 });

  const bearer = await getBearerToken(securityToken);
  if (!bearer) return json({ error: 'Auth failed — check your security token' }, { status: 401 });

  const headers = { Authorization: `Bearer ${bearer}` };

  const [perfMaxRes, perfYtdRes, perf1dRes, holdingsRes, summaryRes, chartRes] = await Promise.allSettled([
    fetch(`${GF_BASE}/api/v2/portfolio/performance?range=max`, { headers }),
    fetch(`${GF_BASE}/api/v2/portfolio/performance?range=ytd`, { headers }),
    fetch(`${GF_BASE}/api/v2/portfolio/performance?range=1d`, { headers }),
    fetch(`${GF_BASE}/api/v1/portfolio/holdings`, { headers }),
    fetch(`${GF_BASE}/api/v1/portfolio/summary`, { headers }),
    fetch(`${GF_BASE}/api/v2/portfolio/chart?range=max`, { headers }),
  ]);

  let netWorth: number | null = null;
  let totalInvested: number | null = null;
  let netGain: number | null = null;
  let netGainPct: number | null = null;
  let netGainYtdPct: number | null = null;
  let todayChangePct: number | null = null;

  if (perfMaxRes.status === 'fulfilled' && perfMaxRes.value.ok) {
    const d = await perfMaxRes.value.json();
    const p = d?.performance ?? d;
    netWorth = p?.currentNetWorth ?? p?.currentValueInBaseCurrency ?? null;
    totalInvested = p?.totalInvestment ?? null;
    netGain = p?.netPerformanceWithCurrencyEffect ?? p?.netPerformance ?? null;
    netGainPct = p?.netPerformancePercentageWithCurrencyEffect ?? p?.netPerformancePercentage ?? null;
    // Ghostfolio always returns percentages as decimals (e.g. 2.532 = 253.2%)
    if (netGainPct !== null) {
      netGainPct = netGainPct * 100;
    }
  }

  if (perfYtdRes.status === 'fulfilled' && perfYtdRes.value.ok) {
    const d = await perfYtdRes.value.json();
    const p = d?.performance ?? d;
    netGainYtdPct = p?.netPerformancePercentageWithCurrencyEffect ?? p?.netPerformancePercentage ?? null;
    if (netGainYtdPct !== null) {
      netGainYtdPct = netGainYtdPct * 100;
    }
  }

  if (perf1dRes.status === 'fulfilled' && perf1dRes.value.ok) {
    const d = await perf1dRes.value.json();
    const p = d?.performance ?? d;
    todayChangePct = p?.netPerformancePercentageWithCurrencyEffect ?? p?.netPerformancePercentage ?? null;
    if (todayChangePct !== null) {
      todayChangePct = todayChangePct * 100;
    }
  }

  let holdings: {
    symbol: string; name: string; allocationInPercentage: number;
    valueInBaseCurrency: number; netPerformancePercentWithCurrencyEffect: number; assetClass: string;
  }[] = [];

  if (holdingsRes.status === 'fulfilled' && holdingsRes.value.ok) {
    const d = await holdingsRes.value.json();
    const raw = d?.holdings ?? d;
    if (raw && typeof raw === 'object') {
      holdings = Object.values(raw)
        .map((h: any) => ({
          symbol: h.symbol ?? '',
          name: h.name ?? h.symbol ?? '',
          allocationInPercentage: (h.allocationInPercentage ?? 0) * 100, // convert 0-1 to %
          valueInBaseCurrency: h.valueInBaseCurrency ?? 0,
          netPerformancePercentWithCurrencyEffect:
            (h.netPerformancePercentWithCurrencyEffect ?? h.netPerformancePercent ?? 0) * 100,
          assetClass: h.assetClass ?? '',
        }))
        .filter((h) => h.symbol && h.valueInBaseCurrency > 0)
        .sort((a, b) => b.valueInBaseCurrency - a.valueInBaseCurrency)
        .slice(0, 8);
    }
  }

  let dividendTotal: number | null = null;
  let dividendYtd: number | null = null;
  let cash: number | null = null;
  let annualizedPerformancePct: number | null = null;
  let firstOrderDate: string | null = null;
  let ordersCount: number | null = null;

  if (summaryRes.status === 'fulfilled' && summaryRes.value.ok) {
    const d = await summaryRes.value.json();
    dividendTotal = d?.dividend?.totalReceived?.withCurrencyEffect ?? d?.dividend?.totalReceived ?? null;
    dividendYtd   = d?.dividend?.currentYear?.withCurrencyEffect ?? d?.dividend?.currentYear ?? null;
    cash          = d?.cash ?? null;
    firstOrderDate = d?.firstOrderDate ?? null;
    ordersCount   = d?.ordersCount ?? null;
    annualizedPerformancePct = d?.annualizedPerformancePercentWithCurrencyEffect ?? d?.annualizedPerformancePercent ?? null;
    // Ghostfolio always returns percentages as decimals (e.g. 0.12 = 12%)
    if (annualizedPerformancePct !== null) {
      annualizedPerformancePct = annualizedPerformancePct * 100;
    }
  }

  let portfolioChart: { t: number; p: number }[] = [];
  if (chartRes.status === 'fulfilled' && chartRes.value.ok) {
    const d = await chartRes.value.json();
    interface ChartEntry { date?: string; netPerformanceInPercentageWithCurrencyEffect?: number; netPerformanceInPercentage?: number; }
    const entries: ChartEntry[] = d?.chart ?? [];
    portfolioChart = entries
      .map((e) => {
        const netPerformancePct = e.netPerformanceInPercentageWithCurrencyEffect ?? e.netPerformanceInPercentage ?? null;
        if (netPerformancePct === null || !e.date) return null;
        return { t: new Date(e.date).getTime(), p: netPerformancePct * 100 };
      })
      .filter((e): e is { t: number; p: number } => e !== null && !isNaN(e.t));
  }

  return json({ netWorth, totalInvested, netGain, netGainPct, netGainYtdPct, todayChangePct, holdings, dividendTotal, dividendYtd, cash, annualizedPerformancePct, firstOrderDate, ordersCount, portfolioChart });
}
