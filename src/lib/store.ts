import { writable, derived } from 'svelte/store';
import { loadSettings, saveSettings, calcDCA, DEFAULT_SETTINGS, type Settings, type LiveSignals } from './settings';

// ── SETTINGS ─────────────────────────────────────────────────
export const settings = writable<Settings>(DEFAULT_SETTINGS);
export const showSettings = writable(false);
export const saved = writable(false);

// ── CLOCK ─────────────────────────────────────────────────────
export const time = writable('');

// ── BTC / NETWORK ─────────────────────────────────────────────
export const btcPrice      = writable(0);
export const prevPrice     = writable(0);
export const priceFlash    = writable('');
export const priceHistory  = writable<number[]>([]); // rolling 60-point 1-min history
export const lightMode     = writable(false);        // dark/light toggle
export const btcBlock      = writable(0);
export const btcFees       = writable({ low: 0, medium: 0, high: 0 });
export const halvingBlocksLeft = writable(0);
export const halvingDays   = writable(0);
export const halvingDate   = writable('');
export const halvingProgress = writable(0);

// ── LATEST BLOCK / MEMPOOL ────────────────────────────────────
export type LatestBlock = { height:number; timestamp:number; size:number; txCount:number; miner:string; weight:number; medianFee:number|null; totalFees:number|null; reward:number|null };
export const latestBlock = writable<LatestBlock|null>(null);
export type MempoolStats = { count:number; vsize:number; totalFee:number };
export const mempoolStats = writable<MempoolStats|null>(null);

// ── DCA SIGNALS ───────────────────────────────────────────────
export const fearGreed      = writable<number|null>(null);
export const fearGreedLabel = writable('');
export const difficultyChange = writable<number|null>(null);
export const fundingRate    = writable<number|null>(null);
export const audUsd         = writable<number|null>(null);
export const dcaUpdated     = writable('');

// ── MARKETS / NEWS ────────────────────────────────────────────
export type Market = { id:string; question:string; topOutcome:string; probability:number; volume:number; volume24hr:number; endDate:string; tag:string; url:string; pinned:boolean };
export const markets = writable<Market[]>([]);
export type NewsItem = { title:string; link:string; source:string; pubDate:string; description:string };
export const newsItems = writable<NewsItem[]>([]);

// ── ASSET MARKETS ─────────────────────────────────────────────
export const goldPriceUsd  = writable<number|null>(null);
export const goldYtdPct    = writable<number|null>(null);
export const sp500Price    = writable<number|null>(null);
export const sp500YtdPct   = writable<number|null>(null);
export const cpiAnnual     = writable<number|null>(null);

// ── GHOSTFOLIO ────────────────────────────────────────────────
export type Holding = { symbol:string; name:string; allocationInPercentage:number; valueInBaseCurrency:number; netPerformancePercentWithCurrencyEffect:number; assetClass:string };
export const gfNetWorth       = writable<number|null>(null);
export const gfTotalInvested  = writable<number|null>(null);
export const gfNetGainPct     = writable<number|null>(null);
export const gfNetGainYtdPct  = writable<number|null>(null);
export const gfTodayChangePct = writable<number|null>(null);
export const gfHoldings       = writable<Holding[]>([]);
export const gfError          = writable('');
export const gfLoading        = writable(false);
export const gfUpdated        = writable('');

// ── DERIVED ───────────────────────────────────────────────────
export const liveSignals = derived(
  [fearGreed, difficultyChange, fundingRate, audUsd],
  ([$fg, $dc, $fr, $au]) => ({ fearGreed: $fg, difficultyChange: $dc, fundingRate: $fr, audUsd: $au }) as LiveSignals
);

export const dca = derived([btcPrice, liveSignals], ([$p, $s]) =>
  $p > 0 ? calcDCA($p, $s) : null
);

export const accentColor = derived(dca, ($d) =>
  !$d ? '#3f3f46' : $d.finalAud === 0 ? '#f43f5e' : $d.finalAud >= 750 ? '#22c55e' : $d.finalAud >= 400 ? '#f7931a' : '#38bdf8'
);

export const priceColor = derived(priceFlash, ($f) =>
  $f === 'up' ? '#22c55e' : $f === 'down' ? '#f43f5e' : '#e2e2e8'
);

export const btcAud = derived([btcPrice, audUsd], ([$p, $a]) =>
  $p > 0 && $a !== null ? $p * $a : null
);

export const satsPerAud = derived(btcAud, ($ba) =>
  $ba !== null && $ba > 0 ? Math.round(1e8 / $ba) : null
);

// ── SAVE HELPER ───────────────────────────────────────────────
export function persistSettings(s: Settings) {
  saveSettings(s);
  saved.set(true);
  setTimeout(() => saved.set(false), 2000);
}
