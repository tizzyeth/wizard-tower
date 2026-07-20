/**
 * DexScreener source — IMPLEMENTATION_PLAN.md §5.
 *
 *   GET https://api.dexscreener.com/latest/dex/tokens/{mint}
 *
 * Responsibilities (one lib per provider, per §5 "Implementation rules"):
 *   - zod-validate every response at the boundary;
 *   - aggregate the raw pairs into the numbers the Ledger + Cauldrons cards need;
 *   - respect the provider limit (300 req/min) via a 30s server-side cache;
 *   - stale-while-revalidate: on any upstream failure, serve the last good data
 *     with a `dataAsOf` timestamp and a `stale` flag — never blank a card.
 *
 * No API key required. All fetching is server-side only.
 *
 * NOTE (for M4): the cache below is module-level in-memory. Within a warm server
 * process it dedupes requests and preserves last-good data across upstream blips.
 * In a cold serverless invocation it starts empty (first request re-fetches);
 * durable cross-cold-start persistence is the `kv_cache` table introduced in M4.
 */

import { z } from "zod";
import { TOKEN } from "@/config/token";
import { fmtAge } from "@/lib/format";

const ENDPOINT = "https://api.dexscreener.com/latest/dex/tokens";

/** Serve a cached snapshot without re-fetching if it is younger than this. */
const CACHE_TTL_MS = 30_000;
/** Abort a slow upstream so it can never hang an SSR render. */
const FETCH_TIMEOUT_MS = 4_500;
/** Active-pool threshold (§4): a pool counts only above this liquidity. */
const ACTIVE_LIQUIDITY_USD = 100;

// ── Boundary validation (zod) ───────────────────────────────────────────────
// DexScreener returns prices as strings and omits fields on thin pools, so every
// extracted field is optional/nullable and numeric strings are coerced safely.

const numeric = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

const tokenRef = z.object({
  address: z.string(),
  name: z.string().nullish(),
  symbol: z.string().nullish(),
});

const pairSchema = z.object({
  chainId: z.string().nullish(),
  dexId: z.string().nullish(),
  url: z.string().nullish(),
  pairAddress: z.string(),
  baseToken: tokenRef,
  quoteToken: tokenRef,
  priceNative: numeric,
  priceUsd: numeric,
  liquidity: z.object({ usd: numeric, base: numeric, quote: numeric }).nullish(),
  volume: z.object({ h24: numeric, h6: numeric, h1: numeric, m5: numeric }).nullish(),
  txns: z
    .object({
      h24: z.object({ buys: numeric, sells: numeric }).nullish(),
      h6: z.object({ buys: numeric, sells: numeric }).nullish(),
      h1: z.object({ buys: numeric, sells: numeric }).nullish(),
      m5: z.object({ buys: numeric, sells: numeric }).nullish(),
    })
    .nullish(),
  priceChange: z.object({ h24: numeric, h6: numeric, h1: numeric, m5: numeric }).nullish(),
  fdv: numeric,
  marketCap: numeric,
  pairCreatedAt: numeric,
});

const responseSchema = z.object({
  // schemaVersion is informational; pairs may be null when nothing is indexed yet.
  schemaVersion: z.string().nullish(),
  pairs: z.array(pairSchema).nullish(),
});

type RawPair = z.infer<typeof pairSchema>;

// ── Public, serializable shapes (safe to pass server → client) ──────────────

export type PoolRow = {
  pairAddress: string;
  dexId: string;
  dexLabel: string;
  baseSymbol: string;
  quoteSymbol: string;
  url: string | null;
  liquidityUsd: number;
  liquidityShare: number; // 0..1 of total active liquidity (for the magnitude bar)
  volumeH24: number;
  txnsH24: number;
  priceUsd: number;
  spreadPct: number; // vs the primary pool
  isPrimary: boolean;
};

