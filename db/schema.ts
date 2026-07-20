/**
 * Drizzle schema — Neon Postgres (IMPLEMENTATION_PLAN.md §6).
 *
 * All THREE tables are created now, in M4, even though only `holder_snapshots` is
 * written this milestone: `x_posts` (M6, The Prophecy Feed) and `kv_cache` (durable
 * cross-cold-start cache, used this milestone by the RugCheck source) are declared
 * here so the next milestones only CONSUME the schema — no schema churn later.
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
