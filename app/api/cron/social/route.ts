/**
 * POST /api/cron/social — the scheduled X poller for The Prophecy Feed
 * (IMPLEMENTATION_PLAN.md §5/§6, M6). The ONE place the paid X API is called.
 *
 * Gated by `Authorization: Bearer ${CRON_SECRET}` (same secret as the snapshot
 * cron) so only .github/workflows/social.yml can trigger it. Flow:
 *   1. respect the kill switch `X_POLL_ENABLED` — `false` no-ops with a logged skip;
 *   2. read each feed's `since_id` cursor from kv_cache (durable across cold starts);
 *   3. poll Official (users/{id}/tweets) + Coven (search/recent) — 2 calls/run
 *      steady-state, each narrowed by `since_id` so only new posts return;
 *   4. UPSERT into x_posts (insert on conflict do update — refreshes engagement
 *      metrics on posts we already have);
 *   5. advance each cursor to meta.newest_id;
 *   6. LOG the per-run call count + upserted row count (the DoD's "cost logged").
 *
 * Cost: 2 calls/run × 48 runs/day at the 30-min cadence = ~96 calls/day (plan's
 * ≲100). Node runtime + force-dynamic; a modest maxDuration (two quick GETs).
 */

import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, dbAvailable } from "@/db";
import { xPosts } from "@/db/schema";
import type { NewXPost } from "@/db/schema";
import { fetchOfficialPosts, fetchCommunityPosts, type PollResult, type XSource } from "@/lib/sources/x";
import { kvGet, kvSet } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sinceKey = (source: XSource) => `x:since_id:${source}`;

/** kv_cache key holding the epoch-ms of the last poll that actually spent X API calls. */
const LAST_POLL_KEY = "x:last_poll_at";

/**
 * Floor between paid polls — 4 hours, set to this token's actual posting rate
 * (~10 posts/week across both feeds, i.e. roughly one per 17h). Polling faster
 * than the community posts buys nothing but X API spend. See the call site.
 *
 * Raise it back if activity picks up: this is the ONE number to change, and the
 * cost scales exactly inversely (2 calls per poll).
 */
const MIN_POLL_INTERVAL_MS = 4 * 60 * 60_000;

