"use client";

import { CardFrame } from "@/components/wizard/CardFrame";
import { AsOf, AwaitingReading, StaleBanner } from "@/components/wizard/DataStatus";
import type { MarketResult, PoolRow } from "@/lib/sources/dexscreener";
import type { SafetyResult } from "@/lib/sources/rugcheck";
import { fmtInt, fmtPct, fmtPrice, fmtRatioPct, fmtUsdCompact } from "@/lib/format";
import { useMarket } from "./useMarket";
import { useSafety } from "./useSafety";

export function TheCauldrons({
  initial,
  initialSafety,
  className = "",
}: {
  initial: MarketResult;
  initialSafety: SafetyResult;
  className?: string;
}) {
  const { result, degraded } = useMarket(initial);
  const { result: safety } = useSafety(initialSafety);
  const stale = degraded || result.stale;
  const d = result.data;
  // M4 follow-up: the primary pool's LP-locked % from RugCheck (§4 footer).
  const lpLockedPct = safety.data?.lpLockedPct ?? null;

  return (
    <CardFrame
      id="pools"
      title="The Cauldrons"
      subtitle="pools & liquidity"
      source="DexScreener · 30s"
      className={className}
    >
      {stale && d && <StaleBanner dataAsOf={result.dataAsOf} />}

      {!d ? (
        <AwaitingReading label="the active pools" />
      ) : (
        <>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.12em] text-muted">
                  <th className="pb-2 text-left font-medium">Pool</th>
                  <th className="pb-2 text-right font-medium">Liquidity</th>
                  <th className="hidden pb-2 text-right font-medium sm:table-cell">24h vol</th>
                  <th className="hidden pb-2 text-right font-medium sm:table-cell">Txns</th>
                  <th className="pb-2 text-right font-medium">Price</th>
                  <th className="pb-2 text-right font-medium">Spread</th>
                </tr>
              </thead>
              <tbody>
                {d.pools.map((pool) => (
                  <PoolTableRow key={pool.pairAddress} pool={pool} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-violet/15 pt-3 text-xs">
            <FooterStat label="Active pools" value={fmtInt(d.activePoolCount)} />
            <FooterStat label="Total liquidity" value={fmtUsdCompact(d.totalLiquidityUsd)} />
            <FooterStat label="Liquidity / mcap" value={fmtRatioPct(d.liqToMcap)} />
            <FooterStat
              label="LP locked"
              value={lpLockedPct == null ? "—" : `${lpLockedPct.toFixed(1)}%`}
              pending={lpLockedPct == null}
            />
          </div>

          <p className="wiz-caption mt-3">
            Active pools hold more than $100 in liquidity. LP-locked % is the primary pool’s,
            via RugCheck.
          </p>

          <AsOf dataAsOf={result.dataAsOf} stale={stale} />
        </>
      )}
    </CardFrame>
  );
}

function PoolTableRow({ pool }: { pool: PoolRow }) {
  const sharePct = Math.max(2, Math.round(pool.liquidityShare * 100));
  const row = (
    <tr className={`align-top ${pool.isPrimary ? "bg-violet/5" : ""}`}>
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2">
          <span className="rounded border border-violet/30 bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-violet-soft">
            {pool.dexLabel}
          </span>
          <div className="min-w-0">
            <div className="font-mono text-xs text-ink">
              {pool.baseSymbol}/{pool.quoteSymbol}
            </div>
            {pool.isPrimary && (
              <div className="text-[9px] uppercase tracking-[0.14em] text-violet-soft/80">
                main pool
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="py-2.5 pl-3 text-right">
        <div className="font-mono tabular-nums text-ink">{fmtUsdCompact(pool.liquidityUsd)}</div>
        {/* Magnitude bar — single-hue amethyst, share of total active liquidity. */}
        <div
          className="mt-1 ml-auto h-1 w-20 overflow-hidden rounded-full bg-violet/10"
          role="img"
          aria-label={`${Math.round(pool.liquidityShare * 100)}% of active liquidity`}
        >
          <div className="h-full rounded-full bg-violet/60" style={{ width: `${sharePct}%` }} />
        </div>
      </td>
      <td className="hidden py-2.5 pl-3 text-right font-mono tabular-nums text-muted sm:table-cell">
        {fmtUsdCompact(pool.volumeH24)}
      </td>
      <td className="hidden py-2.5 pl-3 text-right font-mono tabular-nums text-muted sm:table-cell">
        {fmtInt(pool.txnsH24)}
      </td>
      <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-ink">
        {fmtPrice(pool.priceUsd)}
      </td>
      <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-muted">
        {pool.isPrimary ? "—" : fmtPct(pool.spreadPct)}
      </td>
    </tr>
  );
  return row;
}

function FooterStat({
  label,
  value,
  pending = false,
}: {
  label: string;
  value: string;
  pending?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</span>
      <span
        className={`font-mono tabular-nums ${pending ? "text-muted" : "text-ink"}`}
        title={pending ? "Pending — arrives with Wards & Protections (RugCheck)" : undefined}
      >
        {value}
      </span>
    </span>
  );
}
