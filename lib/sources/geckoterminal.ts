/**
 * GeckoTerminal OHLCV source — IMPLEMENTATION_PLAN.md §5.
 *
 *   GET https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}
 *       /ohlcv/{day|hour|minute}?aggregate=&limit=&currency=usd
 *   → attributes.ohlcv_list: [[ts, open, high, low, close, volume], …]
 *
 * Same house style as `lib/sources/dexscreener.ts` (one lib per provider, §5
 * "Implementation rules"):
 *   - zod-validate the response at the boundary;
 *   - a PURE mapper (`mapOhlcv`) so it is testable against saved fixtures
 *     (test/fixtures/geckoterminal-ohlcv-hour.json);
 *   - a 60s server cache keyed by (pool, timeframe) with in-flight dedup;
 *   - stale-while-revalidate: on any upstream failure serve the last good series
 *     flagged `stale` with a `dataAsOf` timestamp — never blank the chart;
 *   - every call passes through the SHARED GeckoTerminal token budget
 *     (`acquireGeckoToken`) so OHLCV, the M3 trade tape, and pool discovery all
 *     draw from one ~30 req/min ceiling.
 *
 * No API key required. All fetching is server-side only.
 *
 * Two real quirks of this thin-liquidity token, handled in `mapOhlcv`:
 *   1. `ohlcv_list` arrives NEWEST-first — lightweight-charts needs ascending
 *      time, so we sort.
 *   2. GeckoTerminal can emit DUPLICATE timestamps (and sparse, non-contiguous
 *      buckets) for illiquid pools — lightweight-charts throws on duplicate or
 *      out-of-order times, so we dedupe by timestamp.
 */

import { z } from "zod";
import { TOKEN } from "@/config/token";
import { acquireGeckoToken } from "./geckoLimiter";

const BASE = "https://api.geckoterminal.com/api/v2/networks/solana/pools";

/** Serve a cached series without re-fetching if it is younger than this (§5: 60s). */
const CACHE_TTL_MS = 60_000;
/** Abort a slow upstream so it can never hang an SSR render. */
const FETCH_TIMEOUT_MS = 6_000;

// ── Timeframes (§7 mapping) ─────────────────────────────────────────────────
// 1m/5m/15m → minute aggregate 1/5/15 · 1h/4h → hour aggregate 1/4 · 1d → day 1.

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const DEFAULT_TIMEFRAME: Timeframe = "1h";

type TfSpec = { path: "minute" | "hour" | "day"; aggregate: number; limit: number };

const TF_MAP: Record<Timeframe, TfSpec> = {
  "1m": { path: "minute", aggregate: 1, limit: 300 },
  "5m": { path: "minute", aggregate: 5, limit: 288 },
  "15m": { path: "minute", aggregate: 15, limit: 240 },
  "1h": { path: "hour", aggregate: 1, limit: 240 },
  "4h": { path: "hour", aggregate: 4, limit: 180 },
  "1d": { path: "day", aggregate: 1, limit: 180 },
};

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && (TIMEFRAMES as readonly string[]).includes(value);
}

// ── Boundary validation (zod) ───────────────────────────────────────────────

const tokenMeta = z
  .object({ name: z.string().nullish(), symbol: z.string().nullish() })
  .nullish();

const responseSchema = z.object({
  data: z.object({
    // Each row is [ts, o, h, l, c, v]; keep the array loose here and validate
    // shape/finiteness in the mapper so one bad row can't reject the batch.
    attributes: z.object({ ohlcv_list: z.array(z.array(z.number())).nullish() }),
  }),
  meta: z.object({ base: tokenMeta, quote: tokenMeta }).nullish(),
});

// ── Public, serializable shapes (safe to pass server → client) ──────────────

/** One candle. `time` is a unix timestamp in SECONDS (lightweight-charts UTC). */
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume in USD (currency=usd). Independent of the price⇄mcap toggle. */
  volume: number;
};

export type OhlcvData = {
  pool: string;
  timeframe: Timeframe;
  baseSymbol: string;
  quoteSymbol: string;
  candles: Candle[];
};

export type OhlcvResult = {
  /** True when we have a series to show (fresh or last-good). */
  ok: boolean;
  /** True when serving last-good data after a failed refresh. */
  stale: boolean;
  /** When the served series was fetched from upstream (ms). */
  dataAsOf: number | null;
  data: OhlcvData | null;
  /** Echoed so the client can confirm which series it received. */
  pool: string;
  timeframe: Timeframe;
  /** Human reason, present on stale/error for logs and the banner sub-text. */
  error?: string;
};

// ── Aggregation (pure — testable against the saved fixture) ─────────────────

/**
 * Turn a raw GeckoTerminal OHLCV response into ascending, de-duplicated candles.
 * Drops rows that are malformed or carry a non-positive price (degenerate
 * candles GeckoTerminal occasionally emits for empty buckets).
 */
