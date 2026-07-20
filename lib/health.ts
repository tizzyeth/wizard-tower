/**
 * Feed freshness — the app-side half of cron monitoring.
 *
 * The GitHub Actions workflows tell us when a run FAILS (see
 * .github/workflows/cron-failure-issue.yml). They cannot tell us about the worse,
 * quieter failure: a run that exits 0 while writing nothing. `X_POLL_ENABLED=false`
 * left on, a 200 that upserted zero rows, a schedule GitHub auto-disabled after 60
 * days of repo inactivity so no run happens at all — in every one of those cases
 * Actions is green and the data is dead. The only witness is the data itself, so
 * this module asks the one question a workflow cannot: how old is the newest row?
 *
 * Shape follows the house pattern (lib/holders.ts, lib/social.ts): a PURE core that
 * is unit-tested with an injected clock, wrapped by a small cached DB reader.
 *
 * Two deliberate departures from the read-path libs:
 *   1. NO last-good fallback. Serving a cached "everything is fine" after the DB
 *      stopped answering is precisely the lie this module exists to prevent. A read
 *      failure degrades to `unknown`, never to `ok`.
 *   2. `unknown` is a first-class status, distinct from `down`. We report what we
 *      can prove. No database (WIZARD_DISABLE_DB=1, the e2e gate) or an empty table
 *      means we genuinely cannot judge freshness — that is not evidence of an
 *      outage, and rendering an alarm for it would be crying wolf.
 *
 * Reads DB only, two `max()` queries. Never throws, never touches a third-party API.
 */

import { sql } from "drizzle-orm";
import { getDb, dbAvailable } from "@/db";
import { holderSnapshots, xPosts } from "@/db/schema";
import { THRESHOLDS } from "@/config/token";

const HOUR_MS = 3_600_000;
/** Health is a cheap read, but the header renders it on every page load. */
const CACHE_TTL_MS = 30_000;

/**
 * `ok` fresh · `degraded` past warn · `down` past fail · `unknown` not judgeable
 * (no database, or no rows ever recorded).
 */
export type FeedStatus = "ok" | "degraded" | "down" | "unknown";

export type FeedKey = "holderSnapshots" | "xPosts";

/** The warn/fail band for one feed, in hours (config/token.ts → THRESHOLDS.freshness). */
export type FreshnessBand = { warnHours: number; failHours: number };

export type FeedHealth = {
  key: FeedKey;
  /** Human label used in the UI sentence and the issue body. */
  label: string;
  status: FeedStatus;
  /** Newest write we can see (ms), or null when there is nothing to measure. */
  lastWriteAt: number | null;
  ageMs: number | null;
  /** Age in hours, rounded to 1dp — the number the UI prints. */
  ageHours: number | null;
  warnAfterHours: number;
  failAfterHours: number;
  /** What this feed's clock actually measures + why it is in this state. */
  detail: string;
};

export type HealthReport = {
  /** Worst status across judgeable feeds; `unknown` when none can be judged. */
  status: FeedStatus;
  checkedAt: number;
  /** False when there is no database to read (no DATABASE_URL, or WIZARD_DISABLE_DB=1). */
  dbAvailable: boolean;
  feeds: FeedHealth[];
  /** One-line operator summary. */
  note: string;
  /** Present only when the freshness read itself failed. */
  error?: string;
};

const LABELS: Record<FeedKey, string> = {
  holderSnapshots: "holder snapshots",
  xPosts: "the prophecy feed",
};

/**
 * What each feed's timestamp really means. Spelled out because the two are NOT
 * equivalent, and conflating them is how a monitor earns a reputation for lying:
 * a snapshot row is written every run, an x_posts row only when a new post exists.
 */
const CLOCK_MEANING: Record<FeedKey, string> = {
  holderSnapshots: "newest holder_snapshots.ts — written every successful hourly census",
  xPosts:
    "newest x_posts.fetched_at — advances only when the poller actually stores a post, " +
    "so it reads community quiet as well as poller failure",
};

/** Severity order for the roll-up. `unknown` is absent: it is not a severity. */
const RANK: Record<Exclude<FeedStatus, "unknown">, number> = { ok: 0, degraded: 1, down: 2 };

/**
 * PURE: age → status. The whole judgement, in one place, with an injected age so it
 * is testable without a clock or a database.
 *
 * Boundaries are STRICTLY greater-than: an age of exactly `warnHours` is still ok.
 * Thresholds read as "stale after N hours", so N itself has not yet gone stale.
 */
export function classifyAge(
  ageMs: number | null,
  band: FreshnessBand,
): FeedStatus {
  if (ageMs == null || !Number.isFinite(ageMs)) return "unknown";
  const hours = ageMs / HOUR_MS;
  if (hours > band.failHours) return "down";
  if (hours > band.warnHours) return "degraded";
  return "ok";
}

/**
 * PURE: one feed's full health from its newest write time. `lastWriteAt` of null
 * (nothing recorded yet, or no database) yields `unknown` — never `down`, because
 * "we have never written a row" and "we stopped writing rows" are different facts
 * and only the second one is an outage.
 *
 * A write timestamp in the future (clock skew between Neon and the runtime) is
 * clamped to age 0 rather than reported as a negative age.
 */
