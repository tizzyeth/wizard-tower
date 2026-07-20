/**
 * GET /api/holders — the latest holder census for the Council of Holders card
 * (IMPLEMENTATION_PLAN.md §4, §6). Reads the `holder_snapshots` table only (no
 * upstream, no Helius per visitor): latest snapshot + Δ7d/Δ30d + top-20 + buckets
 * + the holder-count series. The 60s cache + last-good fallback live in the source
 * lib (`lib/holders.ts`) so the route and the SSR seed share one throttle.
 *
 * Returns 200 with data, or 200 with `data: null` when no snapshot has been
 * recorded yet (an honest empty state, not an error — the card handles it).
 */

import { getHolders } from "@/lib/holders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getHolders();
  return Response.json(result, {
    // The client polls every 60s; a fresh snapshot lands hourly.
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