export type MarketData = {
  priceUsd: number;
  priceNative: number;
  quoteSymbol: string; // quote of the primary pool, e.g. "SOL"
  priceChange: { h1: number | null; h6: number | null; h24: number | null };
  marketCap: number | null;
  fdv: number | null;
  totalLiquidityUsd: number;
  volumeH24Usd: number;
  liqToMcap: number | null;
  activePoolCount: number;
  pools: PoolRow[];
  primaryPairAddress: string;
  primaryDexLabel: string;
  launchedAt: number | null; // earliest pairCreatedAt (ms)
  tokenAge: string; // pre-formatted, server-computed to avoid hydration drift
  supply: number;
};

export type MarketResult = {
  /** True when we have data to show (fresh or last-good). */
  ok: boolean;
  /** True when serving last-good data after a failed refresh. */
  stale: boolean;
  /** When the served data was fetched from upstream (ms). */
  dataAsOf: number | null;
  data: MarketData | null;
  /** Human reason, present on stale/error for logs and the banner sub-text. */
  error?: string;
};

// ── Aggregation (pure — testable against test/fixtures/dexscreener-market.json) ─

const DEX_LABELS: Record<string, string> = {
  pumpswap: "PumpSwap",
  meteora: "Meteora",
  raydium: "Raydium",
  orca: "Orca",
  raydiumclmm: "Raydium CLMM",
};

function dexLabel(dexId: string | null | undefined): string {
  if (!dexId) return "Unknown";
  return DEX_LABELS[dexId.toLowerCase()] ?? dexId.charAt(0).toUpperCase() + dexId.slice(1);
}

/**
 * Turn the raw DexScreener response into the numbers our cards show.
 *
 * Rules (§4): aggregate only over pairs where WIZARD is the BASE token (one dust
 * pair lists WIZARD as the quote — it must not inflate totals); an "active pool"
 * is one with liquidity.usd > $100. Price/mcap/fdv/change come from the primary
 * pool: the configured main pool if it is active, else the deepest-liquidity pool.
 */
export function aggregateMarket(raw: unknown, nowMs: number = Date.now()): MarketData {
  const parsed = responseSchema.parse(raw);
  const pairs: RawPair[] = parsed.pairs ?? [];

  const base = pairs.filter((p) => p.baseToken.address === TOKEN.mint);
  const active = base
    .filter((p) => (p.liquidity?.usd ?? 0) > ACTIVE_LIQUIDITY_USD)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

  if (active.length === 0) {
    throw new Error("DexScreener returned no active WIZARD pools");
  }

  const primary =
    active.find((p) => p.pairAddress === TOKEN.mainPool) ?? active[0];

  const primaryPrice = primary.priceUsd ?? 0;
  if (!(primaryPrice > 0)) {
    throw new Error("DexScreener primary pool is missing a USD price");
  }

  const totalLiquidityUsd = active.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0);
  const volumeH24Usd = active.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0);

  const pools: PoolRow[] = active.map((p) => {
    const liq = p.liquidity?.usd ?? 0;
    const price = p.priceUsd ?? 0;
    const buys = p.txns?.h24?.buys ?? 0;
    const sells = p.txns?.h24?.sells ?? 0;
    return {
      pairAddress: p.pairAddress,
      dexId: p.dexId ?? "unknown",
      dexLabel: dexLabel(p.dexId),
      baseSymbol: p.baseToken.symbol ?? TOKEN.symbol,
      quoteSymbol: p.quoteToken.symbol ?? "?",
      url: p.url ?? null,
      liquidityUsd: liq,
      liquidityShare: totalLiquidityUsd > 0 ? liq / totalLiquidityUsd : 0,
      volumeH24: p.volume?.h24 ?? 0,
      txnsH24: buys + sells,
      priceUsd: price,
      spreadPct: price > 0 ? ((price - primaryPrice) / primaryPrice) * 100 : 0,
      isPrimary: p.pairAddress === primary.pairAddress,
    };
  });

  const launchTimes = base
    .map((p) => p.pairCreatedAt)
    .filter((t): t is number => t != null && Number.isFinite(t));
  const launchedAt = launchTimes.length ? Math.min(...launchTimes) : null;

  const marketCap = primary.marketCap ?? null;

  return {
    priceUsd: primaryPrice,
    priceNative: primary.priceNative ?? 0,
    quoteSymbol: primary.quoteToken.symbol ?? "SOL",
    priceChange: {
      h1: primary.priceChange?.h1 ?? null,
      h6: primary.priceChange?.h6 ?? null,
      h24: primary.priceChange?.h24 ?? null,
    },
    marketCap,
    fdv: primary.fdv ?? null,
    totalLiquidityUsd,
    volumeH24Usd,
    liqToMcap: marketCap && marketCap > 0 ? totalLiquidityUsd / marketCap : null,
    activePoolCount: active.length,
    pools,
    primaryPairAddress: primary.pairAddress,
    primaryDexLabel: dexLabel(primary.dexId),
    launchedAt,
    // Pre-formatted server-side (deterministic) so the client never re-derives
    // token age from Date.now() and risks a hydration mismatch.
    tokenAge: launchedAt == null ? "—" : fmtAge(launchedAt, nowMs),
    supply: TOKEN.supply,
  };
}

