/**
 * GeckoTerminal trades source — IMPLEMENTATION_PLAN.md §5 (feeds the M3 cards).
 *
 *   GET https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/trades
 *   → data[].attributes: block_timestamp, kind, tx_hash, tx_from_address,
 *     from/to_token_address, from/to_token_amount, price_*_in_usd, volume_in_usd
 *   (a WINDOW, not a history: ≤300 trades AND ≤24h old — see UPSTREAM_WINDOW)
 *
 * Same house style as `lib/sources/geckoterminal.ts` (one lib per provider, §5
 * "Implementation rules"):
 *   - zod-validate at the boundary;
 *   - a PURE mapper (`mapPoolTrades`) normalizing raw legs into WIZARD-perspective
 *     `Trade`s, testable against test/fixtures/geckoterminal-trades-*.json;
 *   - a 30s server cache PER POOL with in-flight dedup;
 *   - stale-while-revalidate: on an upstream failure serve that pool's last-good
 *     trades flagged stale — one flaky pool never blanks the merged tape;
 *   - every fetch passes through the SHARED GeckoTerminal budget
 *     (`acquireGeckoToken`) — NO second limiter. Budget (§ context): 3 active
 *     pools × trades every 30s = 6/min, alongside OHLCV traffic, under ~25/min.
 *
 * The merge/dedupe/flow-aggregation is intentionally NOT here — it lives as pure
 * functions in `lib/metrics/merge-trades.ts` (§6). This module fetches per pool
 * and composes those functions in `getTrades`.
 *
 * No API key required. All fetching is server-side only.
 */

import { z } from "zod";
import { TOKEN, THRESHOLDS } from "@/config/token";
import type { MarketResult } from "@/lib/sources/dexscreener";
import {
  aggregateFlow,
  mergeTrades,
  type FlowStats,
  type Trade,
  type TradeSide,
} from "@/lib/metrics/merge-trades";
import { acquireGeckoToken } from "./geckoLimiter";

export type { Trade, TradeSide, FlowStats } from "@/lib/metrics/merge-trades";

const BASE = "https://api.geckoterminal.com/api/v2/networks/solana/pools";

/** Serve cached per-pool trades without re-fetching if younger than this (§5: 30s). */
const CACHE_TTL_MS = 30_000;
/** Abort a slow upstream so it can never hang an SSR render. */
const FETCH_TIMEOUT_MS = 6_000;
/**
 * Cap the tape payload. The merged set is already bounded by what upstream serves
 * (see UPSTREAM_WINDOW below), but the rendered tape needs far less than that.
 * The archive cron opts out of the cap via `cap: Infinity` (M10).
 */
const RENDER_CAP = 120;

/**
 * What one `/trades` call can actually return, per pool: at most 300 trades AND
 * only from the past 24 hours — whichever binds first. Measured 2026-07-20: a busy
 * reference pool returned exactly 300 spanning 22 minutes (count-bound), while the
 * WIZARD main pool returned 168 spanning exactly 24.0h (time-bound).
 *
 * This corrects the earlier "last ~100 trades" note in this file: 100 was an
 * observation of WIZARD's volume at the time, not the endpoint's limit. Both bounds
 * matter to the M10 archive cron — it must run often enough that no pool can
 * produce 300 trades between runs, and it can never recover a gap older than 24h.
 */
export const UPSTREAM_WINDOW = { maxTrades: 300, maxAgeMs: 86_400_000 } as const;

// ── Boundary validation (zod) ───────────────────────────────────────────────
// Amounts and prices arrive as strings; coerce safely and validate finiteness in
// the mapper so one malformed leg can't reject the whole batch.

const numeric = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

const tradeAttributes = z.object({
  block_timestamp: z.string(),
  kind: z.string().nullish(),
  tx_hash: z.string(),
  tx_from_address: z.string().nullish(),
  from_token_address: z.string(),
  to_token_address: z.string(),
  from_token_amount: numeric,
  to_token_amount: numeric,
  price_from_in_usd: numeric,
  price_to_in_usd: numeric,
  volume_in_usd: numeric,
});

const responseSchema = z.object({
  data: z.array(z.object({ attributes: tradeAttributes })).nullish(),
});

// ── Pure mapper (per pool) — testable against the recorded fixtures ─────────

/** A pool to pull trades from, with the labels a `Trade` should carry. */
export type PoolInput = {
  /** Pool (pair) address. */
  pool: string;
  /** DEX label for the badge, e.g. "PumpSwap". */
  poolLabel: string;
  /** Non-WIZARD side of the pool, e.g. "SOL" / "USDC". */
  quoteSymbol: string;
};

