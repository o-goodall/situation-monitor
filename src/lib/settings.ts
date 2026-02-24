export type FeedCategory = 'global' | 'business' | 'tech' | 'security' | 'crypto';

export type ThreatLevel = 'critical' | 'high' | 'elevated' | 'low' | 'info';

export interface Threat {
  id: string;
  name: string;
  lat: number;
  lon: number;
  level: ThreatLevel;
  desc: string;
  /** ISO 3166-1 numeric country ID for conflict shading on the map (optional) */
  countryId?: string;
}

export interface RssFeed {
  url: string;
  name: string;
  enabled: boolean;
  category: FeedCategory;
}

export type DcaFrequency = 'daily' | 'weekly' | 'fortnightly' | 'monthly';

// ── DEFAULT GLOBAL THREAT HOTSPOTS ───────────────────────────
export const DEFAULT_THREATS: Threat[] = [
  // ── Active Conflicts ────────────────────────────────────────
  { id: 'ukraine',       name: 'Ukraine',        lat: 49.0, lon:  31.5, level: 'critical', desc: '⚔️ Russia–Ukraine War — Active conflict',                          countryId: '804' },
  { id: 'gaza',          name: 'Gaza',            lat: 31.5, lon:  34.5, level: 'critical', desc: '⚔️ Gaza — Israel–Hamas conflict',                                  countryId: '275' },
  { id: 'sudan',         name: 'Sudan',           lat: 15.5, lon:  30.0, level: 'high',     desc: '⚔️ Sudan — Civil war, humanitarian crisis',                        countryId: '729' },
  { id: 'myanmar',       name: 'Myanmar',         lat: 19.7, lon:  96.1, level: 'high',     desc: '⚔️ Myanmar — Civil war & junta resistance',                        countryId: '104' },
  { id: 'iran',          name: 'Iran',            lat: 32.0, lon:  53.0, level: 'high',     desc: '⚔️ Iran — Nuclear program, regional proxy conflict & Israel strikes', countryId: '364' },
  { id: 'yemen',         name: 'Yemen',           lat: 15.3, lon:  44.2, level: 'high',     desc: '⚔️ Yemen — Houthi conflict & Red Sea attacks',                      countryId: '887' },
  { id: 'sahel',         name: 'Sahel',           lat: 14.0, lon:   0.0, level: 'high',     desc: '⚔️ Sahel — Mali, Burkina Faso, Niger coups & insurgency' },
  { id: 'haiti',         name: 'Haiti',           lat: 18.9, lon: -72.3, level: 'high',     desc: '⚔️ Haiti — Gang violence & state collapse',                        countryId: '332' },
  { id: 'ethiopia',      name: 'Ethiopia',        lat:  9.1, lon:  40.5, level: 'elevated', desc: '⚠️ Ethiopia — Amhara conflict & ongoing instability',               countryId: '231' },
  { id: 'taiwan',        name: 'Taiwan Strait',   lat: 24.0, lon: 120.0, level: 'elevated', desc: '⚠️ Taiwan Strait — China military pressure' },
  { id: 'north-korea',   name: 'North Korea',     lat: 40.0, lon: 127.0, level: 'elevated', desc: '⚠️ North Korea — Nuclear & missile program',                       countryId: '408' },
  { id: 'south-china-sea', name: 'South China Sea', lat: 12.0, lon: 114.0, level: 'elevated', desc: '⚠️ South China Sea — Territorial disputes' },
  { id: 'syria',         name: 'Syria',           lat: 34.8, lon:  38.5, level: 'elevated', desc: '⚠️ Syria — Post-Assad transition, HTS rule & fragile stability',   countryId: '760' },
];

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

// Default RSS feeds — global/major news on by default, crypto/tech/security off
export const DEFAULT_RSS_FEEDS: RssFeed[] = [
  // ── Global / Major News (enabled by default) ────────────────
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',             name: 'BBC World News',        enabled: true,  category: 'global' },
  { url: 'https://feeds.reuters.com/reuters/worldnews',              name: 'Reuters World',         enabled: true,  category: 'global' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',               name: 'Al Jazeera',            enabled: true,  category: 'global' },
  { url: 'https://www.theguardian.com/world/rss',                   name: 'Guardian World',        enabled: true,  category: 'global' },
  { url: 'https://feeds.npr.org/1001/rss.xml',                      name: 'NPR News',              enabled: true,  category: 'global' },
  { url: 'https://www.france24.com/en/rss',                         name: 'France 24',             enabled: true,  category: 'global' },
  { url: 'https://rss.dw.com/rdf/rss-en-all',                       name: 'DW World',              enabled: false, category: 'global' },
  // ── Business / Markets (enabled by default) ─────────────────
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',          name: 'BBC Business',          enabled: true,  category: 'business' },
  { url: 'https://feeds.reuters.com/reuters/businessNews',           name: 'Reuters Business',      enabled: false, category: 'business' },
  // ── Technology (off by default) ─────────────────────────────
  { url: 'https://techcrunch.com/feed/',                             name: 'TechCrunch',            enabled: false, category: 'tech' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index',          name: 'Ars Technica',          enabled: false, category: 'tech' },
  { url: 'https://www.theverge.com/rss/index.xml',                  name: 'The Verge',             enabled: false, category: 'tech' },
  { url: 'https://www.wired.com/feed/rss',                          name: 'Wired',                 enabled: false, category: 'tech' },
  // ── Security / Defence (off by default) ─────────────────────
  { url: 'https://krebsonsecurity.com/feed/',                        name: 'Krebs on Security',     enabled: false, category: 'security' },
  { url: 'https://www.defensenews.com/rss/',                        name: 'Defense News',          enabled: false, category: 'security' },
  // ── Crypto (off by default) ─────────────────────────────────
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',         name: 'CoinDesk',              enabled: false, category: 'crypto' },
  { url: 'https://bitcoinmagazine.com/.rss/full/',                   name: 'Bitcoin Magazine',      enabled: false, category: 'crypto' },
  { url: 'https://cointelegraph.com/rss',                           name: 'CoinTelegraph',         enabled: false, category: 'crypto' },
  { url: 'https://www.theblock.co/rss.xml',                         name: 'The Block',             enabled: false, category: 'crypto' },
  { url: 'https://decrypt.co/feed',                                  name: 'Decrypt',               enabled: false, category: 'crypto' },
  { url: 'https://www.btctimes.com/rss',                            name: 'BTC Times',             enabled: false, category: 'crypto' },
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
      // Ensure all default feeds exist (merge new defaults) and backfill missing category
      if (parsed.news?.defaultFeeds) {
        const existingUrls = new Set(parsed.news.defaultFeeds.map((f: RssFeed) => f.url));
        for (const df of DEFAULT_RSS_FEEDS) {
          if (!existingUrls.has(df.url)) {
            parsed.news.defaultFeeds.push({...df});
          }
        }
        // Backfill category on feeds that were saved before the category field existed
        const categoryByUrl = new Map(DEFAULT_RSS_FEEDS.map(f => [f.url, f.category]));
        for (const f of parsed.news.defaultFeeds) {
          if (!f.category) f.category = categoryByUrl.get(f.url) ?? 'global';
        }
      }
      if (parsed.news?.customFeeds) {
        for (const f of parsed.news.customFeeds) {
          if (!f.category) f.category = 'global';
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
