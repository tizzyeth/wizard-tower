"use client";

/**
 * Council of Holders — holder distribution & concentration (plan §4 module 3).
 *
 * Reads our own snapshot DB (via /api/holders), never Helius per visitor. Hero:
 * total holders + Δ7d/Δ30d. Then the holder-count area chart (history is NOT
 * retroactive — the banner shows the first recorded date), top-10/20/50
 * concentration bars EXCLUDING labeled pool/locker accounts, an HHI meter, USD
 * holder buckets, and the top-20 table (address → Solscan, label, balance, %, USD).
 *
 * Self-contained client card (owns its CardFrame, SSR-seeded via `initial`, kept
 * live by the TanStack hook) — the same shape as WardsAndProtections / TheCauldrons.
 * Every mark is single-hue amethyst (the settled palette); green/rose stay reserved
 * for the delta direction and the HHI band reuses the safety pass/warn/fail runes.
 */

import { useMemo } from "react";
import { CardFrame } from "@/components/wizard/CardFrame";
import { AsOf, StaleBanner } from "@/components/wizard/DataStatus";
import type { HoldersResult, HolderChartPoint } from "@/lib/holders";
import type { HolderBucket, TopHolderRow, HolderLabel } from "@/lib/metrics/concentration";
import {
  fmtInt,
  fmtAddr,
  fmtUsdCompact,
  fmtTokenAmount,
  fmtDateUtc,
  fmtDateTimeUtc,
} from "@/lib/format";
import { THRESHOLDS } from "@/config/token";
import { useHolders } from "./useHolders";

const H = THRESHOLDS.verdict.hhiTop20; // DOJ HHI bands (pass ≤1500, warn ≤2500)

export function CouncilOfHolders({
  initial,
  className = "",
}: {
  initial: HoldersResult;
  className?: string;
}) {
  const { result, degraded } = useHolders(initial);
  const stale = degraded || result.stale;
  const d = result.data;

  return (
    <CardFrame
      id="holders"
      title="Council of Holders"
      subtitle="holder distribution & concentration"
      source="Helius · hourly"
      className={className}
    >
      {stale && d && <StaleBanner dataAsOf={result.dataAsOf} />}

      {!d ? (
        <EmptyCensus />
      ) : (
        <>
          <HolderHero data={d} />
          <HolderAreaChart series={d.series} recordedSince={d.recordedSince} />
          <ConcentrationBars data={d} />
          <HhiMeter hhi={d.hhi} />
          <HolderBuckets buckets={d.buckets} counted={d.countedHolders} priced={d.buckets.some((b) => b.count > 0)} />
          <TopHoldersTable rows={d.topHolders} />
          <p className="wiz-caption mt-3">
            Concentration bars, HHI and buckets exclude labeled AMM pools, lockers and the
            burn address; the creator wallet is counted but labeled. Balances from the live
            Helius scan — informational only, never financial advice.
          </p>
          <AsOf dataAsOf={result.dataAsOf} stale={stale} />
        </>
      )}
    </CardFrame>
  );
}

// ── Empty state — history is not retroactive, so say so plainly ──────────────

function EmptyCensus() {
  return (
    <div className="py-6 text-center">
      <p className="font-mono text-3xl font-semibold tabular-nums text-muted">—</p>
      <p className="mt-2 text-sm text-ink">The council has not yet convened.</p>
      <p className="wiz-caption mx-auto mt-1.5 max-w-xs">
        Holder history is recorded from the first census onward, not backfilled. The tower
        takes its first census within the hour — the roll fills from there.
      </p>
    </div>
  );
}

// ── Hero: total holders + Δ7d / Δ30d ─────────────────────────────────────────

function HolderHero({ data }: { data: NonNullable<HoldersResult["data"]> }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Total holders</p>
        <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-ink">
          {fmtInt(data.totalHolders)}
        </p>
      </div>
      <div className="flex gap-2">
        <DeltaChip label="7d" value={data.delta7d} />
        <DeltaChip label="30d" value={data.delta30d} />
      </div>
    </div>
  );
}

function DeltaChip({ label, value }: { label: string; value: number | null }) {
  const known = value != null && Number.isFinite(value);
  const tone = !known || value === 0 ? "text-muted" : value > 0 ? "text-green" : "text-rose";
  const arrow = !known || value === 0 ? "" : value > 0 ? "▲ " : "▼ ";
  const text = !known ? "—" : `${arrow}${value > 0 ? "+" : ""}${fmtInt(value)}`;
  return (
    <div className="rounded border border-violet/15 bg-panel-2/60 px-2 py-1 text-right">
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted">Δ {label}</div>
      <div
        className={`font-mono text-sm tabular-nums ${tone}`}
        title={known ? undefined : "Needs a snapshot from that far back — history is not retroactive"}
      >
        {text}
      </div>
    </div>
  );
}

