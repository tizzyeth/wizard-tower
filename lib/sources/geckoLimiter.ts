/**
 * Shared GeckoTerminal request budget (IMPLEMENTATION_PLAN.md §5).
 *
 * GeckoTerminal's free tier allows ~30 requests/min, and that ceiling is SHARED
 * across every GeckoTerminal call this app makes — OHLCV candles (M2, here),
 * the trade tape (M3), and pool discovery (later). A single module-level token
 * bucket throttles all of them within one warm server process so no one feature
 * can starve the others.
 *
 * Design notes:
 *   - We budget conservatively BELOW the real ceiling (25/min, not 30) to leave
 *     headroom for burst and clock skew.
 *   - `acquire()` waits for a token but never longer than MAX_WAIT_MS, so it can
 *     never hang an SSR render: on a truly exhausted budget it throws, and the
 *     caller falls back to its last-good snapshot (stale-while-revalidate) —
 *     a card is degraded, never blank.
 *   - In practice callers sit behind their own 30–60s caches, so real upstream
 *     traffic is a trickle (≈1 call per key per minute) and the bucket is almost
 *     always full. The limiter is the safety valve, not the common path.
 *
 * M3 (trades) MUST import `acquireGeckoToken` here rather than adding a second
 * limiter — that is the whole point of a shared budget.
 */

/** Tokens available at full budget. Below GeckoTerminal's ~30/min ceiling. */
const CAPACITY = 25;
/** Refill rate: CAPACITY tokens per minute, expressed per millisecond. */
const REFILL_PER_MS = CAPACITY / 60_000;
/** Never block a request longer than this; bail to the stale path instead. */
const MAX_WAIT_MS = 3_000;

let tokens = CAPACITY;
let lastRefill = Date.now();

function refill(now: number): void {
  if (now <= lastRefill) return;
  tokens = Math.min(CAPACITY, tokens + (now - lastRefill) * REFILL_PER_MS);
  lastRefill = now;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Consume one token from the shared GeckoTerminal budget, waiting up to
 * MAX_WAIT_MS for one to refill. Throws if the budget is exhausted past that
 * window so the caller can serve last-good data instead of hanging.
 */
export async function acquireGeckoToken(): Promise<void> {
  const start = Date.now();
  for (;;) {
    refill(Date.now());
    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    const waited = Date.now() - start;
    if (waited >= MAX_WAIT_MS) {
      throw new Error("GeckoTerminal rate budget exhausted");
    }
    const untilNextToken = (1 - tokens) / REFILL_PER_MS;
    await sleep(Math.min(untilNextToken, MAX_WAIT_MS - waited) + 5);
  }
}

/** Inspection hook for tests/logging — current whole-token availability. */
export function geckoTokensAvailable(): number {
  refill(Date.now());
  return Math.floor(tokens);
}

/** Test hook — refill the bucket to full between cases. */
export function __resetGeckoLimiter(): void {
  tokens = CAPACITY;
  lastRefill = Date.now();
}
