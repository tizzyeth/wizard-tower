/**
 * Trade archive read/write path — M10 (the durable tape behind Flow of Mana).
 *
 * WHAT PROBLEM THIS SOLVES. GeckoTerminal's `/trades` endpoint is a rolling WINDOW:
 * ≤300 trades AND ≤24h old, per pool (`UPSTREAM_WINDOW` in lib/sources/gecko-trades.ts).
 * Every 24h figure derived from it — unique buyers/sellers, buy/sell pressure, the
 * Verdict's Activity axis — was therefore a LOWER BOUND, which is why the UI has
 * always labeled those counts "approximate". $WIZARD is thin enough (~170 trades/24h
 * on the main pool) that the window usually does span 24h, but that is luck: it
 * collapses the moment volume spikes, and nothing was persisted either way.
 *
 * Archiving each run's window (cron every 15 min, `app/api/cron/trades/route.ts`)
 * turns the rolling view into a real census that only improves with age.
 *
 * HONESTY IS THE POINT — this module never overclaims:
 *   - `fullyCovered` is true ONLY when the archive's own coverage start (the oldest
 *     row it holds) predates the window start. Right after deploy the archive holds
 *     minutes of history, so it is false and the UI keeps saying "approximate".
 *   - `since` is the coverage start, surfaced the way Council of Holders banners
 *     "recorded since <date>". History is NOT retroactive.
 *   - When there is no database (e2e gate `WIZARD_DISABLE_DB=1`) or no rows yet,
 *     this returns null and callers fall back to the live window unchanged. No
 *     network, deterministic, and no card ever blanks.
 *
 * Follows the DB-backed read pattern of `lib/holders.ts` / `lib/social.ts`: a small
 * in-memory cache + last-good fallback, and pure logic delegated to
 * `lib/metrics/merge-trades.ts` rather than re-implemented here.
 */

import { asc, count, desc, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { trades as tradesTable, type NewTradeRow } from "@/db/schema";
import {
  aggregateFlow,
  mergeTrades,
  FLOW_WINDOW_MS,
  type FlowStats,
  type Trade,
  type TradeSide,
} from "@/lib/metrics/merge-trades";
import {
  activePoolsFromMarket,
  getTrades,
  type GetTradesOptions,
  type TradesResult,
} from "@/lib/sources/gecko-trades";
import { getMarket } from "@/lib/sources/dexscreener";

/** Match the other read paths' freshness window (holders.ts / social.ts). */
const CACHE_TTL_MS = 60_000;
/**
 * Bound the window read. At the historical peak day (~5,900 trades/24h) this still
 * covers a full window several times over; past that we would under-read rather
 * than time out.
 */
const WINDOW_ROW_LIMIT = 20_000;
/** Neon's HTTP driver takes one round-trip per statement — chunk big inserts. */
const INSERT_CHUNK = 500;

/** The minimal row shape flow aggregation + dedupe need (no display fields). */
type ArchiveRow = {
  txHash: string;
  ts: number;
  side: TradeSide;
  usd: number;
  wallet: string;
};

// ── Write path (used by the cron) ────────────────────────────────────────────

/** Map a merged tape `Trade` into its archive row. */
export function toTradeRow(t: Trade): NewTradeRow {
  return {
    txHash: t.txHash,
    ts: new Date(t.ts),
    side: t.side,
    wizardAmount: t.wizardAmount,
    usd: t.usd,
    priceUsd: t.priceUsd,
    wallet: t.wallet,
    pool: t.pool,
    dexId: t.poolLabel,
  };
}

export type ArchiveWriteResult = {
  /** Rows we attempted to write (the merged window). */
  offered: number;
  /** Rows that were genuinely new — conflicts on tx_hash are silently skipped. */
  inserted: number;
};

/**
 * Persist a merged tape, `on conflict (tx_hash) do nothing`.
 *
 * Runs overlap on purpose (a 15-minute cron re-reading a 24-hour window), so the
 * overwhelming majority of offered rows are already present. `returning` after
 * `onConflictDoNothing` yields ONLY the rows actually inserted, which is what makes
 * the cron's "inserted" count an honest measure of new trades rather than of effort.
 */
export async function archiveTrades(
  db: NonNullable<ReturnType<typeof getDb>>,
  tape: Trade[],
): Promise<ArchiveWriteResult> {
  if (tape.length === 0) return { offered: 0, inserted: 0 };

  // Guard against one upstream page carrying the same tx twice: Postgres rejects
  // the whole statement ("cannot affect row a second time") rather than deduping.
  const rows = mergeTrades([tape]).map(toTradeRow);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const written = await db
      .insert(tradesTable)
      .values(chunk)
      .onConflictDoNothing({ target: tradesTable.txHash })
      .returning({ txHash: tradesTable.txHash });
    inserted += written.length;
  }
  return { offered: rows.length, inserted };
}

