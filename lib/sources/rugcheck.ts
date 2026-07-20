/**
 * RugCheck source — IMPLEMENTATION_PLAN.md §5, feeds Wards & Protections (M5).
 *
 *   GET https://api.rugcheck.xyz/v1/tokens/{mint}/report
 *
 * Same house style as `lib/sources/dexscreener.ts` (one lib per provider, §5
 * "Implementation rules"):
 *   - zod-validate at the boundary. RugCheck's report is large (~26KB, 40+ top
 *     fields); we validate ONLY the fields the card uses, with a tolerant schema
 *     (everything optional/nullable, numeric strings coerced) so an unrelated
 *     upstream shape change never rejects the whole report;
 *   - a PURE mapper (`mapReport`) that normalizes the raw report into the small
 *     `SafetyReport` the checklist needs — testable against
 *     test/fixtures/rugcheck-report.json;
 *   - a module-level cache with a 1h TTL + in-flight dedup (the 1h cache IS the
 *     politeness here — the endpoint needs no key, so we simply don't hammer it);
 *   - stale-while-revalidate: on any upstream failure serve the last-good report
 *     flagged `stale` with a `dataAsOf` timestamp — never blank the card.
 *
 * The pass/warn/fail *evaluation* is intentionally NOT here: it lives as a pure,
 * config-driven function in `lib/metrics/safety.ts` (§6, the rubric). This module
 * only fetches and normalizes.
 *
 * ADAPTATION (orchestrator decision, M5 runs before M4): plan §4 lists Helius as
 * a secondary source for this card, but there is no Helius key yet. Every row is
 * derived from the RugCheck report plus data already in the app — top-10
 * concentration and creator holdings from RugCheck's `topHolders`/`creator`
 * fields here; token age from the market's earliest `pairCreatedAt` (computed in
 * dexscreener.ts) at the evaluation step. See the TODO on concentration below.
 *
 * No API key required. All fetching is server-side only.
 *
 * NOTE (for M4): the cache below is module-level in-memory — within a warm server
 * process it dedupes and preserves last-good across upstream blips, but a cold
 * serverless invocation starts empty. Durable cross-cold-start persistence is the
 * `kv_cache` table introduced in M4; migrate this (and the other module caches)
 * there when it lands.
 */

import { z } from "zod";
import { TOKEN } from "@/config/token";
import { kvGet, kvSet } from "@/lib/kv";

const ENDPOINT = "https://api.rugcheck.xyz/v1/tokens";

/** kv_cache key for the durable last-good report (L2 behind the in-memory L1). */
const KV_KEY = "rugcheck:report";

/** Serve the cached report without re-fetching if it is younger than this (§5: 1h). */
const CACHE_TTL_MS = 60 * 60 * 1000;
/** Abort a slow upstream so it can never hang an SSR render. */
const FETCH_TIMEOUT_MS = 6_000;
/** How many non-excluded holders make up the "top-10" concentration figure. */
const TOP_N = 10;

/**
 * Canonical Solana burn / incinerator address — excluded from concentration
 * (§6 "Concentration math"). The system program is intentionally NOT treated as
 * a burn address for tokens.
 */
const BURN_ADDRESSES = new Set(["1nc1nerator11111111111111111111111111111111"]);

/** knownAccounts types whose holdings are protocol-owned, not a real holder (§6). */
const EXCLUDED_ACCOUNT_TYPES = new Set(["amm", "locker"]);

// ── Boundary validation (zod, tolerant) ─────────────────────────────────────
// RugCheck returns some numbers as strings and omits fields on thin markets, so
// every extracted field is optional/nullable and numeric strings are coerced.

const numeric = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

const knownAccount = z
  .object({ name: z.string().nullish(), type: z.string().nullish() })
  .loose();

const topHolder = z.object({
  address: z.string(),
  owner: z.string().nullish(),
  pct: numeric,
  amount: numeric,
});

const riskItem = z
  .object({
    name: z.string().nullish(),
    level: z.string().nullish(), // "warn" | "danger" | …
    score: numeric,
    description: z.string().nullish(),
  })
  .loose();

const marketLp = z
  .object({
    lpLockedPct: numeric,
    lpLockedUSD: numeric,
    lpTotalSupply: numeric,
  })
  .loose();

const market = z.object({
  pubkey: z.string().nullish(),
  marketType: z.string().nullish(),
  lp: marketLp.nullish(),
});

