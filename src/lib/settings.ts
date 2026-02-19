export interface Settings {
  dca: { startDate: string; dailyAmount: number; btcHeld: number; goalBtc: number };
  polymarket: { keywords: string[] };
  news: { sources: string[] };
}

export interface ManualSignals {
  mvrv: string;
  nupl: string;
  lthAccumulating: boolean;
  lthDays: string;
}

export const DEFAULT_SETTINGS: Settings = {
  dca: { startDate: new Date().toISOString().split('T')[0], dailyAmount: 10, btcHeld: 0, goalBtc: 1 },
  polymarket: { keywords: ['Bitcoin', 'Ukraine ceasefire', 'US Iran'] },
  news: { sources: ['https://feeds.bbci.co.uk/news/world/rss.xml', 'https://feeds.reuters.com/reuters/worldNews'] }
};

export const DEFAULT_MANUAL: ManualSignals = { mvrv: '', nupl: '', lthAccumulating: false, lthDays: '' };

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

export function loadManual(): ManualSignals {
  if (typeof window === 'undefined') return DEFAULT_MANUAL;
  try {
    const s = localStorage.getItem('sm_manual');
    if (s) return JSON.parse(s);
  } catch {}
  return DEFAULT_MANUAL;
}

export function saveManual(m: ManualSignals) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('sm_manual', JSON.stringify(m));
}

export function calcDCA(btcUsd: number, live: { fearGreed: number|null; difficultyChange: number|null; fundingRate: number|null; audUsd: number|null }, manual: ManualSignals) {
  const mvrv = manual.mvrv ? parseFloat(manual.mvrv) : null;
  const nupl = manual.nupl ? parseFloat(manual.nupl) : null;
  const lthDays = parseInt(manual.lthDays) || 0;
  const audUsd = live.audUsd ?? 1.58;

  let base = 0;
  if (btcUsd < 55000) base = 100;
  else if (btcUsd > 125000) base = 0;
  else if (btcUsd <= 110000) {
    base = mvrv !== null ? Math.max(0, Math.min(100, ((3.5 - mvrv) / 2.5) * 100)) : ((125000 - btcUsd) / 70000) * 100;
  } else {
    const ath = ((125000 - btcUsd) / 15000) * 100;
    const mv = mvrv !== null ? Math.max(0, Math.min(100, ((3.5 - mvrv) / 2.5) * 100)) : ath;
    base = Math.min(mv, ath);
  }
  base = Math.max(0, Math.min(100, base));

  const now = new Date();
  const halvingActive = now >= new Date('2026-05-01') && now < new Date('2027-05-01');
  const fg = live.fearGreed;
  const diff = live.difficultyChange;
  const funding = live.fundingRate;

  const signals = [
    { name: 'Extreme Fear',     active: fg !== null && fg <= 20,                 value: fg !== null ? `F&G ${fg}` : 'N/A',                          boost: 20 },
    { name: 'Fear',             active: fg !== null && fg > 20 && fg <= 40,       value: fg !== null ? `F&G ${fg}` : 'N/A',                          boost: 10 },
    { name: 'NUPL Negative',    active: nupl !== null && nupl < 0,                value: nupl !== null ? `${nupl.toFixed(2)}` : 'Enter manually',     boost: 15 },
    { name: 'LTH Accumulating', active: manual.lthAccumulating && lthDays >= 7,  value: manual.lthAccumulating ? `${lthDays}d` : 'Enter manually',   boost: 15 },
    { name: 'Mining Distress',  active: diff !== null && diff < -7,               value: diff !== null ? `${diff.toFixed(1)}%` : 'N/A',               boost: 20 },
    { name: 'Funding Negative', active: funding !== null && funding < -0.05,      value: funding !== null ? `${funding.toFixed(3)}%` : 'N/A',         boost: 15 },
    { name: 'Halving Window',   active: halvingActive,                            value: halvingActive ? 'Active' : 'May 2026',                       boost: 10 },
  ];

  const totalBoost = signals.filter(s => s.active).reduce((a, s) => a + s.boost, 0);
  const totalPct = Math.max(0, Math.min(100, base + totalBoost));
  const raw = (totalPct / 100) * 1000;
  const finalAud = Math.min(Math.round(raw / 50) * 50, 1000);

  return { base, signals, totalPct, finalAud, conviction: signals.filter(s => s.active).length, audUsd, btcAud: btcUsd * audUsd, usingFallback: !manual.mvrv };
}
