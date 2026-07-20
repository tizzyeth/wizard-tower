/**
 * GET /api/trades — the unified WIZARD trade tape + 24h flow (M3).
 *
 * Active pools are discovered from the DexScreener aggregate (`getMarket`, 30s
 * cached) so the tape always tracks the same active pool set the rest of the
 * dashboard uses — no hardcoded pool list. The 30s per-pool cache, shared rate
 * budget, tx_hash dedupe, and stale-while-revalidate all live in the source lib.
 *
 * M10: the response is composed by `getTradesWithArchive`, so the 24h `flow` this
 * route returns is archive-backed (an actual census) whenever our `trades` table
 * covers the full window, and the window-derived approximation otherwise. Because
 * the swap happens here, the cards' 30s poll gets the better data automatically.
 *
 * Dev-only: `?fault=1` injects an upstream failure to prove the stale banner
 * renders the last-good tape. It is ignored in production.
 */

import type { NextRequest } from "next/server";
import { getMarket } from "@/lib/sources/dexscreener";
import { activePoolsFromMarket } from "@/lib/sources/gecko-trades";
import { getTradesWithArchive } from "@/lib/trades-archive";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const fault =
    process.env.NODE_ENV !== "production" &&
    request.nextUrl.searchParams.get("fault") === "1";

  // Discover active pools. Under fault injection we still want a pool list so the
  // trades source can serve its own last-good tape, so market failure is tolerated.
  const market = await getMarket();
  const pools = activePoolsFromMarket(market);

  // M10: the archive layer replaces `flow` with a real 24h census once our own
  // `trades` table covers the whole window; until then the live window's own
  // approximate flow stands. The tape itself is unchanged either way.
  const result = await getTradesWithArchive({
    pools,
    forceRefresh: fault,
    simulateFailure: fault,
  });

  return Response.json(result, {
    status: result.ok ? 200 : 503,
    headers: {
      // The client polls every 30s; the upstream throttle is server-side.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