const reportSchema = z.object({
  mint: z.string().nullish(),
  creator: z.string().nullish(),
  creatorBalance: numeric,
  token: z.object({ supply: numeric, decimals: numeric }).nullish(),
  mintAuthority: z.string().nullish(),
  freezeAuthority: z.string().nullish(),
  topHolders: z.array(topHolder).nullish(),
  knownAccounts: z.record(z.string(), knownAccount).nullish(),
  risks: z.array(riskItem).nullish(),
  score: numeric,
  score_normalised: numeric,
  markets: z.array(market).nullish(),
  totalHolders: numeric,
  rugged: z.boolean().nullish(),
  detectedAt: z.string().nullish(),
});

// ── Public, serializable shapes (safe to pass server → client) ──────────────

export type RiskItem = {
  name: string;
  level: string | null; // normalized lower-case: "warn" | "danger" | null
  score: number | null;
  description: string | null;
};

export type SafetyReport = {
  mint: string;
  /** Mint authority address if present; null means it has been revoked. */
  mintAuthority: string | null;
  mintAuthorityRevoked: boolean;
  freezeAuthority: string | null;
  freezeAuthorityRevoked: boolean;
  /** LP locked % of the primary market's LP supply, or null if unmeasurable. */
  lpLockedPct: number | null;
  lpLockedUsd: number | null;
  /** Which market the LP figure came from (transparency in the UI). */
  lpMarketPubkey: string | null;
  lpMarketType: string | null;
  /** Top-10 concentration, % of supply, AMM pools / lockers / burn excluded. */
  top10Pct: number | null;
  /** Raw top-10 including everything (shown as context — pools inflate it). */
  top10PctRaw: number | null;
  /** How many top holders were excluded as pools / lockers / burn. */
  concentrationExcluded: number;
  /** Non-excluded holders available (≤ RugCheck's top-20 window). */
  concentrationSampleSize: number;
  /**
   * Herfindahl-Hirschman index over the real (non-pool) holders in RugCheck's
   * top-20 window: Σ(pct²) on percent shares, range 0–10000. A LOWER BOUND on the
   * true HHI — the untracked long tail adds only negligible squared weight, but
   * M4's full Helius holder set refines it. Null when no real holders are known.
   * Feeds the Verdict's Distribution axis (M7).
   */
  hhiTop20: number | null;
  creator: string | null;
  /** Creator wallet holdings as a % of supply (creatorBalance / supply). */
  creatorPct: number | null;
  /**
   * Owner addresses RugCheck labels as AMM pools (from `knownAccounts` + every
   * `markets[].pubkey`). The M4 holder pipeline builds its exclusion label map
   * from these (a pool's vault is owned by the pool address), so concentration
   * excludes every labeled pool across the whole holder set (§6), not just the
   * ones that happen to land in RugCheck's top-20 window.
   */
  poolAddresses: string[];
  /** Owner addresses RugCheck labels as lockers — also excluded from concentration. */
  lockerAddresses: string[];
  risks: RiskItem[];
  riskCount: number;
  /** Raw RugCheck risk score (sum of risk weights; 0 = clean). */
  score: number | null;
  /** RugCheck's normalized score (0 = clean; lower is safer). */
  scoreNormalised: number | null;
  totalHolders: number | null;
  rugged: boolean;
  /** RugCheck's first-seen timestamp (ms) — a fallback token-age source. */
  detectedAt: number | null;
};

export type SafetyResult = {
  /** True when we have a report to show (fresh or last-good). */
  ok: boolean;
  /** True when serving a last-good report after a failed refresh. */
  stale: boolean;
  /** When the served report was fetched from upstream (ms). */
  dataAsOf: number | null;
  data: SafetyReport | null;
  /** Human reason, present on stale/error for logs and the banner sub-text. */
  error?: string;
};

// ── Pure mapper (testable against test/fixtures/rugcheck-report.json) ────────

type KnownAccounts = Record<string, { name?: string | null; type?: string | null }>;

/** Lower-cased knownAccounts type for an address (by the account or its owner). */
function accountType(
  known: KnownAccounts,
  address: string | null | undefined,
): string | null {
  if (!address) return null;
  const t = known[address]?.type;
  return t ? t.toLowerCase() : null;
}

/**
 * True when a holder is a protocol account (AMM pool / locker / burn), which §6
 * excludes from concentration. A pool's token vault is a distinct account whose
 * `owner` is the labeled pool, so we check both the holder address and its owner.
 *
 * TODO(M4): this labeling is only as complete as RugCheck's `knownAccounts` and
 * its top-20 window. M4's Helius full-holder scan + dynamic pool discovery will
 * refine concentration — excluding every labeled pool/locker account across the
 * whole holder set (plan §6), not just those RugCheck happens to label here.
 */
