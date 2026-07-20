/**
 * GET /api/ohlcv?pool=&tf= — GeckoTerminal OHLCV candles for the Scrying Glass.
 *
 * Query params:
 *   - `pool` — Solana pool address (defaults to the configured main pool).
 *   - `tf`   — one of 1m|5m|15m|1h|4h|1d (defaults to 1h). Unknown values 400.
 *
 * The route stays dynamic; the 60s server cache, in-flight dedup, shared rate
 * budget, and stale-while-revalidate fallback all live in the source lib so
 * every consumer — this route and the server-rendered page seed — shares one
 * throttle and one last-good series per (pool, timeframe).
 *
 * Dev-only: `?fault=1` injects an upstream failure to prove the stale banner
 * renders last-good candles. It is ignored in production.
 */

import type { NextRequest } from "next/server";
import { TOKEN } from "@/config/token";
import { getOhlcv, isTimeframe, DEFAULT_TIMEFRAME } from "@/lib/sources/geckoterminal";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const pool = params.get("pool")?.trim() || TOKEN.mainPool;

  const tfParam = params.get("tf")?.trim() || DEFAULT_TIMEFRAME;
  if (!isTimeframe(tfParam)) {
    return Response.json(
      { ok: false, error: `Unknown timeframe "${tfParam}"` },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const fault =
    process.env.NODE_ENV !== "production" && params.get("fault") === "1";

  const result = await getOhlcv({
    pool,
    timeframe: tfParam,
    forceRefresh: fault,
    simulateFailure: fault,
  });

  return Response.json(result, {
    status: result.ok ? 200 : 503,
    headers: {
      // The client polls every 60s; the upstream throttle is server-side.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
