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
}

export function calcDCA(btcUsd: number, live: LiveSignals) {
  const audUsd = live.audUsd ?? 1.58;

  // Price-based taper: 100% allocation at $55k, 0% at $125k, linear
  // This is the primary driver — clean, fast, no external API dependency
  const base = Math.max(0, Math.min(100, ((125000 - btcUsd) / 70000) * 100));

  const fg = live.fearGreed;
  const diff = live.difficultyChange;
  const funding = live.fundingRate;
  const now = new Date();
  const halvingActive = now >= new Date('2026-05-01') && now < new Date('2027-05-01');

  // Only use the 3 fast/reliable signals — no CoinMetrics dependency
  const signals = [
    {
      name: 'Extreme Fear',
      active: fg !== null && fg <= 20,
      value: fg !== null ? `F&G ${fg}` : '--',
      boost: 20,
      source: 'alternative.me',
    },
    {
      name: 'Fear Zone',
      active: fg !== null && fg > 20 && fg <= 40,
      value: fg !== null ? `F&G ${fg}` : '--',
      boost: 10,
      source: 'alternative.me',
    },
    {
      name: 'Mining Distress',
      active: diff !== null && diff < -7,
      value: diff !== null ? `${diff.toFixed(1)}%` : '--',
      boost: 15,
      source: 'mempool.space',
    },
    {
      name: 'Funding Negative',
      active: funding !== null && funding < -0.05,
      value: funding !== null ? `${funding.toFixed(3)}%` : '--',
      boost: 10,
      source: 'binance',
    },
    {
      name: 'Halving Window',
      active: halvingActive,
      value: halvingActive ? 'Active' : 'Post-April 2026',
      boost: 10,
      source: 'schedule',
    },
  ];

  const totalBoost = signals.filter(s => s.active).reduce((a, s) => a + s.boost, 0);
  const totalPct = Math.max(0, Math.min(100, base + totalBoost));
  const raw = (totalPct / 100) * 1000;
  const finalAud = Math.round(raw / 50) * 50;

  return {
    base,
    signals,
    totalPct,
    finalAud,
    conviction: signals.filter(s => s.active).length,
    audUsd,
    btcAud: btcUsd * audUsd,
    usingFallback: false,
    mvrv: null,
  };
}
