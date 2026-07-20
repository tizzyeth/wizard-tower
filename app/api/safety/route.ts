/**
 * GET /api/safety — the RugCheck-derived safety report for Wards & Protections.
 *
 * The route stays dynamic (GET handlers are dynamic by default in Next 16); the
 * 1h server cache and stale-while-revalidate fallback live in the source lib so
 * every consumer — this route and the server-rendered page seed — shares one
 * throttle and one last-good report. The pass/warn/fail evaluation happens in the
 * card (it also needs the market's token age), so this route returns the raw
 * normalized report.
 *
 * Dev-only: `?fault=1` injects an upstream failure to prove the stale banner
 * renders the last-good report. It is ignored in production.
 */

import type { NextRequest } from "next/server";
import { getSafety } from "@/lib/sources/rugcheck";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const fault =
    process.env.NODE_ENV !== "production" &&
    request.nextUrl.searchParams.get("fault") === "1";

  const result = await getSafety(
    fault ? { simulateFailure: true, forceRefresh: true } : undefined,
  );

  return Response.json(result, {
    status: result.ok ? 200 : 503,
    headers: {
      // The client polls every 10min; the 1h upstream throttle is server-side.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