export function evaluateFeed(
  key: FeedKey,
  lastWriteAt: number | null,
  band: FreshnessBand,
  nowMs: number = Date.now(),
): FeedHealth {
  const valid = lastWriteAt != null && Number.isFinite(lastWriteAt);
  const ageMs = valid ? Math.max(0, nowMs - lastWriteAt) : null;
  const status = classifyAge(ageMs, band);
  const ageHours = ageMs == null ? null : Math.round((ageMs / HOUR_MS) * 10) / 10;

  const detail =
    status === "unknown"
      ? `no rows recorded yet — ${CLOCK_MEANING[key]}`
      : `${ageHours}h old (warn > ${band.warnHours}h, fail > ${band.failHours}h) — ${CLOCK_MEANING[key]}`;

  return {
    key,
    label: LABELS[key],
    status,
    lastWriteAt: valid ? lastWriteAt : null,
    ageMs,
    ageHours,
    warnAfterHours: band.warnHours,
    failAfterHours: band.failHours,
    detail,
  };
}

/**
 * PURE: worst status across the feeds. `unknown` feeds are SKIPPED rather than
 * counted as healthy or as failing — one judgeable feed that is down still makes
 * the whole report down, and a report where nothing is judgeable is `unknown`.
 */
export function rollUp(feeds: FeedHealth[]): FeedStatus {
  const judgeable = feeds.filter(
    (f): f is FeedHealth & { status: Exclude<FeedStatus, "unknown"> } => f.status !== "unknown",
  );
  if (judgeable.length === 0) return "unknown";
  return judgeable.reduce<Exclude<FeedStatus, "unknown">>(
    (worst, f) => (RANK[f.status] > RANK[worst] ? f.status : worst),
    "ok",
  );
}

/** PURE: the one-line operator summary that rides along with the report. */
export function summarize(status: FeedStatus, feeds: FeedHealth[]): string {
  if (status === "unknown") return "freshness not judgeable — no database or no rows recorded yet";
  if (status === "ok") return "all feeds fresh";
  const named = feeds
    .filter((f) => f.status === "degraded" || f.status === "down")
    .map((f) => `${f.label} ${f.ageHours}h old`)
    .join("; ");
  return status === "down" ? `feed down — ${named}` : `feed stale — ${named}`;
}

/**
 * PURE: assemble a report from already-read timestamps. Split out from the DB read
 * so every branch of the report shape is unit-testable with plain numbers.
 */
export function buildReport(
  input: {
    holderSnapshotsAt: number | null;
    xPostsAt: number | null;
    dbAvailable: boolean;
    error?: string;
  },
  nowMs: number = Date.now(),
): HealthReport {
  const feeds = [
    evaluateFeed("holderSnapshots", input.holderSnapshotsAt, THRESHOLDS.freshness.holderSnapshots, nowMs),
    evaluateFeed("xPosts", input.xPostsAt, THRESHOLDS.freshness.xPosts, nowMs),
  ];
  const status = rollUp(feeds);
  return {
    status,
    checkedAt: nowMs,
    dbAvailable: input.dbAvailable,
    feeds,
    note: input.error
      ? "freshness unreadable — the database did not answer"
      : summarize(status, feeds),
    ...(input.error ? { error: input.error } : {}),
  };
}

function toMs(v: Date | string | number | null | undefined): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

type CacheEntry = { report: HealthReport; fetchedAt: number };
let cache: CacheEntry | null = null;
let inFlight: Promise<HealthReport> | null = null;

async function read(nowMs: number): Promise<HealthReport> {
  if (!dbAvailable()) {
    return buildReport({ holderSnapshotsAt: null, xPostsAt: null, dbAvailable: false }, nowMs);
  }
  const db = getDb();
  if (!db) {
    return buildReport({ holderSnapshotsAt: null, xPostsAt: null, dbAvailable: false }, nowMs);
  }
  try {
    // Two scalar aggregates. holder_snapshots.ts is indexed; x_posts is a capped
    // buffer, so both are trivial — this route must stay cheap enough to poll.
    const [snapRow, postRow] = await Promise.all([
      db.select({ newest: sql<string | null>`max(${holderSnapshots.ts})` }).from(holderSnapshots),
      db.select({ newest: sql<string | null>`max(${xPosts.fetchedAt})` }).from(xPosts),
    ]);
    return buildReport(
      {
        holderSnapshotsAt: toMs(snapRow[0]?.newest ?? null),
        xPostsAt: toMs(postRow[0]?.newest ?? null),
        dbAvailable: true,
      },
      nowMs,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    // Unreadable ≠ stale. Report `unknown` and say why; do NOT fall back to a
    // cached healthy reading, and do NOT claim the feeds are down.
    return buildReport(
      { holderSnapshotsAt: null, xPostsAt: null, dbAvailable: true, error: message },
      nowMs,
    );
  }
}

/**
 * The one entry point for GET /api/health and the header's live dot. 30s cache,
 * de-duplicated in flight. Never throws and never blocks a render on a failure —
 * a dead database yields an `unknown` report, not an exception.
 */
export async function getHealth(): Promise<HealthReport> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.report;
  try {
    if (!inFlight) inFlight = read(now);
    const report = await inFlight;
    cache = { report, fetchedAt: Date.now() };
    return report;
  } catch (err) {
    // Defence in depth: `read` already catches, so this is unreachable in practice.
    const message = err instanceof Error ? err.message : "unknown error";
    return buildReport(
      { holderSnapshotsAt: null, xPostsAt: null, dbAvailable: dbAvailable(), error: message },
      now,
    );
  } finally {
    inFlight = null;
  }
}

/** Test/inspection hook — reset the module cache. */
export function __clearHealthCache(): void {
  cache = null;
  inFlight = null;
}
