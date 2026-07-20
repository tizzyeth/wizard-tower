import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke + a11y config (IMPLEMENTATION_PLAN.md §8, M7 DoD).
 *
 * The web server is `next start` (a production build) preloaded with the
 * server-side fetch mock (test/e2e/fetch-mock.mjs), so both the SSR seed and the
 * /api/* routes are served from recorded fixtures — the whole run is deterministic
 * and never touches the live network. Build first: `pnpm test:e2e` runs
 * `next build && playwright test`.
 *
 * GitHub-Actions-friendly (forbidOnly + retries + github reporter under CI) but we
 * intentionally ship NO workflow file — wiring CI is M8's job.
 */

const PORT = 3777;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // WIZARD_DISABLE_DB gates off the Neon client so the run never touches a live
    // DB (getHolders + the kv_cache layer no-op → the holders card renders its
    // deterministic empty state, and no neon fetch escapes the fetch-mock).
    command: `WIZARD_DISABLE_DB=1 NODE_OPTIONS='--import ./test/e2e/fetch-mock.mjs' pnpm exec next start -p ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
