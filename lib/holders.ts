/**
 * Holders read path — IMPLEMENTATION_PLAN.md §4 (Council of Holders) + §6.
 *
 * Reads the `holder_snapshots` table (written hourly by the snapshot cron) and
 * assembles what the card needs: the latest census, Δ7d / Δ30d deltas (null-safe
 * while history is short — the banner shows the first recorded date, plan §9), the
 * holder-count series for the area chart, top-N concentration, HHI, USD buckets,
 * and the top-20 table. Reads DB only — no upstream, no Helius per visitor.
 *
 * Same result envelope as the other sources: a small in-memory 60s cache + last-good
 * fallback so a transient DB blip serves the previous read flagged `stale` rather
 * than blanking the card. When there is no database (e2e) or no snapshot yet, it
 * returns `data: null` and the card renders its honest "not yet convened" state.
 */

import { desc, asc, lte, count } from "drizzle-orm";
import { getDb } from "@/db";
import { holderSnapshots } from "@/db/schema";
import type { HolderBucket, TopHolderRow } from "@/lib/metrics/concentration";

const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 60_000;
/** Cap the area-chart series (hourly snapshots → ~30 days of points). */
const SERIES_LIMIT = 720;

export type HolderChartPoint = { t: number; holders: number };

export type HoldersData = {
  /** Snapshot time of the latest census (ms). */
  ts: number;
  /** Gross distinct-owner holder count (matches Solscan). */
  totalHolders: number;
  /** Real holders (pools/lockers/burn excluded) = Σ bucket counts, or null. */
  countedHolders: number | null;
  /** Excluded (pool/locker/burn) accounts among the holder set. */
  excludedCount: number | null;
  /** First snapshot time (ms) — the "recorded since" banner (history not retroactive). */
  recordedSince: number;
  snapshotCount: number;
  /** Change in holder count vs the snapshot ~7d / ~30d ago; null when too young. */
  delta7d: number | null;
  delta30d: number | null;
  /** Top-N shares of supply, %, pools/lockers/burn excluded (§6). */
  top10Pct: number | null;
  top20Pct: number | null;
  top50Pct: number | null;
  /** Full-holder-set HHI, Σ(pct²), 0–10000. */
  hhi: number | null;
  buckets: HolderBucket[];
  topHolders: TopHolderRow[];
  /** Holder count over time for the area chart (ascending by time). */
  series: HolderChartPoint[];
};

export type HoldersResult = {
  ok: boolean;
  stale: boolean;
  dataAsOf: number | null;
  data: HoldersData | null;
  error?: string;
};

type CacheEntry = { data: HoldersData; fetchedAt: number };
let cache: CacheEntry | null = null;
let inFlight: Promise<HoldersData | null> | null = null;

function toMs(v: Date | string | number | null): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

async function readLatest(): Promise<HoldersData | null> {
  const db = getDb();
  if (!db) return null;

  const [latest] = await db
    .select()
    .from(holderSnapshots)
    .orderBy(desc(holderSnapshots.ts))
    .limit(1);
  if (!latest) return null;

  const now = Date.now();
  const [first] = await db
    .select({ ts: holderSnapshots.ts })
    .from(holderSnapshots)
    .orderBy(asc(holderSnapshots.ts))
    .limit(1);
  const [{ n: snapshotCount }] = await db
    .select({ n: count() })
    .from(holderSnapshots);

  const deltaAt = async (msAgo: number): Promise<number | null> => {
    const [row] = await db
      .select({ total: holderSnapshots.totalHolders })
      .from(holderSnapshots)
      .where(lte(holderSnapshots.ts, new Date(now - msAgo)))
      .orderBy(desc(holderSnapshots.ts))
      .limit(1);
    return row ? latest.totalHolders - row.total : null;
  };
  const [delta7d, delta30d] = await Promise.all([
    deltaAt(7 * DAY_MS),
    deltaAt(30 * DAY_MS),
  ]);

  const seriesRows = await db
    .select({ ts: holderSnapshots.ts, holders: holderSnapshots.totalHolders })
    .from(holderSnapshots)
    .orderBy(desc(holderSnapshots.ts))
    .limit(SERIES_LIMIT);
  const series: HolderChartPoint[] = seriesRows
    .map((r) => ({ t: toMs(r.ts), holders: r.holders }))
    .reverse();

  const buckets = (latest.buckets ?? []) as HolderBucket[];
  const countedHolders = buckets.length
    ? buckets.reduce((s, b) => s + (b.count ?? 0), 0)
    : null;
  const excludedCount =
    countedHolders != null ? Math.max(0, latest.totalHolders - countedHolders) : null;

  return {
    ts: toMs(latest.ts),
    totalHolders: latest.totalHolders,
    countedHolders,
    excludedCount,
    recordedSince: toMs(first?.ts ?? latest.ts),
    snapshotCount,
    delta7d,
    delta30d,
    top10Pct: latest.top10Pct ?? null,
    top20Pct: latest.top20Pct ?? null,
    top50Pct: latest.top50Pct ?? null,
    hhi: latest.hhi ?? null,
    buckets,
    topHolders: (latest.topHolders ?? []) as TopHolderRow[],
    series,
  };
}

/**
 * The one entry point the card seed + the /api/holders route call. 60s cache with
 * a last-good fallback. `data` is null when there is no database or no snapshot yet
 * — the card renders its honest empty state, never blank.
 */
export async function getHolders(): Promise<HoldersResult> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, stale: false, dataAsOf: cache.fetchedAt, data: cache.data };
  }
  try {
    if (!inFlight) inFlight = readLatest();
    const data = await inFlight;
    if (!data) {
      // No snapshot yet (or no database). Not an error — an honest empty state.
      return {
        ok: false,
        stale: false,
        dataAsOf: null,
        data: null,
        error: "no snapshot recorded yet",
      };
    }
    cache = { data, fetchedAt: Date.now() };
    return { ok: true, stale: false, dataAsOf: cache.fetchedAt, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (cache) {
      return { ok: true, stale: true, dataAsOf: cache.fetchedAt, data: cache.data, error: message };
    }
    return { ok: false, stale: true, dataAsOf: null, data: null, error: message };
  } finally {
    inFlight = null;
  }
}

/** Test/inspection hook — reset the module cache. */
export function __clearHoldersCache(): void {
  cache = null;
  inFlight = null;
}
