import fs from "node:fs";
import path from "node:path";
import type { Page, Request } from "@playwright/test";

/**
 * Browser-side /api/* route interception (IMPLEMENTATION_PLAN.md §8 DoD).
 *
 * The web server is already fetch-mocked (so SSR is deterministic), but the DoD
 * also asks for route interception: we fulfill every /api/* poll from recorded
 * fixtures so the browser provably never reaches the network for its data. The
 * fixtures were captured from the mocked server, so the client polls and the SSR
 * seed agree exactly.
 */

const FIX = path.join(process.cwd(), "test", "e2e", "fixtures");
const read = (f: string) => fs.readFileSync(path.join(FIX, f), "utf8");

const BODIES = {
  market: read("api-market.json"),
  trades: read("api-trades.json"),
  safety: read("api-safety.json"),
  holders: read("api-holders.json"),
  ohlcv1h: read("api-ohlcv-1h.json"),
  ohlcv1d: read("api-ohlcv-1d.json"),
  socialOfficial: read("api-social-official.json"),
  socialCommunity: read("api-social-community.json"),
};

export async function mockApiRoutes(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    let body = "{}";
    if (url.includes("/api/market")) body = BODIES.market;
    else if (url.includes("/api/trades")) body = BODIES.trades;
    else if (url.includes("/api/safety")) body = BODIES.safety;
    else if (url.includes("/api/holders")) body = BODIES.holders;
    // The Prophecy Feed (M6): serve each tab from its own fixture so a visitor
    // provably reads only OUR /api/social — never X — and the tab switch is testable.
    else if (url.includes("/api/social")) {
      body = url.includes("source=community") ? BODIES.socialCommunity : BODIES.socialOfficial;
    } else if (url.includes("/api/ohlcv")) body = url.includes("tf=1d") ? BODIES.ohlcv1d : BODIES.ohlcv1h;
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });
}

/**
 * Upstream data hosts the browser must never contact directly during the run.
 * Includes the X API (api.x.com) so the run enforces the M6 DoD — ZERO client-side
 * X calls; the poller is the only X caller, visitors read our DB. (The pbs.twimg.com
 * media CDN is deliberately NOT listed: avatars go through next/image's same-origin
 * /_next/image proxy — the browser never contacts the CDN directly, and matching the
 * proxy URL's query string would be a false positive.)
 */
const LIVE_HOSTS = [
  "api.dexscreener.com",
  "api.geckoterminal.com",
  "api.rugcheck.xyz",
  "api.x.com",
];

export function isLiveUpstream(req: Request): boolean {
  return LIVE_HOSTS.some((h) => req.url().includes(h));
}

/**
 * Attach console-error / pageerror / live-network collectors to a page. Returns
 * the arrays so a test can assert they stayed empty.
 */
export function attachGuards(page: Page): { consoleErrors: string[]; liveRequests: string[] } {
  const consoleErrors: string[] = [];
  const liveRequests: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("request", (r) => {
    if (isLiveUpstream(r)) liveRequests.push(r.url());
  });
  return { consoleErrors, liveRequests };
}
