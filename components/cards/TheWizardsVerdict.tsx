"use client";

/**
 * The Wizard's Verdict — the gold callout, "the screenshot card" (plan §4 module
 * 11, §7). A transparent auto-computed rubric across five axes: Safety ·
 * Distribution · Liquidity · Activity · Community. EVERY axis shows its inputs and
 * the threshold each was judged against, inline — a rubric, not an oracle.
 *
 * All scoring is the pure engine in `lib/metrics/verdict.ts`; this component only
 * assembles the live inputs (reusing the same feeds the other cards poll — no new
 * network) and renders. An axis with no data renders an explicit in-character
 * "awaiting" state and is EXCLUDED from the overall (never scored as zero).
 */

import { useMemo } from "react";
import { ShareButton } from "@/components/wizard/ShareButton";
import { CardFrame } from "@/components/wizard/CardFrame";
import { AsOf, AwaitingReading, StaleBanner } from "@/components/wizard/DataStatus";
import type { MarketResult } from "@/lib/sources/dexscreener";
import type { SafetyResult } from "@/lib/sources/rugcheck";
import type { TradesResult } from "@/lib/sources/gecko-trades";
import type { OhlcvResult } from "@/lib/sources/geckoterminal";
import type { HoldersResult } from "@/lib/holders";
import type { PostingCadence } from "@/lib/social";
import { evaluateChecklist } from "@/lib/metrics/safety";
import {
  avgDailyVolume,
  computeVerdict,
  BAND_LABEL,
  type AxisInput,
  type Band,
  type VerdictAxis,
} from "@/lib/metrics/verdict";
import { useMarket } from "./useMarket";
import { useSafety } from "./useSafety";
import { useTrades } from "./useTrades";
import { useOhlcv } from "./useOhlcv";
import { useHolders } from "./useHolders";

// Status trio (§3): green pass · gold caution · rose fail. Icon + label always
// carry the state alongside color (dataviz: never color-alone).
const RUNE: Record<Band, { glyph: string; text: string; ring: string; fill: string; sr: string }> = {
  pass: { glyph: "✦", text: "text-green", ring: "border-green/40 bg-green/10", fill: "bg-green", sr: "strong" },
  warn: { glyph: "◆", text: "text-gold", ring: "border-gold/40 bg-gold/10", fill: "bg-gold", sr: "mixed" },
  fail: { glyph: "✕", text: "text-rose", ring: "border-rose/40 bg-rose/10", fill: "bg-rose", sr: "weak" },
};

/** Each axis links out to the card where its inputs can be verified (plan §7). */
const AXIS_ANCHOR: Record<string, string> = {
  safety: "#safety",
  distribution: "#holders",
  liquidity: "#pools",
  activity: "#flow",
  community: "#feed",
};

