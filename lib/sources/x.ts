/**
 * X (Twitter) API v2 source — IMPLEMENTATION_PLAN.md §5, feeds The Prophecy Feed
 * (§4 module 8, M6). This is the WRITE path: the ONLY place the paid X API is
 * touched, and only ever from the scheduled poller (`/api/cron/social`), never per
 * visitor. Visitors read our `x_posts` table via `lib/social.ts` — zero client X
 * calls (the milestone's headline cost guarantee).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENDPOINT VERIFICATION (plan §5/§9 mandate — done 2026-07-20 with the configured
 * bearer via curl; the plan says `xurl`, but a verified bearer answers the same
 * question. Real HTTP results recorded to test/fixtures/x-*.json):
 *
 *   OFFICIAL (works):
 *     1. GET /2/users/by/username/swizardcore?user.fields=…  → 200
 *        id 2040859395236474881 (pinned in config/token.ts `X.officialUserId` so the
 *        steady-state poll skips this bootstrap → 2 calls/run).
 *     2. GET /2/users/{id}/tweets?tweet.fields=public_metrics,created_at,attachments
 *          &expansions=attachments.media_keys,author_id
 *          &user.fields=profile_image_url,name,username
 *          &media.fields=preview_image_url,url,type&exclude=replies  → 200, 10 posts,
 *        includes.users + includes.media present. This is the Official tab.
 *
 *   COMMUNITY — three candidates tried, decision = C:
 *     A. GET /2/tweets/search/recent?query=community_id:2031864427176476866
 *        → HTTP 400: "Reference to invalid operator 'community_id'. Operator is not
 *        available in current product or product packaging." The search endpoint is
 *        reachable (structured 400, not a 403), but the community_id operator — the
 *        ONLY way to pull a community's real timeline — is gated above this tier.
 *        (test/fixtures/x-community-A-rejected.json)
 *     B. GET /2/communities/2031864427176476866
 *        → HTTP 200 {"id":…,"name":"Smoking $WIZARD"}. Returns community METADATA
 *        (name/id) but NO post timeline — cannot populate a feed on its own. We do
 *        reuse its name as `X.communityName`. (test/fixtures/x-community-lookup.json)
 *     C. GET /2/tweets/search/recent?query=("smoking wizard" OR $WIZARD) -is:retweet
 *        → HTTP 200, 20 posts. The $WIZARD cashtag + phrase operators ARE available.
 *        (test/fixtures/x-community-search.json)
 *
 *   DECISION → C. The Coven tab is a recent-search over `X.communityQuery`, which is
 *   an APPROXIMATION of community chatter ($WIZARD mentions across X), NOT the literal
 *   member feed (A would give that but is gated). The card labels it as such (X
 *   display + honesty). Config-driven, so if this account is ever upgraded to a tier
 *   with the community_id operator, swap the query in config/token.ts — no code change.
 *
 * COST (plan §5 "X cost control", the milestone DoD): steady state = exactly 2
 * endpoint calls per poll (official timeline + community search), each narrowed with
 * `since_id` so only new posts return. At the 30-min cadence that is 2 × 48 = 96
 * calls/day (plan's ≲100). The poller logs its per-run call count. Kill switch
 * `X_POLL_ENABLED=false` no-ops the poll (handled in the cron route).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * House style (copy helius.ts / rugcheck.ts, §5 "Implementation rules"):
 *   - zod-validate every response at the boundary (tolerant: X omits fields — no
 *     media, no metrics — on many posts, so extracted fields are optional/nullable);
 *   - PURE mappers (`mapTimeline`, `mapUserLookup`) so parsing is unit-tested against
 *     the recorded fixtures, no network;
 *   - an AbortController timeout per request so a slow upstream can't hang the poll;
 *   - the bearer token is SERVER-SIDE ONLY (`X_BEARER_TOKEN`) — never shipped to a
 *     client. Unlike the read-path sources there is no module cache here: the durable
 *     store is the `x_posts` table, and this is only ever called by the cron.
 */

import { z } from "zod";
import { X } from "@/config/token";
import type { NewXPost } from "@/db/schema";
import { kvGet, kvSet } from "@/lib/kv";

const API_BASE = "https://api.x.com/2";

/** Abort a slow request so a poll can never hang. */
const FETCH_TIMEOUT_MS = 12_000;
/** kv_cache key for the resolved official user id (bootstrap skip across cold starts). */
const KV_OFFICIAL_USER = "x:user:official";

export type XSource = "official" | "community";

