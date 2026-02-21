import { json } from '@sveltejs/kit';

// Common currencies to include in the rates response
const COMMON_CURRENCIES = ['AUD','EUR','GBP','CAD','JPY','CHF','NZD','SGD','HKD','INR'];

export async function GET() {
  try {
    const [fngRes, diffRes, fundingRes, fxRes] = await Promise.allSettled([
      fetch('https://api.alternative.me/fng/?limit=1'),
      fetch('https://mempool.space/api/v1/difficulty-adjustment'),
      fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),
      fetch('https://open.er-api.com/v6/latest/USD'),
    ]);

    let fearGreed: number | null = null, fearGreedLabel = '';
    if (fngRes.status === 'fulfilled' && fngRes.value.ok) {
      const d = await fngRes.value.json();
      fearGreed = parseInt(d?.data?.[0]?.value ?? '');
      fearGreedLabel = d?.data?.[0]?.value_classification ?? '';
    }

    let difficultyChange: number | null = null;
    if (diffRes.status === 'fulfilled' && diffRes.value.ok) {
      const d = await diffRes.value.json();
      difficultyChange = d?.difficultyChange ?? d?.estimatedRetarget ?? null;
    }

    let fundingRate: number | null = null;
    if (fundingRes.status === 'fulfilled' && fundingRes.value.ok) {
      const d = await fundingRes.value.json();
      const raw = parseFloat(d?.lastFundingRate ?? '');
      if (!isNaN(raw)) fundingRate = parseFloat((raw * 100).toFixed(4));
    }

    let audUsd: number | null = null;
    let fxRates: Record<string, number> = {};
    if (fxRes.status === 'fulfilled' && fxRes.value.ok) {
      const d = await fxRes.value.json();
      audUsd = d?.rates?.AUD ?? null;
      // Include a subset of common currency rates
      for (const cur of COMMON_CURRENCIES) {
        if (d?.rates?.[cur] != null) fxRates[cur] = d.rates[cur];
      }
    }

    return json({ fearGreed, fearGreedLabel, difficultyChange, fundingRate, audUsd, fxRates, errors: [
      ...(fngRes.status !== 'fulfilled' || !fngRes.value.ok ? ['Fear & Greed'] : []),
      ...(diffRes.status !== 'fulfilled' || !diffRes.value.ok ? ['Difficulty'] : []),
      ...(fundingRes.status !== 'fulfilled' || !fundingRes.value.ok ? ['Funding Rate'] : []),
      ...(fxRes.status !== 'fulfilled' || !fxRes.value.ok ? ['AUD/USD FX'] : []),
    ] });
  } catch {
    return json({ fearGreed: null, fearGreedLabel: '', difficultyChange: null, fundingRate: null, audUsd: null, fxRates: {}, errors: ['Internal error'] });
  }
}
