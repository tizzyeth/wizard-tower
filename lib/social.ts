/**
 * Prophecy Feed read path — IMPLEMENTATION_PLAN.md §4 (module 8) + §6.
 *
 * Reads the `x_posts` table (filled by the social poller cron) and hands the card
 * the newest posts for one feed. Reads DB ONLY — no upstream, no X API per visitor
 * (the milestone's headline guarantee: zero client-side X calls). Same envelope as
 * the other read-path sources (holders.ts): a small per-source 60s cache + last-good
 * fallback so a transient DB blip serves the previous read flagged `stale` rather
 * than blanking the card. `data` is null when there is no database (e2e) or no posts
 * yet — the card renders its in-character "the prophecies are silent" empty state.
 */

import { desc, eq, count } from "drizzle-orm";
import { getDb } from "@/db";
import { xPosts } from "@/db/schema";
import { postingCadencePerWeek } from "@/lib/metrics/cadence";
import type { XSource, XMedia } from "@/lib/sources/x";

/** Posts served per feed — a capped window, not the whole buffer. */
const FEED_LIMIT = 30;
const CACHE_TTL_MS = 60_000;
/** Cadence window (days) + a bound on the timestamp scan behind it. */
const CADENCE_WINDOW_DAYS = 28;
const CADENCE_SCAN_LIMIT = 5000;
const DAY_MS = 86_400_000;

/** One post, shaped for the client (serializable; ms timestamps, never Date). */
export type SocialPost = {
  id: string;
  source: XSource;
  authorHandle: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  text: string | null;
  createdAt: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  media: XMedia[];
  url: string | null;
};

export type SocialData = {
  source: XSource;
  posts: SocialPost[];
  /** When the newest shown post was fetched by the poller (ms) — the freshness clock. */
  lastFetchedAt: number | null;
};

export type SocialResult = {
  ok: boolean;
  stale: boolean;
  dataAsOf: number | null;
  data: SocialData | null;
  error?: string;
};

type CacheEntry = { data: SocialData; fetchedAt: number };
const cache: Partial<Record<XSource, CacheEntry>> = {};
const inFlight: Partial<Record<XSource, Promise<SocialData | null>>> = {};

function toMs(v: Date | string | number | null): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

async function readFeed(source: XSource): Promise<SocialData | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(xPosts)
    .where(eq(xPosts.source, source))
    .orderBy(desc(xPosts.createdAt))
    .limit(FEED_LIMIT);
  if (rows.length === 0) return null;

  const posts: SocialPost[] = rows.map((r) => ({
    id: r.id,
    source: r.source as XSource,
    authorHandle: r.authorHandle,
    authorName: r.authorName,
    authorAvatarUrl: r.authorAvatarUrl,
    text: r.text,
    createdAt: toMs(r.createdAt),
    likes: r.likes,
    reposts: r.reposts,
    replies: r.replies,
    media: (r.media as XMedia[] | null) ?? [],
    url: r.url,
  }));

  const lastFetchedAt = rows.reduce<number | null>((max, r) => {
    const t = toMs(r.fetchedAt);
    return t != null && (max == null || t > max) ? t : max;
  }, null);

  return { source, posts, lastFetchedAt };
}

/**
 * The one entry point the card seed + the /api/social route call, per feed. 60s
 * cache with a last-good fallback. `data` is null when there is no database or no
 * posts recorded yet (an honest empty state — never blank).
 */
export async function getSocial(source: XSource): Promise<SocialResult> {
  const now = Date.now();
  const cached = cache[source];
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, stale: false, dataAsOf: cached.fetchedAt, data: cached.data };
  }
  try {
    if (!inFlight[source]) inFlight[source] = readFeed(source);
    const data = await inFlight[source];
    if (!data) {
      return { ok: false, stale: false, dataAsOf: null, data: null, error: "no posts recorded yet" };
    }
    cache[source] = { data, fetchedAt: Date.now() };
    return { ok: true, stale: false, dataAsOf: cache[source]!.fetchedAt, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (cached) {
      return { ok: true, stale: true, dataAsOf: cached.fetchedAt, data: cached.data, error: message };
    }
    return { ok: false, stale: true, dataAsOf: null, data: null, error: message };
  } finally {
    inFlight[source] = undefined;
  }
}

export type PostingCadence = {
  /** Posts per week over the trailing window, across BOTH feeds. Null = no history. */
  perWeek: number | null;
  windowDays: number;
  /** Posts counted in the window (context for the card/note). */
  postsInWindow: number;
};

/**
 * Posting cadence across BOTH feeds for the Verdict's Community axis (M6 hookup).
 * Reads DB only, computed by the pure `postingCadencePerWeek`. Bounds the scan to
 * the most recent rows — enough to cover the window and to detect an empty buffer.
 */
export async function getPostingCadence(nowMs: number = Date.now()): Promise<PostingCadence> {
  const db = getDb();
  if (!db) return { perWeek: null, windowDays: CADENCE_WINDOW_DAYS, postsInWindow: 0 };
  try {
    const rows = await db
      .select({ createdAt: xPosts.createdAt })
      .from(xPosts)
      .orderBy(desc(xPosts.createdAt))
      .limit(CADENCE_SCAN_LIMIT);
    const timestamps = rows.map((r) => toMs(r.createdAt));
    const perWeek = postingCadencePerWeek(timestamps, nowMs, CADENCE_WINDOW_DAYS);
    const cutoff = nowMs - CADENCE_WINDOW_DAYS * DAY_MS;
    const postsInWindow = timestamps.filter((t) => t != null && t >= cutoff).length;
    return { perWeek, windowDays: CADENCE_WINDOW_DAYS, postsInWindow };
  } catch {
    return { perWeek: null, windowDays: CADENCE_WINDOW_DAYS, postsInWindow: 0 };
  }
}

/** Total posts recorded per source — used by the cron log + diagnostics. */
export async function countPosts(): Promise<Record<XSource, number>> {
  const db = getDb();
  const zero = { official: 0, community: 0 } as Record<XSource, number>;
  if (!db) return zero;
  try {
    const rows = await db
      .select({ source: xPosts.source, n: count() })
      .from(xPosts)
      .groupBy(xPosts.source);
    const out = { ...zero };
    for (const r of rows) if (r.source === "official" || r.source === "community") out[r.source] = r.n;
    return out;
  } catch {
    return zero;
  }
}

/** Test/inspection hook — reset the per-source module cache. */
export function __clearSocialCache(): void {
  cache.official = undefined;
  cache.community = undefined;
  inFlight.official = undefined;
  inFlight.community = undefined;
}