// ── Fetch + cache + stale-while-revalidate ──────────────────────────────────

type CacheEntry = { data: MarketData; fetchedAt: number };
let cache: CacheEntry | null = null;
let inFlight: Promise<MarketData> | null = null;

async function fetchAndAggregate(simulateFailure: boolean): Promise<MarketData> {
  if (simulateFailure) {
    // Dev-only fault injection (see the route handler) to exercise the stale path.
    throw new Error("Simulated DexScreener outage (fault injection)");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}/${TOKEN.mint}`, {
      // We do our own 30s caching + last-good fallback, so bypass Next's data
      // cache for a deterministic, testable freshness window.
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
    const json = await res.json();
    return aggregateMarket(json);
  } finally {
    clearTimeout(timeout);
  }
}

type GetMarketOptions = {
  /** Bypass the fresh-cache short-circuit and force an upstream attempt. */
  forceRefresh?: boolean;
  /** Dev-only: make the upstream attempt fail to prove the stale banner. */
  simulateFailure?: boolean;
};

/**
 * The one entry point cards + the API route call. Returns fresh data, or the
 * last-good snapshot flagged `stale`, or an honest error (never throws for a
 * routine upstream failure).
 */
export async function getMarket(options: GetMarketOptions = {}): Promise<MarketResult> {
  const { forceRefresh = false, simulateFailure = false } = options;
  const now = Date.now();

  if (!forceRefresh && !simulateFailure && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, stale: false, dataAsOf: cache.fetchedAt, data: cache.data };
  }

  // The dev fault path (forced/simulated) always runs standalone so it can never
  // share or poison the deduped promise of a concurrent real refresh.
  const standalone = forceRefresh || simulateFailure;

  try {
    let data: MarketData;
    if (standalone) {
      data = await fetchAndAggregate(simulateFailure);
    } else {
      // Dedupe concurrent refreshes into a single upstream call.
      if (!inFlight) inFlight = fetchAndAggregate(false);
      data = await inFlight;
    }
    cache = { data, fetchedAt: Date.now() };
    return { ok: true, stale: false, dataAsOf: cache.fetchedAt, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (cache) {
      // Serve last-good, flagged stale — the crystal ball is cloudy, not dark.
      return { ok: true, stale: true, dataAsOf: cache.fetchedAt, data: cache.data, error: message };
    }
    return { ok: false, stale: true, dataAsOf: null, data: null, error: message };
  } finally {
    if (!standalone) inFlight = null;
  }
}

/** Test/inspection hook — reset the module cache between fault-injection checks. */
export function __clearMarketCache(): void {
  cache = null;
  inFlight = null;
}
