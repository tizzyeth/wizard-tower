/**
 * The Wizard's Verdict — the transparent five-axis rubric (IMPLEMENTATION_PLAN.md
 * §4 module 11, §7). PURE and config-driven: it takes already-normalized inputs
 * (from the market / safety / trades sources) and turns them into the axis rows +
 * overall roll-up the gold callout card renders. All thresholds live in
 * `config/token.ts` (`THRESHOLDS.verdict`, reusing `THRESHOLDS.safety` where the
 * two rubrics share a band) — nothing magic is decided here.
 *
 * This is "a rubric, not an oracle": every axis exposes its inputs, each input's
 * measured value AND the threshold it was judged against, and the direction the
 * band runs. The overall score is a plain equal-weight mean of the axes that have
 * data — no hidden weighting.
 *
 * DESIGN — axes declare their inputs; a data-less axis is honest, not zero (§7):
 *   - Each axis is built from a list of inputs. A numeric input with a null value
 *     is "unmeasured" and is dropped from that axis's mean (it neither helps nor
 *     hurts the score).
 *   - An axis whose inputs are ALL unmeasured has status "awaiting-data": it shows
 *     an in-character "not yet heard" line and is EXCLUDED from the overall
 *     roll-up (never scored as zero). Community is always awaiting-data in M7 (the
 *     X feed is M6, blocked on a key).
 *   - An axis scored off incomplete inputs is flagged `partial` (Distribution: a
 *     top-20 holder window until M4; Activity: the exchange's rolling ≤300-trade /
 *     ≤24h window can clip 24h, until M10's trade archive covers it). The score
 *     still counts; the caveat is shown.
 *
 * The overall is labeled with how many axes contributed ("4 of 5 wards speak").
 *
 * Kept separate from every source (like `merge-trades.ts` and `safety.ts`) so it
 * is unit-tested in isolation — against the recorded fixtures and against
 * synthetic inputs that exercise the warn/fail/awaiting branches the clean live
 * token never hits (test/verdict.test.ts).
 */

import { THRESHOLDS } from "@/config/token";
import type { SafetyChecklist, CheckStatus, CheckKey } from "@/lib/metrics/safety";
import {
  fmtInt,
  fmtRatioPct,
  fmtUsdCompact,
} from "@/lib/format";

const V = THRESHOLDS.verdict;
const S = THRESHOLDS.safety;

// ── Bands (pure, local so the engine stays decoupled from safety.ts internals) ─

/** pass/warn/fail — shared vocabulary with the safety rubric, same runes in the UI. */
export type Band = CheckStatus; // "pass" | "warn" | "fail"
export type AxisStatus = "scored" | "awaiting-data";
export type InputDirection = "higher" | "lower" | "boolean";

type NumBand = { pass: number; warn: number };

/** Higher-is-safer: value ≥ pass → pass, ≥ warn → warn, else fail. */
function bandHigher(value: number, b: NumBand): Band {
  if (value >= b.pass) return "pass";
  if (value >= b.warn) return "warn";
  return "fail";
}

/** Lower-is-safer: value ≤ pass → pass, ≤ warn → warn, else fail. */
function bandLower(value: number, b: NumBand): Band {
  if (value <= b.pass) return "pass";
  if (value <= b.warn) return "warn";
  return "fail";
}

function pointsFor(status: Band): number {
  return status === "pass" ? V.points.pass : status === "warn" ? V.points.warn : V.points.fail;
}

/** Map a 0–100 axis/overall score to a band via the config cut-offs. */
function bandFromScore(score: number): Band {
  if (score >= V.band.strong) return "pass";
  if (score >= V.band.fair) return "warn";
  return "fail";
}

// ── Public, serializable shapes (safe server → client) ──────────────────────

export type AxisInput = {
  key: string;
  /** What the input measures, e.g. "Top-10 concentration". */
  label: string;
  /** Raw measured value; null = unmeasured (dropped from the axis mean). */
  value: number | boolean | null;
  /** Display string for the value, e.g. "23.1%", "revoked", "0.24×". */
  display: string;
  /** The band it was judged against, e.g. "≤ 30%", "revoked", "≥ 0.75×". */
  threshold: string;
  direction: InputDirection;
  /** pass/warn/fail, or null when unmeasured. */
  status: Band | null;
  /** 0–100 points contributed, or null when unmeasured. */
  points: number | null;
  note?: string;
};

export type AxisKey = "safety" | "distribution" | "liquidity" | "activity" | "community";