function unauthorized() {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

/**
 * Batch upsert posts by id. On conflict we refresh the mutable fields — engagement
 * metrics climb over a post's life, and the author's avatar/name can change — while
 * created_at + url stay fixed. Returns the number of rows written.
 */
async function upsertPosts(db: NonNullable<ReturnType<typeof getDb>>, posts: NewXPost[]): Promise<number> {
  if (posts.length === 0) return 0;
  await db
    .insert(xPosts)
    .values(posts)
    .onConflictDoUpdate({
      target: xPosts.id,
      set: {
        authorHandle: sql`excluded.author_handle`,
        authorName: sql`excluded.author_name`,
        authorAvatarUrl: sql`excluded.author_avatar_url`,
        text: sql`excluded.text`,
        likes: sql`excluded.likes`,
        reposts: sql`excluded.reposts`,
        replies: sql`excluded.replies`,
        media: sql`excluded.media`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
  return posts.length;
}

type FeedOutcome = {
  source: XSource;
  ok: boolean;
  calls: number;
  fetched: number;
  upserted: number;
  newestId: string | null;
  error?: string;
};

async function pollFeed(
  db: NonNullable<ReturnType<typeof getDb>>,
  source: XSource,
  run: (sinceId: string | null) => Promise<PollResult>,
): Promise<FeedOutcome> {
  const sinceId = (await kvGet<string>(sinceKey(source)))?.value ?? null;
  try {
    const res = await run(sinceId);
    const upserted = await upsertPosts(db, res.posts);
    // Advance the cursor only when the poll succeeded and returned a newer high-water
    // mark (an empty poll leaves newest_id null — keep the existing cursor).
    if (res.newestId) await kvSet(sinceKey(source), res.newestId);
    return { source, ok: true, calls: res.callCount, fetched: res.resultCount, upserted, newestId: res.newestId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    // A 400 usually means the cursor fell outside search/recent's ~7-day window
    // (only reachable if the poller was down for a week). Reset it so the next run
    // recovers with a fresh, cursor-less poll — no manual intervention.
    if (sinceId && /HTTP 400/.test(message)) await kvSet(sinceKey(source), "");
    console.error(`[cron/social] ${source} poll failed:`, message);
    // One call was still attempted upstream — count it so the cost log is honest.
    return { source, ok: false, calls: 1, fetched: 0, upserted: 0, newestId: null, error: message };
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return unauthorized();

  // Kill switch (plan §5): X_POLL_ENABLED=false → no upstream calls at all.
  if (process.env.X_POLL_ENABLED === "false") {
    console.log("[cron/social] skipped — X_POLL_ENABLED=false (0 calls)");
    return Response.json({ ok: true, skipped: true, reason: "X_POLL_ENABLED=false", calls: 0 });
  }
  if (!process.env.X_BEARER_TOKEN) {
    return Response.json({ ok: false, error: "X_BEARER_TOKEN not configured" }, { status: 500 });
  }
  if (!dbAvailable()) {
    return Response.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "database unavailable" }, { status: 503 });

  // X is the one PAID upstream in this stack, billed per call. The shared data
  // cron fires every 15 minutes because the trade archive needs that cadence —
  // but the poller must not ride along, so the route enforces its own floor,
  // exactly like /api/cron/snapshot does: the schedule serves the strictest
  // consumer, and each route declares what it actually needs.
  //
  // The floor is set by the COMMUNITY's posting rate, not by what feels fresh:
  // at ~10 posts/week there is nothing new to fetch most of the time, and an
  // empty poll still costs 2 calls. At 4h that is 12 calls/day, versus 192 if
  // the poller followed the 15-minute schedule — a 16x saving for a feed whose
  // newest item is typically hours old anyway. `?force=1` overrides for manual
  // runs. (Product owner's call, 2026-07-25: "раз в 4 часа с текущей
  // активностью… вернем чаще, если активность поднимется.")
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force) {
    const last = (await kvGet<number>(LAST_POLL_KEY))?.value ?? null;
    const sinceLast = typeof last === "number" ? Date.now() - last : null;
    if (sinceLast !== null && sinceLast < MIN_POLL_INTERVAL_MS) {
      const ageMin = Math.round(sinceLast / 60_000);
      console.log(
        `[cron/social] skipped — polled ${ageMin}m ago (min interval ${
          MIN_POLL_INTERVAL_MS / 60_000
        }m, 0 calls). Pass ?force=1 to override.`,
      );
      return Response.json({
        ok: true,
        skipped: true,
        reason: "polled recently",
        calls: 0,
        lastPollMinutesAgo: ageMin,
        minIntervalMinutes: MIN_POLL_INTERVAL_MS / 60_000,
      });
    }
  }

  const startedAt = Date.now();
  // Stamp before polling: a run that dies mid-flight has still spent its calls,
  // and must not invite an immediate retry that spends them again.
  await kvSet(LAST_POLL_KEY, startedAt);
  // Poll both feeds independently — one failing must not sink the other.
  const [official, community] = await Promise.all([
    pollFeed(db, "official", fetchOfficialPosts),
    pollFeed(db, "community", fetchCommunityPosts),
  ]);

  const calls = official.calls + community.calls;
  const upserted = official.upserted + community.upserted;
  const elapsedMs = Date.now() - startedAt;

  // The DoD cost line: per-run X API call count + rows upserted.
  console.log(
    `[cron/social] done calls=${calls} upserted=${upserted} ` +
      `official=${official.upserted}/${official.fetched} community=${community.upserted}/${community.fetched} ` +
      `elapsedMs=${elapsedMs}`,
  );

  const anyOk = official.ok || community.ok;
  return Response.json(
    { ok: anyOk, calls, upserted, elapsedMs, feeds: { official, community } },
    { status: anyOk ? 200 : 502 },
  );
}
