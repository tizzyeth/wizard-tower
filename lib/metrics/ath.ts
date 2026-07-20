/**
 * All-time high — PURE (M10). One function, one honesty problem.
 *
 * THE SOURCING PROBLEM. DexScreener's token endpoint does not return an ATH, which
 * is why the Wizard's Ledger showed "—". Our own trade archive cannot supply one
 * either: it only knows prices from the moment archiving started, so its maximum is
 * a "high since we started watching", not an all-time high — and presenting that as
 * ATH would be a lie that gets worse the lower the token drifts.
 *
 * WHAT WE USE INSTEAD. GeckoTerminal daily OHLCV reaches back much further: for the
 * $WIZARD main pool it returns 132 daily candles starting 2026-03-11, and DexScreener
 * reports that pool's `pairCreatedAt` as 2026-03-11T15:04:56Z. The candle history
 * therefore spans the POOL'S ENTIRE LIFE, and the max daily high across it is a
 * genuine price extreme rather than a windowed one.
 *
 * WHY IT IS STILL LABELED "SINCE". $WIZARD launched on pump.fun (the mint ends in
 * `pump`), so a bonding-curve phase precedes the PumpSwap pool that GeckoTerminal
 * indexes. We cannot see that phase, so we do NOT claim an absolute all-time high:
 * the card renders "ATH (since <date>)" using `since` below. If a future source ever
 * covers the curve, only the label changes.
 *
 * Verified 2026-07-20 against the live main pool: max daily high = $0.0009331 on
 * 2026-05-20, corroborated independently by that day's HOURLY candles (07:00 UTC
 * high 9.3307e-4, close 8.8794e-4, $9.5k volume in the hour and $41.7k the next) —
 * a sustained level across neighbouring hours, not a single-print wick.
 */

/** One daily candle, as produced by `lib/sources/geckoterminal.ts` (time in SECONDS). */
export type AthCandle = { time: number; high: number };

export type Ath = {
  /** The highest price seen in the covered history, USD. */
  priceUsd: number;
  /** UTC day of that high (ms) — the "on <date>" in the tooltip. */
  atMs: number;
  /** Start of the covered history (ms) — the "since <date>" in the label. */
  sinceMs: number;
  /** Candles the figure was computed from — sizes the caveat. */
  candles: number;
};

/**
 * Highest daily high across the supplied candles.
 *
 * Deliberately uses HIGH, not close: an all-time high is the highest price actually
 * traded, and on a thin pool the extreme frequently sits intraday. Candles with a
 * non-finite or non-positive high are dropped (GeckoTerminal emits degenerate rows
 * for empty buckets on illiquid pools — the same rows `mapOhlcv` filters).
 *
 * Returns null when there is nothing usable, so the card keeps its honest "—". A
 * wrong ATH is worse than none.
 */
export function computeAth(candles: readonly AthCandle[]): Ath | null {
  let best: AthCandle | null = null;
  let earliest: number | null = null;
  let usable = 0;

  for (const c of candles) {
    if (!Number.isFinite(c.time) || !Number.isFinite(c.high) || c.high <= 0) continue;
    usable += 1;
    if (earliest === null || c.time < earliest) earliest = c.time;
    if (best === null || c.high > best.high) best = c;
  }

  if (!best || earliest === null) return null;
  return {
    priceUsd: best.high,
    atMs: best.time * 1000,
    sinceMs: earliest * 1000,
    candles: usable,
  };
}
