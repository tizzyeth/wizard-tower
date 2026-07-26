/**
 * Creator-fee route — IMPLEMENTATION_PLAN.md §4 module 10 / §7 M9 ("Mimo's Tribute").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE DOES NOT RETURN A TOTAL
 * ─────────────────────────────────────────────────────────────────────────────
 * M9's definition of done is "ship only if totals verify against pump.fun's
 * displayed creator rewards; else link out". The research spike (2026-07-20)
 * found that the AMOUNT reconciles but the ATTRIBUTION does not, so the card
 * ships the link-out variant and this module returns *structure*, not money.
 *
 * What the spike established, all reproducible from chain state:
 *
 *  1. The coin's on-chain creator is `3ecXTre9LyqzjheLKpiBbsEm29aLLLfm2KidrVjfAAkM`.
 *     Confirmed in two independent places: the pump.fun bonding curve's `creator`
 *     field (account AC1oM8…, offset 49) and the PumpSwap pool's `coin_creator`
 *     field (account Dw4kAH8…). RugCheck's `creator` agrees. pump.fun's frontend
 *     API instead reports `FM1YCKED2KaqB8Uat8aB1nsffR1vezr7s6FAEieXJgke` — the
 *     ORIGINAL deployer, which handed the creator role over on 2026-03-11
 *     (graduation day). pump.fun's own creator-fees endpoint lists both, so the
 *     API `creator` field is a launch-time record, not the live fee recipient.
 *
 *  2. `3ecXTre9…` IS NOT A WALLET. It is a 1024-byte program account owned by
 *     pump.fun's fee-sharing program `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`.
 *     It encodes a SPLIT: N recipients, each with a basis-point share. At the time
 *     of the spike: 2 recipients at 5000 bps (50%) each. So creator fees do not
 *     land in one person's wallet — they fork. That is what this module decodes,
 *     and it is the card's entire argument.
 *
 *  3. Fees exit through the pump.fun creator-vault PDA
 *     `42pktb2NWKesFjxmJ2WU3nVkAuDjepMkn9zpzxkM9T6r`
 *     (seeds ["creator-vault", creator], program 6EF8rrec…). The PumpSwap-era
 *     vault authority (seeds ["creator_vault", creator], program pAMMBay6…) holds
 *     its balance as WSOL in an ATA and forwards through the same PDA — it has
 *     ZERO external outflows, which makes the pump vault a single choke point and
 *     the claim accounting tractable. Cumulative out, as of the spike:
 *     823.603038370 SOL over 1,996 transfers, to THREE destinations (one of which
 *     is no longer in the split config). Plus 0.157431715 SOL then-unclaimed.
 *
 *  4. Ground truth: `GET https://swap-api.pump.fun/v1/coins/{mint}/creator-fees`
 *     → `cumulativeCreatorFee: "824"`. Our 823.76 SOL matches to ~0.03% IF that
 *     field is whole SOL — but the response's own `cumulativeCreatorFeeSOL` says
 *     "0.000000824", which is the same figure divided by 1e9. The endpoint
 *     contradicts itself, so it can only confirm our number to ±0.5 SOL and only
 *     under an inference about units. Recorded at test/fixtures/pumpfun-creator-fees.json.
 *
 * The blocker is (2), not (4): even with a total we trust, we cannot attribute a
 * single lamport to Mimo by name. Two anonymous recipients split it 50/50 and a
 * third received 124.65 SOL under an earlier configuration. Publishing "N SOL to
 * Mimo" on a card that names a real person would be exactly the invented figure
 * M9 forbids. So the card explains the mechanism and links out.
 *
 * TO UPGRADE B → A a future session needs to identify the recipient wallets — a
 * signed statement from Mimo, a wallet published on mimofr.com / @mimofrl, or an
 * attested link between `3Ee23hH…` / `HyPT5NYE…` and the creator. The money math
 * is already solved and reproducible from the notes above; only the attribution
 * is missing. Nothing else is blocking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * House style (mirrors lib/sources/rugcheck.ts and helius.ts, §5):
 *   - zod-validate the RPC envelope at the boundary;
 *   - a PURE decoder (`decodeFeeShareConfig`) so parsing is unit-tested against
 *     test/fixtures/pumpfun-fee-config-account.json;
 *   - module cache + in-flight dedup + stale-while-revalidate (never blank a card);
 *   - server-side only (the Helius key never reaches the client).
 *
 * CAUTION — the fee-share layout is REVERSE-ENGINEERED from account bytes; pump.fun
 * publishes no IDL for `pfeeUxB6…`. The decoder therefore validates aggressively
 * (owner program, embedded mint, recipient count, bps summing to 10000) and returns
 * null rather than guess. A null degrades the card to its static explainer, which
 * is the safe direction: we would rather show no split than a wrong one.
 */

