import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

// Polymarket Geopolitics tag is the primary feed (mirrors polymarket.com/markets/geopolitics)
const GEOPOLITICS_TAG = { id: 100265, label: 'Geopolitics' };
const MS_PER_DAY = 86_400_000;
/** Minimum 24hr volume (USD) for organic (non-pinned) results */
const MIN_ORGANIC_VOLUME = 500;

interface Market {
  id: string;
  question: string;
  topOutcome: string;
  probability: number;
  outcomes: { name: string; probability: number }[];
  volume: number;
  volume24hr: number;
  liquidity: number;
  endDate: string;
  startDate: string;
  tag: string;
  url: string;
  pinned: boolean;
  trending: boolean;
  // days until resolution (null = open-ended)
  daysLeft: number | null;
}

function parseOutcomes(event: any): { topOutcome: string; probability: number; outcomes: { name: string; probability: number }[] } {
  const firstMarket = event.markets?.[0];
  if (!firstMarket) return { topOutcome: 'Yes', probability: 50, outcomes: [] };

  let prices: number[] = [];
  let outcomeNames: string[] = [];

  try {
    prices = typeof firstMarket.outcomePrices === 'string'
      ? JSON.parse(firstMarket.outcomePrices).map(Number)
      : (firstMarket.outcomePrices ?? []).map(Number);
  } catch {}

  try {
    outcomeNames = typeof firstMarket.outcomes === 'string'
      ? JSON.parse(firstMarket.outcomes)
      : (firstMarket.outcomes ?? []);
  } catch {}

  if (!prices.length) return { topOutcome: 'Yes', probability: 50, outcomes: [] };

  const maxPrice = prices.reduce((m, p) => p > m ? p : m, -Infinity);
  const maxIdx = prices.indexOf(maxPrice);
  const outcomes = prices.map((p, i) => ({
    name: outcomeNames[i] ?? (i === 0 ? 'Yes' : 'No'),
    probability: Math.round(p * 100),
  })).sort((a, b) => b.probability - a.probability);

  return {
    topOutcome: outcomeNames[maxIdx] ?? 'Yes',
    probability: Math.round((prices[maxIdx] ?? 0.5) * 100),
    outcomes,
  };
}

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  try {
    const ms = new Date(dateStr).getTime() - Date.now();
    if (isNaN(ms)) return null;
    return Math.ceil(ms / MS_PER_DAY);
  } catch { return null; }
}

function eventToMarket(event: any, tagLabel: string, pinned = false, trending = false): Market | null {
  if (!event?.id || !event?.title) return null;
  const { topOutcome, probability, outcomes } = parseOutcomes(event);
  const endDate = event.endDate ?? '';
  return {
    id: String(event.id),
    question: event.title,
    topOutcome,
    probability,
    outcomes,
    volume: parseFloat(event.volume ?? 0),
    volume24hr: parseFloat(event.volume24hr ?? 0),
    liquidity: parseFloat(event.liquidity ?? 0),
    endDate,
    startDate: event.startDate ?? '',
    tag: tagLabel,
    url: event.slug ? `https://polymarket.com/event/${event.slug}` : 'https://polymarket.com/markets',
    pinned,
    trending,
    daysLeft: daysUntil(endDate),
  };
}

export async function GET({ url }: RequestEvent) {
  try {
    const kwParam = url.searchParams.get('keywords');
    const keywords: string[] = kwParam ? JSON.parse(decodeURIComponent(kwParam)) : [];

    // Primary: Geopolitics — fetch top results by 24hr volume
    const geoFetch = fetch(
      `https://gamma-api.polymarket.com/events?tag_id=${GEOPOLITICS_TAG.id}&closed=false&limit=10&order=volume24hr&ascending=false`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
      .then(r => r.ok ? r.json() : [])
      .then((events: any[]) => ({ events: Array.isArray(events) ? events : [], label: GEOPOLITICS_TAG.label, trending: false }))
      .catch(() => ({ events: [], label: GEOPOLITICS_TAG.label, trending: false }));

    // Secondary: Trending — top 24hr volume across ALL active markets (then filter geo-adjacent)
    const trendingFetch = fetch(
      `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=20&order=volume24hr&ascending=false`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
      .then(r => r.ok ? r.json() : [])
      .then((events: any[]) => ({ events: Array.isArray(events) ? events : [], label: 'Trending', trending: true }))
      .catch(() => ({ events: [], label: 'Trending', trending: true }));

    // Keyword pinned watchlist (max 4 keywords, 2 results each)
    const kwFetches = keywords.slice(0, 4).map(kw =>
      fetch(
        `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=2&search=${encodeURIComponent(kw)}&order=volume24hr&ascending=false`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
        .then(r => r.ok ? r.json() : [])
        .then((events: any[]) => ({ events: Array.isArray(events) ? events : [], label: kw, pinned: true, trending: false }))
        .catch(() => ({ events: [], label: kw, pinned: true, trending: false }))
    );

    const allResults = await Promise.allSettled([geoFetch, trendingFetch, ...kwFetches]);

    const seen = new Set<string>();
    const pinnedMarkets: Market[] = [];
    const geoMarkets: Market[] = [];
    const trendingMarkets: Market[] = [];

    for (const result of allResults) {
      if (result.status !== 'fulfilled') continue;
      const { events, label, pinned = false, trending = false } = result.value as any;

      for (const event of events) {
        const id = String(event.id ?? '');
        if (!id || seen.has(id)) continue;
        const vol24 = parseFloat(event.volume24hr ?? 0);
        if (!pinned && vol24 < MIN_ORGANIC_VOLUME) continue;
        seen.add(id);

        const market = eventToMarket(event, label, pinned, trending);
        if (!market) continue;

        if (pinned) pinnedMarkets.push(market);
        else if (trending) trendingMarkets.push(market);
        else geoMarkets.push(market);
      }
    }

    // Sort by 24hr volume descending
    geoMarkets.sort((a, b) => b.volume24hr - a.volume24hr);
    pinnedMarkets.sort((a, b) => b.volume24hr - a.volume24hr);
    // Only keep top 4 trending (non-duplicate, highest volume)
    trendingMarkets.sort((a, b) => b.volume24hr - a.volume24hr);
    const topTrending = trendingMarkets.slice(0, 4);

    // Pinned first, then geo, then trending fills remaining slots up to 16
    const combined = [...pinnedMarkets, ...geoMarkets];
    const remaining = Math.max(0, 16 - combined.length);
    const markets = [...combined, ...topTrending.slice(0, remaining)].slice(0, 16);

    return json({ markets });
  } catch {
    return json({ markets: [] });
  }
}
