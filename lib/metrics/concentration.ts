/**
 * Concentration math — IMPLEMENTATION_PLAN.md §4 (Council of Holders) + §6.
 *
 * PURE and deterministic: it turns a full holder set (aggregated by owner, from
 * `lib/sources/helius.ts`) plus a label map into the top-N shares, HHI, USD
 * buckets, and top-20 table the card renders and the snapshot cron stores. No
 * fetching, no clock — so every derived value is unit-tested against the recorded
 * live fixture (test/fixtures/helius-holders-full.json) and synthetic cases.
 *
 * Exclusion rules (§6 "Concentration math"):
 *   - AMM pool vaults, lockers, and the burn/incinerator address are EXCLUDED from
 *     the top-N shares, HHI and buckets — they are not real holders. A pool's WIZARD
 *     vault is a token account whose OWNER is the pool address (verified live:
 *     the PumpSwap main pool owns its ~12.9% vault), so the label map is keyed by
 *     owner and the caller builds it from pool discovery + RugCheck's labeled
 *     accounts (see the snapshot route).
 *   - The creator wallet is INCLUDED in concentration but LABELED (plan §6) so a
 *     buyer can see it in the table.
 *   - The top-20 TABLE still lists everything (pools included) with labels — the
 *     bars/HHI/buckets are what exclude. Raw (unexcluded) top-N is also returned as
 *     context so the card can show how much the pools inflate the naive figure.
 *
 * Percentages are of the LIVE supply passed in (Helius `getTokenSupply`), never a
 * hardcoded 1B — some supply is burned (live ≈ 999.77M).
 *
 * Numeric note: raw base-unit amounts are kept as JS numbers. Safe here — WIZARD's
 * max single balance (~1.3e14) and total supply (~1e15) are well under 2^53. A
 * token with far larger raw supply would need BigInt; documented, not needed for v1.
 */

import { TOKEN } from "@/config/token";

/** Size of the top-holder table stored + rendered (plan §4: "top-20 table"). */
export const CONCENTRATION_TOP_TABLE = 20;

/** Canonical Solana burn / incinerator address (§6) — excluded when present. */
export const BURN_ADDRESS = "1nc1nerator11111111111111111111111111111111";

export type HolderLabel = "pool" | "locker" | "burn" | "creator";

/** A holder aggregated by owner wallet; `amount` is raw base units (integer). */
export type RawHolder = { owner: string; amount: number };

/**
 * owner address → label. `pool` / `locker` / `burn` are excluded from the shares,
 * HHI and buckets; `creator` is included but labeled. Unlabeled owners are normal
 * holders. Keyed by owner because a pool's vault is owned by the pool address.
 */
export type HolderLabels = Record<string, HolderLabel>;

export type BucketKey = "u10" | "d10_100" | "d100_1k" | "d1k_10k" | "o10k";

export type HolderBucket = {
  key: BucketKey;
  label: string;
  minUsd: number;
  /** null = open-ended (the "> $10K" bucket). */
  maxUsd: number | null;
  count: number;
};

/** USD holder buckets (§4). Boundaries are inclusive-low / exclusive-high. */
export const BUCKET_DEFS: ReadonlyArray<Omit<HolderBucket, "count">> = [
  { key: "u10", label: "< $10", minUsd: 0, maxUsd: 10 },
  { key: "d10_100", label: "$10 – $100", minUsd: 10, maxUsd: 100 },
  { key: "d100_1k", label: "$100 – $1K", minUsd: 100, maxUsd: 1_000 },
  { key: "d1k_10k", label: "$1K – $10K", minUsd: 1_000, maxUsd: 10_000 },
  { key: "o10k", label: "> $10K", minUsd: 10_000, maxUsd: null },
];

export type TopHolderRow = {
  rank: number;
  /** Owner wallet — links to a Solscan account page in the table. */
  address: string;
  /** Balance in human (UI) units. */
  amount: number;
  /** Share of live supply, %. */
  pct: number;
  /** Holding value in USD, or null when no current price is available. */
  usd: number | null;
  label: HolderLabel | null;
  /** Excluded from the concentration bars / HHI / buckets (pool/locker/burn). */
  excluded: boolean;
};