import { z } from "zod";
import { TOKEN } from "@/config/token";

const RPC_ENDPOINT = "https://mainnet.helius-rpc.com";

/** pump.fun's fee-sharing program — the owner of a coin's fee-share config account. */
export const PUMP_FEE_SHARE_PROGRAM = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";

/** Abort a slow upstream so it can never hang an SSR render. */
const FETCH_TIMEOUT_MS = 6_000;
/** The split is structural and changes rarely — an hour is plenty (cf. RugCheck). */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Basis points in a whole — a valid split must sum to exactly this. */
const TOTAL_BPS = 10_000;
/** Sanity bound on the recipient array so a bad decode can't allocate wildly. */
const MAX_RECIPIENTS = 16;

// Byte offsets, verified against the live account (see the fixture). The mint at
// offset 11 is the alignment check: if it does not equal our mint, the layout
// assumption is wrong and we refuse to decode.
const OFF_MINT = 11;
const OFF_ADMIN = 43;
const OFF_COUNT = 76;
const OFF_RECIPIENTS = 80;
/** Each recipient is a 32-byte pubkey followed by a u16 bps share. */
const RECIPIENT_STRIDE = 34;

// ── Boundary validation (zod) ───────────────────────────────────────────────

const accountInfoResponse = z.object({
  result: z.object({
    value: z
      .object({
        owner: z.string(),
        lamports: z.number().nullish(),
        // [base64Data, "base64"]
        data: z.tuple([z.string(), z.string()]).rest(z.unknown()),
      })
      .nullable(),
  }),
});

// ── Public, serializable shapes ─────────────────────────────────────────────

export type FeeRecipient = {
  address: string;
  /** Share in basis points (5000 = 50%). */
  bps: number;
  /** Same share as a percentage, for display. */
  pct: number;
};

export type FeeShareConfig = {
  /** The fee-share config account itself — the coin's on-chain "creator". */
  address: string;
  /** The mint this config belongs to (validated against ours). */
  mint: string;
  /** The account authorized to change the split. */
  admin: string;
  recipients: FeeRecipient[];
  /** Should be 10000; a config that doesn't sum is rejected before we get here. */
  totalBps: number;
};

/**
 * Cumulative creator fees this coin has paid, as pump.fun's own ledger reports
 * them — the same ledger the card links out to.
 *
 * Their `cumulativeCreatorFee` is a plain SOL figure; the sibling
 * `cumulativeCreatorFeeSOL` in the same response is that number divided by 1e9
 * and is simply wrong, so it is ignored. The figure is independently
 * reproducible: summing every outflow from the creator-vault PDA
 * (42pktb2N…) gave 843.97 SOL against their 845 on 2026-07-26 — a 0.12% gap,
 * which is the balance not yet claimed out of the PumpSwap vault. We do not run
 * that scan per request: it is 36 paginated calls, and this figure moves slowly.
 */
const totalSchema = z
  .object({
    cumulativeCreatorFee: z.union([z.string(), z.number()]).nullish(),
    numTrades: z.number().nullish(),
  })
  .loose();

export type CreatorFeeTotal = {
  cumulativeSol: number;
  numTrades: number | null;
  /** Named in the UI — the reader should know whose ledger this is. */
  source: "pump.fun";
};

