/**
 * GET /api/social?source=official|community — one feed of The Prophecy Feed
 * (IMPLEMENTATION_PLAN.md §4 module 8, §6). Reads the `x_posts` table ONLY (no X
 * API per visitor — the poller cron is the only X caller). The 60s cache + last-good
 * fallback live in `lib/social.ts` so the route and the SSR seed share one throttle.
 *
 * Returns 200 with data, or 200 with `data: null` when no posts have been recorded
 * yet (an honest empty state, not an error — the card handles it). `source` defaults
 * to "official"; anything else is rejected.
 */

import type { NextRequest } from "next/server";
import { getSocial } from "@/lib/social";
import type { XSource } from "@/lib/sources/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSource(value: string | null): XSource | null {
  if (value === "official" || value === "community") return value;
  if (value == null) return "official"; // default feed
  return null;
}

export async function GET(request: NextRequest) {
  const source = parseSource(request.nextUrl.searchParams.get("source"));
  if (!source) {
    return Response.json(
      { ok: false, error: "source must be 'official' or 'community'" },
      { status: 400 },
    );
  }
  const result = await getSocial(source);
  return Response.json(result, {
    // The client polls every 60s; a fresh post lands within one poll cycle (≤4h:
    // the shared cron ticks every 15 min, the route floors paid X polls at 4h).
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
