/**
 * Helius source — IMPLEMENTATION_PLAN.md §5. Feeds the hourly holder snapshot
 * (Council of Holders, §4).
 *
 *   POST https://mainnet.helius-rpc.com/?api-key=KEY
 *     · DAS  `getTokenAccounts` by mint, paginated 1000/page → full holder list
 *     · RPC  `getTokenSupply`                                → live circulating supply
 *
 * House style (copy dexscreener.ts shape, §5 "Implementation rules"):
 *   - zod-validate every RPC response at the boundary;
 *   - PURE mappers (`mapSupply`, `mapTokenAccountsPage`) so parsing is unit-tested
 *     against recorded fixtures (test/fixtures/helius-token-accounts-page1.json,
 *     helius-token-supply.json);
 *   - an AbortController timeout per request so a slow upstream can't hang;
 *   - in-flight dedup so two concurrent scans share one pass;
 *   - respect the 10 rps free-tier limit with a small pacing delay between pages.
 *
 * Unlike the read-path sources, this has NO module cache / stale-while-revalidate:
 * the durable store IS the `holder_snapshots` table. The scan is only ever called
 * by the snapshot cron (never per-visitor), so it fetches fresh each run and the
 * card reads the DB. The API key is server-side only.
 *
 * Solana note: WIZARD is a Token-2022 mint (verified on Solscan — Owner Program
 * "Token 2022 Program"). DAS `getTokenAccounts` keys off the MINT, so it returns
 * the accounts regardless of which token program owns them — no program-id branch
 * needed. Holder count = distinct OWNER wallets with a positive balance (a pool's
 * vault is one such owner; the concentration step labels/excludes it).
 */

import { z } from "zod";
import { TOKEN } from "@/config/token";
import type { RawHolder } from "@/lib/metrics/concentration";

const RPC_ENDPOINT = "https://mainnet.helius-rpc.com";

/** Abort a slow request so a scan can never hang indefinitely. */
const FETCH_TIMEOUT_MS = 15_000;
/** Accounts per DAS page (§5: "paginated 1K/page"). */
const PAGE_LIMIT = 1000;
/** Pacing delay between pages — keeps us well under the 10 rps free-tier limit. */
const PAGE_DELAY_MS = 120;
/** Hard stop so a runaway pagination bug can't loop forever (≈50K accounts). */
const MAX_PAGES = 50;

// ── Boundary validation (zod) ───────────────────────────────────────────────

/** RPC amounts arrive as strings (u64); coerce to a finite number or null. */
const numericString = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

const supplyResponse = z.object({
  result: z.object({
    value: z.object({
      amount: numericString,
      decimals: z.number().nullish(),
      uiAmountString: z.string().nullish(),
    }),
  }),
});

const tokenAccount = z
  .object({
    address: z.string().nullish(),
    owner: z.string().nullish(),
    amount: numericString,
  })
  .loose();

const tokenAccountsResponse = z.object({
  result: z.object({
    total: z.number().nullish(),
    limit: z.number().nullish(),
    page: z.number().nullish(),
    cursor: z.string().nullish(),
    token_accounts: z.array(tokenAccount).nullish(),
  }),
});

// ── Public, serializable shapes ──────────────────────────────────────────────

export type LiveSupply = {
  /** Total supply in raw base units (integer). */
  supplyRaw: number;
  decimals: number;
};

export type TokenAccountsPage = {
  /** Accounts on this page: owner + raw amount, positive balances only. */
  accounts: RawHolder[];
  /** Raw account count returned for this page (before the positive-balance filter). */
  rawCount: number;
};

export type HolderScan = {
  /** Holders aggregated by owner (positive balances), raw base units. */
  holders: RawHolder[];
  /** Distinct owners with a positive balance — the gross holder count. */
  ownerCount: number;
  /** Total token accounts scanned (a few owners hold via >1 account). */
  tokenAccountCount: number;
  supplyRaw: number;
  decimals: number;
  /** Pages fetched — surfaced in the cron log for observability. */
  pages: number;
  scannedAt: number;
};

