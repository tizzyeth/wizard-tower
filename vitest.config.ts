import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Minimal, Next-compatible vitest config (IMPLEMENTATION_PLAN.md §8) — the repo's
 * first tests. Pure logic only (no DOM), so the node environment is enough. The
 * "@/" alias mirrors tsconfig.json so tests import modules exactly as the app does.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
