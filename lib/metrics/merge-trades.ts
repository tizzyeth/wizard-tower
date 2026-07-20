/**
 * Trade merge / dedupe / flow aggregation — PURE functions (IMPLEMENTATION_PLAN.md §6).
 *
 * These are the domain heart of M3 and carry no I/O: they take already-normalized
 * trades (produced by `lib/sources/gecko-trades.ts`) and turn them into the
 * unified tape and the buy/sell pressure the two M3 cards render. Being pure and
 * deterministic, they are the repo's first unit-tested logic (test/merge-trades.test.ts)
 * against the live fixtures recorded in test/fixtures/.
 *
 * Two decisions worth stating, both validated against recorded live data:
 *
 *   1. SIDE is defined from WIZARD's position in the swap — WIZARD received is a
 *      BUY, WIZARD spent is a SELL — decided in the source mapper, not here.
 *      (GeckoTerminal's own `kind` is relative to each pool's BASE token, which
 *      is not WIZARD in every pool, e.g. USD2/WIZARD — so `kind` would flip the
 *      side for those pools. WIZARD-position is correct and pool-orientation-safe.)
 *
 *   2. DEDUPE is by `tx_hash` (§4/§5: "one swap can appear via multiple pools/legs").
 *      A single user swap routed by an aggregator across several pools shows up
 *      once per pool with the SAME tx_hash. In a recorded snapshot, 11 of 103
 *      swaps were multi-pool. We keep the single largest-USD leg as the swap's
 *      representative (its dominant venue), so the unified tape shows each swap
 *      once and the 24h USD stays within ~1.5% of DexScreener's summed volume.
 */

// ── Domain types (shared by the source, the route, and the cards) ───────────

export type TradeSide = "buy" | "sell";

/** One normalized swap, always from WIZARD's perspective. Serializable server→client. */
export type Trade = {
  /** Solana transaction signature — the cross-pool dedupe key. */
  txHash: string;
  /** Block time in unix milliseconds. */
  ts: number;
  /** BUY = WIZARD received · SELL = WIZARD spent. */
  side: TradeSide;
  /** WIZARD token amount in the swap. */
  wizardAmount: number;
  /** USD value of the swap (GeckoTerminal `volume_in_usd`). */
  usd: number;
  /** WIZARD USD price at the trade. */
  priceUsd: number;
  /** Signer / fee payer (`tx_from_address`) — truncated + linked to Solscan in the UI. */
  wallet: string;
  /** Pool (pair) address this representative leg traded through. */
  pool: string;
  /** DEX label for the pool badge, e.g. "PumpSwap". */
  poolLabel: string;
  /** The non-WIZARD side of the pool, e.g. "SOL" / "USDC". */
  quoteSymbol: string;
  /** True when `usd` clears the whale threshold (config/token.ts). */
  whale: boolean;
};

/** 24h buy-vs-sell pressure + net flow, derived from the merged tape. */
export type FlowStats = {
  /** Aggregation window length (ms). */
  windowMs: number;
  /** now − windowMs — the inclusive lower bound of the window. */
  windowStart: number;
  buyCount: number;
  sellCount: number;
  buyUsd: number;
  sellUsd: number;
  /** buyUsd − sellUsd. Positive = net buying pressure. */
  netUsd: number;
  /** buyUsd + sellUsd over the window. */
  totalUsd: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  /**
   * Distinct wallets that traded (bought OR sold) in the window — NOT
   * uniqueBuyers + uniqueSellers, which double-counts a wallet that did both.
   * Feeds the Verdict's Activity axis (M7).
   */
  uniqueTraders: number;
  /** Oldest trade we hold across all pools (ms), or null when the tape is empty. */
  oldestTradeTs: number | null;
  /**
   * True only when our data reaches back past the window start — i.e. the
   * ~100-trades-per-pool cap does NOT clip the 24h window. When false the counts
   * are a lower bound and the UI labels them "approximate".
   */
  fullyCovered: boolean;
};

