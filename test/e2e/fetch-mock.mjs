/**
 * Server-side fetch mock for the Playwright e2e run (IMPLEMENTATION_PLAN.md §8).
 *
 * Preloaded into the Next server process via
 *   NODE_OPTIONS="--import ./test/e2e/fetch-mock.mjs" next start
 * so that EVERY upstream call the app makes — during the force-dynamic SSR seed
 * AND from the /api/* route handlers the client polls — is answered from the
 * recorded raw fixtures in test/fixtures/. Nothing touches the live network.
 *
 * Why here and not only Playwright route interception: the page seeds itself on
 * the server (getMarket / getSafety / getTrades / getOhlcv call the source libs
 * directly, not /api/*), and browser route interception cannot see Node's
 * server-side fetches. Patching the server process's global fetch covers both.
 *
 * The mock is deliberately LOUD: an upstream URL with no fixture throws, so a
 * missing mock fails the run instead of silently reaching the network.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIX = join(process.cwd(), "test", "fixtures");
const load = (name) => JSON.parse(readFileSync(join(FIX, name), "utf8"));

// Recorded raw upstream responses (the same fixtures the unit tests use).
const dexscreener = load("dexscreener-market.json");
const rugcheck = load("rugcheck-report.json");
const ohlcvHour = load("geckoterminal-ohlcv-hour.json");
const ohlcvDay = load("geckoterminal-ohlcv-day.json");
// M9: the recorded pump.fun fee-share config account behind Mimo's Tribute.
const feeConfigAccount = load("pumpfun-fee-config-account.json");

// Active WIZARD pools → their recorded trade fixtures (addresses from the
// dexscreener fixture: PumpSwap main + two Meteora pools).
const TRADES_BY_POOL = {
  Dw4kAH8LhdmgfW1cgyvnWSwSDqkt37jeY7pW4oFkbGTu: load("geckoterminal-trades-pumpswap.json"),
  "6ChdkdgBjzdwCPv4PYoriyr1xDT6KzjWKojzuhWjEMqr": load("geckoterminal-trades-meteora-sol.json"),
  "2jwbtvZf8dxZkQrERBZERDZfPMQoFpHGYEESPCxWibaG": load("geckoterminal-trades-meteora-usdc.json"),
};

const EMPTY_TRADES = { data: [] };

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Resolve a mocked upstream URL → a Response, or null to pass through. */
function mockFor(url, init) {
  if (url.includes("api.dexscreener.com")) return json(dexscreener);
  if (url.includes("api.rugcheck.xyz")) return json(rugcheck);

  // Helius JSON-RPC — one URL, many methods, so branch on the request body.
  // Mimo's Tribute reads the creator's fee-share config via getAccountInfo.
  if (url.includes("helius-rpc.com")) {
    let method = null;
    try {
      method = JSON.parse(init?.body ?? "{}").method ?? null;
    } catch {
      method = null;
    }
    if (method === "getAccountInfo") return json(feeConfigAccount);
    throw new Error(`[fetch-mock] unmocked Helius RPC method: ${method}`);
  }

  if (url.includes("api.geckoterminal.com")) {
    if (url.includes("/trades")) {
      const pool = Object.keys(TRADES_BY_POOL).find((p) => url.includes(p));
      return json(pool ? TRADES_BY_POOL[pool] : EMPTY_TRADES);
    }
    if (url.includes("/ohlcv/day")) return json(ohlcvDay);
    if (url.includes("/ohlcv/hour")) return json(ohlcvHour);
    if (url.includes("/ohlcv/minute")) return json(ohlcvHour); // not hit by the smoke run
    throw new Error(`[fetch-mock] unmocked GeckoTerminal URL: ${url}`);
  }

  // Any other upstream must be explicitly mocked — fail loudly.
  if (/^https?:\/\//.test(url) && !url.includes("localhost") && !url.includes("127.0.0.1")) {
    throw new Error(`[fetch-mock] unmocked upstream URL (no live network in e2e): ${url}`);
  }
  return null;
}

const realFetch = globalThis.fetch;

globalThis.fetch = async function mockedFetch(input, init) {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  const mocked = mockFor(url, init);
  if (mocked) return mocked;
  return realFetch(input, init);
};

console.log("[fetch-mock] active — upstreams served from test/fixtures");
