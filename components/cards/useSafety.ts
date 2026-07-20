"use client";

import { useQuery } from "@tanstack/react-query";
import type { SafetyResult } from "@/lib/sources/rugcheck";

async function fetchSafety(): Promise<SafetyResult> {
  // Dev-only: `?fault=1` on the page URL makes the client poll the fault-injected
  // endpoint so the stale banner can be exercised in the browser. Inert in
  // production — the route ignores the flag there.
  const fault =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("fault") === "1";
  const res = await fetch(`/api/safety${fault ? "?fault=1" : ""}`, { cache: "no-store" });
  const body = (await res.json()) as SafetyResult;
  // On a hard failure (no report at all), throw so TanStack Query keeps the last
  // good render instead of overwriting the card with an empty payload.
  if (!res.ok || !body.ok || !body.data) {
    throw new Error(body.error ?? `safety request failed (${res.status})`);
  }
  return body;
}

/**
 * Safety feed for Wards & Protections. The upstream RugCheck report is cached 1h
 * server-side, so the client polls slowly (every 10min) — enough to pick up a
 * fresh report within one server-cache window without adding load. `initial` is
 * the server-rendered seed so the card paints real runes with no skeleton flash.
 */
export function useSafety(initial: SafetyResult) {
  const query = useQuery({
    queryKey: ["safety"],
    queryFn: fetchSafety,
    initialData: initial.ok && initial.data ? initial : undefined,
    initialDataUpdatedAt: initial.dataAsOf ?? undefined,
    refetchInterval: 600_000, // 10min — the server cache is 1h anyway
    refetchIntervalInBackground: false,
  });

  // Prefer live data; fall back to the server seed if the first poll is still in
  // flight or a hard failure left the query without data.
  const result: SafetyResult = query.data ?? initial;

  return {
    result,
    /** A refresh is failing but we're still showing the last good report. */
    degraded: query.isError && !!result.data,
    refetch: query.refetch,
  };
}
