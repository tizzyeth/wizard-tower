/**
 * Neon connection + Drizzle instance (IMPLEMENTATION_PLAN.md §6 stack:
 * drizzle-orm + @neondatabase/serverless).
 *
 * Uses the neon-http driver — one HTTPS round-trip per query, no pooled socket to
 * keep warm, which is exactly right for serverless route handlers on Vercel Hobby.
 * `DATABASE_URL` is the direct Neon connection string in `.env.local`; in
 * production/preview the Neon⟷Vercel marketplace integration injects it (marked
 * Sensitive, so `vercel env pull` shows it blank but it is present at runtime).
 *
 * `getDb()` is lazy + memoized and returns null when the database is unavailable
 * (no URL, or the e2e gate `WIZARD_DISABLE_DB=1`). Callers must treat null as "no
 * durable store right now" and degrade honestly — the holders card shows its
 * "not yet recorded" empty state, the kv cache falls back to its in-memory layer.
 * This keeps the Playwright e2e run (which has no live DB) deterministic and
 * off-network without special-casing every call site.
 */

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let cached: Db | null = null;
let resolved = false;

/** True when a durable database is configured and not gated off. */
export function dbAvailable(): boolean {
  return process.env.WIZARD_DISABLE_DB !== "1" && !!process.env.DATABASE_URL;
}

/**
 * The one entry point for database access. Returns a memoized Drizzle client, or
 * null when there is no database to talk to (callers degrade gracefully).
 */
export function getDb(): Db | null {
  if (resolved) return cached;
  resolved = true;
  if (!dbAvailable()) {
    cached = null;
    return null;
  }
  const client = neon(process.env.DATABASE_URL as string);
  cached = drizzle(client, { schema });
  return cached;
}

export { schema };