export type CreatorFeeResult = {
  ok: boolean;
  stale: boolean;
  dataAsOf: number | null;
  data: FeeShareConfig | null;
  error?: string;
};

// ── Pure decoder (testable against the recorded fixture) ────────────────────

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Encode raw bytes as a base58 Solana address.
 *
 * Byte-wise long division rather than BigInt: the project's TypeScript target is
 * below ES2020, so BigInt literals don't compile. `digits` holds the base-58
 * result least-significant-first while we divide.
 */
export function toBase58(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  // Leading zero bytes are encoded as leading '1's, not as base-58 zeros.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  // Drop the high-order zero digits so an all-zero input yields only the '1's.
  let end = digits.length;
  while (end > 0 && digits[end - 1] === 0) end -= 1;

  let out = "1".repeat(zeros);
  for (let i = end - 1; i >= 0; i -= 1) out += B58[digits[i]];
  return out;
}

/**
 * Decode a pump.fun fee-share config account into its recipient split.
 *
 * Returns null (never throws, never guesses) when anything about the account
 * contradicts the reverse-engineered layout: wrong owner program, missing
 * account, embedded mint that isn't ours, an implausible recipient count, a
 * truncated buffer, or shares that don't sum to 10000 bps. The caller degrades
 * to the static explainer on null.
 *
 * `expectedMint` is injectable so the decoder stays pure and the template stays
 * config-first (§6) — it is not read from module scope.
 */
export function decodeFeeShareConfig(
  raw: unknown,
  address: string,
  expectedMint: string = TOKEN.mint,
): FeeShareConfig | null {
  const parsed = accountInfoResponse.safeParse(raw);
  if (!parsed.success) return null;

  const value = parsed.data.result.value;
  if (!value) return null;
  if (value.owner !== PUMP_FEE_SHARE_PROGRAM) return null;

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(value.data[0], "base64"));
  } catch {
    return null;
  }
  if (bytes.length < OFF_RECIPIENTS + RECIPIENT_STRIDE) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Alignment check: the account embeds its own mint. If this doesn't match, our
  // offsets are wrong (or this is a different account shape) — refuse to decode.
  const mint = toBase58(bytes.subarray(OFF_MINT, OFF_MINT + 32));
  if (mint !== expectedMint) return null;

  const count = view.getUint32(OFF_COUNT, true);
  if (count < 1 || count > MAX_RECIPIENTS) return null;
  if (bytes.length < OFF_RECIPIENTS + count * RECIPIENT_STRIDE) return null;

  const recipients: FeeRecipient[] = [];
  let totalBps = 0;
  for (let i = 0; i < count; i += 1) {
    const at = OFF_RECIPIENTS + i * RECIPIENT_STRIDE;
    const bps = view.getUint16(at + 32, true);
    if (bps < 0 || bps > TOTAL_BPS) return null;
    totalBps += bps;
    recipients.push({
      address: toBase58(bytes.subarray(at, at + 32)),
      bps,
      pct: (bps / TOTAL_BPS) * 100,
    });
  }
  // A split that doesn't add up means we mis-read the layout. Don't publish it.
  if (totalBps !== TOTAL_BPS) return null;

  return {
    address,
    mint,
    admin: toBase58(bytes.subarray(OFF_ADMIN, OFF_ADMIN + 32)),
    recipients,
    totalBps,
  };
}

// ── Fetch + cache + stale-while-revalidate ──────────────────────────────────

type CacheEntry = { data: FeeShareConfig; fetchedAt: number };
let cache: CacheEntry | null = null;
let inFlight: Promise<FeeShareConfig | null> | null = null;

function endpoint(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY is not set");
  return `${RPC_ENDPOINT}/?api-key=${key}`;
}

