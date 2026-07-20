/**
 * drizzle-kit config (IMPLEMENTATION_PLAN.md §6). `pnpm db:push` diffs the live
 * Neon database against db/schema.ts and applies the delta — no migration files
 * for v1 (the conscious choice recorded in db/schema.ts).
 *
 * drizzle-kit does NOT auto-load .env.local, so we read DATABASE_URL from it here
 * (falling back to a real process env var, e.g. in CI). Keeps the push command a
 * plain `drizzle-kit push` with no shell env plumbing.
 */

import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(new URL(".env.local", import.meta.url), "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^DATABASE_URL=(.*)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // fall through
  }
  throw new Error("DATABASE_URL not found in env or .env.local");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: databaseUrl() },
  strict: true,
  verbose: true,
});
