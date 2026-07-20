/**
 * Posting cadence — the Community axis input for The Wizard's Verdict (M6/M7,
 * plan §4 module 11). PURE and clock-injectable so it is unit-tested in isolation
 * (test/x.test.ts) like the other metrics (concentration, verdict).
 *
 * Cadence = posts per week across the recorded feeds over a trailing window. It
 * reads volume, not sentiment: an active community that keeps talking is a
 * healthier sign than a silent one (the band lives in THRESHOLDS.verdict.postingCadence).
 *
 * Awaiting vs. silent — an important distinction the Verdict relies on:
 *   - NO history at all (empty buffer, poller has never filled it) → null. The
 *     Community axis then renders "awaiting" and is excluded from the roll-up
 *     (never scored as zero — we genuinely don't know yet).
 *   - History exists but nothing landed in the window → 0. That is a real signal
 *     (the coven has gone quiet lately) and is scored as a fail.
 */

const DAY_MS = 86_400_000;

/**
 * Posts per week over the trailing `windowDays`, from all known post timestamps
 * (ms). Returns null when there is no history at all, else the rate (0 when history
 * exists but none is recent).
 */
export function postingCadencePerWeek(
  createdAtMs: Array<number | null | undefined>,
  nowMs: number = Date.now(),
  windowDays = 28,
): number | null {
  const valid = createdAtMs.filter((t): t is number => t != null && Number.isFinite(t));
  if (valid.length === 0) return null; // no history → awaiting, not zero
  const cutoff = nowMs - windowDays * DAY_MS;
  const inWindow = valid.filter((t) => t >= cutoff && t <= nowMs).length;
  const weeks = windowDays / 7;
  return inWindow / weeks;
}