/** Default flow window: 24 hours. */
export const FLOW_WINDOW_MS = 86_400_000;

// ── Merge + dedupe ──────────────────────────────────────────────────────────

/**
 * The minimum a value needs for dedupe: an identity, a time, and a size to rank
 * competing legs by. Generic so the SAME merge serves the rendered tape (`Trade`)
 * and the archive's DB rows, which carry no display fields (M10).
 */
export type Mergeable = { txHash: string; ts: number; usd: number };

/**
 * Merge per-pool trade lists into one newest-first tape, deduped by tx_hash.
 * When the same swap appears in multiple pools we keep the largest-USD leg as its
 * representative (dominant venue) so the tape shows each swap exactly once.
 *
 * Generic in the element type: passing `Trade[][]` returns `Trade[]`, so the tape's
 * typing is unchanged, while the archive can merge its own row shape (M10).
 */
export function mergeTrades<T extends Mergeable>(perPool: T[][]): T[] {
  const byHash = new Map<string, T>();
  for (const list of perPool) {
    for (const trade of list) {
      const existing = byHash.get(trade.txHash);
      if (!existing || trade.usd > existing.usd) {
        byHash.set(trade.txHash, trade);
      }
    }
  }
  // Newest first; break ties by larger USD so the bigger deed reads first.
  return [...byHash.values()].sort((a, b) => b.ts - a.ts || b.usd - a.usd);
}

// ── Flow aggregation ─────────────────────────────────────────────────────────

/**
 * The fields flow aggregation actually reads. A structural subset of `Trade`, so
 * `Trade[]` still satisfies it — but the archive can aggregate its DB rows without
 * inventing display fields (poolLabel/quoteSymbol/whale) it does not store (M10).
 */
export type FlowInput = {
  ts: number;
  side: TradeSide;
  usd: number;
  wallet: string;
};

/**
 * Aggregate 24h buy/sell pressure, net flow, and unique traders from a merged,
 * already-deduped tape. `oldestTradeTs` is computed over the WHOLE tape (not just
 * the window) so the caller can tell whether the source window clipped 24h.
 *
 * NOTE (M10): when the caller has a durable archive it knows a coverage start that
 * predates anything in `trades`; `fullyCovered`/`oldestTradeTs` are then overridden
 * by the caller (see `lib/trades-archive.ts`) — this function only ever reports what
 * the rows it was handed can prove.
 */
export function aggregateFlow(
  trades: FlowInput[],
  nowMs: number = Date.now(),
  windowMs: number = FLOW_WINDOW_MS,
): FlowStats {
  const windowStart = nowMs - windowMs;

  let buyCount = 0;
  let sellCount = 0;
  let buyUsd = 0;
  let sellUsd = 0;
  let oldestTradeTs: number | null = null;
  const buyers = new Set<string>();
  const sellers = new Set<string>();
  const traders = new Set<string>();

  for (const t of trades) {
    if (oldestTradeTs === null || t.ts < oldestTradeTs) oldestTradeTs = t.ts;
    if (t.ts < windowStart) continue;
    if (t.wallet) traders.add(t.wallet);
    if (t.side === "buy") {
      buyCount += 1;
      buyUsd += t.usd;
      if (t.wallet) buyers.add(t.wallet);
    } else {
      sellCount += 1;
      sellUsd += t.usd;
      if (t.wallet) sellers.add(t.wallet);
    }
  }

  return {
    windowMs,
    windowStart,
    buyCount,
    sellCount,
    buyUsd,
    sellUsd,
    netUsd: buyUsd - sellUsd,
    totalUsd: buyUsd + sellUsd,
    uniqueBuyers: buyers.size,
    uniqueSellers: sellers.size,
    uniqueTraders: traders.size,
    oldestTradeTs,
    fullyCovered: oldestTradeTs !== null && oldestTradeTs <= windowStart,
  };
}
