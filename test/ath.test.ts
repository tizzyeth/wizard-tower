import { describe, expect, it } from "vitest";
import { computeAth, type AthCandle } from "@/lib/metrics/ath";
import { mapOhlcv } from "@/lib/sources/geckoterminal";
import dayRaw from "./fixtures/geckoterminal-ohlcv-day.json";

/** The recorded main-pool daily series — the real ATH source. */
const candles = mapOhlcv(dayRaw, {
  pool: "Dw4kAH8LhdmgfW1cgyvnWSwSDqkt37jeY7pW4oFkbGTu",
  timeframe: "1d",
}).candles;

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe("computeAth — the highest price we can actually prove", () => {
  it("takes the highest daily HIGH, not the highest close", () => {
    // A day that closed low after spiking must still win on its intraday high —
    // on a thin pool the extreme almost always sits inside the candle.
    const rows: AthCandle[] = [
      { time: 1, high: 5 },
      { time: 2, high: 9 }, // the spike
      { time: 3, high: 6 },
    ];
    expect(computeAth(rows)!.priceUsd).toBe(9);
    expect(computeAth(rows)!.atMs).toBe(2000);
  });

  it("reports the coverage start, which is what makes the label honest", () => {
    const ath = computeAth([
      { time: 300, high: 2 },
      { time: 100, high: 7 },
      { time: 200, high: 4 },
    ])!;
    // sinceMs is the EARLIEST candle regardless of input order — the card renders
    // "ATH · since <that date>" rather than claiming an unqualified all-time high.
    expect(ath.sinceMs).toBe(100_000);
    expect(ath.priceUsd).toBe(7);
    expect(ath.candles).toBe(3);
  });

  it("drops the degenerate candles GeckoTerminal emits for empty buckets", () => {
    const ath = computeAth([
      { time: 1, high: 3 },
      { time: 2, high: 0 }, // empty bucket
      { time: 3, high: Number.NaN },
      { time: Number.NaN, high: 99 }, // unusable timestamp — must not win
      { time: 4, high: -1 },
    ])!;
    expect(ath.priceUsd).toBe(3);
    expect(ath.candles).toBe(1);
  });

  it("returns null rather than a guess when nothing is usable", () => {
    expect(computeAth([])).toBeNull();
    expect(computeAth([{ time: 1, high: 0 }])).toBeNull();
  });
});

describe("computeAth — against the recorded live main-pool series", () => {
  const ath = computeAth(candles)!;

  it("computes $0.0009331 on 2026-05-20 from 131 candles since 2026-03-11", () => {
    expect(candles.length).toBe(131);
    expect(ath.priceUsd).toBeCloseTo(0.0009330744615442539, 12);
    expect(utc(ath.atMs)).toBe("2026-05-20");
    expect(utc(ath.sinceMs)).toBe("2026-03-11");
  });

  it("covers the main pool's whole life, so the figure is not window-clipped", () => {
    // DexScreener reports the PumpSwap main pool's pairCreatedAt as
    // 2026-03-11T15:04:56Z, and the candle history starts that same UTC day —
    // the series spans the pool from birth. (It does NOT span the token's earlier
    // pump.fun bonding-curve phase, which is precisely why the card says "since".)
    expect(utc(ath.sinceMs)).toBe("2026-03-11");
    expect(ath.candles).toBe(candles.length);
  });

  /**
   * CROSS-CHECK against prior research (2026-07-17), which recorded ATH ≈ $0.0003529.
   * It does NOT agree with this computation, and the disagreement is deliberate to
   * record rather than paper over.
   *
   * The computed $0.0009331 is corroborated independently by the HOURLY candles for
   * 2026-05-20: the 07:00 UTC hour printed high 9.3307e-4 / close 8.8794e-4 on $9.5k
   * of volume, the following hour did $41.7k, and neighbouring hours sat in the
   * 8e-4 range — a sustained level, not a single-print wick.
   *
   * $0.0003529 matches no maximum we can reproduce: not the max high or max close of
   * any trailing 7/14/30/60/90-day window, as of either 2026-07-17 or 2026-07-20, on
   * any of the four WIZARD pools. (Nearest neighbours: trailing-14d max high
   * 3.2753e-4; trailing-30d max close 3.7903e-4.) We therefore ship the computed
   * figure and treat the reference as superseded.
   */
  it("is materially higher than the $0.0003529 reference — recorded, not silently dropped", () => {
    const REFERENCE = 0.0003529;
    expect(ath.priceUsd).toBeGreaterThan(REFERENCE);
    // ~2.6x — far outside any plausible rounding or currency-conversion drift, so
    // the two are measuring different things, not the same thing imprecisely.
    expect(ath.priceUsd / REFERENCE).toBeGreaterThan(2.5);
  });
});
