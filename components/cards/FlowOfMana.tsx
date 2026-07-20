"use client";

import { useMemo } from "react";
import { CardFrame } from "@/components/wizard/CardFrame";
import { AsOf, StaleBanner } from "@/components/wizard/DataStatus";
import { StatGrid } from "@/components/wizard/StatGrid";
import type { OhlcvResult } from "@/lib/sources/geckoterminal";
import type { FlowStats, TradesResult } from "@/lib/sources/gecko-trades";
import { fmtInt, fmtUsdCompact, fmtUsdTrade } from "@/lib/format";
import { useOhlcv } from "./useOhlcv";
import { useTrades } from "./useTrades";

/** Days of daily-volume history to render (§4: "30d daily volume bars"). */
const VOLUME_DAYS = 30;

export function FlowOfMana({
  initialTrades,
  initialDaily,
  pool,
  className = "",
}: {
  initialTrades: TradesResult;
  initialDaily?: OhlcvResult;
  /** Primary pool address — the daily-volume series (§4: "existing OHLCV, tf=1d"). */
  pool: string;
  className?: string;
}) {
  const { result: trades, degraded } = useTrades(initialTrades);
  const flow = trades.flow;
  const stale = degraded || trades.stale;

  const daily = useOhlcv({ pool, timeframe: "1d", initial: initialDaily });
  const bars = useMemo(() => {
    const candles = daily.data?.candles ?? [];
    return candles.slice(-VOLUME_DAYS);
  }, [daily.data]);

  return (
    <CardFrame
      id="flow"
      title="Flow of Mana"
      subtitle="volume & momentum"
      source="GeckoTerminal · trades + daily OHLCV"
      className={className}
    >
      {stale && <StaleBanner dataAsOf={trades.dataAsOf} />}

      <NetFlowHero flow={flow} />

      <PressureSplit flow={flow} />

      <StatGrid
        cols={4}
        className="mt-5"
        items={[
          { label: "24h trades", value: flow ? fmtInt(flow.buyCount + flow.sellCount) : undefined },
          { label: "24h volume", value: flow ? fmtUsdCompact(flow.totalUsd) : undefined },
          {
            label: "Unique buyers",
            value: flow ? `~${fmtInt(flow.uniqueBuyers)}` : undefined,
            tone: "green",
          },
          {
            label: "Unique sellers",
            value: flow ? `~${fmtInt(flow.uniqueSellers)}` : undefined,
            tone: "rose",
          },
        ]}
      />

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted">
            Daily volume · {VOLUME_DAYS}d
          </span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted">main pool</span>
        </div>
        <VolumeBars bars={bars} loading={daily.loading} />
      </div>

      <p className="wiz-caption mt-4">
        {approxCaption(flow)}
      </p>

      <AsOf dataAsOf={trades.dataAsOf} stale={stale} />
    </CardFrame>
  );
}

// ── Net-flow hero (thesis metric: is money flowing in or out?) ───────────────

function NetFlowHero({ flow }: { flow: FlowStats | null }) {
  if (!flow) {
    return (
      <div>
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Net flow · 24h</p>
        <div aria-hidden className="wiz-skel mt-2 h-10 w-48 max-w-full" />
      </div>
    );
  }
  const net = flow.netUsd;
  const flat = Math.abs(net) < 0.5;
  const tone = flat ? "text-ink" : net > 0 ? "text-green" : "text-rose";
  const sign = flat ? "" : net > 0 ? "+" : "-";
  const label = flat ? "balanced" : net > 0 ? "net buying pressure" : "net selling pressure";
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Net flow · 24h</p>
      <p className={`mt-1 font-mono text-3xl font-semibold tabular-nums md:text-4xl ${tone}`}>
        {sign}
        {fmtUsdTrade(Math.abs(net))}
      </p>
      <p className="wiz-caption mt-1.5">
        buy USD − sell USD · <span className={flat ? "" : net > 0 ? "text-green" : "text-rose"}>{label}</span>
      </p>
    </div>
  );
}

