"use client";

import { useMemo } from "react";
import { ShareButton } from "@/components/wizard/ShareButton";
import { CardFrame } from "@/components/wizard/CardFrame";
import { Rune } from "@/components/wizard/Rune";
import { AsOf, AwaitingReading, StaleBanner } from "@/components/wizard/DataStatus";
import { evaluateChecklist, type CheckStatus } from "@/lib/metrics/safety";
import type { SafetyResult } from "@/lib/sources/rugcheck";
import type { HoldersResult } from "@/lib/holders";
import { fmtAddr } from "@/lib/format";
import { LINKS } from "@/config/token";
import { useSafety } from "./useSafety";
import { useHolders } from "./useHolders";

/**
 * Deep links out to the reports a buyer should verify against (plan §4).
 *
 * Bubblemaps is deliberately NOT in this row — it is a different instrument
 * (a relationship map, not a report), so it gets its own explained affordance
 * below. See the note there on why it stays a link-out rather than an embed.
 */
const DEEP_LINKS: ReadonlyArray<readonly [string, string]> = [
  ["RugCheck", LINKS.explorers.rugcheck],
  ["Solscan", LINKS.explorers.solscan],
];

const SUMMARY: Record<CheckStatus, { glyph: string; tone: string; headline: string }> = {
  pass: { glyph: "✦", tone: "text-green", headline: "The wards hold." },
  warn: { glyph: "◆", tone: "text-gold", headline: "The wards mostly hold." },
  fail: { glyph: "✕", tone: "text-rose", headline: "A ward is broken." },
};

export function WardsAndProtections({
  initial,
  initialHolders,
  launchedAt,
  className = "",
}: {
  initial: SafetyResult;
  initialHolders: HoldersResult;
  /** Earliest pool creation (ms) from the market seed — the token-age source. */
  launchedAt: number | null;
  className?: string;
}) {
  const { result, degraded } = useSafety(initial);
  const { result: holders } = useHolders(initialHolders);
  const stale = degraded || result.stale;
  const report = result.data;

  const checklist = useMemo(
    () =>
      report
        ? evaluateChecklist(report, {
            launchedAt,
            // M4 follow-up: prefer the full-holder-census top-10 (pool/locker
            // excluded) when a snapshot exists; otherwise RugCheck's top-20 window.
            refinedTop10: holders.data
              ? { pct: holders.data.top10Pct, excludedCount: holders.data.excludedCount }
              : null,
          })
        : null,
    [report, launchedAt, holders.data],
  );

  return (
    <CardFrame
      id="safety"
      title="Wards & Protections"
      subtitle="safety checklist — a rubric, not an oracle"
      source="RugCheck · 1h"
      className={className}
        controls={<ShareButton card="wards" label="Wards & Protections" />}
    >
      {stale && report && <StaleBanner dataAsOf={result.dataAsOf} />}

      {!report || !checklist ? (
        <AwaitingReading label="the ward-stones" />
      ) : (
        <>
          {/* Thesis: does the tower's protection hold, at a glance. */}
          <div className="mb-4 flex items-center gap-2.5 rounded border border-violet/15 bg-panel-2/60 px-3 py-2">
            <span aria-hidden className={`text-base ${SUMMARY[checklist.overall].tone}`}>
              {SUMMARY[checklist.overall].glyph}
            </span>
            <span className="text-sm text-ink">{SUMMARY[checklist.overall].headline}</span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted">
              {checklist.passCount}/{checklist.checks.length} pass
              {checklist.warnCount > 0 && ` · ${checklist.warnCount} caution`}
              {checklist.failCount > 0 && ` · ${checklist.failCount} fail`}
            </span>
          </div>

          <div className="space-y-3">
            {checklist.checks.map((check) => (
              <Rune
                key={check.key}
                status={check.status}
                label={check.label}
                measured={check.measured}
                threshold={check.threshold}
                note={check.note}
              />
            ))}
          </div>

          {/* Creator wallet — surfaced for the buyer and reused by M9 (Mimo's Tribute). */}
          {report.creator && (
            <div className="mt-4 flex items-center gap-2 border-t border-violet/15 pt-3 text-xs">
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted">Creator wallet</span>
              <a
                href={`https://solscan.io/account/${report.creator}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono tabular-nums text-violet-soft transition-colors hover:text-ink"
                title={report.creator}
              >
                {fmtAddr(report.creator)} ↗
              </a>
            </div>
          )}

          <p className="mt-3 text-xs">
            {DEEP_LINKS.map(([label, href], i) => (
              <span key={label}>
                {i > 0 && (
                  <span aria-hidden className="text-muted">
                    {" "}
                    ◆{" "}
                  </span>
                )}
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-soft transition-colors hover:text-ink"
                >
                  {label} ↗
                </a>
              </span>
            ))}
          </p>

          {/*
            Holder relationship map — link-out, not an embed (plan §10 backlog).
            Bubblemaps serves `Content-Security-Policy: frame-ancestors` naming
            only its own domains plus a handful of partners (assetdash, bullx,
            mobyscreener, tinyastro) and localhost; this origin is not on that
            list, so a framed map renders as a browser block page in production.
            Even from an allow-listed origin the map boots blank inside a frame.
            A link-out is therefore the only honest way to offer it — and it has
            the side benefit that Bubblemaps is never contacted until a visitor
            chooses to go there.
          */}
          <div className="mt-3 rounded border border-violet/15 bg-panel-2/60 px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                Holder relationship map
              </span>
              <a
                href={LINKS.explorers.bubblemaps}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-violet-soft transition-colors hover:text-ink"
              >
                Open on Bubblemaps ↗
              </a>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              The council counts the holders; Bubblemaps draws the lines between them —
              which wallets cluster, and which have passed coin to one another. Opens in a
              new tab, charted from Bubblemaps&rsquo; own reading of the chain, not ours.
            </p>
          </div>

          <p className="wiz-caption mt-3">
            Each ward shows its measured value and the threshold it is judged against.
            Verify against the reports above — informational only, never financial advice.
          </p>

          <AsOf dataAsOf={result.dataAsOf} stale={stale} />
        </>
      )}
    </CardFrame>
  );
}