// ── Read path ────────────────────────────────────────────────────────────────

export type ArchiveCoverage = {
  /** Oldest trade the archive holds (ms) — "recorded since". */
  since: number;
  /** Total rows archived. */
  rows: number;
  /** Rows inside the aggregation window. */
  rowsInWindow: number;
  /** True when `since` predates the window start — the window is fully covered. */
  fullyCovered: boolean;
};

export type ArchiveFlowResult = {
  flow: FlowStats;
  coverage: ArchiveCoverage;
  /** Window rows, kept so a live-tape union can re-aggregate without a 2nd query. */
  windowRows: ArchiveRow[];
};

function toMs(v: Date | string | number | null): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

type CacheEntry = { value: ArchiveFlowResult | null; fetchedAt: number };
let cache: CacheEntry | null = null;

/**
 * Override what the aggregation could prove from its rows with what the ARCHIVE can
 * prove. `aggregateFlow` only sees rows inside the window, so its `oldestTradeTs` /
 * `fullyCovered` describe that sample; the archive knows the true coverage start.
 * This is the one place the two are reconciled.
 */
function withCoverage(flow: FlowStats, coverage: ArchiveCoverage): FlowStats {
  return { ...flow, oldestTradeTs: coverage.since, fullyCovered: coverage.fullyCovered };
}

async function readArchive(
  db: NonNullable<ReturnType<typeof getDb>>,
  nowMs: number,
  windowMs: number,
): Promise<ArchiveFlowResult | null> {
  const windowStart = nowMs - windowMs;

  const [[firstRow], [totals]] = await Promise.all([
    db.select({ ts: tradesTable.ts }).from(tradesTable).orderBy(asc(tradesTable.ts)).limit(1),
    db.select({ n: count() }).from(tradesTable),
  ]);
  const rows = totals?.n ?? 0;
  if (!firstRow || rows === 0) return null;

  const windowRowsRaw = await db
    .select({
      txHash: tradesTable.txHash,
      ts: tradesTable.ts,
      side: tradesTable.side,
      usd: tradesTable.usd,
      wallet: tradesTable.wallet,
    })
    .from(tradesTable)
    .where(gte(tradesTable.ts, new Date(windowStart)))
    .orderBy(desc(tradesTable.ts))
    .limit(WINDOW_ROW_LIMIT);

  const windowRows: ArchiveRow[] = windowRowsRaw.map((r) => ({
    txHash: r.txHash,
    ts: toMs(r.ts),
    side: r.side === "buy" ? "buy" : "sell",
    usd: r.usd ?? 0,
    wallet: r.wallet ?? "",
  }));

  const coverage: ArchiveCoverage = {
    since: toMs(firstRow.ts),
    rows,
    rowsInWindow: windowRows.length,
    // The whole honesty hinge: only claim a census once the archive genuinely
    // reaches back past the window start.
    fullyCovered: toMs(firstRow.ts) <= windowStart,
  };

  return {
    flow: withCoverage(aggregateFlow(windowRows, nowMs, windowMs), coverage),
    coverage,
    windowRows,
  };
}

/**
 * Read the archive and aggregate the flow window from it.
 *
 * `liveTape` is unioned in before aggregating: the archive lags by up to one cron
 * interval (15 min), and a wallet that traded in that tail would otherwise be missed
 * from the unique-trader counts. Both sides go through the same `mergeTrades` the
 * tape uses, so the union cannot double-count a swap.
 *
 * Returns null when there is no database or no rows yet — callers keep the live
 * window's own (approximate) flow.
 */
