"use client";

import { CardFrame } from "@/components/wizard/CardFrame";
import { StatHero } from "@/components/wizard/StatHero";
import { StatGrid, type StatItem } from "@/components/wizard/StatGrid";
import { AsOf, AwaitingReading, StaleBanner } from "@/components/wizard/DataStatus";
import type { MarketResult } from "@/lib/sources/dexscreener";
import type { HoldersResult } from "@/lib/holders";
import {
  fmtInt,
  fmtPct,
  fmtPrice,
  fmtNative,
  fmtSupply,
  fmtUsdCompact,
  signTone,
} from "@/lib/format";
import { useMarket } from "./useMarket";
import { useHolders } from "./useHolders";

const TONE_TEXT = {
  green: "text-green",
  rose: "text-rose",
  muted: "text-muted",
} as const;

/** A single timeframe change pill (1H / 6H / 24H), colored by direction. */
function ChangeChip({ label, value }: { label: string; value: number | null }) {
  const tone = signTone(value);
  return (
    <div className="flex flex-col items-center rounded border border-violet/20 bg-panel-2/60 px-2.5 py-1">
      <span className="text-[9px] uppercase tracking-[0.16em] text-muted">{label}</span>
      <span className={`font-mono text-xs font-medium tabular-nums ${TONE_TEXT[tone]}`}>
        {fmtPct(value)}
      </span>
    </div>
  );
}

export function WizardsLedger({
  initial,
  initialHolders,
  className = "",
}: {
  initial: MarketResult;
  initialHolders: HoldersResult;
  className?: string;
}) {
  const { result, degraded } = useMarket(initial);
  // Holder count comes from OUR hourly census, not DexScreener. Shares the
  // ["holders"] query key with the Council of Holders, so the page still polls
  // /api/holders once and both cards read the same reading. Stays "—" until the
  // first snapshot exists — the honest fallback, never a fabricated zero.
  const { result: holders } = useHolders(initialHolders);
  const stale = degraded || result.stale;
  const d = result.data;

  return (
    <CardFrame
      id="ledger"
      title="The Wizard’s Ledger"
      subtitle="live market snapshot"
      source="DexScreener · 30s · Helius · hourly"
      className={className}
    >
      {stale && d && <StaleBanner dataAsOf={result.dataAsOf} />}

      {!d ? (
        <AwaitingReading label="the market reading" />
      ) : (
        <>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:gap-10">
            <div className="shrink-0">
              <StatHero
                label="Price · USD"
                value={fmtPrice(d.priceUsd)}
                sub={`≈ ${fmtNative(d.priceNative, d.quoteSymbol)} per ${initialSymbol(d)}`}
              />
              <div className="mt-3 flex gap-1.5">
                <ChangeChip label="1H" value={d.priceChange.h1} />
                <ChangeChip label="6H" value={d.priceChange.h6} />
                <ChangeChip label="24H" value={d.priceChange.h24} />
              </div>
            </div>

            <StatGrid
              cols={4}
              className="flex-1"
              items={ledgerStats(d, holders.data?.totalHolders ?? null)}
            />
          </div>

          <p className="wiz-caption mt-4">
            Holders are our own hourly on-chain census. All-time high still awaits a
            source — DexScreener’s token feed does not carry it. Liquidity and volume
            sum the {d.activePoolCount} active pools; price follows the{" "}
            {d.primaryDexLabel} main pool.
          </p>

          <AsOf dataAsOf={result.dataAsOf} stale={stale} />
        </>
      )}
    </CardFrame>
  );
}

function initialSymbol(d: NonNullable<MarketResult["data"]>): string {
  return d.pools.find((p) => p.isPrimary)?.baseSymbol ?? "token";
}

function ledgerStats(
  d: NonNullable<MarketResult["data"]>,
  totalHolders: number | null,
): StatItem[] {
  return [
    { label: "Market cap", value: fmtUsdCompact(d.marketCap) },
    { label: "FDV", value: fmtUsdCompact(d.fdv) },
    { label: "Liquidity", value: fmtUsdCompact(d.totalLiquidityUsd) },
    { label: "24h volume", value: fmtUsdCompact(d.volumeH24Usd) },
    // ATH has no source yet — DexScreener's token endpoint does not return it,
    // so this stays an honest em-dash rather than a computed guess.
    { label: "ATH", value: "—", tone: "muted" },
    // Gross distinct-owner count from the latest census (matches Solscan). "—"
    // until the first snapshot lands; history is not retroactive.
    totalHolders == null
      ? { label: "Holders", value: "—", tone: "muted" }
      : { label: "Holders", value: fmtInt(totalHolders) },
    { label: "Token age", value: d.tokenAge },
    { label: "Supply", value: fmtSupply(d.supply) },
  ];
}
