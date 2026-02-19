import { json } from '@sveltejs/kit';

export async function GET() {
  try {
    const [priceRes, feesRes, blockRes] = await Promise.allSettled([
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'),
      fetch('https://mempool.space/api/v1/fees/recommended'),
      fetch('https://mempool.space/api/blocks/tip/height'),
    ]);

    let price = 0;
    if (priceRes.status === 'fulfilled' && priceRes.value.ok) {
      const d = await priceRes.value.json();
      price = d?.bitcoin?.usd ?? 0;
    }
    if (price === 0) {
      const fb = await fetch('https://mempool.space/api/v1/prices').catch(() => null);
      if (fb?.ok) { const d = await fb.json(); price = d?.USD ?? 0; }
    }

    let fees = { fastestFee: 1, halfHourFee: 1, hourFee: 1 };
    if (feesRes.status === 'fulfilled' && feesRes.value.ok) fees = await feesRes.value.json();

    let blockHeight = 0;
    if (blockRes.status === 'fulfilled' && blockRes.value.ok) blockHeight = await blockRes.value.json();

    return json({ price, satsPerDollar: price > 0 ? Math.round(1e8 / price) : 0, blockHeight, fees: { low: fees.hourFee, medium: fees.halfHourFee, high: fees.fastestFee } });
  } catch {
    return json({ price: 0, satsPerDollar: 0, blockHeight: 0, fees: { low: 0, medium: 0, high: 0 } });
  }
}
