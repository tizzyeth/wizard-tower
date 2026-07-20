"use client";

import { useQuery } from "@tanstack/react-query";
import type { OhlcvResult, Timeframe } from "@/lib/sources/geckoterminal";

async function fetchOhlcv(pool: string, tf: Timeframe): Promise<OhlcvResult> {
  // Dev-only: `?fault=1` on the page URL makes the client poll the fault-injected
  // endpoint so the stale banner can be exercised in the browser. Inert in
  // production — the route ignores the flag there.
  const fault =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("fault") === "1";
  const qs = new URLSearchParams({ pool, tf });
  if (fault) qs.set("fault", "1");
  const res = await fetch(`/api/ohlcv?${qs.toString()}`, { cache: "no-store" });
  const body = (await res.json()) as OhlcvResult;
  // On a hard failure (no candles at all), throw so TanStack Query keeps the
  // last good series instead of overwriting the chart with an empty payload.
  if (!res.ok || !body.ok || !body.data) {
    throw new Error(body.error ?? `ohlcv request failed (${res.status})`);
  }
  return body;
}

/**
 * OHLCV feed for one (pool, timeframe). The query key includes both, so TanStack
 * caches every series the user has viewed — switching back to a seen timeframe
 * is served from cache with no refetch and no skeleton (the < 300ms DoD), while
 * a first-seen series shows the skeleton until its candles land.
 *
 * `initial` is the server-rendered seed; it is only adopted when it matches the
 * requested (pool, timeframe) so the default view paints candles with no flash.
 */
export function useOhlcv({
  pool,
  timeframe,
  initial,
}: {
  pool: string;
  timeframe: Timeframe;
  initial?: OhlcvResult;
}) {
  const seedMatches =
    !!initial &&
    initial.ok &&
    !!initial.data &&
    initial.pool === pool &&
    initial.timeframe === timeframe;
  const seed = seedMatches ? initial : undefined;

  const query = useQuery({
    queryKey: ["ohlcv", pool, timeframe],
    queryFn: () => fetchOhlcv(pool, timeframe),
    initialData: seed,
    initialDataUpdatedAt: seed?.dataAsOf ?? undefined,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
  });

  const result: OhlcvResult | undefined = query.data;

  return {
    /** The current series, or undefined while the first fetch for this key runs. */
    result,
    data: result?.data ?? null,
    /** A refresh is failing but we're still showing the last good candles. */
    degraded: query.isError && !!result?.data,
    /** First load of this key with nothing to show yet → render the skeleton. */
    loading: query.isPending && !result?.data,
  };
}
