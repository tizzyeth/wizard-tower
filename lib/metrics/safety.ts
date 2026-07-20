/**
 * Safety rubric — IMPLEMENTATION_PLAN.md §7 (Wards & Protections) + §6.
 *
 * Pure, config-driven pass/warn/fail evaluation of a normalized `SafetyReport`
 * (from `lib/sources/rugcheck.ts`) into the checklist rows the card renders. This
 * is "a rubric, not an oracle": every row carries its measured value AND the
 * threshold it was judged against, and the thresholds themselves live in
 * `config/token.ts` (`THRESHOLDS.safety`) — nothing magic is decided here.
 *
 * Kept separate from the source (like `merge-trades.ts` is separate from
 * `gecko-trades.ts`, §6) so it can be unit-tested in isolation: against the
 * recorded fixture (via `mapReport`) and against synthetic reports that exercise
 * the warn/fail branches the clean live token never hits.
 */

import { THRESHOLDS } from "@/config/token";
import { fmtAge } from "@/lib/format";
import type { SafetyReport } from "@/lib/sources/rugcheck";

export type CheckStatus = "pass" | "warn" | "fail";

export type CheckKey =
  | "mint"
  | "freeze"
  | "lpLocked"
  | "top10"
  | "rugcheck"
  | "creator"
  | "age";

export type SafetyCheck = {
  key: CheckKey;
  /** Row label, in the plan's "revoked / locked" affirmative framing. */
  label: string;
  status: CheckStatus;
  /** The measured reading, e.g. "revoked", "93.9%", "0 risks · score 1". */
  measured: string;
  /** The band this row is judged against, e.g. "≥ 80%", "≤ 30%", "must be null". */
  threshold: string;
  /** Optional extra context, e.g. "pools & lockers excluded". */
  note?: string;
};

export type SafetyChecklist = {
  checks: SafetyCheck[];
  passCount: number;
  warnCount: number;
  failCount: number;
  /** The worst status across all rows — drives the card's one-line summary. */
  overall: CheckStatus;
};

export type EvaluateOptions = {
  /** Earliest pool creation (ms) from the market data — the token-age source. */
  launchedAt?: number | null;
  /** Injectable clock so token-age is deterministic in tests. */
  nowMs?: number;
  /**
   * M4: prefer the holders-pipeline concentration for the top-10 row when a
   * snapshot exists — the full-holder-set, pool/locker-excluded figure, rather
   * than RugCheck's top-20 window. Omitted → the RugCheck figure is used (the
   * original behavior; every existing test path).
   */
  refinedTop10?: { pct: number | null; excludedCount: number | null } | null;
};

const T = THRESHOLDS.safety;

/** Higher-is-safer band: value ≥ pass → pass, ≥ warn → warn, else fail. */
function bandHigher(value: number | null, band: { pass: number; warn: number }): CheckStatus {
  if (value == null || !Number.isFinite(value)) return "warn"; // unmeasurable → caution
  if (value >= band.pass) return "pass";
  if (value >= band.warn) return "warn";
  return "fail";
}

/** Lower-is-safer band: value ≤ pass → pass, ≤ warn → warn, else fail. */
function bandLower(value: number | null, band: { pass: number; warn: number }): CheckStatus {
  if (value == null || !Number.isFinite(value)) return "warn";
  if (value <= band.pass) return "pass";
  if (value <= band.warn) return "warn";
  return "fail";
}

