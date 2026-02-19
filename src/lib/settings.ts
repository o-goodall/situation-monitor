export interface Settings {
  dca: { startDate: string; dailyAmount: number; btcHeld: number; goalBtc: number };
  polymarket: { keywords: string[] };
  news: { sources: string[] };
  ghostfolio: { token: string; currency: string };
}

export const DEFAULT_SETTINGS: Settings = {
  dca: { startDate: new Date().toISOString().split('T')[0], dailyAmount: 10, btcHeld: 0, goalBtc: 1 },
  polymarket: { keywords: ['Bitcoin', 'Ukraine ceasefire', 'US Iran'] },
  news: { sources: ['https://feeds.bbci.co.uk/news/world/rss.xml', 'https://feeds.reuters.com/reuters/worldNews'] },
  ghostfolio: { token: '', currency: 'AUD' },
};

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const s = localStorage.getItem('sm_settings');
    if (s) return { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
  } catch {}
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: Settings) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('sm_settings', JSON.stringify(s));
}

export interface LiveSignals {
  fearGreed: number | null;
  difficultyChange: number | null;
  fundingRate: number | null;
  audUsd: number | null;
  mvrv: number | null;
  nupl: number | null;
  nvt: number | null;
}

export function calcDCA(btcUsd: number, live: LiveSignals) {
  const audUsd = live.audUsd ?? 1.58;
  const mvrv = live.mvrv;
  const nupl = live.nupl;
  const nvt = live.nvt;

  // Base % from price position + MVRV (auto now)
  let base = 0;
  let usingFallback = false;
  if (btcUsd < 55000) {
    base = 100;
  } else if (btcUsd > 125000) {
    base = 0;
  } else if (mvrv !== null) {
    // MVRV-driven base: 3.5 = overvalued (0%), 1.0 = undervalued (100%)
    base = Math.max(0, Math.min(100, ((3.5 - mvrv) / 2.5) * 100));
  } else {
    // Price-only fallback
    base = Math.max(0, Math.min(100, ((125000 - btcUsd) / 70000) * 100));
    usingFallback = true;
  }
  base = Math.max(0, Math.min(100, base));

  const now = new Date();
  const halvingActive = now >= new Date('2026-05-01') && now < new Date('2027-05-01');
  const fg = live.fearGreed;
  const diff = live.difficultyChange;
  const funding = live.fundingRate;

  // NVT: low NVT (<= 40) = undervalued/accumulation, network activity high relative to price
  // Historical: NVT < 40 = strong buy signal, 40-65 = neutral, > 65 = overvalued
  const nvtLow = nvt !== null && nvt <= 40;

  const signals = [
    {
      name: 'Extreme Fear',
      active: fg !== null && fg <= 20,
      value: fg !== null ? `F&G ${fg}` : 'Loading...',
      boost: 20,
      source: 'alternative.me'
    },
    {
      name: 'Fear',
      active: fg !== null && fg > 20 && fg <= 40,
      value: fg !== null ? `F&G ${fg}` : 'Loading...',
      boost: 10,
      source: 'alternative.me'
    },
    {
      name: 'NUPL Negative',
      active: nupl !== null && nupl < 0,
      value: nupl !== null ? nupl.toFixed(3) : 'Loading...',
      boost: 15,
      source: 'coinmetrics'
    },
    {
      name: 'NVT Low',
      active: nvtLow,
      value: nvt !== null ? `NVT ${nvt}` : 'Loading...',
      boost: 15,
      source: 'coinmetrics'
    },
    {
      name: 'Mining Distress',
      active: diff !== null && diff < -7,
      value: diff !== null ? `${diff.toFixed(1)}%` : 'Loading...',
      boost: 20,
      source: 'mempool.space'
    },
    {
      name: 'Funding Negative',
      active: funding !== null && funding < -0.05,
      value: funding !== null ? `${funding.toFixed(3)}%` : 'Loading...',
      boost: 15,
      source: 'binance'
    },
    {
      name: 'Halving Window',
      active: halvingActive,
      value: halvingActive ? 'Active' : 'May 2026',
      boost: 10,
      source: 'hardcoded'
    },
  ];

  const totalBoost = signals.filter(s => s.active).reduce((a, s) => a + s.boost, 0);
  const totalPct = Math.max(0, Math.min(100, base + totalBoost));
  const raw = (totalPct / 100) * 1000;
  const finalAud = Math.min(Math.round(raw / 50) * 50, 1000);

  return {
    base,
    signals,
    totalPct,
    finalAud,
    conviction: signals.filter(s => s.active).length,
    audUsd,
    btcAud: btcUsd * audUsd,
    usingFallback,
    mvrv
  };
}
