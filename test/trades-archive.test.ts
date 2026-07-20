import { describe, expect, it } from "vitest";
import { applyArchive, toTradeRow, type ArchiveFlowResult } from "@/lib/trades-archive";
import { mapPoolTrades } from "@/lib/sources/gecko-trades";
import type { TradesResult } from "@/lib/sources/gecko-trades";
import {
  aggregateFlow,
  mergeTrades,
  FLOW_WINDOW_MS,
  type FlowStats,
  type Trade,
} from "@/lib/metrics/merge-trades";
import pumpswapRaw from "./fixtures/geckoterminal-trades-pumpswap.json";

const POOL = {
  pool: "Dw4kAH8LhdmgfW1cgyvnWSwSDqkt37jeY7pW4oFkbGTu",
  poolLabel: "PumpSwap",
  quoteSymbol: "SOL",
};
const tape = mapPoolTrades(pumpswapRaw, POOL);

const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
const WINDOW_START = NOW - FLOW_WINDOW_MS;

function flowStub(over: Partial<FlowStats> = {}): FlowStats {
  return {
    windowMs: FLOW_WINDOW_MS,
    windowStart: WINDOW_START,
    buyCount: 0,
    sellCount: 0,
    buyUsd: 0,
    sellUsd: 0,
    netUsd: 0,
    totalUsd: 0,
    uniqueBuyers: 0,
    uniqueSellers: 0,
    uniqueTraders: 0,
    oldestTradeTs: null,
    fullyCovered: false,
    ...over,
  };
}

function baseResult(): TradesResult {
  return {
    ok: true,
    stale: false,
    dataAsOf: NOW,
    trades: [],
    totalMerged: 0,
    flow: flowStub({ uniqueBuyers: 5, uniqueSellers: 4, uniqueTraders: 8 }),
    pools: [POOL],
    poolsFailed: [],
  };
}

function archiveResult(sinceMs: number, rows = 1000): ArchiveFlowResult {
  return {
    flow: flowStub({
      uniqueBuyers: 31,
      uniqueSellers: 22,
      uniqueTraders: 47,
      oldestTradeTs: sinceMs,
      fullyCovered: sinceMs <= WINDOW_START,
    }),
    coverage: {
      since: sinceMs,
      rows,
      rowsInWindow: 180,
      fullyCovered: sinceMs <= WINDOW_START,
    },
    windowRows: [],
  };
}