export type VerdictAxis = {
  key: AxisKey;
  /** Axis name, e.g. "Safety". */
  label: string;
  /** Functional subtitle, e.g. "depth · liquidity-to-mcap". */
  subtitle: string;
  status: AxisStatus;
  /** 0–100, or null when awaiting-data. */
  score: number | null;
  band: Band | null;
  inputs: AxisInput[];
  /** Scored off incomplete inputs — the score counts, the caveat is shown. */
  partial: boolean;
  /** In-character caveat (partial) or explanation (awaiting-data). */
  note?: string;
};

export type Verdict = {
  axes: VerdictAxis[];
  /** Overall 0–100, mean of the scored axes only; null if none scored. */
  score: number | null;
  band: Band | null;
  /** How many axes contributed to the overall. */
  contributing: number;
  /** Total axes (5). */
  total: number;
  /** In-character one-liner keyed to the overall band. */
  headline: string;
  /** "4 of 5 wards speak" — how many axes had data. */
  summary: string;
};

// ── Raw inputs the engine consumes (assembled from the app's data shapes) ────

export type VerdictInputs = {
  /** Reuses the safety checklist (plan §7: "reuse evaluateChecklist"). Null before data. */
  safetyChecklist: SafetyChecklist | null;
  distribution: {
    top10Pct: number | null;
    hhiTop20: number | null;
    /** Real (non-excluded) holders behind the figures — sizes the note. */
    sampleSize: number;
    /**
     * True = a windowed sample (RugCheck's top-20) → the axis stays `partial`.
     * False = the full holder set from the M4 snapshot pipeline → `partial` off
     * and the HHI note reads "full holder set". Defaults true (backward compatible
     * with the RugCheck-only path).
     */
    windowed?: boolean;
  } | null;
  liquidity: {
    totalLiquidityUsd: number | null;
    liqToMcap: number | null;
  } | null;
  activity: {
    volume24hUsd: number | null;
    /** Trailing 30d average DAILY volume (the baseline the 24h figure is judged against). */
    avgDailyVolume30d: number | null;
    uniqueTraders24h: number | null;
    /**
     * False when the trader count is a floor rather than a census — i.e. the source
     * did not demonstrably span the full 24h. True once M10's trade archive covers
     * the window, which flips this axis from `partial` to fully scored.
     */
    fullyCovered: boolean;
    /**
     * Where the trader count came from (M10). Only changes the CAVEAT WORDING, never
     * the score: "archive" = counted from our own `trades` table, "window" = derived
     * from the exchange's rolling ≤300-trade/≤24h window.
     */
    source?: "archive" | "window";
  } | null;
  /**
   * Community posting cadence — posts per week across both feeds over 28d, from the
   * x_posts buffer (M6). Null = no posts recorded yet → the axis stays awaiting.
   */
  community: { postingCadence: number | null } | null;
};

// ── Input builders ───────────────────────────────────────────────────────────

/** A measured numeric input scored by its band + direction. */
function numericInput(args: {
  key: string;
  label: string;
  value: number | null;
  band: NumBand;
  direction: "higher" | "lower";
  display: (v: number) => string;
  threshold: string;
  note?: string;
}): AxisInput {
  const { key, label, value, band, direction, display, threshold, note } = args;
  if (value == null || !Number.isFinite(value)) {
    return { key, label, value: null, display: "—", threshold, direction, status: null, points: null, note };
  }
  const status = direction === "higher" ? bandHigher(value, band) : bandLower(value, band);
  return { key, label, value, display: display(value), threshold, direction, status, points: pointsFor(status), note };
}

/** Convert a reused safety-checklist row into an axis input (no re-derivation). */
function checklistInput(checklist: SafetyChecklist, key: CheckKey, label?: string): AxisInput {
  const row = checklist.checks.find((c) => c.key === key)!;
  const isBool = key === "mint" || key === "freeze";
  return {
    key,
    label: label ?? row.label,
    value: isBool ? row.status === "pass" : null,
    display: row.measured,
    threshold: row.threshold,
    direction: isBool ? "boolean" : "higher",
    status: row.status,
    points: pointsFor(row.status),
    note: row.note,
  };
}

/** Fold a list of inputs into an axis: mean of measured inputs, or awaiting-data. */
function assembleAxis(args: {
  key: AxisKey;
  label: string;
  subtitle: string;
  inputs: AxisInput[];
  /** Extra partial flag (e.g. Distribution's window, Activity's clipped cap). */
  forcePartial?: boolean;
  partialNote?: string;
  awaitingNote: string;
}): VerdictAxis {
  const { key, label, subtitle, inputs, forcePartial, partialNote, awaitingNote } = args;
  const measured = inputs.filter((i) => i.points != null);

  if (measured.length === 0) {
    return { key, label, subtitle, status: "awaiting-data", score: null, band: null, inputs, partial: false, note: awaitingNote };
  }

  const score = measured.reduce((s, i) => s + (i.points as number), 0) / measured.length;
  const partial = Boolean(forcePartial) || measured.length < inputs.length;
  return {
    key,
    label,
    subtitle,
    status: "scored",
    score,
    band: bandFromScore(score),
    inputs,
    partial,
    note: partial ? partialNote : undefined,
  };
}

