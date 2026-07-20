import { describe, expect, it } from "vitest";
import { mapPoolTrades, type PoolInput } from "@/lib/sources/gecko-trades";
import {
  aggregateFlow,
  mergeTrades,
  type Trade,
} from "@/lib/metrics/merge-trades";
import pumpswapRaw from "./fixtures/geckoterminal-trades-pumpswap.json";
import meteoraUsdcRaw from "./fixtures/geckoterminal-trades-meteora-usdc.json";
import meteoraSolRaw from "./fixtures/geckoterminal-trades-meteora-sol.json";

const POOLS: Record<string, PoolInput> = {
  pumpswap: { pool: "Dw4kAH8LhdmgfW1cgyvnWSwSDqkt37jeY7pW4oFkbGTu", poolLabel: "PumpSwap", quoteSymbol: "SOL" },
  meteoraUsdc: { pool: "2jwbtvZf8dxZkQrERBZERDZfPMQoFpHGYEESPCxWibaG", poolLabel: "Meteora", quoteSymbol: "USDC" },
  meteoraSol: { pool: "6ChdkdgBjzdwCPv4PYoriyr1xDT6KzjWKojzuhWjEMqr", poolLabel: "Meteora", quoteSymbol: "SOL" },
};

const perPool = [
  mapPoolTrades(pumpswapRaw, POOLS.pumpswap),
  mapPoolTrades(meteoraUsdcRaw, POOLS.meteoraUsdc),
  mapPoolTrades(meteoraSolRaw, POOLS.meteoraSol),
];

describe("mergeTrades — dedupe by tx_hash across pools", () => {
  const merged = mergeTrades(perPool);
  const allLegs = perPool.flat();

  it("collapses 115 recorded legs into 103 distinct swaps", () => {
    expect(allLegs).toHaveLength(115);
    const distinct = new Set(allLegs.map((t) => t.txHash)).size;
    expect(distinct).toBe(103);
    expect(merged).toHaveLength(103);
  });

  it("keeps the largest-USD leg as each swap's representative", () => {
    // Group legs by hash and compare the merged entry to the per-hash max USD.
    const maxByHash = new Map<string, Trade>();
    for (const t of allLegs) {
      const cur = maxByHash.get(t.txHash);
      if (!cur || t.usd > cur.usd) maxByHash.set(t.txHash, t);
    }
    for (const m of merged) {
      const expected = maxByHash.get(m.txHash)!;
      expect(m.usd).toBe(expected.usd);
      expect(m.pool).toBe(expected.pool);
    }
  });

  it("keeps the PumpSwap $194.39 leg over the $1.95 Meteora leg of the same tx", () => {
    const dup = merged.find(
      (t) => t.txHash === "5pu6GMLiCvfaC9T1kYposHeGqxiU9ZQs47pZYSLHPHKhSqf6hJdK7yEzH5Cyum2f5uXmCwnKhDwLo1fJSuadXs9f",
    )!;
    expect(dup).toBeDefined();
    expect(dup.usd).toBeCloseTo(194.3932972, 3);
    expect(dup.pool).toBe(POOLS.pumpswap.pool);
  });

  it("sorts newest-first", () => {
    for (let i = 1; i < merged.length; i += 1) {
      expect(merged[i - 1].ts).toBeGreaterThanOrEqual(merged[i].ts);
    }
  });
});

describe("aggregateFlow — pressure math over the merged tape", () => {
  const merged = mergeTrades(perPool);
  const newest = Math.max(...merged.map((t) => t.ts));
  const oldest = Math.min(...merged.map((t) => t.ts));
  const span = newest - oldest;

  it("with a window spanning our whole tape, counts and USD equal the deduped set", () => {
    const flow = aggregateFlow(merged, newest, span);
    const buys = merged.filter((t) => t.side === "buy");
    const sells = merged.filter((t) => t.side === "sell");
    expect(flow.buyCount).toBe(buys.length);
    expect(flow.sellCount).toBe(sells.length);
    expect(flow.buyUsd).toBeCloseTo(buys.reduce((s, t) => s + t.usd, 0), 6);
    expect(flow.sellUsd).toBeCloseTo(sells.reduce((s, t) => s + t.usd, 0), 6);
    expect(flow.netUsd).toBeCloseTo(flow.buyUsd - flow.sellUsd, 6);
    expect(flow.totalUsd).toBeCloseTo(flow.buyUsd + flow.sellUsd, 6);
    // windowStart === oldest, so our data reaches the window's edge → covered.
    expect(flow.fullyCovered).toBe(true);
  });

  it("unique traders never exceed their side's trade count", () => {
    const flow = aggregateFlow(merged, newest, span);
    expect(flow.uniqueBuyers).toBeLessThanOrEqual(flow.buyCount);
    expect(flow.uniqueSellers).toBeLessThanOrEqual(flow.sellCount);
    expect(flow.uniqueBuyers).toBeGreaterThan(0);
  });

  it("reports under-coverage when the window is wider than our data reaches", () => {
    // Models the real 24h case: our ~100/pool tape spans <24h, so a 24h window
    // reaches back before our oldest trade — counts are a floor, not complete.
    const flow = aggregateFlow(merged, newest, span * 2 + 1000);
    expect(flow.fullyCovered).toBe(false);
    expect(flow.oldestTradeTs).toBe(oldest);
  });
});

describe("aggregateFlow — deterministic window + wallet dedupe", () => {
  const mk = (over: Partial<Trade>): Trade => ({
    txHash: Math.random().toString(36),
    ts: 0,
    side: "buy",
    wizardAmount: 1,
    usd: 10,
    priceUsd: 0.0002,
    wallet: "w",
    pool: "P",
    poolLabel: "PumpSwap",
    quoteSymbol: "SOL",
    whale: false,
    ...over,
  });
  const now = 1_000_000_000_000;
  const windowMs = 86_400_000;
  const start = now - windowMs;

  it("includes the boundary, excludes older, and dedupes unique wallets", () => {
    const trades: Trade[] = [
      mk({ ts: now, side: "buy", usd: 100, wallet: "alice" }),
      mk({ ts: start, side: "buy", usd: 50, wallet: "alice" }), // exactly at boundary → in; same wallet
      mk({ ts: start - 1, side: "buy", usd: 999, wallet: "bob" }), // 1ms too old → excluded
      mk({ ts: now - 5000, side: "sell", usd: 40, wallet: "carol" }),
    ];
    const flow = aggregateFlow(trades, now, windowMs);
    expect(flow.buyCount).toBe(2);
    expect(flow.sellCount).toBe(1);
    expect(flow.buyUsd).toBe(150);
    expect(flow.sellUsd).toBe(40);
    expect(flow.netUsd).toBe(110);
    expect(flow.uniqueBuyers).toBe(1); // both buys are "alice"
    expect(flow.uniqueSellers).toBe(1);
    expect(flow.oldestTradeTs).toBe(start - 1); // oldest is computed over ALL trades
    expect(flow.fullyCovered).toBe(true); // oldest sits before the window start
  });
});
