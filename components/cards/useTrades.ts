"use client";

import { useQuery } from "@tanstack/react-query";
import type { TradesResult } from "@/lib/sources/gecko-trades";

async function fetchTrades(): Promise<TradesResult> {
  // Dev-only: `?fault=1` on the page URL makes the client poll the fault-injected
  // endpoint so the stale banner can be exercised in the browser. Inert in
  // production — the route ignores the flag there.
  const fault =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("fault") === "1";
  const res = await fetch(`/api/trades${fault ? "?fault=1" : ""}`, { cache: "no-store" });
  const body = (await res.json()) as TradesResult;
  // On a hard failure (no tape at all), throw so TanStack Query keeps the last
  // good tape instead of overwriting it with an empty payload.
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? `trades request failed (${res.status})`);
  }
  return body;
}

/**
 * Shared trade feed for the Ledger of Deeds + Flow of Mana. Both cards use the
 * same query key, so the page polls the merged tape once every 30s and fans the
 * result out. `initial` is the server-rendered seed — the cards paint real deeds
 * with no skeleton flash, then this hook keeps them live (server cache 30s + this
 * 30s poll ⇒ a fresh on-chain trade surfaces within ~60s worst case).
 */
export function useTrades(initial: TradesResult) {
  const query = useQuery({
    queryKey: ["trades"],
    queryFn: fetchTrades,
    initialData: initial.ok ? initial : undefined,
    initialDataUpdatedAt: initial.dataAsOf ?? undefined,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  // Prefer live data; fall back to the server seed if the first poll is still in
  // flight or a hard failure left the query without data.
  const result: TradesResult = query.data ?? initial;

  return {
    result,
    /** A refresh is failing but we're still showing the last good tape. */
    degraded: query.isError && result.ok,
    refetch: query.refetch,
  };
}
