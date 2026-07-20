import { describe, expect, it } from "vitest";
import {
  computeConcentration,
  BURN_ADDRESS,
  type HolderLabels,
  type RawHolder,
} from "@/lib/metrics/concentration";
import full from "./fixtures/helius-holders-full.json";

/**
 * Recorded live 2026-07-19 (full Helius scan aggregated by owner, plus the pool /
 * locker labels resolved from DexScreener pool discovery + RugCheck knownAccounts).
 * Solscan showed 1,137 holders at capture; our distinct-owner count is 1,132
 * (−0.4%, within the ±1% DoD — Solscan counts token accounts, we count wallets).
 */
const holders: RawHolder[] = full.holders.map((h) => ({
  owner: h.owner,
  amount: Number(h.amount),
}));
const supplyRaw = Number(full.supplyRaw);

function fixtureLabels(): HolderLabels {
  const labels: HolderLabels = {};
  for (const p of full.labels.pools) labels[p] = "pool";
  for (const l of full.labels.lockers) labels[l] = "locker";
  labels[full.labels.burn] = "burn";
  labels[full.labels.creator] = "creator";
  return labels;
}

describe("computeConcentration — the live holder set (fixture)", () => {
  const c = computeConcentration({
    holders,
    supplyRaw,
    decimals: full.decimals,
    labels: fixtureLabels(),
    priceUsd: full.priceUsd,
  });

  it("counts distinct owners as the gross holder count (≈ Solscan's 1,137)", () => {
    expect(c.totalHolders).toBe(1132);
    expect(Math.abs(c.totalHolders - 1137) / 1137).toBeLessThan(0.01); // within ±1%
  });

  it("excludes the labeled pool/locker/burn accounts from the counted base", () => {
    expect(c.excludedCount).toBe(9);
    expect(c.countedHolders).toBe(1123);
    expect(c.countedHolders + c.excludedCount).toBe(c.totalHolders);
    // The PumpSwap main pool alone holds ~12.9% — most of the excluded weight.
    expect(c.excludedPct).toBeCloseTo(13.7, 1);
  });

  it("computes top-N shares of supply, pools EXCLUDED, below the raw figure", () => {
    expect(c.top10Pct!).toBeCloseTo(23.02, 2);
    expect(c.top20Pct!).toBeCloseTo(36.0, 1);
    expect(c.top50Pct!).toBeCloseTo(60.22, 2);
    // Raw (pools included) is materially higher — the exclusion is meaningful.
    expect(c.top10PctRaw!).toBeCloseTo(34.05, 2);
    expect(c.top10Pct!).toBeLessThan(c.top10PctRaw!);
  });

  it("computes the full-holder-set HHI (very unconcentrated, « 1500)", () => {
    expect(c.hhi!).toBeCloseTo(98.31, 1);
    expect(c.hhi!).toBeLessThan(1500); // DOJ unconcentrated
  });

  it("buckets the real holders by USD value (sums to the counted base)", () => {
    const byKey = Object.fromEntries(c.buckets.map((b) => [b.key, b.count]));
    expect(byKey.u10).toBe(766);
    expect(byKey.d10_100).toBe(186);
    expect(byKey.d100_1k).toBe(123);
    expect(byKey.d1k_10k).toBe(48);
    expect(byKey.o10k).toBe(0);
    const sum = c.buckets.reduce((s, b) => s + b.count, 0);
    expect(sum).toBe(c.countedHolders);
  });

  it("returns a labeled top-20 table (pools included, ranked, with USD)", () => {
    expect(c.topHolders).toHaveLength(20);
    const first = c.topHolders[0];
    expect(first.rank).toBe(1);
    expect(first.address).toBe("Dw4kAH8LhdmgfW1cgyvnWSwSDqkt37jeY7pW4oFkbGTu");
    expect(first.label).toBe("pool");
    expect(first.excluded).toBe(true);
    expect(first.pct).toBeCloseTo(12.87, 1);
    expect(first.usd!).toBeGreaterThan(0);
    // The #2 holder is a real wallet, unlabeled and counted.
    expect(c.topHolders[1].label).toBeNull();
    expect(c.topHolders[1].excluded).toBe(false);
    // Ranks are contiguous and balances descending.
    for (let i = 1; i < c.topHolders.length; i++) {
      expect(c.topHolders[i].rank).toBe(i + 1);
      expect(c.topHolders[i].amount).toBeLessThanOrEqual(c.topHolders[i - 1].amount);
    }
  });
});

