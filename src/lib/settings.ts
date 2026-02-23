export interface RssFeed {
  url: string;
  name: string;
  enabled: boolean;
}

export type DcaFrequency = 'daily' | 'weekly' | 'fortnightly' | 'monthly';

export interface Settings {
  dca: {
    startDate: string;
    dailyAmount: number;
    btcHeld: number;
    goalBtc: number;
    lowPrice: number;
    highPrice: number;
    maxDcaAud: number;
    dcaFrequency: DcaFrequency;
  };
  polymarket: { keywords: string[] };
  news: {
    defaultFeeds: RssFeed[];   // Pre-selected feeds (toggleable)
    customFeeds: RssFeed[];    // User-added feeds (toggleable)
  };
  ghostfolio: { token: string; currency: string };
  displayCurrency: string;   // User's preferred display currency (e.g. AUD, EUR, GBP)
}

// Default Bitcoin/crypto RSS feeds
export const DEFAULT_RSS_FEEDS: RssFeed[] = [
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',       name: 'CoinDesk',          enabled: true },
  { url: 'https://bitcoinmagazine.com/.rss/full/',                name: 'Bitcoin Magazine',   enabled: true },
  { url: 'https://cointelegraph.com/rss',                         name: 'CoinTelegraph',     enabled: true },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',        name: 'BBC Business',      enabled: true },
  { url: 'https://feeds.reuters.com/reuters/businessNews',         name: 'Reuters Business',  enabled: false },
  { url: 'https://www.theblock.co/rss.xml',                       name: 'The Block',         enabled: false },
  { url: 'https://decrypt.co/feed',                                name: 'Decrypt',           enabled: false },
  { url: 'https://www.btctimes.com/rss',                           name: 'BTC Times',         enabled: false },
];

export const DEFAULT_SETTINGS: Settings = {
  dca: { startDate: new Date().toISOString().split('T')[0], dailyAmount: 10, btcHeld: 0, goalBtc: 1, lowPrice: 55000, highPrice: 125000, maxDcaAud: 1000, dcaFrequency: 'fortnightly' },
  polymarket: { keywords: ['Bitcoin', 'Ukraine ceasefire', 'US Iran'] },
  news: {
    defaultFeeds: DEFAULT_RSS_FEEDS.map(f => ({...f})),
    customFeeds: [],
  },
  ghostfolio: { token: '', currency: 'AUD' },
  displayCurrency: 'AUD',
};

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const s = localStorage.getItem('sm_settings');
    if (s) {
      const parsed = JSON.parse(s);
      // Migrate old format: if news.sources exists (old string array), convert
      if (parsed.news?.sources && !parsed.news?.defaultFeeds) {
        const customUrls: string[] = parsed.news.sources;
        parsed.news = {
          defaultFeeds: DEFAULT_RSS_FEEDS.map(f => ({...f})),
          customFeeds: customUrls.map((url: string) => ({
            url,
            name: new URL(url).hostname.replace('www.','').replace('feeds.',''),
            enabled: true,
          })),
        };
      }
      // Ensure all default feeds exist (merge new defaults)
      if (parsed.news?.defaultFeeds) {
        const existingUrls = new Set(parsed.news.defaultFeeds.map((f: RssFeed) => f.url));
        for (const df of DEFAULT_RSS_FEEDS) {
          if (!existingUrls.has(df.url)) {
            parsed.news.defaultFeeds.push({...df});
          }
        }
      }
      return { ...DEFAULT_SETTINGS, ...parsed, dca: { ...DEFAULT_SETTINGS.dca, ...parsed.dca, dcaFrequency: parsed.dca?.dcaFrequency ?? 'fortnightly' }, displayCurrency: parsed.displayCurrency ?? DEFAULT_SETTINGS.displayCurrency };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: Settings) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('sm_settings', JSON.stringify(s));
}

// Get all enabled feed URLs
export function getEnabledFeedUrls(news: Settings['news']): string[] {
  const enabled: string[] = [];
  for (const f of news.defaultFeeds) {
    if (f.enabled) enabled.push(f.url);
  }
  for (const f of news.customFeeds) {
    if (f.enabled) enabled.push(f.url);
  }
  return enabled;
}

export interface LiveSignals {
  fearGreed: number | null;
  difficultyChange: number | null;
  fundingRate: number | null;
  audUsd: number | null;
  halvingDaysLeft: number | null;
}

export function calcDCA(
  btcUsd: number,
  live: LiveSignals,
  lowPrice = 55000,
  highPrice = 125000,
  maxDcaAud = 1000,
  halvingDate = ''
) {
  const usingFallback = live.audUsd === null;
  const audUsd = live.audUsd ?? 1.58;

  // Price-based taper: 100% allocation at lowPrice, 0% at highPrice, linear
  const range = highPrice - lowPrice;
  const base = Math.max(0, Math.min(100, ((highPrice - btcUsd) / range) * 100));

  const fg = live.fearGreed;
  const diff = live.difficultyChange;
  const funding = live.fundingRate;

  // Active if halving is within the next 365 days (halvingDaysLeft is null when not yet loaded)
  const halvingActive = live.halvingDaysLeft !== null && live.halvingDaysLeft <= 365;

  const signals = [
    {
      name: 'Fear Signal',
      description: fg === null
        ? 'Fear & Greed index — market sentiment below 40'
        : fg <= 20
          ? 'Fear & Greed index ≤ 20 — market in extreme fear'
          : fg <= 40
            ? 'Fear & Greed index 21–40 — market in fear'
            : 'Fear & Greed index > 40 — market not in fear',
      active: fg !== null && fg <= 40,
      value: fg !== null ? `F&G: ${fg}${fg <= 20 ? ' (Extreme)' : ''}` : '--',
      boost: fg !== null && fg <= 20 ? 20 : 10,
      source: 'alternative.me',
    },
    {
      name: 'Mining Distress',
      description: 'Hash rate difficulty dropped >5% — miners under pressure',
      active: diff !== null && diff < -5, // threshold lowered from -7 for earlier signal
      value: diff !== null ? `Δ ${diff.toFixed(1)}%` : '--',
      boost: 10,
      source: 'mempool.space',
    },
    // Funding rate signal: only include when data is available
    ...(funding !== null ? [{
      name: 'Funding Negative',
      description: 'Futures funding rate negative — shorts paying longs',
      active: funding < -0.05,
      value: `${funding.toFixed(3)}%`,
      boost: 10,
      source: 'binance/bybit',
    }] : []),
    {
      name: 'Halving Window',
      description: 'Within 365 days of the next Bitcoin halving event',
      active: halvingActive,
      value: halvingActive
        ? (halvingDate || 'Active')
        : live.halvingDaysLeft !== null && live.halvingDaysLeft > 365
          ? `${(live.halvingDaysLeft - 365).toLocaleString()} days`
          : 'Inactive',
      boost: 10,
      source: 'schedule',
    },
  ];

  const totalBoost = signals.filter(s => s.active).reduce((a, s) => a + s.boost, 0);
  const boostMultiplier = 1 + (totalBoost / 100);
  const totalPct = Math.max(0, Math.min(100, base * boostMultiplier));
  const raw = (totalPct / 100) * maxDcaAud;
  const finalAud = Math.round(raw / 50) * 50;

  return {
    base,
    signals,
    totalPct,
    finalAud,
    conviction: signals.filter(s => s.active).length,
    audUsd,
    btcAud: btcUsd * audUsd,
    usingFallback,
    mvrv: null,
  };
}