// ── Holder-count area chart (single-hue amethyst sparkline) ───────────────────

function HolderAreaChart({
  series,
  recordedSince,
}: {
  series: HolderChartPoint[];
  recordedSince: number;
}) {
  const W = 300;
  const Hh = 96;
  const padX = 4;
  const padY = 8;

  const geom = useMemo(() => {
    if (series.length === 0) return null;
    const values = series.map((p) => p.holders);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      // Flat series — pad so the line sits mid-height instead of on an edge.
      min -= 1;
      max += 1;
    }
    const n = series.length;
    const x = (i: number) =>
      n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - 2 * padX);
    const y = (v: number) => padY + (1 - (v - min) / (max - min)) * (Hh - 2 * padY);
    const pts = series.map((p, i) => ({ px: x(i), py: y(p.holders), p }));
    const line = pts.map((q, i) => `${i === 0 ? "M" : "L"}${q.px.toFixed(1)},${q.py.toFixed(1)}`).join(" ");
    const area = `M${pts[0].px.toFixed(1)},${Hh - padY} ${pts
      .map((q) => `L${q.px.toFixed(1)},${q.py.toFixed(1)}`)
      .join(" ")} L${pts[pts.length - 1].px.toFixed(1)},${Hh - padY} Z`;
    return { pts, line, area, min, max };
  }, [series]);

  const first = series[0]?.holders;
  const last = series[series.length - 1]?.holders;
  const label =
    series.length <= 1
      ? "The first census is recorded — the curve grows each hour."
      : `Holder count across ${fmtInt(series.length)} censuses · recorded since ${fmtDateUtc(recordedSince)}`;

  return (
    <div className="mt-4">
      <div className="relative h-24 w-full overflow-hidden rounded border border-violet/12 bg-panel-2/40">
        {geom ? (
          <svg
            viewBox={`0 0 ${W} ${Hh}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label={
              series.length <= 1
                ? `Holder count ${fmtInt(last)}, first census recorded`
                : `Holder count from ${fmtInt(first)} to ${fmtInt(last)} across ${series.length} censuses`
            }
          >
            <defs>
              <linearGradient id="holderArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-violet)" stopOpacity="0.34" />
                <stop offset="100%" stopColor="var(--color-violet)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {series.length > 1 && <path d={geom.area} fill="url(#holderArea)" />}
            <path
              d={geom.line}
              fill="none"
              stroke="var(--color-violet-soft)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              strokeDasharray={series.length <= 1 ? "3 3" : undefined}
            />
            {geom.pts.map((q, i) => (
              <circle
                key={i}
                cx={q.px}
                cy={q.py}
                r={series.length > 60 ? 0 : 2.4}
                fill="var(--color-violet-soft)"
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${fmtDateTimeUtc(q.p.t)} · ${fmtInt(q.p.holders)} holders`}</title>
              </circle>
            ))}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="wiz-caption">Awaiting the first census…</span>
          </div>
        )}
      </div>
      <p className="wiz-caption mt-1.5">{label}</p>
    </div>
  );
}

// ── Concentration bars — top-10 / 20 / 50, pools EXCLUDED ─────────────────────