export function mapOhlcv(
  raw: unknown,
  ctx: { pool: string; timeframe: Timeframe },
): OhlcvData {
  const parsed = responseSchema.parse(raw);
  const rows = parsed.data.attributes.ohlcv_list ?? [];

  // Keyed by timestamp to dedupe. Rows arrive newest-first; the first row we see
  // for a timestamp is the most complete candle, so we keep it and ignore later
  // duplicates of the same bucket.
  const byTime = new Map<number, Candle>();
  for (const row of rows) {
    if (row.length < 6) continue;
    const [time, open, high, low, close, volume] = row;
    if (![time, open, high, low, close, volume].every(Number.isFinite)) continue;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;
    if (byTime.has(time)) continue;
    byTime.set(time, {
      time,
      open,
      high,
      low,
      close,
      volume: volume < 0 ? 0 : volume,
    });
  }

  const candles = [...byTime.values()].sort((a, b) => a.time - b.time);

  return {
    pool: ctx.pool,
    timeframe: ctx.timeframe,
    baseSymbol: parsed.meta?.base?.symbol ?? TOKEN.symbol,
    quoteSymbol: parsed.meta?.quote?.symbol ?? "SOL",
    candles,
  };
}

// ── Fetch + cache + stale-while-revalidate (per pool+timeframe) ─────────────

type CacheEntry = { data: OhlcvData; fetchedAt: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<OhlcvData>>();

const keyOf = (pool: string, tf: Timeframe) => `${pool}:${tf}`;

async function fetchAndMap(
  pool: string,
  tf: Timeframe,
  simulateFailure: boolean,
): Promise<OhlcvData> {
  if (simulateFailure) {
    // Dev-only fault injection (see the route handler) to exercise the stale path.
    throw new Error("Simulated GeckoTerminal outage (fault injection)");
  }

  const { path, aggregate, limit } = TF_MAP[tf];
  // Draw from the shared GeckoTerminal budget before touching the network.
  await acquireGeckoToken();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url =
      `${BASE}/${encodeURIComponent(pool)}/ohlcv/${path}` +
      `?aggregate=${aggregate}&limit=${limit}&currency=usd`;
    const res = await fetch(url, {
      // We own the freshness window (60s cache) + last-good fallback, so bypass
      // Next's data cache for deterministic, testable behavior.
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
    const json = await res.json();
    return mapOhlcv(json, { pool, timeframe: tf });
  } finally {
    clearTimeout(timeout);
  }
}

export type GetOhlcvOptions = {
  pool: string;
  timeframe: Timeframe;
  /** Bypass the fresh-cache short-circuit and force an upstream attempt. */
  forceRefresh?: boolean;
  /** Dev-only: make the upstream attempt fail to prove the stale banner. */
  simulateFailure?: boolean;
};

/**
 * The one entry point the card + the API route call. Returns a fresh series, the
 * last-good series flagged `stale`, or an honest error (never throws for a
 * routine upstream failure). Cache + dedup are keyed per (pool, timeframe).
 */
export async function getOhlcv(options: GetOhlcvOptions): Promise<OhlcvResult> {
  const { pool, timeframe, forceRefresh = false, simulateFailure = false } = options;
  const key = keyOf(pool, timeframe);
  const now = Date.now();
  const cached = cache.get(key);

  if (!forceRefresh && !simulateFailure && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      ok: true,
      stale: false,
      dataAsOf: cached.fetchedAt,
      data: cached.data,
      pool,
      timeframe,
    };
  }

  // The dev fault path (forced/simulated) runs standalone so it can never share
  // or poison the deduped promise of a concurrent real refresh.
  const standalone = forceRefresh || simulateFailure;

  try {
    let data: OhlcvData;
    if (standalone) {
      data = await fetchAndMap(pool, timeframe, simulateFailure);
    } else {
      let flight = inFlight.get(key);
      if (!flight) {
        flight = fetchAndMap(pool, timeframe, false);
        inFlight.set(key, flight);
      }
      data = await flight;
    }
    const entry: CacheEntry = { data, fetchedAt: Date.now() };
    cache.set(key, entry);
    return { ok: true, stale: false, dataAsOf: entry.fetchedAt, data, pool, timeframe };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (cached) {
      // Serve last-good, flagged stale — the crystal ball is cloudy, not dark.
      return {
        ok: true,
        stale: true,
        dataAsOf: cached.fetchedAt,
        data: cached.data,
        pool,
        timeframe,
        error: message,
      };
    }
    return { ok: false, stale: true, dataAsOf: null, data: null, pool, timeframe, error: message };
  } finally {
    if (!standalone) inFlight.delete(key);
  }
}

/** Test/inspection hook — reset the module cache between fault-injection checks. */
export function __clearOhlcvCache(): void {
  cache.clear();
  inFlight.clear();
}