function isProtocolHolder(
  known: KnownAccounts,
  h: { address: string; owner?: string | null },
): boolean {
  if (BURN_ADDRESSES.has(h.address) || (h.owner && BURN_ADDRESSES.has(h.owner))) {
    return true;
  }
  const byAddr = accountType(known, h.address);
  const byOwner = accountType(known, h.owner);
  return (
    (byAddr != null && EXCLUDED_ACCOUNT_TYPES.has(byAddr)) ||
    (byOwner != null && EXCLUDED_ACCOUNT_TYPES.has(byOwner))
  );
}

/** Pick the market that best represents "the LP" — the configured main pool if it
 *  has a real LP supply, else the market with the most locked LP value. DLMM/CLMM
 *  markets have no fungible LP token (lpTotalSupply 0), so they are skipped. */
function pickLpMarket(
  markets: Array<z.infer<typeof market>>,
): { pct: number | null; usd: number | null; pubkey: string | null; type: string | null } {
  const withLp = markets.filter((m) => (m.lp?.lpTotalSupply ?? 0) > 0);
  if (withLp.length === 0) {
    return { pct: null, usd: null, pubkey: null, type: null };
  }
  const primary = withLp.find((m) => m.pubkey === TOKEN.mainPool);
  const chosen =
    primary ??
    withLp.reduce((best, m) => ((m.lp?.lpLockedUSD ?? 0) > (best.lp?.lpLockedUSD ?? 0) ? m : best));
  return {
    pct: chosen.lp?.lpLockedPct ?? null,
    usd: chosen.lp?.lpLockedUSD ?? null,
    pubkey: chosen.pubkey ?? null,
    type: chosen.marketType ?? null,
  };
}

/**
 * Normalize the raw RugCheck report into the compact `SafetyReport` the card and
 * the rubric consume. Pure — no fetching, no clock — so the tests can pin every
 * derived value against the recorded fixture.
 */
export function mapReport(raw: unknown): SafetyReport {
  const r = reportSchema.parse(raw);

  const known: KnownAccounts = r.knownAccounts ?? {};
  const holders = (r.topHolders ?? []).map((h) => ({
    address: h.address,
    owner: h.owner ?? null,
    pct: h.pct ?? 0,
  }));

  // Concentration excluding protocol accounts (§6). "Top-10" is the ten largest
  // *real* holders — after dropping pools/lockers/burn from the ranked set.
  const realHolders = holders.filter((h) => !isProtocolHolder(known, h));
  const top10Pct = realHolders.length
    ? realHolders.slice(0, TOP_N).reduce((s, h) => s + h.pct, 0)
    : null;
  const top10PctRaw = holders.length
    ? holders.slice(0, TOP_N).reduce((s, h) => s + h.pct, 0)
    : null;

  // HHI over the real holders in the top-20 window (§4 "HHI concentration meter",
  // partial until M4). Σ(pct²) on percent shares — a lower bound on the true HHI.
  const hhiTop20 = realHolders.length
    ? realHolders.reduce((s, h) => s + h.pct * h.pct, 0)
    : null;

  // Creator holdings as a % of supply. creatorBalance and token.supply are both
  // raw base units from RugCheck, so the ratio is decimals-independent.
  const supplyRaw = r.token?.supply ?? null;
  const creatorBalance = r.creatorBalance ?? null;
  const creatorPct =
    creatorBalance != null && supplyRaw != null && supplyRaw > 0
      ? (creatorBalance / supplyRaw) * 100
      : creatorBalance === 0
        ? 0
        : null;

  const lp = pickLpMarket(r.markets ?? []);

  // Pool / locker owner addresses for the M4 concentration exclusion map. AMM +
  // LOCKER labels from knownAccounts, plus every market pubkey (a labeled pool).
  const poolSet = new Set<string>();
  const lockerSet = new Set<string>();
  for (const [addr, acct] of Object.entries(known)) {
    const t = acct.type ? acct.type.toLowerCase() : null;
    if (t === "amm") poolSet.add(addr);
    else if (t === "locker") lockerSet.add(addr);
  }
  for (const m of r.markets ?? []) {
    if (m.pubkey) poolSet.add(m.pubkey);
  }

  const risks: RiskItem[] = (r.risks ?? []).map((x) => ({
    name: x.name ?? "risk",
    level: x.level ? x.level.toLowerCase() : null,
    score: x.score ?? null,
    description: x.description ?? null,
  }));

  const detectedAt =
    r.detectedAt != null && Number.isFinite(Date.parse(r.detectedAt))
      ? Date.parse(r.detectedAt)
      : null;

  return {
    mint: r.mint ?? TOKEN.mint,
    mintAuthority: r.mintAuthority ?? null,
    mintAuthorityRevoked: (r.mintAuthority ?? null) === null,
    freezeAuthority: r.freezeAuthority ?? null,
    freezeAuthorityRevoked: (r.freezeAuthority ?? null) === null,
    lpLockedPct: lp.pct,
    lpLockedUsd: lp.usd,
    lpMarketPubkey: lp.pubkey,
    lpMarketType: lp.type,
    top10Pct,
    top10PctRaw,
    concentrationExcluded: holders.length - realHolders.length,
    concentrationSampleSize: realHolders.length,
    hhiTop20,
    creator: r.creator ?? null,
    creatorPct,
    poolAddresses: [...poolSet],
    lockerAddresses: [...lockerSet],
    risks,
    riskCount: risks.length,
    score: r.score ?? null,
    scoreNormalised: r.score_normalised ?? null,
    totalHolders: r.totalHolders ?? null,
    rugged: r.rugged ?? false,
    detectedAt,
  };
}