// ── Buy vs sell pressure split (diverging — green buys / rose sells) ─────────

function PressureSplit({ flow }: { flow: FlowStats | null }) {
  if (!flow) {
    return <div aria-hidden className="wiz-skel mt-5 h-2.5 w-full rounded-full" />;
  }
  const total = flow.buyUsd + flow.sellUsd;
  const buyPct = total > 0 ? (flow.buyUsd / total) * 100 : 50;
  const sellPct = 100 - buyPct;
  const noFlow = total <= 0;

  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="font-medium text-green">
          Buys · {fmtInt(flow.buyCount)} · {fmtUsdCompact(flow.buyUsd)}
        </span>
        <span className="font-medium text-rose">
          {fmtUsdCompact(flow.sellUsd)} · {fmtInt(flow.sellCount)} · Sells
        </span>
      </div>
      {/* Diverging split by USD share; 2px surface gap between the two fills. */}
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-panel-2"
        role="img"
        aria-label={
          noFlow
            ? "No buy or sell volume in the last 24 hours"
            : `Buy pressure ${buyPct.toFixed(0)}% versus sell pressure ${sellPct.toFixed(0)}% by USD`
        }
      >
        {!noFlow && (
          <>
            <div
              className="h-full rounded-l-full bg-green"
              style={{ width: `${buyPct}%`, marginRight: "2px" }}
            />
            <div className="h-full flex-1 rounded-r-full bg-rose" />
          </>
        )}
      </div>
    </div>
  );
}

// ── 30d daily volume bars (single-hue amethyst — magnitude, not category) ────

function VolumeBars({
  bars,
  loading,
}: {
  bars: { time: number; volume: number }[];
  loading: boolean;
}) {
  if (loading && bars.length === 0) {
    return (
      <div aria-hidden className="flex h-24 items-end gap-[3px]">
        {Array.from({ length: VOLUME_DAYS }, (_, i) => (
          <div key={i} className="wiz-skel flex-1" style={{ height: `${30 + (i % 5) * 12}%` }} />
        ))}
      </div>
    );
  }
  if (bars.length === 0) {
    return (
      <p className="wiz-caption py-6 text-center">
        The mana pool has no recorded days yet — daily volume appears as candles form.
      </p>
    );
  }
  const max = Math.max(...bars.map((b) => b.volume), 0);
  return (
    <div
      className="flex h-24 items-end gap-[3px]"
      role="img"
      aria-label={`Daily WIZARD trading volume for the last ${bars.length} days, main pool`}
    >
      {bars.map((b, i) => {
        const pct = max > 0 ? (b.volume / max) * 100 : 0;
        // Anchored to the baseline; a floor of 2px keeps a nonzero day visible,
        // an empty day shows only a 1px baseline tick (no faked magnitude).
        const height = b.volume > 0 ? `max(${pct}%, 2px)` : "1px";
        return (
          <div
            key={b.time}
            className={`flex-1 rounded-t-[2px] ${b.volume > 0 ? "bg-violet/70" : "bg-violet/20"} ${
              i === bars.length - 1 ? "opacity-100" : ""
            }`}
            style={{ height }}
            title={`${fmtDayUtc(b.time)} · ${fmtUsdCompact(b.volume)}`}
          />
        );
      })}
    </div>
  );
}

// ── Copy ─────────────────────────────────────────────────────────────────────

function approxCaption(flow: FlowStats | null): string {
  const base =
    "Buy/sell pressure, net flow, and unique traders are approximate — they read the last ~100 trades per pool.";
  if (!flow) return base;
  const covers = flow.fullyCovered
    ? "That window currently reaches past 24h, so the counts are near-complete."
    : "For this thin token that window sits just under 24h right now, so treat the counts as a floor.";
  return `${base} ${covers} Daily bars: main pool volume, UTC days; the last bar is today, still filling.`;
}

/** Deterministic "Jul 18" UTC day label for bar tooltips (no hydration drift). */
function fmtDayUtc(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}`;
}