export function TheWizardsVerdict({
  initialMarket,
  initialSafety,
  initialTrades,
  initialDaily,
  initialHolders,
  initialCadence,
  launchedAt,
  pool,
  className = "",
}: {
  initialMarket: MarketResult;
  initialSafety: SafetyResult;
  initialTrades: TradesResult;
  initialDaily?: OhlcvResult;
  initialHolders: HoldersResult;
  /** Community posting cadence (M6) — the Community axis input; slow-moving 28d metric. */
  initialCadence: PostingCadence;
  /** Earliest pool creation (ms) — the token-age source for the safety checklist. */
  launchedAt: number | null;
  /** Primary pool address — the 30d daily-volume baseline for the Activity axis. */
  pool: string;
  className?: string;
}) {
  const { result: market, degraded: mDeg } = useMarket(initialMarket);
  const { result: safety, degraded: sDeg } = useSafety(initialSafety);
  const { result: trades, degraded: tDeg } = useTrades(initialTrades);
  const { result: holders } = useHolders(initialHolders);
  const daily = useOhlcv({ pool, timeframe: "1d", initial: initialDaily });

  const checklist = useMemo(
    () => (safety.data ? evaluateChecklist(safety.data, { launchedAt }) : null),
    [safety.data, launchedAt],
  );
  const baseline = useMemo(() => avgDailyVolume(daily.data?.candles ?? []), [daily.data]);

  const verdict = useMemo(
    () =>
      computeVerdict({
        safetyChecklist: checklist,
        // M4: prefer the full-holder-set census (windowed=false → the axis scores
        // in full, no longer a top-20 window); fall back to RugCheck's window.
        distribution: holders.data
          ? {
              top10Pct: holders.data.top10Pct,
              hhiTop20: holders.data.hhi,
              sampleSize: holders.data.countedHolders ?? holders.data.totalHolders,
              windowed: false,
            }
          : safety.data
            ? {
                top10Pct: safety.data.top10Pct,
                hhiTop20: safety.data.hhiTop20,
                sampleSize: safety.data.concentrationSampleSize,
              }
            : null,
        liquidity: market.data
          ? { totalLiquidityUsd: market.data.totalLiquidityUsd, liqToMcap: market.data.liqToMcap }
          : null,
        // M10: the trader count now comes from our own trade archive whenever it
        // covers the full 24h (the swap happens in /api/trades, so this component
        // needs no new feed). `fullyCovered` then flips true and the axis stops
        // being partial; `source` only adjusts the caveat wording, never the score.
        activity:
          market.data && trades.flow
            ? {
                volume24hUsd: market.data.volumeH24Usd,
                avgDailyVolume30d: baseline,
                uniqueTraders24h: trades.flow.uniqueTraders,
                fullyCovered: trades.flow.fullyCovered,
                source: trades.flowSource,
              }
            : null,
        // M6: real posting cadence from the x_posts buffer (posts/week, 28d, both
        // feeds). Null while the buffer is empty → Community stays "awaiting".
        community: { postingCadence: initialCadence.perWeek },
      }),
    [
      checklist,
      safety.data,
      holders.data,
      market.data,
      trades.flow,
      trades.flowSource,
      baseline,
      initialCadence.perWeek,
    ],
  );

  const stale =
    mDeg || sDeg || tDeg || market.stale || safety.stale || trades.stale;
  const dataAsOf = market.dataAsOf ?? safety.dataAsOf ?? trades.dataAsOf ?? null;

  return (
    <CardFrame
      id="verdict"
      title="The Wizard’s Verdict"
      subtitle="an auto-computed rubric — not an oracle"
      source="Safety · Distribution · Liquidity · Activity · Community"
      variant="gold"
      className={className}
        controls={<ShareButton card="verdict" label="The Wizard’s Verdict" />}
    >
      {stale && verdict.score != null && <StaleBanner dataAsOf={dataAsOf} />}

      {verdict.score == null && verdict.contributing === 0 ? (
        <AwaitingReading label="the verdict" />
      ) : (
        <>
          <OverallSeal verdict={verdict} />

          <div className="mt-5 space-y-4">
            {verdict.axes.map((axis) => (
              <AxisBlock key={axis.key} axis={axis} />
            ))}
          </div>

          <div className="mt-5 border-t border-gold/20 pt-3">
            <p className="wiz-caption">
              Each axis is the equal-weight mean of the inputs shown; the overall is the
              mean of the axes that have data. Axes still awaiting a feed are excluded — never
              scored as zero. Verify every input in its own card above.
            </p>
            <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-gold/90">
              A rubric to read the facts — informational only, never financial advice.
            </p>
          </div>

          <AsOf dataAsOf={dataAsOf} stale={stale} />
        </>
      )}
    </CardFrame>
  );
}

// ── Overall seal — the thesis: does the tower stand? ─────────────────────────

