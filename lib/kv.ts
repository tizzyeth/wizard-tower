/**
 * Durable key/value cache over the `kv_cache` Neon table (IMPLEMENTATION_PLAN.md
 * §6). This is the L2 behind a source's in-memory L1: it survives serverless cold
 * starts, so a freshly-spun instance can serve last-good data before its first
 * upstream fetch completes.
 *
 * Best-effort by design: every call swallows errors and no-ops when there is no
 * database (getDb() null — e.g. the e2e run, or a missing DATABASE_URL). A cache
 * layer must never be able to break a card, so a KV failure degrades to "L1 only"
 * silently (a single console.warn for observability).
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { kvCache } from "@/db/schema";

export type KvEntry<T> = { value: T; updatedAt: number };

/** Read a durable value, or null when absent / no database. */
export async function kvGet<T>(key: string): Promise<KvEntry<T> | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select({ value: kvCache.value, updatedAt: kvCache.updatedAt })
      .from(kvCache)
      .where(sql`${kvCache.key} = ${key}`)
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      value: row.value as T,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : Date.now(),
    };
  } catch (err) {
    console.warn(`[kv] read '${key}' failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Write a durable value (upsert by key). No-op on failure / no database. */
export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db
      .insert(kvCache)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: kvCache.key,
        set: { value, updatedAt: new Date() },
      });
  } catch (err) {
    console.warn(`[kv] write '${key}' failed:`, err instanceof Error ? err.message : err);
  }
}
