import { json } from '@sveltejs/kit';

// Fetch 200 weekly BTC/USDT candles from Binance public API and compute 200-week MA.
// Binance klines endpoint is public, no API key required, generous rate limits.
export async function GET() {
  try {
    const res = await fetch(
      'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=200',
      { headers: { 'Accept': 'application/json' } }
    );

    if (!res.ok) {
      return json({ ma200: null, error: `Binance returned ${res.status}` });
    }

    const data = await res.json();
    // Binance klines: [openTime, open, high, low, close, volume, ...]
    type BinanceKline = [number, string, string, string, string, ...unknown[]];
    const closes: number[] = (data as BinanceKline[]).map((k) => parseFloat(k[4])).filter((v) => !isNaN(v));

    if (closes.length < 14) {
      return json({ ma200: null, error: 'Insufficient price data' });
    }

    const window = closes.slice(-200);
    const ma200 = window.reduce((sum, p) => sum + p, 0) / window.length;

    return json({ ma200: parseFloat(ma200.toFixed(2)), weeks: window.length });
  } catch (err) {
    return json({ ma200: null, error: String(err) });
  }
}
