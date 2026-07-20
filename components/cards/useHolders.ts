"use client";

import { useQuery } from "@tanstack/react-query";
import type { HoldersResult } from "@/lib/holders";

async function fetchHolders(): Promise<HoldersResult> {
  const res = await fetch("/api/holders", { cache: "no-store" });
  const body = (await res.json()) as HoldersResult;
  // A "no snapshot yet" response (ok:false, data:null) is NOT an error — throwing
  // would make TanStack Query retry-spin against an empty table. Only throw on a
  // real transport failure so the last-good render (or the empty seed) survives.
  if (!res.ok && res.status >= 500 && !body.data) {
    throw new Error(body.error ?? `holders request failed (${res.status})`);
  }
  return body;
}

/**
 * Holder census feed for the Council of Holders. A fresh snapshot lands hourly
 * (the cron), so the client polls every 60s — enough to pick up a new census
 * within a minute of it landing. `initial` is the server-rendered seed so the
 * card paints the recorded numbers with no skeleton flash.
 */
export function useHolders(initial: HoldersResult) {
  const query = useQuery({
    queryKey: ["holders"],
    queryFn: fetchHolders,
    initialData: initial.data ? initial : undefined,
    initialDataUpdatedAt: initial.dataAsOf ?? undefined,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const result: HoldersResult = query.data ?? initial;

  return {
    result,
    /** A refresh is failing but we're still showing the last good census. */
    degraded: query.isError && !!result.data,
    refetch: query.refetch,
  };
}
