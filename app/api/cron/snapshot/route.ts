/**
 * POST /api/cron/snapshot — the hourly holder census (IMPLEMENTATION_PLAN.md §6).
 *
 * Gated by `Authorization: Bearer ${CRON_SECRET}` (401 otherwise) so only the
 * GitHub Actions workflow (.github/workflows/snapshot.yml) can trigger a scan.
 * Flow: full Helius holder scan → build the pool/locker/burn/creator label map
 * from pool discovery (DexScreener) + RugCheck's labeled accounts → compute
 * concentration against the LIVE supply → INSERT one row into holder_snapshots.
 *
 * Node runtime (the Helius scan + Neon insert need it), force-dynamic, and a
 * generous maxDuration for the paginated scan.
 */

import type { NextRequest } from "next/server";
import { getDb, dbAvailable } from "@/db";
import { holderSnapshots } from "@/db/schema";
import { scanHolders } from "@/lib/sources/helius";
import { getMarket } from "@/lib/sources/dexscreener";
import { getSafety } from "@/lib/sources/rugcheck";
import {
  computeConcentration,
  BURN_ADDRESS,
  type HolderLabels,
} from "@/lib/metrics/concentration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

/**
 * Build the owner→label exclusion map (§6). Pools come from DexScreener pool
 * discovery AND RugCheck's labeled AMM accounts (a pool's vault is owned by the
 * pool address); lockers + the burn address are excluded; the creator wallet is
 * labeled but stays counted. Pool/locker labels win over creator on any overlap.
 */
function buildLabels(
  market: Awaited<ReturnType<typeof getMarket>>["data"],
  safety: Awaited<ReturnType<typeof getSafety>>["data"],
): { labels: HolderLabels; creator: string | null } {
  const labels: HolderLabels = {};
  for (const p of market?.pools ?? []) labels[p.pairAddress] = "pool";
  for (const a of safety?.poolAddresses ?? []) labels[a] = "pool";
  for (const a of safety?.lockerAddresses ?? []) labels[a] = "locker";
  labels[BURN_ADDRESS] = "burn";
  const creator = safety?.creator ?? null;
  if (creator && !labels[creator]) labels[creator] = "creator";
  return { labels, creator };
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) return unauthorized();

  if (!dbAvailable()) {
    return Response.json(
      { ok: false, error: "database unavailable" },
      { status: 503 },
    );
  }

  const startedAt = Date.now();
  try {
    // The Helius scan is the critical input; market + safety only enrich labels /
    // price, so a stale one must not abort the census (best-effort).
    const [scan, marketRes, safetyRes] = await Promise.all([
      scanHolders(),
      getMarket().catch(() => null),
      getSafety().catch(() => null),
    ]);

    const market = marketRes?.data ?? null;
    const safety = safetyRes?.data ?? null;
    const { labels, creator } = buildLabels(market, safety);
    const priceUsd = market?.priceUsd ?? null;

    const c = computeConcentration({
      holders: scan.holders,
      supplyRaw: scan.supplyRaw,
      decimals: scan.decimals,
      labels,
      priceUsd,
    });

    const db = getDb();
    if (!db) {
      return Response.json({ ok: false, error: "database unavailable" }, { status: 503 });
    }
    const [row] = await db
      .insert(holderSnapshots)
      .values({
        totalHolders: c.totalHolders,
        top10Pct: c.top10Pct,
        top20Pct: c.top20Pct,
        top50Pct: c.top50Pct,
        hhi: c.hhi,
        buckets: c.buckets,
        topHolders: c.topHolders,
      })
      .returning({ id: holderSnapshots.id, ts: holderSnapshots.ts });

    return Response.json({
      ok: true,
      snapshot: {
        id: row.id,
        ts: row.ts,
        totalHolders: c.totalHolders,
        countedHolders: c.countedHolders,
        excludedCount: c.excludedCount,
        excludedPct: Number(c.excludedPct.toFixed(3)),
        top10Pct: c.top10Pct == null ? null : Number(c.top10Pct.toFixed(3)),
        top20Pct: c.top20Pct == null ? null : Number(c.top20Pct.toFixed(3)),
        top50Pct: c.top50Pct == null ? null : Number(c.top50Pct.toFixed(3)),
        top10PctRaw: c.top10PctRaw == null ? null : Number(c.top10PctRaw.toFixed(3)),
        hhi: c.hhi == null ? null : Number(c.hhi.toFixed(2)),
        buckets: c.buckets.map((b) => ({ key: b.key, count: b.count })),
      },
      scan: {
        tokenAccounts: scan.tokenAccountCount,
        owners: scan.ownerCount,
        pages: scan.pages,
        supplyRaw: scan.supplyRaw,
        decimals: scan.decimals,
        priceUsd,
        labeledPools: Object.values(labels).filter((l) => l === "pool").length,
        labeledLockers: Object.values(labels).filter((l) => l === "locker").length,
        creator,
      },
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[cron/snapshot] failed:", message);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