describe("toTradeRow — what the archive persists", () => {
  const t = tape[0];
  const row = toTradeRow(t);

  it("keeps the identity, time, side and money the tape derived", () => {
    expect(row.txHash).toBe(t.txHash);
    expect(row.ts).toBeInstanceOf(Date);
    expect((row.ts as Date).getTime()).toBe(t.ts);
    expect(row.side).toBe(t.side);
    expect(row.usd).toBe(t.usd);
    expect(row.priceUsd).toBe(t.priceUsd);
    expect(row.wallet).toBe(t.wallet);
    expect(row.pool).toBe(t.pool);
    expect(row.dexId).toBe(t.poolLabel);
  });

  it("only ever writes the two sides the CHECK constraint allows", () => {
    for (const row of tape.map(toTradeRow)) {
      expect(["buy", "sell"]).toContain(row.side);
    }
  });

  it("stores what the TAPE calls one trade — merged first, so tx_hash is unique", () => {
    // The PK is tx_hash, so a duplicated leg inside one batch would abort the whole
    // INSERT. mergeTrades is what guarantees the batch is already collapsed.
    const merged = mergeTrades([tape]);
    const hashes = merged.map((t) => t.txHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("applyArchive — the honesty rule, in both directions", () => {
  it("YOUNG archive: keeps the approximate window flow and says so", () => {
    // Archive started 3 hours ago — it cannot speak for a 24h window.
    const young = archiveResult(NOW - 3 * 3_600_000);
    const out = applyArchive(baseResult(), young);

    expect(out.flowSource).toBe("window");
    expect(out.flow!.uniqueBuyers).toBe(5); // the window's number, untouched
    expect(out.flow!.fullyCovered).toBe(false);
    // It still reports WHEN we started recording, so the card can explain itself.
    expect(out.archiveSince).toBe(young.coverage.since);
    expect(out.archiveRows).toBe(1000);
  });

  it("MATURE archive: supplies the counted census and flips the flag", () => {
    // Archive reaches back 3 days — it fully covers the window.
    const mature = archiveResult(NOW - 3 * FLOW_WINDOW_MS);
    const out = applyArchive(baseResult(), mature);

    expect(out.flowSource).toBe("archive");
    expect(out.flow!.uniqueBuyers).toBe(31); // the archive's number
    expect(out.flow!.uniqueTraders).toBe(47);
    expect(out.flow!.fullyCovered).toBe(true);
    expect(out.archiveSince).toBe(mature.coverage.since);
  });

  it("treats the boundary conservatively — exactly at the window start counts", () => {
    const exact = applyArchive(baseResult(), archiveResult(WINDOW_START));
    expect(exact.flowSource).toBe("archive");
    const oneMsLate = applyArchive(baseResult(), archiveResult(WINDOW_START + 1));
    expect(oneMsLate.flowSource).toBe("window");
  });

  it("NO archive (no DB, e2e, or empty table): the payload is untouched", () => {
    const out = applyArchive(baseResult(), null);
    expect(out.flowSource).toBeUndefined();
    expect(out.archiveSince).toBeUndefined();
    expect(out.flow!.uniqueBuyers).toBe(5);
    // An absent flowSource is what the cards read as "approximate" — the safe default.
  });

  it("never touches the tape itself, only the derived flow", () => {
    const base = { ...baseResult(), trades: tape.slice(0, 10), totalMerged: 10 };
    const out = applyArchive(base, archiveResult(NOW - 3 * FLOW_WINDOW_MS));
    expect(out.trades).toBe(base.trades);
    expect(out.totalMerged).toBe(10);
  });
});

describe("archive aggregation reuses the tape's pure logic", () => {
  it("aggregateFlow accepts bare archive rows (no display fields)", () => {
    // The archive stores no poolLabel/quoteSymbol/whale; flow math must not need them.
    const rows = tape.map((t) => ({
      txHash: t.txHash,
      ts: t.ts,
      side: t.side,
      usd: t.usd,
      wallet: t.wallet,
    }));
    const fromRows = aggregateFlow(rows, NOW);
    const fromTrades = aggregateFlow(tape, NOW);
    expect(fromRows.buyCount).toBe(fromTrades.buyCount);
    expect(fromRows.uniqueTraders).toBe(fromTrades.uniqueTraders);
    expect(fromRows.totalUsd).toBeCloseTo(fromTrades.totalUsd, 10);
  });

  it("mergeTrades dedupes archive rows and keeps the max-USD leg", () => {
    const dup = { txHash: "same", ts: 1, usd: 10, side: "buy" as const, wallet: "w" };
    const bigger = { ...dup, usd: 99 };
    const merged = mergeTrades([[dup], [bigger]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].usd).toBe(99);
  });

  it("a live-tape union cannot double-count a trade already archived", () => {
    // The read path unions the last cron interval's live tail onto the archive rows;
    // the shared tx_hash key is what makes that safe.
    const archived = tape.slice(0, 50).map((t) => ({
      txHash: t.txHash,
      ts: t.ts,
      side: t.side,
      usd: t.usd,
      wallet: t.wallet,
    }));
    const live: Trade[] = tape.slice(25); // deliberately overlapping
    const merged = mergeTrades([
      archived,
      live.map((t) => ({ txHash: t.txHash, ts: t.ts, side: t.side, usd: t.usd, wallet: t.wallet })),
    ]);
    expect(merged).toHaveLength(new Set(tape.map((t) => t.txHash)).size);
  });
});