export type Concentration = {
  /** Distinct owners with a positive balance — the gross holder count (incl. pools). */
  totalHolders: number;
  /** Real holders after excluding pools / lockers / burn — the concentration base. */
  countedHolders: number;
  excludedCount: number;
  /** Share of supply held by the excluded accounts, % (context for the tooltip). */
  excludedPct: number;
  supplyRaw: number;
  decimals: number;
  priceUsd: number | null;
  /** Top-N shares of supply, %, pools/lockers/burn EXCLUDED. Null with no holders. */
  top10Pct: number | null;
  top20Pct: number | null;
  top50Pct: number | null;
  /** Naive top-N shares INCLUDING pools — context so the exclusion is transparent. */
  top10PctRaw: number | null;
  top20PctRaw: number | null;
  /**
   * Herfindahl-Hirschman index over the real (non-excluded) holders: Σ(pct²) on
   * percent shares, 0–10000 (one holder = 10000). This is the FULL-holder-set HHI
   * (unlike RugCheck's top-20-window lower bound), so it refines the Verdict's
   * Distribution axis. Null when there are no real holders.
   */
  hhi: number | null;
  /** USD holder buckets over the real holders. Counts are 0 when price is unknown. */
  buckets: HolderBucket[];
  /** Top-20 by balance, INCLUDING labeled pools/lockers — the table (§4). */
  topHolders: TopHolderRow[];
};

type Row = {
  owner: string;
  amountRaw: number;
  ui: number;
  pct: number;
  label: HolderLabel | null;
  excluded: boolean;
};

/**
 * Compute the full concentration picture from a holder set + label map. Pure.
 * `holders` may be token-account-level or already aggregated — it is (idempotently)
 * summed by owner here, so the holder count is always distinct owners.
 */
export function computeConcentration(args: {
  holders: RawHolder[];
  /** Live total supply in raw base units (Helius getTokenSupply). */
  supplyRaw: number;
  decimals?: number;
  labels?: HolderLabels;
  /** Current USD price per token (from getMarket) — drives the USD buckets + table. */
  priceUsd?: number | null;
  topTableSize?: number;
}): Concentration {
  const {
    holders,
    supplyRaw,
    decimals = TOKEN.decimals,
    labels = {},
    priceUsd = null,
    topTableSize = CONCENTRATION_TOP_TABLE,
  } = args;

  // Aggregate by owner (idempotent) and drop non-positive balances.
  const byOwner = new Map<string, number>();
  for (const h of holders) {
    if (!h || typeof h.owner !== "string") continue;
    const amt = Number(h.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    byOwner.set(h.owner, (byOwner.get(h.owner) ?? 0) + amt);
  }

  const supply = Number(supplyRaw);
  const hasSupply = Number.isFinite(supply) && supply > 0;
  const scale = 10 ** decimals;
  const priceOk = priceUsd != null && Number.isFinite(priceUsd) && priceUsd > 0;

  const rows: Row[] = [...byOwner].map(([owner, amountRaw]) => {
    const label = labels[owner] ?? (owner === BURN_ADDRESS ? "burn" : null);
    const excluded = label === "pool" || label === "locker" || label === "burn";
    return {
      owner,
      amountRaw,
      ui: amountRaw / scale,
      pct: hasSupply ? (amountRaw / supply) * 100 : 0,
      label,
      excluded,
    };
  });
  rows.sort((a, b) => b.amountRaw - a.amountRaw);

  const real = rows.filter((r) => !r.excluded);
  const excludedRows = rows.filter((r) => r.excluded);

  const topN = (arr: Row[], n: number): number | null =>
    hasSupply && arr.length ? arr.slice(0, n).reduce((s, r) => s + r.pct, 0) : null;

  const hhi =
    hasSupply && real.length ? real.reduce((s, r) => s + r.pct * r.pct, 0) : null;

  const excludedPct = hasSupply
    ? excludedRows.reduce((s, r) => s + r.pct, 0)
    : 0;

  const buckets: HolderBucket[] = BUCKET_DEFS.map((b) => ({ ...b, count: 0 }));
  if (priceOk) {
    for (const r of real) {
      const usd = r.ui * (priceUsd as number);
      const b = buckets.find(
        (x) => usd >= x.minUsd && (x.maxUsd == null || usd < x.maxUsd),
      );
      if (b) b.count += 1;
    }
  }

  const topHolders: TopHolderRow[] = rows.slice(0, topTableSize).map((r, i) => ({
    rank: i + 1,
    address: r.owner,
    amount: r.ui,
    pct: r.pct,
    usd: priceOk ? r.ui * (priceUsd as number) : null,
    label: r.label,
    excluded: r.excluded,
  }));

  return {
    totalHolders: rows.length,
    countedHolders: real.length,
    excludedCount: excludedRows.length,
    excludedPct,
    supplyRaw: hasSupply ? supply : 0,
    decimals,
    priceUsd: priceOk ? (priceUsd as number) : null,
    top10Pct: topN(real, 10),
    top20Pct: topN(real, 20),
    top50Pct: topN(real, 50),
    top10PctRaw: topN(rows, 10),
    top20PctRaw: topN(rows, 20),
    hhi,
    buckets,
    topHolders,
  };
}