/** Normalized media thumbnail stored in the `media` jsonb column. */
export type XMedia = {
  /** "photo" | "video" | "animated_gif". */
  type: string;
  /** pbs.twimg.com thumbnail: a photo's `url` or a video/gif's `preview_image_url`. */
  thumbUrl: string;
};

/** What the pure mapper produces from one raw response (no cost info). */
export type MappedTimeline = {
  /** Upsert-ready rows for `x_posts` (newest first, as X returns them). */
  posts: NewXPost[];
  /** meta.newest_id — the next run's `since_id` for this feed (null if none). */
  newestId: string | null;
  /** How many posts this poll returned. */
  resultCount: number;
};

/** What one poll of one feed returns — the mapped timeline plus its X API cost. */
export type PollResult = MappedTimeline & {
  /** X API calls this poll actually spent (for the DoD cost log). */
  callCount: number;
};

// ── Boundary validation (zod, tolerant) ─────────────────────────────────────

const publicMetrics = z
  .object({
    like_count: z.number().nullish(),
    retweet_count: z.number().nullish(),
    reply_count: z.number().nullish(),
    quote_count: z.number().nullish(),
    impression_count: z.number().nullish(),
    bookmark_count: z.number().nullish(),
  })
  .loose();

const tweet = z
  .object({
    id: z.string(),
    text: z.string().nullish(),
    author_id: z.string().nullish(),
    created_at: z.string().nullish(),
    public_metrics: publicMetrics.nullish(),
    attachments: z.object({ media_keys: z.array(z.string()).nullish() }).loose().nullish(),
  })
  .loose();

const includedUser = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    username: z.string().nullish(),
    profile_image_url: z.string().nullish(),
  })
  .loose();

const includedMedia = z
  .object({
    media_key: z.string(),
    type: z.string().nullish(),
    url: z.string().nullish(),
    preview_image_url: z.string().nullish(),
  })
  .loose();

const timelineResponse = z.object({
  data: z.array(tweet).nullish(),
  includes: z
    .object({
      users: z.array(includedUser).nullish(),
      media: z.array(includedMedia).nullish(),
    })
    .loose()
    .nullish(),
  meta: z
    .object({
      result_count: z.number().nullish(),
      newest_id: z.string().nullish(),
      oldest_id: z.string().nullish(),
    })
    .loose()
    .nullish(),
  // A search/timeline error comes back 200-shaped-ish or with an `errors` array;
  // real transport errors are thrown by `xGet` before we ever parse.
  errors: z.array(z.object({ message: z.string().nullish() }).loose()).nullish(),
});

const userLookupResponse = z.object({
  data: includedUser,
});

// ── Pure mappers (testable against test/fixtures/x-*.json) ───────────────────

/**
 * Twitter serves a 48px `_normal` avatar; swap to the 400px variant for a crisp
 * thumbnail. Pure string transform — safe when the URL shape is unexpected (no-op).
 */
function upgradeAvatar(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/_normal(\.[a-z]+)(\?.*)?$/i, "_400x400$1$2");
}

