import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export async function GET({ url }: RequestEvent) {
  try {
    const kwParam = url.searchParams.get('keywords');
    const keywords: string[] = kwParam ? JSON.parse(decodeURIComponent(kwParam)) : ['Bitcoin', 'Ukraine ceasefire', 'US Iran'];
    if (!keywords.length) return json({ markets: [] });

    const results = await Promise.allSettled(keywords.map(async (keyword) => {
      const res = await fetch(`https://gamma-api.polymarket.com/markets?active=true&limit=3&search=${encodeURIComponent(keyword)}&order=volume&ascending=false`);
      if (!res.ok) return [];
      return res.json();
    }));

    const seen = new Set<string>();
    const markets: { id: string; question: string; topOutcome: string; probability: number; volume: number; endDate: string }[] = [];

    results.forEach((result, i) => {
      if (result.status !== 'fulfilled') return;
      const list = Array.isArray(result.value) ? result.value : [];
      list.slice(0, 2).forEach((m: { id: string; question: string; outcomes?: unknown; outcomePrices?: unknown; volume?: number; endDate?: string }) => {
        if (!m.id || seen.has(m.id)) return;
        seen.add(m.id);

        let prices: number[] = [];
        if (typeof m.outcomePrices === 'string') { try { prices = JSON.parse(m.outcomePrices).map(Number); } catch { prices = []; } }
        else if (Array.isArray(m.outcomePrices)) prices = m.outcomePrices.map(Number);

        let outcomes: string[] = [];
        if (typeof m.outcomes === 'string') { try { outcomes = JSON.parse(m.outcomes); } catch { outcomes = []; } }
        else if (Array.isArray(m.outcomes)) outcomes = m.outcomes;

        if (!prices.length) return;
        const maxIdx = prices.indexOf(Math.max(...prices));
        markets.push({ id: m.id, question: m.question, topOutcome: outcomes[maxIdx] ?? 'Yes', probability: Math.round((prices[maxIdx] ?? 0) * 100), volume: m.volume ?? 0, endDate: m.endDate ?? '' });
      });
    });

    markets.sort((a, b) => b.volume - a.volume);
    return json({ markets: markets.slice(0, 8) });
  } catch {
    return json({ markets: [] });
  }
}