async function fetchAndDecode(address: string): Promise<FeeShareConfig | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(), {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "wizard-tower",
        method: "getAccountInfo",
        params: [address, { encoding: "base64" }],
      }),
    });
    if (!res.ok) throw new Error(`Helius getAccountInfo HTTP ${res.status}`);
    return decodeFeeShareConfig(await res.json(), address);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve the creator-fee split for a coin's on-chain creator account.
 *
 * `creatorAccount` comes from the live RugCheck report (`getSafety().creator`),
 * so nothing about the route is hardcoded. Returns ok:false — never throws — when
 * the account isn't a fee-share config, the key is missing, or upstream is down;
 * the card renders its explainer regardless and simply omits the split.
 */
export async function getCreatorFeeRoute(
  creatorAccount: string | null,
): Promise<CreatorFeeResult> {
  if (!creatorAccount) {
    return { ok: false, stale: false, dataAsOf: null, data: null, error: "no creator account" };
  }

  const now = Date.now();
  if (cache && cache.data.address === creatorAccount && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, stale: false, dataAsOf: cache.fetchedAt, data: cache.data };
  }

  try {
    if (!inFlight) inFlight = fetchAndDecode(creatorAccount);
    const data = await inFlight;
    if (!data) {
      // Decoded to nothing: not a fee-share config (or an unrecognised layout).
      // Keep any last-good split rather than blanking, but say it's stale.
      if (cache) {
        return {
          ok: true,
          stale: true,
          dataAsOf: cache.fetchedAt,
          data: cache.data,
          error: "creator account is not a recognised fee-share config",
        };
      }
      return {
        ok: false,
        stale: false,
        dataAsOf: null,
        data: null,
        error: "creator account is not a recognised fee-share config",
      };
    }
    cache = { data, fetchedAt: Date.now() };
    return { ok: true, stale: false, dataAsOf: cache.fetchedAt, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (cache) {
      return { ok: true, stale: true, dataAsOf: cache.fetchedAt, data: cache.data, error: message };
    }
    return { ok: false, stale: true, dataAsOf: null, data: null, error: message };
  } finally {
    inFlight = null;
  }
}

/** Test hook — reset the module cache between cases. */
export function __clearCreatorFeeCache(): void {
  cache = null;
  inFlight = null;
}

// ── Cumulative total ────────────────────────────────────────────────────────

const TOTAL_TTL_MS = 60 * 60_000;
let totalCache: { data: CreatorFeeTotal; fetchedAt: number } | null = null;
let totalInFlight: Promise<CreatorFeeTotal | null> | null = null;

async function fetchTotal(): Promise<CreatorFeeTotal | null> {
  const res = await fetch(
    `https://swap-api.pump.fun/v1/coins/${TOKEN.mint}/creator-fees`,
    { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`pump.fun creator-fees returned ${res.status}`);
  const json: unknown = await res.json();
  const parsed = totalSchema.safeParse(json);
  if (!parsed.success) return null;

  const sol = Number(parsed.data.cumulativeCreatorFee);
  if (!Number.isFinite(sol) || sol < 0) return null;
  return {
    cumulativeSol: sol,
    numTrades: parsed.data.numTrades ?? null,
    source: "pump.fun",
  };
}

/** Cumulative creator fees, 1h cache, last-good on failure (never blanks the card). */
export async function getCreatorFeeTotal(): Promise<{
  data: CreatorFeeTotal | null;
  stale: boolean;
  dataAsOf: number | null;
}> {
  const now = Date.now();
  if (totalCache && now - totalCache.fetchedAt < TOTAL_TTL_MS) {
    return { data: totalCache.data, stale: false, dataAsOf: totalCache.fetchedAt };
  }
  try {
    totalInFlight ??= fetchTotal();
    const data = await totalInFlight;
    if (!data) return { data: totalCache?.data ?? null, stale: !!totalCache, dataAsOf: totalCache?.fetchedAt ?? null };
    totalCache = { data, fetchedAt: Date.now() };
    return { data, stale: false, dataAsOf: totalCache.fetchedAt };
  } catch {
    return { data: totalCache?.data ?? null, stale: !!totalCache, dataAsOf: totalCache?.fetchedAt ?? null };
  } finally {
    totalInFlight = null;
  }
}