// ── Synthetic cases exercising exclusion / creator / burn / price edges ───────

describe("computeConcentration — exclusion + labeling rules (synthetic)", () => {
  const supply = 1_000_000; // raw units, decimals 0 for easy math

  it("excludes pools & lockers from shares/HHI but the creator stays counted", () => {
    const c = computeConcentration({
      holders: [
        { owner: "POOL", amount: 500_000 }, // 50% — excluded
        { owner: "LOCK", amount: 100_000 }, // 10% — excluded
        { owner: "CREATOR", amount: 40_000 }, // 4% — counted, labeled
        { owner: "whaleA", amount: 30_000 }, // 3%
        { owner: "whaleB", amount: 30_000 }, // 3%
      ],
      supplyRaw: supply,
      decimals: 0,
      labels: { POOL: "pool", LOCK: "locker", CREATOR: "creator" },
    });
    expect(c.totalHolders).toBe(5);
    expect(c.countedHolders).toBe(3); // creator + 2 whales
    expect(c.excludedCount).toBe(2);
    expect(c.top10Pct).toBeCloseTo(10, 6); // 4 + 3 + 3 (pool/locker gone)
    expect(c.top10PctRaw).toBeCloseTo(70, 6); // 50 + 10 + 4 + 3 + 3
    // HHI over counted: 4²+3²+3² = 34
    expect(c.hhi).toBeCloseTo(34, 6);
    const creatorRow = c.topHolders.find((r) => r.address === "CREATOR")!;
    expect(creatorRow.label).toBe("creator");
    expect(creatorRow.excluded).toBe(false);
  });

  it("treats the burn/incinerator address as excluded even without a label", () => {
    const c = computeConcentration({
      holders: [
        { owner: BURN_ADDRESS, amount: 200_000 },
        { owner: "alice", amount: 100_000 },
      ],
      supplyRaw: supply,
      decimals: 0,
    });
    expect(c.excludedCount).toBe(1);
    expect(c.countedHolders).toBe(1);
    expect(c.topHolders.find((r) => r.address === BURN_ADDRESS)!.label).toBe("burn");
  });

  it("aggregates multiple token accounts of one owner into a single holder", () => {
    const c = computeConcentration({
      holders: [
        { owner: "alice", amount: 100_000 },
        { owner: "alice", amount: 50_000 },
        { owner: "bob", amount: 30_000 },
      ],
      supplyRaw: supply,
      decimals: 0,
    });
    expect(c.totalHolders).toBe(2);
    expect(c.topHolders[0].address).toBe("alice");
    expect(c.topHolders[0].amount).toBe(150_000);
  });

  it("buckets by USD using the current price (< $10 … > $10K)", () => {
    // decimals 0, price $1 → USD == token amount.
    const c = computeConcentration({
      holders: [
        { owner: "dust", amount: 5 }, // $5  → u10
        { owner: "small", amount: 50 }, // $50 → d10_100
        { owner: "mid", amount: 500 }, // $500 → d100_1k
        { owner: "big", amount: 5_000 }, // $5K → d1k_10k
        { owner: "whale", amount: 50_000 }, // $50K → o10k
      ],
      supplyRaw: 1_000_000,
      decimals: 0,
      priceUsd: 1,
    });
    const byKey = Object.fromEntries(c.buckets.map((b) => [b.key, b.count]));
    expect(byKey).toEqual({ u10: 1, d10_100: 1, d100_1k: 1, d1k_10k: 1, o10k: 1 });
  });

  it("omits USD when no price is given (buckets empty, table usd null)", () => {
    const c = computeConcentration({
      holders: [{ owner: "alice", amount: 100 }],
      supplyRaw: 1_000,
      decimals: 0,
    });
    expect(c.priceUsd).toBeNull();
    expect(c.buckets.every((b) => b.count === 0)).toBe(true);
    expect(c.topHolders[0].usd).toBeNull();
  });

  it("is null-safe on an empty holder set", () => {
    const c = computeConcentration({ holders: [], supplyRaw: 1_000, decimals: 0 });
    expect(c.totalHolders).toBe(0);
    expect(c.top10Pct).toBeNull();
    expect(c.hhi).toBeNull();
    expect(c.topHolders).toEqual([]);
  });
});
