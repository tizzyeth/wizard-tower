/**
 * POST /api/cron/trades — the trade archive ingester (M10).
 *
 * Gated by `Authorization: Bearer ${CRON_SECRET}` (401 otherwise), the same secret
 * and shape as the snapshot + social crons, so only
 * .github/workflows/trades-archive.yml can trigger it. Flow:
 *   1. discover the currently active pools from the DexScreener aggregate — the same
 *      pool set the rest of the dashboard uses, never a hardcoded list;
 *   2. pull each pool's trade window through the EXISTING source
 *      (`getTrades`, which owns the zod boundary, the WIZARD-position side
 *      derivation, the shared 25/min Gecko limiter and the cross-pool merge) with
 *      `cap: Infinity` so we archive every merged swap, not just the rendered page;
 *   3. UPSERT into `trades` with on-conflict-do-nothing on tx_hash — runs overlap by
 *      design, so re-running is a no-op rather than a duplicate;
 *   4. LOG the offered/inserted counts, per-pool detail, and any coverage gap.
 *
 * NOTHING about fetching or mapping trades is reimplemented here. The one job this
 * route owns is persistence.
 *
 * GAP DETECTION. Upstream serves at most 300 trades AND at most 24h per pool. If a
 * pool produced more than 300 trades since the previous run, or the cron was down
 * for over 24h, the oldest trade we just fetched will be NEWER than the newest trade
 * already archived — a hole we can never backfill from this source. We cannot fix it
 * after the fact, so we detect and log it loudly (and report it in the body) rather
 * than let the archive silently claim continuous coverage. The 15-minute cadence is
 * sized so this should not happen; see the workflow for the arithmetic.
 *
 * Node runtime (the Neon insert needs it), force-dynamic, and a maxDuration sized
 * for a handful of throttled upstream calls plus a chunked insert.
 */

import type { NextRequest } from "next/server";
import { getDb, dbAvailable } from "@/db";
import { getMarket } from "@/lib/sources/dexscreener";
import {
  activePoolsFromMarket,
  getTrades,
  UPSTREAM_WINDOW,
  type Trade,
} from "@/lib/sources/gecko-trades";
import { archiveTrades, archiveIntegrity, __clearArchiveCache } from "@/lib/trades-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

/** Per-pool ingest context for the log — how full the upstream window came back. */
type PoolStat = {
  pool: string;
  label: string;
  trades: number;
  /** True when the pool returned a full page — it may have had MORE to give. */
  windowFull: boolean;
  oldest: string | null;
  newest: string | null;
};

function poolStats(tape: Trade[], pools: { pool: string; poolLabel: string }[]): PoolStat[] {
  return pools.map((p) => {
    const own = tape.filter((t) => t.pool === p.pool);
    const times = own.map((t) => t.ts).sort((a, b) => a - b);
    return {
      pool: p.pool,
      label: p.poolLabel,
      trades: own.length,
      windowFull: own.length >= UPSTREAM_WINDOW.maxTrades,
      oldest: times.length ? new Date(times[0]).toISOString() : null,
      newest: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    };
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return unauthorized();

  if (!dbAvailable()) {
    return Response.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "database unavailable" }, { status: 503 });

  const startedAt = Date.now();
  try {
    // Where the archive stood BEFORE this run — the baseline for gap detection.
    const before = await archiveIntegrity();

    const market = await getMarket().catch(() => null);
    const pools = activePoolsFromMarket(market);

    // forceRefresh: a cron must never be served the 30s render cache; cap: Infinity
    // because the archive needs every merged swap, not the rendered page of them.
    const result = await getTrades({ pools, forceRefresh: true, cap: Infinity });
    const tape = result.trades;

    const write = await archiveTrades(db, tape);
    // The read path caches for 60s; this run just changed the table underneath it.
    __clearArchiveCache();

    const after = await archiveIntegrity();

    // Gap: the oldest trade this run could see is newer than the newest trade we had
    // already archived ⇒ trades happened in between that upstream no longer serves.
    const oldestFetched = tape.length ? Math.min(...tape.map((t) => t.ts)) : null;
    const gap =
      before && before.latest != null && oldestFetched != null && oldestFetched > before.latest
        ? { fromIso: new Date(before.latest).toISOString(), toIso: new Date(oldestFetched).toISOString(), ms: oldestFetched - before.latest }
        : null;

    const stats = poolStats(tape, pools);
    const saturated = stats.filter((s) => s.windowFull).map((s) => s.pool);

    // The cost/health line, matching the social cron's convention.
    console.log(
      `[cron/trades] done offered=${write.offered} inserted=${write.inserted} ` +
        `pools=${pools.length} rows=${after?.rows ?? "?"} distinct=${after?.distinct ?? "?"} ` +
        `since=${after?.since ? new Date(after.since).toISOString() : "—"} ` +
        `elapsedMs=${Date.now() - startedAt}`,
    );
    if (gap) {
      console.error(
        `[cron/trades] COVERAGE GAP — no trades archived between ${gap.fromIso} and ${gap.toIso} ` +
          `(${Math.round(gap.ms / 60_000)} min). Upstream serves only ${UPSTREAM_WINDOW.maxTrades} ` +
          `trades / 24h per pool; run the cron more often.`,
      );
    }
    if (saturated.length) {
      console.warn(
        `[cron/trades] ${saturated.length} pool(s) returned a FULL ${UPSTREAM_WINDOW.maxTrades}-trade ` +
          `window (${saturated.join(", ")}) — trades may have been missed; consider a faster cadence.`,
      );
    }

    return Response.json({
      ok: true,
      offered: write.offered,
      inserted: write.inserted,
      archive: {
        rows: after?.rows ?? null,
        distinctTxHash: after?.distinct ?? null,
        // Equal counts are the dedupe proof; tx_hash is the PK so they cannot diverge.
        dedupeHolds: after ? after.rows === after.distinct : null,
        since: after?.since ? new Date(after.since).toISOString() : null,
        latest: after?.latest ? new Date(after.latest).toISOString() : null,
        rowsBefore: before?.rows ?? 0,
      },
      window: {
        maxTradesPerPool: UPSTREAM_WINDOW.maxTrades,
        maxAgeHours: UPSTREAM_WINDOW.maxAgeMs / 3_600_000,
        saturatedPools: saturated,
      },
      gap,
      pools: stats,
      poolsFailed: result.poolsFailed,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[cron/trades] failed:", message);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
