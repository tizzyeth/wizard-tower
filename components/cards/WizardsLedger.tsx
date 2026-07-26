"use client";

import { ShareButton } from "@/components/wizard/ShareButton";
import { CardFrame } from "@/components/wizard/CardFrame";
import { StatHero } from "@/components/wizard/StatHero";
import { StatGrid, type StatItem } from "@/components/wizard/StatGrid";
import { AsOf, AwaitingReading, StaleBanner } from "@/components/wizard/DataStatus";
import type { MarketResult } from "@/lib/sources/dexscreener";
import type { HoldersResult } from "@/lib/holders";
import type { Ath } from "@/lib/metrics/ath";
import {
  fmtDateUtc,
  fmtMonthUtc,
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
  ath,
  className = "",
}: {
  initial: MarketResult;
  initialHolders: HoldersResult;
  /**
   * ATH computed server-side from the main pool's full daily series (M10). Slow-
   * moving by nature, so it is a static seed rather than a polled query — a new
   * high only appears on the next page load, which for an all-time extreme is fine.
   * Null when the series is unavailable → the card keeps its honest em-dash.
   */
  ath?: Ath | null;
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
        controls={<ShareButton card="ledger" label="The Wizard’s Ledger" />}
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
              items={ledgerStats(d, holders.data?.totalHolders ?? null, ath ?? null)}
            />
          </div>

          <p className="wiz-caption mt-4">
            Holders are our own hourly on-chain census.{" "}
            {ath ? (
              <>
                The high is the largest daily high in the {d.primaryDexLabel} main
                pool’s candle history, which begins {fmtDateUtc(ath.sinceMs)} — so it
                is labelled “since” rather than all-time: $WIZARD launched on pump.fun
                and its bonding-curve phase predates the pool we can read.
              </>
            ) : (
              <>
                All-time high still awaits a source — DexScreener’s token feed does not
                carry it and the candle history is unavailable right now.
              </>
            )}{" "}
            Liquidity and volume sum the {d.activePoolCount} active pools; price
            follows the {d.primaryDexLabel} main pool.
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
  ath: Ath | null,
): StatItem[] {
  return [
    { label: "Market cap", value: fmtUsdCompact(d.marketCap) },
    { label: "FDV", value: fmtUsdCompact(d.fdv) },
    { label: "Liquidity", value: fmtUsdCompact(d.totalLiquidityUsd) },
    { label: "24h volume", value: fmtUsdCompact(d.volumeH24Usd) },
    // M10: the highest daily high in the main pool's candle history. The label
    // carries the coverage start because that history begins at the POOL's
    // creation, not the token's pump.fun launch — so this is provably a
    // "high since <date>", never an unqualified all-time high. Still "—" when
    // the daily series is unavailable: a wrong ATH is worse than none.
    // Month precision in the label, exact date in the caption: at 390px the full
    // "11 Mar 2026" wrapped this label to two lines, which knocked its value out of
    // alignment with "Holders" beside it. Month is enough to stop the figure reading
    // as an absolute all-time high, which is the caveat's whole job.
    ath == null
      ? { label: "ATH", value: "—", tone: "muted" }
      : { label: `ATH since ${fmtMonthUtc(ath.sinceMs)}`, value: fmtPrice(ath.priceUsd) },
    // Gross distinct-owner count from the latest census (matches Solscan). "—"
    // until the first snapshot lands; history is not retroactive.
    totalHolders == null
      ? { label: "Holders", value: "—", tone: "muted" }
      : { label: "Holders", value: fmtInt(totalHolders) },
    { label: "Token age", value: d.tokenAge },
    { label: "Supply", value: fmtSupply(d.supply) },
  ];
}