function OverallSeal({ verdict }: { verdict: ReturnType<typeof computeVerdict> }) {
  const band = verdict.band ?? "warn";
  const rune = RUNE[band];
  const score = verdict.score;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-gold/25 bg-gold/[0.04] p-4">
      {/* The verdict seal — gold is the Verdict's own material (§3); the band is
          carried by the chip, the meter, and the score tone beside it. */}
      <span
        aria-hidden
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-gold/50 bg-gold/10 text-2xl text-gold shadow-[0_0_20px_rgba(234,179,8,0.15)]"
      >
        ✦
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-base font-semibold text-ink">{verdict.headline}</span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${rune.ring} ${rune.text}`}
          >
            {BAND_LABEL[band]}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-mono text-3xl font-semibold tabular-nums text-gold md:text-4xl">
            {score == null ? "—" : Math.round(score)}
          </span>
          <span className="font-mono text-sm text-muted">/ 100</span>
          <span aria-hidden className="text-muted">
            ◆
          </span>
          <span className="text-xs text-muted">{verdict.summary}</span>
        </div>
        {/* Overall meter — magnitude, colored by band; the seal/chip/score already
            name the state so this reinforces rather than color-alone. */}
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-panel-2"
          role="img"
          aria-label={score == null ? "No overall score yet" : `Overall verdict score ${Math.round(score)} of 100, ${rune.sr}`}
        >
          {score != null && (
            <div className={`h-full rounded-full ${rune.fill}`} style={{ width: `${score}%` }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── One axis: header + meter + its inputs (transparent inline rubric) ────────

function AxisBlock({ axis }: { axis: VerdictAxis }) {
  const awaiting = axis.status === "awaiting-data";
  const band = axis.band ?? "warn";
  const rune = RUNE[band];
  const anchor = AXIS_ANCHOR[axis.key];

  return (
    <div className="border-l-2 border-violet/20 pl-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          {awaiting ? (
            <span aria-hidden className="text-muted">
              ◦
            </span>
          ) : (
            <span aria-hidden className={rune.text}>
              {rune.glyph}
            </span>
          )}
          <a
            href={anchor}
            className="text-sm font-medium text-ink underline decoration-transparent underline-offset-2 transition-colors hover:decoration-violet/50"
          >
            {axis.label}
          </a>
          <span className="hidden truncate text-[11px] text-muted sm:inline">· {axis.subtitle}</span>
        </div>
        {awaiting ? (
          <span className="shrink-0 rounded border border-violet/20 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted">
            awaiting
          </span>
        ) : (
          <span className="shrink-0 font-mono text-sm tabular-nums text-ink">
            {Math.round(axis.score as number)}
            {axis.partial && (
              <span aria-hidden className="text-gold" title="scored on partial data">
                {" "}
                *
              </span>
            )}
          </span>
        )}
      </div>

      {/* Axis meter (skipped when awaiting) */}
      {!awaiting && (
        <div
          className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-panel-2"
          role="img"
          aria-label={`${axis.label} score ${Math.round(axis.score as number)} of 100, ${rune.sr}`}
        >
          <div className={`h-full rounded-full ${rune.fill}`} style={{ width: `${axis.score}%` }} />
        </div>
      )}

      {/* Inputs — the actual rubric: value + the threshold it was judged against */}
      {awaiting ? (
        <p className="mt-1.5 text-xs italic text-muted">{axis.note}</p>
      ) : (
        <div className="mt-2 space-y-1">
          {axis.inputs.map((input) => (
            <InputRow key={input.key} input={input} />
          ))}
          {axis.partial && axis.note && (
            <p className="pt-0.5 text-[11px] italic text-muted">
              <span aria-hidden className="text-gold">
                *{" "}
              </span>
              {axis.note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function InputRow({ input }: { input: AxisInput }) {
  const dot =
    input.status == null
      ? "bg-muted/50"
      : input.status === "pass"
        ? "bg-green"
        : input.status === "warn"
          ? "bg-gold"
          : "bg-rose";
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span aria-hidden className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 truncate text-muted">
        {input.label}
        {input.note && <span className="text-muted"> · {input.note}</span>}
      </span>
      <span className="shrink-0 font-mono tabular-nums text-ink">{input.display}</span>
      <span aria-hidden className="text-muted">
        vs
      </span>
      <span className="shrink-0 font-mono tabular-nums text-muted">{input.threshold}</span>
      <span className="sr-only">
        {input.status == null ? "awaiting data" : input.status}
      </span>
    </div>
  );
}
