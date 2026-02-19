import { json } from '@sveltejs/kit';

export async function GET() {
  try {
    // Fetch yesterday's date for CoinMetrics (daily data, always 1 day behind)
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const cmUrl = `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur,CapMrktCurUSD,CapRealUSD,NVTAdj&frequency=1d&limit_per_asset=1&page_size=1&end_time=${yesterday}`;

    const [fngRes, diffRes, fundingRes, fxRes, cmRes] = await Promise.allSettled([
      fetch('https://api.alternative.me/fng/?limit=1'),
      fetch('https://mempool.space/api/v1/difficulty-adjustment'),
      fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),
      fetch('https://open.er-api.com/v6/latest/USD'),
      fetch(cmUrl),
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
      difficultyChange = d?.difficultyChange ?? d?.estimatedDiffChange ?? null;
    }

    let fundingRate: number | null = null;
    if (fundingRes.status === 'fulfilled' && fundingRes.value.ok) {
      const d = await fundingRes.value.json();
      const raw = parseFloat(d?.lastFundingRate ?? '');
      if (!isNaN(raw)) fundingRate = parseFloat((raw * 100).toFixed(4));
    }

    let audUsd: number | null = null;
    if (fxRes.status === 'fulfilled' && fxRes.value.ok) {
      const d = await fxRes.value.json();
      audUsd = d?.rates?.AUD ?? null;
    }

    // CoinMetrics: MVRV, NUPL (derived), NVT
    let mvrv: number | null = null;
    let nupl: number | null = null;
    let nvt: number | null = null;
    let cmDate: string = '';
    if (cmRes.status === 'fulfilled' && cmRes.value.ok) {
      const d = await cmRes.value.json();
      const row = d?.data?.[0];
      if (row) {
        const mvrvRaw = parseFloat(row.CapMVRVCur);
        const mrktCap = parseFloat(row.CapMrktCurUSD);
        const realCap = parseFloat(row.CapRealUSD);
        const nvtRaw = parseFloat(row.NVTAdj);
        if (!isNaN(mvrvRaw)) mvrv = parseFloat(mvrvRaw.toFixed(3));
        if (!isNaN(mrktCap) && !isNaN(realCap) && mrktCap > 0) {
          nupl = parseFloat(((mrktCap - realCap) / mrktCap).toFixed(4));
        }
        if (!isNaN(nvtRaw)) nvt = parseFloat(nvtRaw.toFixed(1));
        cmDate = row.time?.split('T')[0] ?? '';
      }
    }

    return json({ fearGreed, fearGreedLabel, difficultyChange, fundingRate, audUsd, mvrv, nupl, nvt, cmDate });
  } catch (e) {
    return json({ fearGreed: null, fearGreedLabel: '', difficultyChange: null, fundingRate: null, audUsd: null, mvrv: null, nupl: null, nvt: null, cmDate: '' });
  }
}
