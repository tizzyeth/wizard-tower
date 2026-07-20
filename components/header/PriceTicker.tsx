"use client";

import type { MarketResult } from "@/lib/sources/dexscreener";
import { fmtPct, fmtPrice, signTone } from "@/lib/format";
import { useMarket } from "@/components/cards/useMarket";

const TONE_TEXT = {
  green: "text-green",
  rose: "text-rose",
  muted: "text-muted",
} as const;

/**
 * Sticky-header price ticker (IMPLEMENTATION_PLAN.md §4: "live price + 24h%").
 *
 * Reuses the shared `["market"]` TanStack query key via `useMarket`, exactly as
 * the Ledger / Cauldrons / Verdict do — so adding this ticker costs ZERO extra
 * network: all four consumers fan out from the one 30s DexScreener poll. It is
 * seeded from the same server-rendered snapshot the page already fetched, so it
 * paints real numbers with no skeleton flash and no hydration drift.
 *
 * Renders nothing at all when there is no reading (never an empty husk in the
 * header) — the Ledger card is the place that explains a degraded feed.
 */
export function PriceTicker({ initial }: { initial: MarketResult }) {
  const { result } = useMarket(initial);
  const d = result.data;
  if (!d) return null;

  const change = d.priceChange.h24;
  const tone = signTone(change);

  return (
    <div className="hidden items-baseline gap-2 sm:flex">
      <span className="font-mono text-sm font-medium tabular-nums text-ink">
        {fmtPrice(d.priceUsd)}
      </span>
      <span className={`font-mono text-xs tabular-nums ${TONE_TEXT[tone]}`}>
        {fmtPct(change)}
      </span>
      {/* The bare "+1.23%" above is meaningless to a screen reader without its
          window; name it once here rather than duplicating the number. */}
      <span className="sr-only">24 hour change</span>
    </div>
  );
}