/**
 * Normalize one pool's raw trades response into WIZARD-perspective `Trade`s.
 *
 * Side is derived from WIZARD's position in the swap, NOT GeckoTerminal `kind`
 * (which is relative to each pool's base token and flips for WIZARD-as-quote
 * pools): WIZARD received (`to`) is a BUY, WIZARD spent (`from`) is a SELL. Legs
 * where WIZARD is on neither side, or that carry a non-finite USD value / missing
 * timestamp, are dropped.
 */
export function mapPoolTrades(raw: unknown, ctx: PoolInput): Trade[] {
  const parsed = responseSchema.parse(raw);
  const rows = parsed.data ?? [];
  const out: Trade[] = [];

  for (const { attributes: a } of rows) {
    const wizardIsTo = a.to_token_address === TOKEN.mint;
    const wizardIsFrom = a.from_token_address === TOKEN.mint;
    if (!wizardIsTo && !wizardIsFrom) continue; // pool leg not involving WIZARD

    const ts = Date.parse(a.block_timestamp);
    if (!Number.isFinite(ts)) continue;

    const usd = a.volume_in_usd;
    if (usd == null || usd < 0) continue;

    const side: TradeSide = wizardIsTo ? "buy" : "sell";
    const wizardAmount = (wizardIsTo ? a.to_token_amount : a.from_token_amount) ?? 0;
    const priceUsd = (wizardIsTo ? a.price_to_in_usd : a.price_from_in_usd) ?? 0;

    out.push({
      txHash: a.tx_hash,
      ts,
      side,
      wizardAmount,
      usd,
      priceUsd,
      wallet: a.tx_from_address ?? "",
      pool: ctx.pool,
      poolLabel: ctx.poolLabel,
      quoteSymbol: ctx.quoteSymbol,
      whale: usd >= THRESHOLDS.whaleUsd,
    });
  }

  return out;
}

/** Map DexScreener's active pools into the trade-source's pool inputs (§4 reuse). */
export function activePoolsFromMarket(market: MarketResult | null | undefined): PoolInput[] {
  const pools = market?.data?.pools ?? [];
  return pools.map((p) => ({
    pool: p.pairAddress,
    poolLabel: p.dexLabel,
    quoteSymbol: p.quoteSymbol,
  }));
}

/** Last-resort pool when market discovery is unavailable at cold start. */
const FALLBACK_POOL: PoolInput = {
  pool: TOKEN.mainPool,
  poolLabel: "PumpSwap",
  quoteSymbol: "SOL",
};

// ── Per-pool fetch + cache + stale-while-revalidate ─────────────────────────

type PoolCacheEntry = { trades: Trade[]; fetchedAt: number };
const cache = new Map<string, PoolCacheEntry>();
const inFlight = new Map<string, Promise<Trade[]>>();