/** The more severe of two statuses (fail beats warn beats pass). */
function worst(a: CheckStatus, b: CheckStatus): CheckStatus {
  const rank: Record<CheckStatus, number> = { pass: 0, warn: 1, fail: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function pct1(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`;
}

/**
 * Map RugCheck's risk score + risk list to a status. Score is lower-is-safer
 * (verified against the clean $WIZARD fixture: score 1, 0 risks). Any explicitly
 * danger-level risk forces a fail and any warn-level risk forces at least a warn,
 * regardless of the numeric score — a labeled risk should never hide behind a low
 * score.
 */
function evaluateRugcheck(report: SafetyReport): CheckStatus {
  let status = bandLower(report.scoreNormalised, T.rugScore);
  for (const risk of report.risks) {
    if (risk.level === "danger") status = worst(status, "fail");
    else if (risk.level === "warn") status = worst(status, "warn");
  }
  return status;
}

/**
 * Turn a normalized report into the seven-row checklist (plan §4 module 7).
 * Token age comes from the market's earliest `pairCreatedAt` (`launchedAt`); if
 * that is unavailable we fall back to RugCheck's own first-seen `detectedAt`.
 */
export function evaluateChecklist(
  report: SafetyReport,
  options: EvaluateOptions = {},
): SafetyChecklist {
  const nowMs = options.nowMs ?? Date.now();
  const launchedAt = options.launchedAt ?? report.detectedAt ?? null;
  const ageDays =
    launchedAt != null && Number.isFinite(launchedAt)
      ? Math.max(0, (nowMs - launchedAt) / 86_400_000)
      : null;

  const checks: SafetyCheck[] = [
    {
      key: "mint",
      label: "Mint authority revoked",
      status: report.mintAuthorityRevoked ? "pass" : "fail",
      measured: report.mintAuthorityRevoked ? "revoked" : "still held",
      threshold: "must be revoked",
      note: report.mintAuthorityRevoked ? undefined : "supply can be inflated",
    },
    {
      key: "freeze",
      label: "Freeze authority revoked",
      status: report.freezeAuthorityRevoked ? "pass" : "fail",
      measured: report.freezeAuthorityRevoked ? "revoked" : "still held",
      threshold: "must be revoked",
      note: report.freezeAuthorityRevoked ? undefined : "transfers can be frozen",
    },
    {
      key: "lpLocked",
      label: "Liquidity locked",
      status: bandHigher(report.lpLockedPct, T.lpLockedPct),
      measured: pct1(report.lpLockedPct),
      threshold: `≥ ${T.lpLockedPct.pass}%`,
      note: report.lpMarketType ? `${report.lpMarketType} pool` : undefined,
    },
    (() => {
      // Prefer the M4 full-holder-set concentration when a snapshot is supplied;
      // fall back to RugCheck's top-20 window otherwise.
      const refined = options.refinedTop10 ?? null;
      const top10 = refined && refined.pct != null ? refined.pct : report.top10Pct;
      const excluded = refined ? refined.excludedCount : report.concentrationExcluded;
      const note =
        excluded != null && excluded > 0
          ? `${excluded} pool/locker excluded${refined ? " · full census" : ""}`
          : refined
            ? "pools & lockers excluded · full census"
            : "pools & lockers excluded";
      return {
        key: "top10" as const,
        label: "Top-10 concentration",
        status: bandLower(top10, T.top10Pct),
        measured: pct1(top10),
        threshold: `≤ ${T.top10Pct.pass}%`,
        note,
      };
    })(),
    {
      key: "rugcheck",
      label: "RugCheck risks",
      status: evaluateRugcheck(report),
      measured:
        report.riskCount === 0
          ? `0 risks · score ${report.scoreNormalised ?? "—"}`
          : `${report.riskCount} risk${report.riskCount === 1 ? "" : "s"} · score ${report.scoreNormalised ?? "—"}`,
      threshold: `score ≤ ${T.rugScore.pass}`,
      note: report.rugged ? "flagged rugged" : undefined,
    },
    {
      key: "creator",
      label: "Creator holdings",
      status: bandLower(report.creatorPct, T.creatorPct),
      measured: report.creatorPct == null ? "—" : pct1(report.creatorPct),
      threshold: `≤ ${T.creatorPct.pass}%`,
    },
    {
      key: "age",
      label: "Token age",
      status: bandHigher(ageDays, T.ageDays),
      measured: launchedAt == null ? "—" : fmtAge(launchedAt, nowMs),
      threshold: `≥ ${T.ageDays.pass}d`,
    },
  ];

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  let overall: CheckStatus = "pass";
  for (const c of checks) {
    if (c.status === "pass") passCount += 1;
    else if (c.status === "warn") warnCount += 1;
    else failCount += 1;
    overall = worst(overall, c.status);
  }

  return { checks, passCount, warnCount, failCount, overall };
}
