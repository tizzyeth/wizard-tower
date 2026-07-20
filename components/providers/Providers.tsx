"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * App-wide client providers. TanStack Query drives the 30s polling for every
 * live card (§6). One QueryClient per browser session, created lazily so it is
 * never shared across requests on the server.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Cards seed from server-rendered data and refresh on their own
            // cadence; keep failed refreshes from clearing the last good render.
            retry: 2,
            refetchOnWindowFocus: true,
            staleTime: 30_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