// ── The five axes ─────────────────────────────────────────────────────────────

function safetyAxis(checklist: SafetyChecklist | null): VerdictAxis {
  const inputs = checklist
    ? [
        checklistInput(checklist, "mint", "Mint authority"),
        checklistInput(checklist, "freeze", "Freeze authority"),
        checklistInput(checklist, "lpLocked", "Liquidity locked"),
        checklistInput(checklist, "rugcheck", "RugCheck risks"),
      ]
    : [];
  return assembleAxis({
    key: "safety",
    label: "Safety",
    subtitle: "mint · freeze · liquidity locks · RugCheck",
    inputs,
    partialNote: "Creator holdings and token age are weighed in Wards & Protections.",
    awaitingNote: "The ward-stones have not answered yet.",
  });
}

function distributionAxis(d: VerdictInputs["distribution"]): VerdictAxis {
  // M4: when the full-holder-set snapshot feeds this axis (windowed === false),
  // the figures are no longer a top-20 sample — the axis is no longer partial and
  // the HHI note reflects the full set. RugCheck-only input keeps the old caveat.
  const windowed = d ? d.windowed ?? true : true;
  const inputs: AxisInput[] = d
    ? [
        numericInput({
          key: "top10",
          label: "Top-10 concentration",
          value: d.top10Pct,
          band: S.top10Pct,
          direction: "lower",
          display: (v) => `${v.toFixed(1)}%`,
          threshold: `≤ ${S.top10Pct.pass}%`,
          note: "pools & lockers excluded",
        }),
        numericInput({
          key: "hhi",
          label: "Holder concentration · HHI",
          value: d.hhiTop20,
          band: V.hhiTop20,
          direction: "lower",
          display: (v) => fmtInt(v),
          threshold: `≤ ${fmtInt(V.hhiTop20.pass)}`,
          note: windowed ? `top-${d.sampleSize} window` : `full holder set (${fmtInt(d.sampleSize)})`,
        }),
      ]
    : [];
  return assembleAxis({
    key: "distribution",
    label: "Distribution",
    subtitle: "top-10 share · holder concentration (HHI)",
    inputs,
    // Partial only while the figures are a windowed sample (RugCheck's top-20).
    // The M4 full holder scan (windowed=false) scores this axis in full.
    forcePartial: Boolean(d) && windowed,
    partialNote: "A top-20 holder window; the full holder census refines this hourly.",
    awaitingNote: "The council's roll is not yet counted.",
  });
}

function liquidityAxis(l: VerdictInputs["liquidity"]): VerdictAxis {
  const inputs: AxisInput[] = l
    ? [
        numericInput({
          key: "depth",
          label: "Liquidity depth",
          value: l.totalLiquidityUsd,
          band: V.liquidityUsd,
          direction: "higher",
          display: (v) => fmtUsdCompact(v),
          threshold: `≥ ${fmtUsdCompact(V.liquidityUsd.pass)}`,
          note: "sum of active pools",
        }),
        numericInput({
          key: "liqToMcap",
          label: "Liquidity / market cap",
          value: l.liqToMcap,
          band: V.liqToMcap,
          direction: "higher",
          display: (v) => fmtRatioPct(v),
          threshold: `≥ ${fmtRatioPct(V.liqToMcap.pass)}`,
        }),
      ]
    : [];
  return assembleAxis({
    key: "liquidity",
    label: "Liquidity",
    subtitle: "depth · liquidity-to-mcap",
    inputs,
    awaitingNote: "The cauldrons have not been measured yet.",
  });
}

