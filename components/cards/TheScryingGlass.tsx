"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CardFrame } from "@/components/wizard/CardFrame";
import { AsOf, AwaitingReading, StaleBanner } from "@/components/wizard/DataStatus";
import { Skeleton } from "@/components/wizard/Skeleton";
import { TOKEN } from "@/config/token";
import type { MarketResult } from "@/lib/sources/dexscreener";
import {
  TIMEFRAMES,
  DEFAULT_TIMEFRAME,
  type OhlcvResult,
  type Timeframe,
} from "@/lib/sources/geckoterminal";
import type { PriceMode } from "./CandleChart";
import { useOhlcv } from "./useOhlcv";

// Client-only: the chart touches the DOM and must never run on the server.
const CandleChart = dynamic(
  () => import("./CandleChart").then((m) => m.CandleChart),
  { ssr: false, loading: () => <ChartLoading /> },
);

type PoolOption = { value: string; label: string };

export function TheScryingGlass({
  initialMarket,
  initialOhlcv,
  className = "",
}: {
  initialMarket: MarketResult;
  initialOhlcv?: OhlcvResult;
  className?: string;
}) {
  const poolOptions = usePoolOptions(initialMarket);
  const defaultPool = poolOptions[0]?.value ?? TOKEN.mainPool;

  const [pool, setPool] = useState(defaultPool);
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [priceMode, setPriceMode] = useState<PriceMode>("price");

  const { result, data, degraded, loading } = useOhlcv({
    pool,
    timeframe,
    initial: initialOhlcv,
  });
  const stale = degraded || (result?.stale ?? false);
  const candles = data?.candles ?? [];
  const hasCandles = candles.length > 0;

  const activePool = poolOptions.find((p) => p.value === pool);
  const resetKey = `${pool}:${timeframe}`;

  return (
    <CardFrame
      id="chart"
      title="The Scrying Glass"
      subtitle="price & volume"
      source="GeckoTerminal · 60s"
      controls={
        <TimeframeChips value={timeframe} onChange={setTimeframe} />
      }
      className={className}
    >
      {stale && hasCandles && <StaleBanner dataAsOf={result?.dataAsOf ?? null} />}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PoolSelect
          options={poolOptions}
          value={pool}
          onChange={(next) => setPool(next)}
        />
        <PriceModeToggle value={priceMode} onChange={setPriceMode} />
      </div>

      <div className="h-72">
        {hasCandles ? (
          <CandleChart
            candles={candles}
            priceMode={priceMode}
            supply={TOKEN.supply}
            resetKey={resetKey}
            className="h-full"
          />
        ) : loading ? (
          <ChartLoading />
        ) : (
          <div className="flex h-full items-center justify-center">
            <AwaitingReading label="the candles" />
          </div>
        )}
      </div>

      <p className="wiz-caption mt-3">
        Candles &amp; volume from the {activePool?.label ?? "main"} pool via
        GeckoTerminal. Volume is USD; the market-cap view scales price by the{" "}
        {TOKEN.symbol} supply — it is not a re-fetch.
      </p>

      <AsOf dataAsOf={result?.dataAsOf ?? null} stale={stale} />
    </CardFrame>
  );
}

// ── Pool selector ───────────────────────────────────────────────────────────

function usePoolOptions(initialMarket: MarketResult): PoolOption[] {
  return useMemo(() => {
    const pools = initialMarket.data?.pools ?? [];
    if (pools.length === 0) {
      // Market feed unavailable at seed time — still offer the configured main pool.
      return [{ value: TOKEN.mainPool, label: "PumpSwap · main pool" }];
    }
    // Primary (main) pool first, then by liquidity (source already sorts by liq).
    const ordered = [...pools].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    return ordered.map((p) => ({
      value: p.pairAddress,
      label: `${p.dexLabel} · ${p.baseSymbol}/${p.quoteSymbol}`,
    }));
  }, [initialMarket]);
}

function PoolSelect({
  options,
  value,
  onChange,
}: {
  options: PoolOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted">
      <span className="sr-only">Pool</span>
      <span aria-hidden>pool</span>
      <select
        aria-label="Chart pool"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-violet/30 bg-panel-2 px-2 py-1 font-mono text-[11px] normal-case tracking-normal text-violet-soft outline-none transition-colors hover:border-violet/50 focus-visible:border-violet-soft"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-panel text-ink">
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Timeframe chips (interactive; mono 10px, active = amethyst — §M2 note) ───

function TimeframeChips({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}) {
  return (
    <div role="group" aria-label="Timeframe" className="flex gap-1">
      {TIMEFRAMES.map((tf) => {
        const active = tf === value;
        return (
          <button
            key={tf}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tf)}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
              active
                ? "border-violet/60 bg-violet/20 text-violet-soft"
                : "border-violet/20 text-muted hover:border-violet/40 hover:text-violet-soft"
            }`}
          >
            {tf}
          </button>
        );
      })}
    </div>
  );
}

// ── Price ⇄ market-cap toggle ────────────────────────────────────────────────

function PriceModeToggle({
  value,
  onChange,
}: {
  value: PriceMode;
  onChange: (mode: PriceMode) => void;
}) {
  const modes: { key: PriceMode; label: string }[] = [
    { key: "price", label: "Price" },
    { key: "mcap", label: "Mcap" },
  ];
  return (
    <div
      role="group"
      aria-label="Price or market cap"
      className="inline-flex overflow-hidden rounded border border-violet/25"
    >
      {modes.map((m) => {
        const active = m.key === value;
        return (
          <button
            key={m.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(m.key)}
            className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors ${
              active ? "bg-violet/20 text-violet-soft" : "text-muted hover:text-violet-soft"
            }`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Loading state ────────────────────────────────────────────────────────────

function ChartLoading() {
  return (
    <div className="relative h-full overflow-hidden rounded">
      <Skeleton className="absolute inset-0" />
      <p className="wiz-caption absolute inset-x-0 bottom-3 text-center">
        The crystal ball is warming — reading the candles.
      </p>
    </div>
  );
}
