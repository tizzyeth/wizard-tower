"use client";

import { useMemo, useState } from "react";
import { CardFrame } from "@/components/wizard/CardFrame";
import { AsOf, StaleBanner } from "@/components/wizard/DataStatus";
import { THRESHOLDS } from "@/config/token";
import type { Trade, TradesResult } from "@/lib/sources/gecko-trades";
import { fmtAddr, fmtInt, fmtPrice, fmtTimeUtc, fmtTokenAmount, fmtUsdTrade } from "@/lib/format";
import { useTrades } from "./useTrades";

/** How many merged deeds the tape renders — a capped window, not the full list. */
const TAPE_WINDOW = 50;

type SideFilter = "all" | "buy" | "sell";

/** Min-USD filter presets; the whale threshold comes from config (config-first). */
const MIN_USD_STEPS = [
  { value: 0, label: "All" },
  { value: 100, label: "≥$100" },
  { value: THRESHOLDS.whaleUsd, label: `≥$${THRESHOLDS.whaleUsd}` },
  { value: 1000, label: "≥$1K" },
] as const;

export function TheLedgerOfDeeds({
  initial,
  className = "",
}: {
  initial: TradesResult;
  className?: string;
}) {
  const { result, degraded } = useTrades(initial);
  const stale = degraded || result.stale;

  const [poolFilter, setPoolFilter] = useState("all");
  const [side, setSide] = useState<SideFilter>("all");
  const [minUsd, setMinUsd] = useState(0);

  const filtered = useMemo(() => {
    return result.trades.filter(
      (t) =>
        (poolFilter === "all" || t.pool === poolFilter) &&
        (side === "all" || t.side === side) &&
        t.usd >= minUsd,
    );
  }, [result.trades, poolFilter, side, minUsd]);

  const shown = filtered.slice(0, TAPE_WINDOW);
  const filtersActive = poolFilter !== "all" || side !== "all" || minUsd > 0;

  return (
    <CardFrame
      id="tape"
      title="The Ledger of Deeds"
      subtitle="unified trade tape"
      source="GeckoTerminal · 30s"
      controls={<LiveDot live={result.ok && !stale} />}
      className={className}
    >
      {stale && <StaleBanner dataAsOf={result.dataAsOf} />}

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <PoolFilter
          pools={result.pools}
          value={poolFilter}
          onChange={setPoolFilter}
        />
        <SideToggle value={side} onChange={setSide} />
        <MinUsdChips value={minUsd} onChange={setMinUsd} />
      </div>

      {shown.length === 0 ? (
        <EmptyLedger filtersActive={filtersActive} hasAny={result.trades.length > 0} />
      ) : (
        // The tape is the longest card on the page: unbounded it ran hundreds of
        // rows past its neighbours and left a column of dead space beside them.
        // Capping it keeps the bento honest — every deed is still here, reached by
        // scrolling the card rather than the page. The header row stays pinned so
        // the columns stay readable mid-scroll.
        <div className="-mx-1 max-h-[28rem] overflow-y-auto overflow-x-auto px-1">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="text-[10px] uppercase tracking-[0.12em] text-muted">
                <th className="pb-2 text-left font-medium">Time · UTC</th>
                <th className="pb-2 text-left font-medium">Side</th>
                <th className="pb-2 text-right font-medium">Amount WIZARD</th>
                <th className="pb-2 text-right font-medium">USD</th>
                <th className="hidden pb-2 text-right font-medium sm:table-cell">Price</th>
                <th className="hidden pb-2 text-right font-medium md:table-cell">Pool</th>
                <th className="pb-2 text-right font-medium">Wallet</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <TapeRow key={t.txHash} trade={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="wiz-caption mt-3">
        {shown.length > 0 ? (
          <>
            Showing the last {shown.length}
            {filtered.length > shown.length ? ` of ${filtered.length} matching` : ""} deeds
            {" "}across {result.pools.length} active {result.pools.length === 1 ? "pool" : "pools"},
            deduped by transaction. Whale rune marks swaps ≥ ${fmtInt(THRESHOLDS.whaleUsd)}.
          </>
        ) : (
          <>Deeds merge across {result.pools.length} active {result.pools.length === 1 ? "pool" : "pools"}, deduped by transaction.</>
        )}
      </p>

      <AsOf dataAsOf={result.dataAsOf} stale={stale} />
    </CardFrame>
  );
}

// ── One tape row ─────────────────────────────────────────────────────────────

function TapeRow({ trade }: { trade: Trade }) {
  const isBuy = trade.side === "buy";
  const sideColor = isBuy ? "text-green" : "text-rose";
  return (
    <tr className={`align-middle ${trade.whale ? "bg-violet/[0.06]" : ""}`}>
      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-muted">
        {fmtTimeUtc(trade.ts)}
      </td>
      <td className="py-2 pr-3">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${isBuy ? "bg-green" : "bg-rose"}`}
          />
          <span className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${sideColor}`}>
            {isBuy ? "Buy" : "Sell"}
          </span>
          {trade.whale && <WhaleRune />}
        </span>
      </td>
      <td className="py-2 pl-3 text-right font-mono tabular-nums text-ink">
        {fmtTokenAmount(trade.wizardAmount)}
      </td>
      <td className={`py-2 pl-3 text-right font-mono tabular-nums ${trade.whale ? "text-violet-soft" : "text-ink"}`}>
        {fmtUsdTrade(trade.usd)}
      </td>
      <td className="hidden py-2 pl-3 text-right font-mono tabular-nums text-muted sm:table-cell">
        {fmtPrice(trade.priceUsd)}
      </td>
      <td className="hidden py-2 pl-3 text-right md:table-cell">
        <span
          className="rounded border border-violet/30 bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-violet-soft"
          title={`${trade.poolLabel} · WIZARD/${trade.quoteSymbol}`}
        >
          {trade.poolLabel}
        </span>
      </td>
      <td className="py-2 pl-3 text-right">
        {trade.wallet ? (
          <a
            href={`${SOLSCAN_ACCOUNT}${trade.wallet}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-violet-soft/90 transition-colors hover:text-ink"
            title={`${trade.wallet} — open on Solscan`}
          >
            {fmtAddr(trade.wallet)}
          </a>
        ) : (
          <span className="font-mono text-xs text-muted">—</span>
        )}
      </td>
    </tr>
  );
}

const SOLSCAN_ACCOUNT = "https://solscan.io/account/";

function WhaleRune() {
  return (
    <span
      className="rounded border border-violet/40 bg-violet/15 px-1 py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-violet-soft"
      title={`Whale — swap ≥ $${THRESHOLDS.whaleUsd}`}
    >
      ◈ whale
    </span>
  );
}

// ── Filters ──────────────────────────────────────────────────────────────────

function PoolFilter({
  pools,
  value,
  onChange,
}: {
  pools: TradesResult["pools"];
  value: string;
  onChange: (v: string) => void;
}) {
  if (pools.length <= 1) return null;
  return (
    <label className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted">
      <span aria-hidden>pool</span>
      <select
        aria-label="Filter tape by pool"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-violet/30 bg-panel-2 px-2 py-1 font-mono text-[11px] normal-case tracking-normal text-violet-soft outline-none transition-colors hover:border-violet/50 focus-visible:border-violet-soft"
      >
        <option value="all" className="bg-panel text-ink">
          All pools
        </option>
        {pools.map((p) => (
          <option key={p.pool} value={p.pool} className="bg-panel text-ink">
            {p.poolLabel} · WIZARD/{p.quoteSymbol}
          </option>
        ))}
      </select>
    </label>
  );
}

function SideToggle({
  value,
  onChange,
}: {
  value: SideFilter;
  onChange: (v: SideFilter) => void;
}) {
  const opts: { key: SideFilter; label: string; tone: string }[] = [
    { key: "all", label: "All", tone: "text-violet-soft" },
    { key: "buy", label: "Buys", tone: "text-green" },
    { key: "sell", label: "Sells", tone: "text-rose" },
  ];
  return (
    <div role="group" aria-label="Filter tape by side" className="inline-flex overflow-hidden rounded border border-violet/25">
      {opts.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={`px-2 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors ${
              active ? `bg-violet/20 ${o.tone}` : "text-muted hover:text-violet-soft"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function MinUsdChips({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div role="group" aria-label="Minimum trade size" className="flex gap-1">
      {MIN_USD_STEPS.map((step) => {
        const active = step.value === value;
        return (
          <button
            key={step.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(step.value)}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
              active
                ? "border-violet/60 bg-violet/20 text-violet-soft"
                : "border-violet/20 text-muted hover:border-violet/40 hover:text-violet-soft"
            }`}
          >
            {step.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Live indicator (ember — the wizard's lit pipe; §3 reserved for live only) ─

function LiveDot({ live }: { live: boolean }) {
  if (!live) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted">
      <span aria-hidden className="wiz-live-dot h-1.5 w-1.5 rounded-full" />
      live
    </span>
  );
}

// ── Empty state (§9: a quiet tape is signal — never fake data) ───────────────

function EmptyLedger({ filtersActive, hasAny }: { filtersActive: boolean; hasAny: boolean }) {
  if (hasAny && filtersActive) {
    return (
      <p className="wiz-caption py-8 text-center">
        No deeds match this filter — loosen the runes to see more of the ledger.
      </p>
    );
  }
  return (
    <p className="wiz-caption py-8 text-center">
      The ledger is quiet — no deeds recorded in the pools we watch. A still tape is
      itself a reading.
    </p>
  );
}
