/**
 * GET /api/market — aggregated DexScreener snapshot for the Ledger + Cauldrons.
 *
 * The route stays dynamic (GET handlers are dynamic by default in Next 16); the
 * 30s server cache and stale-while-revalidate fallback live in the source lib so
 * every consumer — this route and the server-rendered page — shares one throttle
 * and one last-good snapshot.
 *
 * Dev-only: `?fault=1` injects an upstream failure to prove the stale banner
 * renders last-good data. It is ignored in production.
 */

import type { NextRequest } from "next/server";
import { getMarket } from "@/lib/sources/dexscreener";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const fault =
    process.env.NODE_ENV !== "production" &&
    request.nextUrl.searchParams.get("fault") === "1";

  const result = await getMarket(
    fault ? { simulateFailure: true, forceRefresh: true } : undefined,
  );

  return Response.json(result, {
    status: result.ok ? 200 : 503,
    headers: {
      // The client polls every 30s; the upstream throttle is server-side.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