/** Build the canonical link back to the post on X (display-requirement: link back). */
function postUrl(handle: string | null, id: string): string {
  return handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`;
}

/**
 * Normalize a raw timeline/search response into upsert-ready `x_posts` rows. Pure:
 * no fetch, no clock beyond the injected `nowMs`, so every derived field is pinned
 * by the fixture tests. Joins each tweet to its author (includes.users) and media
 * (includes.media) by key. A post with an unknown author still maps (author fields
 * null) rather than being dropped.
 */
export function mapTimeline(raw: unknown, source: XSource, nowMs: number = Date.now()): MappedTimeline {
  const parsed = timelineResponse.parse(raw);
  const tweets = parsed.data ?? [];
  const usersById = new Map<string, z.infer<typeof includedUser>>();
  for (const u of parsed.includes?.users ?? []) usersById.set(u.id, u);
  const mediaByKey = new Map<string, z.infer<typeof includedMedia>>();
  for (const m of parsed.includes?.media ?? []) mediaByKey.set(m.media_key, m);

  const fetchedAt = new Date(nowMs);
  const posts: NewXPost[] = tweets.map((t) => {
    const author = t.author_id ? usersById.get(t.author_id) : undefined;
    const handle = author?.username ?? null;

    const media: XMedia[] = [];
    for (const key of t.attachments?.media_keys ?? []) {
      const m = mediaByKey.get(key);
      if (!m) continue;
      const thumbUrl = m.url ?? m.preview_image_url ?? null;
      if (thumbUrl) media.push({ type: m.type ?? "photo", thumbUrl });
    }

    const pm = t.public_metrics;
    const createdAt =
      t.created_at && Number.isFinite(Date.parse(t.created_at)) ? new Date(t.created_at) : null;

    return {
      id: t.id,
      source,
      authorHandle: handle,
      authorName: author?.name ?? null,
      authorAvatarUrl: upgradeAvatar(author?.profile_image_url),
      text: t.text ?? null,
      createdAt,
      likes: pm?.like_count ?? null,
      reposts: pm?.retweet_count ?? null,
      replies: pm?.reply_count ?? null,
      media: media.length ? media : null,
      url: postUrl(handle, t.id),
      fetchedAt,
    };
  });

  return {
    posts,
    newestId: parsed.meta?.newest_id ?? null,
    resultCount: parsed.meta?.result_count ?? posts.length,
  };
}

/** Normalize a users/by/username lookup into its numeric id. */
export function mapUserLookup(raw: unknown): { id: string; username: string | null } {
  const parsed = userLookupResponse.parse(raw);
  return { id: parsed.data.id, username: parsed.data.username ?? null };
}

// ── Fetch (server-side only) ─────────────────────────────────────────────────

function bearer(): string {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("X_BEARER_TOKEN is not set");
  return token;
}

/** GET an X API v2 endpoint with the bearer + timeout; throws with detail on error. */
async function xGet(path: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { authorization: `Bearer ${bearer()}`, accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`X ${path} HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Field sets reused by both feeds so Official and Coven posts map identically. */
const TWEET_FIELDS = "public_metrics,created_at,attachments,author_id";
const EXPANSIONS = "attachments.media_keys,author_id";
const USER_FIELDS = "profile_image_url,name,username";
const MEDIA_FIELDS = "preview_image_url,url,type";

/**
 * Resolve the official account's numeric user id. Prefers the pinned config value
 * (0 calls), else the durable kv cache (0 calls), else the username lookup (1 call)
 * whose result is written back to kv so it is a one-time bootstrap. Returns the id
 * and how many API calls it spent.
 */
export async function resolveOfficialUserId(): Promise<{ id: string; callCount: number }> {
  if (X.officialUserId) return { id: X.officialUserId, callCount: 0 };

  const cached = await kvGet<string>(KV_OFFICIAL_USER);
  if (cached?.value) return { id: cached.value, callCount: 0 };

  const raw = await xGet(`/users/by/username/${X.officialUsername}`, { "user.fields": USER_FIELDS });
  const { id } = mapUserLookup(raw);
  await kvSet(KV_OFFICIAL_USER, id);
  return { id, callCount: 1 };
}

/**
 * Poll the Official tab: the account's own posts since `sinceId` (replies excluded).
 * One API call. `sinceId` narrows the response to new posts only (cost control).
 */
export async function fetchOfficialPosts(sinceId?: string | null): Promise<PollResult> {
  const resolved = await resolveOfficialUserId();
  const params: Record<string, string> = {
    "tweet.fields": TWEET_FIELDS,
    expansions: EXPANSIONS,
    "user.fields": USER_FIELDS,
    "media.fields": MEDIA_FIELDS,
    exclude: "replies",
    max_results: "20",
  };
  if (sinceId) params.since_id = sinceId;

  const raw = await xGet(`/users/${resolved.id}/tweets`, params);
  const mapped = mapTimeline(raw, "official");
  return { ...mapped, callCount: resolved.callCount + 1 };
}

/**
 * Poll the Coven tab: recent-search over `X.communityQuery` since `sinceId`
 * (fallback C — see the decision log above). One API call. `search/recent` covers
 * only the last ~7 days; at the 30-min cadence `since_id` is always minutes old, so
 * the window is never a factor in normal operation (the cron resets a stale cursor).
 */
export async function fetchCommunityPosts(sinceId?: string | null): Promise<PollResult> {
  const params: Record<string, string> = {
    query: X.communityQuery,
    "tweet.fields": TWEET_FIELDS,
    expansions: EXPANSIONS,
    "user.fields": USER_FIELDS,
    "media.fields": MEDIA_FIELDS,
    max_results: "20",
  };
  if (sinceId) params.since_id = sinceId;

  const raw = await xGet(`/tweets/search/recent`, params);
  const mapped = mapTimeline(raw, "community");
  return { ...mapped, callCount: 1 };
}