// ── Fetch + cache + stale-while-revalidate ──────────────────────────────────

type CacheEntry = { data: SafetyReport; fetchedAt: number };
let cache: CacheEntry | null = null;
let inFlight: Promise<SafetyReport> | null = null;

async function fetchAndMap(simulateFailure: boolean): Promise<SafetyReport> {
  if (simulateFailure) {
    // Dev-only fault injection (see the route handler) to exercise the stale path.
    throw new Error("Simulated RugCheck outage (fault injection)");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}/${TOKEN.mint}/report`, {
      // We own the freshness window (1h) + last-good fallback, so bypass Next's
      // data cache for deterministic, testable behavior.
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`RugCheck HTTP ${res.status}`);
    const json = await res.json();
    return mapReport(json);
  } finally {
    clearTimeout(timeout);
  }
}

type GetSafetyOptions = {
  /** Bypass the fresh-cache short-circuit and force an upstream attempt. */
  forceRefresh?: boolean;
  /** Dev-only: make the upstream attempt fail to prove the stale banner. */
  simulateFailure?: boolean;
};

/**
 * The one entry point the card seed + the API route call. Returns a fresh report,
 * the last-good report flagged `stale`, or an honest error (never throws for a
 * routine upstream failure). The 1h cache means a second call within the TTL is
 * served from memory with no upstream request at all.
 */
export async function getSafety(options: GetSafetyOptions = {}): Promise<SafetyResult> {
  const { forceRefresh = false, simulateFailure = false } = options;
  const now = Date.now();

  // L2 warm-up (M4): on a cold in-memory cache, seed from the durable kv_cache so
  // a fresh serverless instance serves last-good instantly — and skips upstream
  // entirely when the durable copy is still within the 1h window. Best-effort:
  // kvGet returns null with no database (e2e) or on error. Skipped for the dev
  // fault path so the simulated outage still exercises the cold-cache branch.
  if (!cache && !simulateFailure) {
    const durable = await kvGet<SafetyReport>(KV_KEY);
    if (durable) cache = { data: durable.value, fetchedAt: durable.updatedAt };
  }

  if (!forceRefresh && !simulateFailure && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, stale: false, dataAsOf: cache.fetchedAt, data: cache.data };
  }

  // The dev fault path (forced/simulated) always runs standalone so it can never
  // share or poison the deduped promise of a concurrent real refresh.
  const standalone = forceRefresh || simulateFailure;

  try {
    let data: SafetyReport;
    if (standalone) {
      data = await fetchAndMap(simulateFailure);
    } else {
      // Dedupe concurrent refreshes into a single upstream call.
      if (!inFlight) inFlight = fetchAndMap(false);
      data = await inFlight;
    }
    cache = { data, fetchedAt: Date.now() };
    // Write-through to the durable L2 so the fresh report survives cold starts.
    await kvSet(KV_KEY, data);
    return { ok: true, stale: false, dataAsOf: cache.fetchedAt, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (cache) {
      // Serve last-good, flagged stale — the wards were last inspected earlier.
      return { ok: true, stale: true, dataAsOf: cache.fetchedAt, data: cache.data, error: message };
    }
    return { ok: false, stale: true, dataAsOf: null, data: null, error: message };
  } finally {
    if (!standalone) inFlight = null;
  }
}

/** Test/inspection hook — reset the module cache between fault-injection checks. */
export function __clearSafetyCache(): void {
  cache = null;
  inFlight = null;
}

/** Test/inspection hook — read whether a fresh (non-stale) entry is cached. */
export function __safetyCacheAgeMs(nowMs: number = Date.now()): number | null {
  return cache ? nowMs - cache.fetchedAt : null;
}