function ConcentrationBars({ data }: { data: NonNullable<HoldersResult["data"]> }) {
  // Raw (pools included) top-N derived from the top-20 table for transparency.
  const rawTop = (n: number): number | null => {
    const rows = data.topHolders.slice(0, n);
    return rows.length ? rows.reduce((s, r) => s + r.pct, 0) : null;
  };
  const bars: Array<[string, number | null, number | null]> = [
    ["Top 10", data.top10Pct, rawTop(10)],
    ["Top 20", data.top20Pct, rawTop(20)],
    ["Top 50", data.top50Pct, null],
  ];
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] uppercase tracking-[0.14em] text-muted">Concentration</h3>
        {data.excludedCount != null && data.excludedCount > 0 && (
          <span className="text-[10px] text-muted">
            {fmtInt(data.excludedCount)} pool/locker excluded
          </span>
        )}
      </div>
      <div className="space-y-2.5">
        {bars.map(([label, pct, raw]) => (
          <div key={label} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-[11px] uppercase tracking-[0.1em] text-muted">
              {label}
            </span>
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-violet/10"
              role="img"
              aria-label={`${label} holders hold ${pct == null ? "unknown" : `${pct.toFixed(1)}%`} of supply, pools excluded`}
            >
              <div
                className="h-full rounded-full bg-violet/70"
                style={{ width: `${Math.min(100, Math.max(1, pct ?? 0))}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-ink">
              {pct == null ? "—" : `${pct.toFixed(1)}%`}
              {raw != null && raw > (pct ?? 0) + 0.05 && (
                <span className="text-muted"> · {raw.toFixed(0)}% raw</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── HHI meter — full-holder-set Herfindahl, DOJ band via the safety runes ─────

function HhiMeter({ hhi }: { hhi: number | null }) {
  const band =
    hhi == null ? null : hhi <= H.pass ? "pass" : hhi <= H.warn ? "warn" : "fail";
  const TONE = {
    pass: { text: "text-green", fill: "bg-green", word: "unconcentrated" },
    warn: { text: "text-gold", fill: "bg-gold", word: "moderate" },
    fail: { text: "text-rose", fill: "bg-rose", word: "concentrated" },
  } as const;
  const t = band ? TONE[band] : null;
  // Scale the meter to the "highly concentrated" boundary so a low HHI reads as a
  // short bar (honest: WIZARD's ~100 is a sliver against the 2500 threshold).
  const pct = hhi == null ? 0 : Math.min(100, (hhi / (H.warn * 1.2)) * 100);
  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h3 className="text-[11px] uppercase tracking-[0.14em] text-muted">
          Concentration index · HHI
        </h3>
        <span className="font-mono text-xs tabular-nums text-ink">
          {hhi == null ? "—" : fmtInt(hhi)}
          {t && <span className={`ml-1.5 ${t.text}`}>· {t.word}</span>}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2"
        role="img"
        aria-label={
          hhi == null
            ? "HHI not yet measured"
            : `Herfindahl-Hirschman index ${Math.round(hhi)} of 10000, ${t?.word}`
        }
      >
        {t && <div className={`h-full rounded-full ${t.fill}`} style={{ width: `${Math.max(1, pct)}%` }} />}
      </div>
      <p className="wiz-caption mt-1">
        Herfindahl-Hirschman over real holders (0–10000). Below {fmtInt(H.pass)} is
        unconcentrated; above {fmtInt(H.warn)} is highly concentrated (US DOJ bands).
      </p>
    </div>
  );
}

// ── USD holder buckets ────────────────────────────────────────────────────────

function HolderBuckets({
  buckets,
  counted,
  priced,
}: {
  buckets: HolderBucket[];
  counted: number | null;
  priced: boolean;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] uppercase tracking-[0.14em] text-muted">Holdings by value</h3>
        {counted != null && (
          <span className="text-[10px] text-muted">{fmtInt(counted)} holders</span>
        )}
      </div>
      {priced ? (
        <div className="space-y-1.5">
          {buckets.map((b) => (
            <div key={b.key} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
                {b.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-violet/10">
                <div
                  className="h-full rounded-full bg-violet/55"
                  style={{ width: `${Math.max(b.count > 0 ? 3 : 0, (b.count / max) * 100)}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-ink">
                {fmtInt(b.count)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="wiz-caption">USD buckets await a live price reading.</p>
      )}
    </div>
  );
}

// ── Top-20 table ──────────────────────────────────────────────────────────────

const LABEL_META: Record<HolderLabel, { text: string; cls: string }> = {
  pool: { text: "pool", cls: "border-muted/30 text-muted" },
  locker: { text: "locker", cls: "border-muted/30 text-muted" },
  burn: { text: "burn", cls: "border-muted/30 text-muted" },
  creator: { text: "creator", cls: "border-violet/40 text-violet-soft" },
};

function TopHoldersTable({ rows }: { rows: TopHolderRow[] }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] uppercase tracking-[0.14em] text-muted">Top 20 holders</h3>
        <span className="text-[10px] text-muted">share of supply</span>
      </div>
      <ol className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
        {rows.map((r) => (
          <li
            key={r.rank}
            className={`flex items-center gap-2.5 rounded px-1.5 py-1 ${r.excluded ? "opacity-70" : ""}`}
          >
            <span className="w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
              {r.rank}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <a
                  href={`https://solscan.io/account/${r.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs tabular-nums text-violet-soft transition-colors hover:text-ink"
                  title={r.address}
                >
                  {fmtAddr(r.address)}
                </a>
                {r.label && (
                  <span
                    className={`rounded border px-1 py-px text-[9px] uppercase tracking-[0.08em] ${LABEL_META[r.label].cls}`}
                  >
                    {LABEL_META[r.label].text}
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] tabular-nums text-muted">
                {fmtTokenAmount(r.amount)}
                {r.usd != null && <span> · {fmtUsdCompact(r.usd)}</span>}
              </div>
            </div>
            <span className="shrink-0 font-mono text-xs tabular-nums text-ink">
              {r.pct.toFixed(2)}%
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