export async function getArchiveFlow(opts?: {
  liveTape?: Trade[];
  nowMs?: number;
  windowMs?: number;
}): Promise<ArchiveFlowResult | null> {
  const nowMs = opts?.nowMs ?? Date.now();
  const windowMs = opts?.windowMs ?? FLOW_WINDOW_MS;
  const liveTape = opts?.liveTape ?? [];

  const db = getDb();
  if (!db) return null;

  // Cache the DB read only for the plain (real-clock) case — a caller-injected
  // clock must never be served a value computed for a different `now`.
  const cacheable = opts?.nowMs == null && opts?.windowMs == null;

  let base: ArchiveFlowResult | null;
  try {
    if (cacheable && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      base = cache.value;
    } else {
      base = await readArchive(db, nowMs, windowMs);
      if (cacheable) cache = { value: base, fetchedAt: Date.now() };
    }
  } catch (err) {
    // A DB blip must not blank the card — serve last-good, else fall back to live.
    console.error(
      "[trades-archive] read failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    base = cache?.value ?? null;
  }

  if (!base) return null;
  if (liveTape.length === 0) return base;

  // Union the live tail in, then re-aggregate. Coverage still comes from the archive
  // alone — the live window can never extend how far back we can PROVE we recorded.
  const merged = mergeTrades<ArchiveRow>([
    base.windowRows,
    liveTape.map((t) => ({
      txHash: t.txHash,
      ts: t.ts,
      side: t.side,
      usd: t.usd,
      wallet: t.wallet,
    })),
  ]);

  return {
    flow: withCoverage(aggregateFlow(merged, nowMs, windowMs), base.coverage),
    coverage: { ...base.coverage, rowsInWindow: merged.length },
    windowRows: merged,
  };
}

// ── Composition: the tape, with the archive layered on when it earns it ───────

export type GetTradesWithArchiveOptions = Omit<GetTradesOptions, "pools"> & {
  /** Pools to read; discovered from the market aggregate when omitted. */
  pools?: GetTradesOptions["pools"];
};

/**
 * The entry point the page seed and `/api/trades` both call.
 *
 * Fetches the live window exactly as before, then — ONLY if the archive covers the
 * whole flow window — replaces `flow` with the archive-derived census and marks
 * `flowSource: "archive"`. Otherwise the live window's own approximate flow stands
 * untouched. Either way `archiveSince` / `archiveRows` are reported so the card can
 * say how far back its numbers actually reach.
 *
 * Doing the swap HERE rather than in the card means the 30s client poll of
 * /api/trades keeps returning archive-backed flow — no server/client divergence,
 * no extra prop plumbing, and the Verdict gets the better data for free.
 */
export async function getTradesWithArchive(
  options: GetTradesWithArchiveOptions = {},
): Promise<TradesResult> {
  const pools = options.pools ?? activePoolsFromMarket(await getMarket().catch(() => null));
  const base = await getTrades({ ...options, pools });

  const archive = await getArchiveFlow({
    liveTape: base.trades,
    nowMs: options.nowMs,
  }).catch(() => null);

  return applyArchive(base, archive);
}

/**
 * PURE: decide whether the archive has earned the right to replace the window's
 * flow, and label the result accordingly. Extracted from `getTradesWithArchive` so
 * the honesty rule itself is unit-tested without a database (test/trades-archive.test.ts).
 *
 * The rule, in one line: the archive supplies the numbers ONLY when it demonstrably
 * spans the whole window. A young archive still reports `archiveSince` (so the card
 * can say "we began recording on …") but leaves the approximate window flow in place
 * and labels the source "window" — it must not imply a census it cannot back.
 */
export function applyArchive(
  base: TradesResult,
  archive: ArchiveFlowResult | null,
): TradesResult {
  if (!archive) return base;
  const useArchive = archive.coverage.fullyCovered;
  return {
    ...base,
    flow: useArchive ? archive.flow : base.flow,
    flowSource: useArchive ? "archive" : "window",
    archiveSince: archive.coverage.since,
    archiveRows: archive.coverage.rows,
  };
}

/**
 * Diagnostics: total rows vs distinct tx_hash. Equal counts prove the on-conflict
 * dedupe is holding — the cron logs this, and the README's verification steps use it.
 */
export async function archiveIntegrity(): Promise<{
  rows: number;
  distinct: number;
  since: number | null;
  latest: number | null;
} | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      distinct: sql<number>`count(distinct ${tradesTable.txHash})::int`,
      since: sql<string | null>`min(${tradesTable.ts})`,
      latest: sql<string | null>`max(${tradesTable.ts})`,
    })
    .from(tradesTable);
  return {
    rows: row?.rows ?? 0,
    distinct: row?.distinct ?? 0,
    since: row?.since ? toMs(row.since) : null,
    latest: row?.latest ? toMs(row.latest) : null,
  };
}

/** Test/inspection hook — reset the module cache. */
export function __clearArchiveCache(): void {
  cache = null;
}
