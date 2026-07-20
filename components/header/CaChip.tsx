"use client";

import { useEffect, useRef, useState } from "react";

/** Truncated contract-address chip; click copies the full mint. */
export function CaChip({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions/http) — the chip simply stays put.
    }
  }

  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy contract address"
      className="rounded border border-violet/35 bg-panel-2 px-2 py-1 font-mono text-xs text-violet-soft transition-colors hover:border-violet/70 hover:text-ink"
    >
      {copied ? "copied ✦" : short}
    </button>
  );
}
