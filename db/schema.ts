/**
 * Drizzle schema — Neon Postgres (IMPLEMENTATION_PLAN.md §6).
 *
 * The first THREE tables were created together in M4, even though only
 * `holder_snapshots` was written that milestone: `x_posts` (M6, The Prophecy Feed)
 * and `kv_cache` (durable cross-cold-start cache, used by the RugCheck source) were
 * declared up front so later milestones only CONSUME the schema — no schema churn.
 * `trades` (M10, the trade archive) is the one later addition; see its own note.
 *
 * Pushed with `drizzle-kit push` (see drizzle.config.ts). Per §6 we deliberately
 * skip migration-file ceremony for v1 — `push` diffs the live db against this file.
 * If versioned migrations are ever needed (multi-env, rollbacks), switch to
 * `drizzle-kit generate` + `migrate`; recorded here as the conscious v1 choice.
 */

import {
  pgTable,
  serial,
  timestamp,
  integer,
  real,
  doublePrecision,
  jsonb,
  text,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { HolderBucket, TopHolderRow } from "@/lib/metrics/concentration";

/**
 * Hourly holder census (§4 Council of Holders). One row per snapshot; the card's
 * area chart is these rows over time, and the "recorded since" banner is the first
 * row's `ts` (history is not retroactive — plan §9).
 */
export const holderSnapshots = pgTable(
  "holder_snapshots",
  {
    id: serial("id").primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    /** Gross distinct-owner holder count (matches Solscan; pools included). */
    totalHolders: integer("total_holders").notNull(),
    /** Top-N shares of supply, %, pools/lockers/burn EXCLUDED (§6). */
    top10Pct: real("top10_pct"),
    top20Pct: real("top20_pct"),
    top50Pct: real("top50_pct"),
    /** Full-holder-set HHI, Σ(pct²) on percent shares, 0–10000. */
    hhi: real("hhi"),
    /** USD holder buckets (< $10 … > $10K) over the real holders. */
    buckets: jsonb("buckets").$type<HolderBucket[]>(),
    /** Top-20 holders (incl. labeled pools) for the table. */
    topHolders: jsonb("top_holders").$type<TopHolderRow[]>(),
  },
  (t) => [index("holder_snapshots_ts_idx").on(t.ts)],
);

export type HolderSnapshotRow = typeof holderSnapshots.$inferSelect;
export type NewHolderSnapshot = typeof holderSnapshots.$inferInsert;

/**
 * X posts buffer (§4 The Prophecy Feed, M6). Declared now so M6 only consumes it.
 * `source` is constrained to the two feeds the plan shows: official + community.
 * The scheduled poller upserts by `id`; visitors read our DB, never X directly.
 */
export const xPosts = pgTable("x_posts", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  authorHandle: text("author_handle"),
  authorName: text("author_name"),
  authorAvatarUrl: text("author_avatar_url"),
  text: text("text"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  likes: integer("likes"),
  reposts: integer("reposts"),
  replies: integer("replies"),
  media: jsonb("media"),
  url: text("url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
}, (t) => [
  check("x_posts_source_check", sql`${t.source} in ('official','community')`),
]);

export type XPostRow = typeof xPosts.$inferSelect;
export type NewXPost = typeof xPosts.$inferInsert;

/**
 * Durable key/value cache (§6) — survives serverless cold starts. Used this
 * milestone by `lib/sources/rugcheck.ts` (write-through L2 behind its in-memory
 * L1) and available to any source that needs last-good persistence.
 */
export const kvCache = pgTable("kv_cache", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KvCacheRow = typeof kvCache.$inferSelect;

/**
 * Trade archive (M10) — the durable tape behind The Ledger of Deeds / Flow of Mana.
 *
 * WHY THIS TABLE EXISTS. GeckoTerminal's `/trades` endpoint is a WINDOW, not a
 * history: it returns at most **300 trades AND only from the past 24 hours** per
 * pool (measured 2026-07-20 — a busy reference pool returned exactly 300 spanning
 * 22 minutes; the WIZARD main pool returned 168 spanning exactly 24.0h). Nothing
 * was persisted, so every 24h figure derived from it was a lower bound and the UI
 * had to label unique buyers/sellers "approximate". Archiving each run's window
 * turns that rolling view into an actual census that only improves with age.
 *
 * PRIMARY KEY IS `tx_hash` — dedupe is the entire point. Runs overlap heavily by
 * design (a 15-minute cron re-reads a 24-hour window), so ingestion is
 * `on conflict do nothing` and re-running is a no-op, not a duplicate.
 *
 * ONE ROW = ONE SWAP, matching what the tape shows. A swap routed across several
 * pools appears once per pool with the SAME tx_hash; `lib/metrics/merge-trades.ts`
 * collapses those legs keeping the max-USD leg as the representative, and we
 * archive the collapsed result. So `pool`/`dex_id` are the swap's DOMINANT venue,
 * not "every venue it touched" — consistent with the Ledger of Deeds.
 *
 * `ts` is indexed because every consumer queries by time range (the 24h flow
 * window, the coverage-start banner).
 */
export const trades = pgTable(
  "trades",
  {
    /** Solana transaction signature — the cross-pool, cross-run dedupe key. */
    txHash: text("tx_hash").primaryKey(),
    /** Block time. Indexed — all reads are time-range queries. */
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    /**
     * BUY = WIZARD received · SELL = WIZARD spent. Derived from WIZARD's position
     * in the swap, NEVER from GeckoTerminal's base-relative `kind` (which inverts
     * for pools where WIZARD is the quote token). See lib/sources/gecko-trades.ts.
     */
    side: text("side").notNull(),
    /** WIZARD token amount in the swap. double precision — token amounts run to 1e9. */
    wizardAmount: doublePrecision("wizard_amount"),
    /** USD value of the swap (GeckoTerminal `volume_in_usd`). */
    usd: doublePrecision("usd").notNull(),
    /** WIZARD USD price at the trade. */
    priceUsd: doublePrecision("price_usd"),
    /** Signer / fee payer (`tx_from_address`) — the unique-trader identity. */
    wallet: text("wallet"),
    /** Pool (pair) address of the representative (max-USD) leg. */
    pool: text("pool").notNull(),
    /** DEX label of that pool, e.g. "PumpSwap" / "Meteora". */
    dexId: text("dex_id"),
  },
  (t) => [
    index("trades_ts_idx").on(t.ts),
    check("trades_side_check", sql`${t.side} in ('buy','sell')`),
  ],
);

export type TradeRow = typeof trades.$inferSelect;
export type NewTradeRow = typeof trades.$inferInsert;
