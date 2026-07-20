"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketResult } from "@/lib/sources/dexscreener";

async function fetchMarket(): Promise<MarketResult> {
  // Dev-only: `?fault=1` on the page URL makes the client poll the fault-injected
  // endpoint so the stale banner can be exercised in the browser. Inert in
  // production — the route ignores the flag there.
  const fault =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("fault") === "1";
  const res = await fetch(`/api/market${fault ? "?fault=1" : ""}`, { cache: "no-store" });
  const body = (await res.json()) as MarketResult;
  // On a hard failure (no data at all), throw so TanStack Query keeps the last
  // good render instead of overwriting the card with an empty payload.
  if (!res.ok || !body.ok || !body.data) {
    throw new Error(body.error ?? `market request failed (${res.status})`);
  }
  return body;
}

/**
 * Shared market feed for the Ledger + Cauldrons. Both cards use the same query
 * key, so the page polls DexScreener once every 30s and fans the result out.
 * `initial` is the server-rendered snapshot — the page paints real numbers with
 * no skeleton flash, then this hook keeps them live.
 */
export function useMarket(initial: MarketResult) {
  const query = useQuery({
    queryKey: ["market"],
    queryFn: fetchMarket,
    initialData: initial.ok && initial.data ? initial : undefined,
    initialDataUpdatedAt: initial.dataAsOf ?? undefined,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  // Prefer live data; fall back to the server snapshot if the first poll is
  // still in flight or a hard failure left the query without data.
  const result: MarketResult = query.data ?? initial;

  return {
    result,
    /** A refresh is failing but we're still showing the last good numbers. */
    degraded: query.isError && !!result.data,
    refetch: query.refetch,
  };
}
