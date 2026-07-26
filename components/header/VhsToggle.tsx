"use client";

/**
 * Header switch for the VHS overlay — the effect people actually want to play
 * with, so it earns a visible control rather than living only behind cmd+K.
 *
 * Shares its state with the palette through `lib/vhs.ts` (the DOM attribute is
 * the source of truth), and subscribes to changes so flipping it in one place
 * updates the other without a reload.
 *
 * `useSyncExternalStore` rather than an effect: the state lives outside React,
 * and this is the idiom for that — it also keeps the server render and the first
 * client render agreeing, since both start from "on".
 */

import { useSyncExternalStore } from "react";
import { onVhsChange, setVhs, vhsIsOn } from "@/lib/vhs";

export function VhsToggle() {
  const on = useSyncExternalStore(
    onVhsChange,
    vhsIsOn,
    // Server snapshot: the overlay defaults to on, and the inline script in
    // layout.tsx has already applied the stored preference before paint.
    () => true,
  );

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setVhs(!on)}
      title={on ? "Turn the VHS overlay off" : "Turn the VHS overlay on"}
      className={`group flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
        on
          ? "border-violet/50 bg-violet/15 text-violet-soft"
          : "border-violet/20 text-muted hover:border-violet/40 hover:text-violet-soft"
      }`}
    >
      <span className="sr-only">VHS overlay</span>
      {/* A little CRT: scanlines that light up when the effect is on. */}
      <svg aria-hidden viewBox="0 0 16 12" className="h-3 w-4" fill="none">
        <rect
          x="0.6"
          y="0.6"
          width="14.8"
          height="10.8"
          rx="1.6"
          stroke="currentColor"
          strokeWidth="1.1"
        />
        {on && (
          <g fill="currentColor" opacity="0.75">
            <rect x="2.6" y="3" width="10.8" height="1" />
            <rect x="2.6" y="5.5" width="10.8" height="1" />
            <rect x="2.6" y="8" width="10.8" height="1" />
          </g>
        )}
      </svg>
      <span aria-hidden>VHS</span>
    </button>
  );
}
