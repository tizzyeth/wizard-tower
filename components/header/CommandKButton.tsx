"use client";

import { OPEN_COMMAND_EVENT } from "@/components/wizard/CommandPalette";

/**
 * The "⌘K" affordance in the header — a discovery hint for mouse users (§4). It
 * dispatches the same event the palette listens for, so there is one open path.
 *
 * The label is the conventional "⌘K" glyph used by command palettes everywhere
 * (Linear, Vercel, GitHub) — kept static rather than platform-branched so it is
 * SSR-safe (no hydration mismatch). The shortcut itself accepts Cmd OR Ctrl, so
 * Windows/Linux users are covered even though the hint shows ⌘.
 */
export function CommandKButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT))}
      aria-label="Open command palette (Cmd or Ctrl + K)"
      title="Command palette — ⌘K / Ctrl K"
      className="hidden items-center gap-1 rounded border border-violet/30 bg-panel-2 px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-violet/60 hover:text-violet-soft sm:inline-flex"
    >
      <span aria-hidden>⌘K</span>
    </button>
  );
}
