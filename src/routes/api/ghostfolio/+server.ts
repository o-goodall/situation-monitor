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

  const [perfMaxRes, perfYtdRes, perf1dRes, holdingsRes] = await Promise.allSettled([
    fetch(`${GF_BASE}/api/v2/portfolio/performance?range=max`, { headers }),
    fetch(`${GF_BASE}/api/v2/portfolio/performance?range=ytd`, { headers }),
    fetch(`${GF_BASE}/api/v2/portfolio/performance?range=1d`, { headers }),
    fetch(`${GF_BASE}/api/v1/portfolio/holdings`, { headers }),
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
    // Convert 0-1 fraction to percentage if needed
    if (netGainPct !== null && Math.abs(netGainPct) < 1 && netGainPct !== 0) {
      netGainPct = netGainPct * 100;
    }
  }

  if (perfYtdRes.status === 'fulfilled' && perfYtdRes.value.ok) {
    const d = await perfYtdRes.value.json();
    const p = d?.performance ?? d;
    netGainYtdPct = p?.netPerformancePercentageWithCurrencyEffect ?? p?.netPerformancePercentage ?? null;
    if (netGainYtdPct !== null && Math.abs(netGainYtdPct) < 1 && netGainYtdPct !== 0) {
      netGainYtdPct = netGainYtdPct * 100;
    }
  }

  if (perf1dRes.status === 'fulfilled' && perf1dRes.value.ok) {
    const d = await perf1dRes.value.json();
    const p = d?.performance ?? d;
    todayChangePct = p?.netPerformancePercentageWithCurrencyEffect ?? p?.netPerformancePercentage ?? null;
    if (todayChangePct !== null && Math.abs(todayChangePct) < 1 && todayChangePct !== 0) {
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

  return json({ netWorth, totalInvested, netGain, netGainPct, netGainYtdPct, todayChangePct, holdings });
}