// ── Pure mappers (testable against the recorded fixtures) ────────────────────

/** Normalize a raw getTokenSupply response into live supply + decimals. */
export function mapSupply(raw: unknown): LiveSupply {
  const parsed = supplyResponse.parse(raw);
  const supplyRaw = parsed.result.value.amount;
  if (supplyRaw == null || !(supplyRaw > 0)) {
    throw new Error("Helius getTokenSupply returned no positive supply");
  }
  return { supplyRaw, decimals: parsed.result.value.decimals ?? TOKEN.decimals };
}

/** Normalize one raw getTokenAccounts page into positive-balance holders. */
export function mapTokenAccountsPage(raw: unknown): TokenAccountsPage {
  const parsed = tokenAccountsResponse.parse(raw);
  const rows = parsed.result.token_accounts ?? [];
  const accounts: RawHolder[] = [];
  for (const r of rows) {
    if (!r.owner || r.amount == null || r.amount <= 0) continue;
    accounts.push({ owner: r.owner, amount: r.amount });
  }
  return { accounts, rawCount: rows.length };
}

/** Aggregate paginated accounts by owner (positive balances) into a holder list. */
export function aggregateByOwner(accounts: RawHolder[]): RawHolder[] {
  const byOwner = new Map<string, number>();
  for (const a of accounts) {
    if (!a.owner || !(a.amount > 0)) continue;
    byOwner.set(a.owner, (byOwner.get(a.owner) ?? 0) + a.amount);
  }
  return [...byOwner].map(([owner, amount]) => ({ owner, amount }));
}

// ── Fetch (server-side only) ─────────────────────────────────────────────────

function endpoint(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY is not set");
  return `${RPC_ENDPOINT}/?api-key=${key}`;
}

async function rpc(method: string, params: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(), {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "wizard-tower", method, params }),
    });
    if (!res.ok) throw new Error(`Helius ${method} HTTP ${res.status}`);
    const json = (await res.json()) as { error?: unknown };
    if (json && json.error) {
      throw new Error(`Helius ${method} RPC error: ${JSON.stringify(json.error)}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Live circulating supply (raw base units) + decimals from getTokenSupply. */
export async function getLiveSupply(mint: string = TOKEN.mint): Promise<LiveSupply> {
  return mapSupply(await rpc("getTokenSupply", [mint]));
}

let scanInFlight: Promise<HolderScan> | null = null;

/**
 * Full holder scan: paginate DAS getTokenAccounts by mint (1000/page, paced),
 * aggregate by owner, and fetch live supply. Concurrent calls dedupe onto one
 * pass. Called by the snapshot cron only.
 */
export async function scanHolders(mint: string = TOKEN.mint): Promise<HolderScan> {
  if (scanInFlight) return scanInFlight;
  scanInFlight = doScan(mint).finally(() => {
    scanInFlight = null;
  });
  return scanInFlight;
}

async function doScan(mint: string): Promise<HolderScan> {
  const { supplyRaw, decimals } = await getLiveSupply(mint);

  const all: RawHolder[] = [];
  let tokenAccountCount = 0;
  let page = 1;
  for (; page <= MAX_PAGES; page += 1) {
    const raw = await rpc("getTokenAccounts", {
      mint,
      page,
      limit: PAGE_LIMIT,
      options: { showZeroBalance: false },
    });
    const { accounts, rawCount } = mapTokenAccountsPage(raw);
    tokenAccountCount += rawCount;
    all.push(...accounts);
    // A short page (fewer than the limit) is the last page.
    if (rawCount < PAGE_LIMIT) break;
    await sleep(PAGE_DELAY_MS);
  }

  const holders = aggregateByOwner(all);
  return {
    holders,
    ownerCount: holders.length,
    tokenAccountCount,
    supplyRaw,
    decimals,
    pages: Math.min(page, MAX_PAGES),
    scannedAt: Date.now(),
  };
}