async function fetchPoolTrades(input: PoolInput, simulateFailure: boolean): Promise<Trade[]> {
  if (simulateFailure) {
    // Dev-only fault injection (see the route handler) to exercise the stale path.
    throw new Error("Simulated GeckoTerminal outage (fault injection)");
  }

  await acquireGeckoToken(); // shared budget — before every GeckoTerminal fetch

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${BASE}/${encodeURIComponent(input.pool)}/trades`;
    const res = await fetch(url, {
      // We own the freshness window (30s) + last-good fallback, so bypass Next's
      // data cache for deterministic, testable behavior.
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
    const json = await res.json();
    return mapPoolTrades(json, input);
  } finally {
    clearTimeout(timeout);
  }
}

type PoolResult = { trades: Trade[]; fetchedAt: number | null; stale: boolean; failed: boolean };

/** Fetch one pool's trades honoring the 30s cache, dedup, and last-good fallback. */
async function getPoolTrades(
  input: PoolInput,
  opts: { forceRefresh: boolean; simulateFailure: boolean },
): Promise<PoolResult> {
  const key = input.pool;
  const now = Date.now();
  const cached = cache.get(key);

  if (!opts.forceRefresh && !opts.simulateFailure && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { trades: cached.trades, fetchedAt: cached.fetchedAt, stale: false, failed: false };
  }

  const standalone = opts.forceRefresh || opts.simulateFailure;

  try {
    let trades: Trade[];
    if (standalone) {
      trades = await fetchPoolTrades(input, opts.simulateFailure);
    } else {
      let flight = inFlight.get(key);
      if (!flight) {
        flight = fetchPoolTrades(input, false);
        inFlight.set(key, flight);
      }
      trades = await flight;
    }
    const entry: PoolCacheEntry = { trades, fetchedAt: Date.now() };
    cache.set(key, entry);
    return { trades, fetchedAt: entry.fetchedAt, stale: false, failed: false };
  } catch {
    if (cached) {
      // Serve this pool's last-good trades, flagged stale — degrade, don't blank.
      return { trades: cached.trades, fetchedAt: cached.fetchedAt, stale: true, failed: true };
    }
    return { trades: [], fetchedAt: null, stale: false, failed: true };
  } finally {
    if (!standalone) inFlight.delete(key);
  }
}

// ── Public merged result ─────────────────────────────────────────────────────

export type TradesResult = {
  /** True when we have a tape to show (fresh, last-good, or an honest empty one). */
  ok: boolean;
  /** True when any served pool fell back to last-good data. */
  stale: boolean;
  /** Newest successful upstream fetch across pools (ms). */
  dataAsOf: number | null;
  /** Merged, deduped, newest-first tape, capped for payload size. */
  trades: Trade[];
  /** Merged count before the render cap. */
  totalMerged: number;
  /** 24h buy/sell pressure over the full merged tape (pre-cap). */
  flow: FlowStats | null;
  /** Active pools included — drives the tape's pool filter. */
  pools: PoolInput[];
  /** Pools whose refresh failed this cycle (served last-good or skipped). */
  poolsFailed: string[];
  /** Human reason, present on stale/error for logs and the banner sub-text. */
  error?: string;

  // ── Archive overlay (M10) — populated by `lib/trades-archive.ts`, never here.
  // Optional so this source stays DB-free and so an older cached/fixture payload
  // (e2e) simply reads as "no archive", falling back to the window's own honesty.
  /**
   * Where `flow` was computed from. "window" = the ≤300-trade/≤24h upstream window
   * (counts are a floor → the UI says "approximate"). "archive" = our own durable
   * trade table, which covers the full 24h → the counts are an actual census.
   */
  flowSource?: "window" | "archive";
  /** Oldest trade the archive holds (ms) — the "recorded since" date. */
  archiveSince?: number | null;
  /** Total rows in the archive — context for the coverage note. */
  archiveRows?: number;
};

export type GetTradesOptions = {
  pools: PoolInput[];
  forceRefresh?: boolean;
  simulateFailure?: boolean;
  /** Injectable clock for deterministic flow windows in tests. */
  nowMs?: number;
  /**
   * Max trades to return in `trades`. Defaults to the render cap; the archive cron
   * passes `Infinity` because it must persist every merged swap, not just the
   * newest page of them (M10).
   */
  cap?: number;
};

/**
 * The one entry point the card seed + the API route call. Fetches every active
 * pool (in parallel, each throttled by the shared budget), merges + dedupes by
 * tx_hash, and aggregates 24h flow — returning a fresh tape, a last-good tape
 * flagged stale, or an honest empty tape. Never throws for a routine failure.
 */
export async function getTrades(options: GetTradesOptions): Promise<TradesResult> {
  const {
    forceRefresh = false,
    simulateFailure = false,
    nowMs = Date.now(),
    cap = RENDER_CAP,
  } = options;
  const pools = options.pools.length > 0 ? options.pools : [FALLBACK_POOL];

  const settled = await Promise.all(
    pools.map((p) => getPoolTrades(p, { forceRefresh, simulateFailure })),
  );

  const perPool: Trade[][] = [];
  const poolsFailed: string[] = [];
  let anyStale = false;
  let anyData = false;
  let dataAsOf: number | null = null;

  settled.forEach((res, i) => {
    perPool.push(res.trades);
    if (res.failed) poolsFailed.push(pools[i].pool);
    if (res.stale) anyStale = true;
    if (res.fetchedAt != null) {
      anyData = true;
      dataAsOf = dataAsOf == null ? res.fetchedAt : Math.max(dataAsOf, res.fetchedAt);
    }
  });

  const merged = mergeTrades(perPool);
  const flow = aggregateFlow(merged, nowMs);

  // Hard failure only when NO pool yielded any data at all (cold start + every
  // pool down); otherwise a quiet-but-reachable tape is ok:true with 0 trades.
  const ok = anyData;

  return {
    ok,
    stale: anyStale || (!ok && poolsFailed.length > 0),
    dataAsOf,
    trades: Number.isFinite(cap) ? merged.slice(0, cap) : merged,
    totalMerged: merged.length,
    flow,
    pools,
    poolsFailed,
    error: poolsFailed.length
      ? `${poolsFailed.length} pool(s) unreachable`
      : undefined,
  };
}

/** Test/inspection hook — reset the per-pool cache between fault-injection checks. */
export function __clearTradesCache(): void {
  cache.clear();
  inFlight.clear();
}
