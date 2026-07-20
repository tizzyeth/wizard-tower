"use client";

import { useQuery } from "@tanstack/react-query";
import type { SocialResult } from "@/lib/social";
import type { XSource } from "@/lib/sources/x";

async function fetchSocial(source: XSource): Promise<SocialResult> {
  const res = await fetch(`/api/social?source=${source}`, { cache: "no-store" });
  const body = (await res.json()) as SocialResult;
  // "No posts yet" (ok:false, data:null) is NOT an error — throwing would make
  // TanStack Query retry-spin against an empty table. Only throw on a real transport
  // failure so the last-good render (or the empty seed) survives.
  if (!res.ok && res.status >= 500 && !body.data) {
    throw new Error(body.error ?? `social request failed (${res.status})`);
  }
  return body;
}

/**
 * One feed of The Prophecy Feed. A fresh post lands each poll interval (≤30 min via
 * the cron), so the client polls every 60s — quick to pick up a new post once it is
 * in our DB, and it only ever hits OUR /api/social (never X). `initial` is the
 * server-rendered seed so the active tab paints real posts with no skeleton flash.
 */
export function useSocial(source: XSource, initial: SocialResult) {
  const query = useQuery({
    queryKey: ["social", source],
    queryFn: () => fetchSocial(source),
    initialData: initial.ok && initial.data ? initial : undefined,
    initialDataUpdatedAt: initial.dataAsOf ?? undefined,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const result: SocialResult = query.data ?? initial;

  return {
    result,
    /** A refresh is failing but we're still showing the last good posts. */
    degraded: query.isError && !!result.data,
    refetch: query.refetch,
  };
}
