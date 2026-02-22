import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

// Polymarket Geopolitics tag is the primary feed (mirrors polymarket.com/markets/geopolitics)
const GEOPOLITICS_TAG = { id: 100265, label: 'Geopolitics' };

interface Market {
  id: string;
  question: string;
  topOutcome: string;
  probability: number;
  outcomes: { name: string; probability: number }[];
  volume: number;
  volume24hr: number;
  endDate: string;
  tag: string;
  url: string;
  pinned: boolean;
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

function eventToMarket(event: any, tagLabel: string, pinned = false): Market | null {
  if (!event?.id || !event?.title) return null;
  const { topOutcome, probability, outcomes } = parseOutcomes(event);
  return {
    id: String(event.id),
    question: event.title,
    topOutcome,
    probability,
    outcomes,
    volume: parseFloat(event.volume ?? 0),
    volume24hr: parseFloat(event.volume24hr ?? 0),
    endDate: event.endDate ?? '',
    tag: tagLabel,
    url: event.slug ? `https://polymarket.com/event/${event.slug}` : 'https://polymarket.com/markets',
    pinned,
  };
}

export async function GET({ url }: RequestEvent) {
  try {
    const kwParam = url.searchParams.get('keywords');
    const keywords: string[] = kwParam ? JSON.parse(decodeURIComponent(kwParam)) : [];

    // Primary: Geopolitics — fetch more results to fill the card grid
    const geoFetch = fetch(
      `https://gamma-api.polymarket.com/events?tag_id=${GEOPOLITICS_TAG.id}&closed=false&limit=12&order=volume24hr&ascending=false`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
      .then(r => r.ok ? r.json() : [])
      .then((events: any[]) => ({ events: Array.isArray(events) ? events : [], label: GEOPOLITICS_TAG.label }))
      .catch(() => ({ events: [], label: GEOPOLITICS_TAG.label }));

    // Keyword pinned watchlist (max 4 keywords, 2 results each)
    const kwFetches = keywords.slice(0, 4).map(kw =>
      fetch(
        `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=2&search=${encodeURIComponent(kw)}&order=volume24hr&ascending=false`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
        .then(r => r.ok ? r.json() : [])
        .then((events: any[]) => ({ events: Array.isArray(events) ? events : [], label: kw, pinned: true }))
        .catch(() => ({ events: [], label: kw, pinned: true }))
    );

    const allResults = await Promise.allSettled([geoFetch, ...kwFetches]);

    const seen = new Set<string>();
    const pinnedMarkets: Market[] = [];
    const organicMarkets: Market[] = [];

    for (const result of allResults) {
      if (result.status !== 'fulfilled') continue;
      const { events, label, pinned = false } = result.value as any;

      for (const event of events) {
        const id = String(event.id ?? '');
        if (!id || seen.has(id)) continue;
        const vol24 = parseFloat(event.volume24hr ?? 0);
        if (!pinned && vol24 < 100) continue;
        seen.add(id);

        const market = eventToMarket(event, label, pinned);
        if (!market) continue;

        if (pinned) pinnedMarkets.push(market);
        else organicMarkets.push(market);
      }
    }

    // Sort by 24hr volume descending
    organicMarkets.sort((a, b) => b.volume24hr - a.volume24hr);
    pinnedMarkets.sort((a, b) => b.volume24hr - a.volume24hr);

    // Pinned first, then organic, cap at 16 total for card grid
    const markets = [...pinnedMarkets, ...organicMarkets].slice(0, 16);

    return json({ markets });
  } catch {
    return json({ markets: [] });
  }
}