function activityAxis(a: VerdictInputs["activity"]): VerdictAxis {
  let trend: number | null = null;
  if (a && a.volume24hUsd != null && a.avgDailyVolume30d != null && a.avgDailyVolume30d > 0) {
    trend = a.volume24hUsd / a.avgDailyVolume30d;
  }
  const inputs: AxisInput[] = a
    ? [
        numericInput({
          key: "volumeTrend",
          label: "Volume vs 30d average",
          value: trend,
          band: V.volumeTrend,
          direction: "higher",
          display: (v) => `${v.toFixed(2)}×`,
          threshold: `≥ ${V.volumeTrend.pass.toFixed(2)}×`,
          note: "24h volume ÷ 30d avg day",
        }),
        numericInput({
          key: "uniqueTraders",
          label: "Unique traders · 24h",
          value: a.uniqueTraders24h,
          band: V.uniqueTraders24h,
          direction: "higher",
          display: (v) => fmtInt(v),
          threshold: `≥ ${fmtInt(V.uniqueTraders24h.pass)}`,
          // M10: name the provenance inline, so a reader can tell a counted census
          // from a floor without decoding the axis-level asterisk.
          note:
            a.source === "archive" && a.fullyCovered
              ? "counted from our trade archive"
              : undefined,
        }),
      ]
    : [];
  return assembleAxis({
    key: "activity",
    label: "Activity",
    subtitle: "volume trend · unique traders",
    inputs,
    // Partial while the trader count is a floor. M10's archive clears this once it
    // spans a full 24h — the axis then scores in full, like Distribution did in M4.
    forcePartial: Boolean(a) && !a!.fullyCovered,
    partialNote:
      "Trader counts read the exchange's rolling window (≤300 trades, ≤24h per pool), so treat them as a floor until our trade archive spans a full day.",
    awaitingNote: "The flow of mana is not yet gauged.",
  });
}

function communityAxis(c: VerdictInputs["community"]): VerdictAxis {
  // M6: posting cadence from the Prophecy Feed's x_posts buffer now feeds this axis.
  // A null value (no posts recorded yet) leaves it unmeasured → the axis renders
  // "awaiting" and is excluded from the roll-up. A number (incl. 0 = gone quiet)
  // scores it via THRESHOLDS.verdict.postingCadence, so Community joins "5 of 5".
  const inputs: AxisInput[] = [
    numericInput({
      key: "cadence",
      label: "Posting cadence",
      value: c?.postingCadence ?? null,
      band: V.postingCadence,
      direction: "higher",
      display: (v) => `${v.toFixed(1)}/wk`,
      threshold: `≥ ${V.postingCadence.pass}/wk`,
      note: "posts per week · 28d · both feeds",
    }),
  ];
  return assembleAxis({
    key: "community",
    label: "Community",
    subtitle: "posting cadence",
    inputs,
    awaitingNote: "The coven's voice is not yet heard — no prophecies recorded yet.",
  });
}

// ── Overall roll-up ───────────────────────────────────────────────────────────

const HEADLINE: Record<Band, string> = {
  pass: "The tower stands strong.",
  warn: "The tower holds, with cracks.",
  fail: "The tower stands on uncertain ground.",
};

/**
 * Compute the full verdict from assembled inputs. Overall = equal-weight mean of
 * the axes that have data; awaiting-data axes are excluded (never scored as zero),
 * and the summary reports how many spoke.
 */
export function computeVerdict(inputs: VerdictInputs): Verdict {
  const axes: VerdictAxis[] = [
    safetyAxis(inputs.safetyChecklist),
    distributionAxis(inputs.distribution),
    liquidityAxis(inputs.liquidity),
    activityAxis(inputs.activity),
    communityAxis(inputs.community),
  ];

  const scored = axes.filter((a) => a.status === "scored" && a.score != null);
  const total = axes.length;
  const contributing = scored.length;

  if (contributing === 0) {
    return {
      axes,
      score: null,
      band: null,
      contributing,
      total,
      headline: "The wards are silent — no reading yet.",
      summary: `0 of ${total} wards speak`,
    };
  }

  const score = scored.reduce((s, a) => s + (a.score as number), 0) / contributing;
  const band = bandFromScore(score);
  return {
    axes,
    score,
    band,
    contributing,
    total,
    headline: HEADLINE[band],
    summary: `${contributing} of ${total} wards speak`,
  };
}

// ── Baseline helper (pure) ────────────────────────────────────────────────────

/** One daily OHLCV candle, as produced by `lib/sources/geckoterminal.ts`. */
type DailyCandle = { time: number; volume: number };

/**
 * Trailing average DAILY volume over the last `days` COMPLETE days — the baseline
 * the Activity axis judges 24h volume against. The most recent candle is today's
 * still-filling bar, so it is excluded to avoid comparing a full 24h window
 * against a partial day. Returns null when there is not enough history.
 */
export function avgDailyVolume(candles: DailyCandle[], days = 30): number | null {
  if (candles.length < 2) return null;
  // Drop the last (partial, in-progress) UTC day, then take up to `days` before it.
  const complete = candles.slice(0, -1);
  const window = complete.slice(-days);
  if (window.length === 0) return null;
  const sum = window.reduce((s, c) => s + (Number.isFinite(c.volume) ? c.volume : 0), 0);
  return sum / window.length;
}
