"use client";

/**
 * The header's Buy menu — outbound links only (plan §4: this site never touches
 * a wallet, every venue is a plain link).
 *
 * Replaces a native <details>/<summary>, which had three defects in this spot:
 * it only closed by clicking the summary again (never on an outside click or
 * Escape), its panel rendered against the sticky header's `backdrop-blur`
 * stacking context and clipped, and toggling it nudged the header's flex row.
 * A controlled menu fixes all three: the trigger keeps a constant size, the
 * panel is absolutely positioned inside its own relative wrapper, and the two
 * dismissals people expect both work.
 */

import { useEffect, useRef, useState } from "react";
import { LINKS } from "@/config/token";

type Venue = {
  label: string;
  href: string;
  /** Small right-aligned note — what this venue is, in a word. */
  note: string;
};

const VENUES: readonly Venue[] = [
  { label: "pump.fun", href: LINKS.buy.pumpFun, note: "launchpad" },
  { label: "Jupiter", href: LINKS.buy.jupiter, note: "aggregator" },
  { label: "Axiom", href: LINKS.buy.axiom, note: "referral" },
];

export function BuyMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Dismiss on an outside pointer-down and on Escape, both bound to the
  // document so they fire wherever focus happens to be.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-violet/50 bg-violet/15 px-3 py-1.5 text-xs font-semibold text-violet-soft transition-colors hover:bg-violet/25"
      >
        Buy ✦
      </button>

      {open && (
        // Positioning and card styling MUST live on separate elements: `.wiz-card`
        // declares `position: relative`, which beats Tailwind's `.absolute` (equal
        // specificity, and the component layer wins the cascade). Put both on one
        // node and the panel silently drops into normal flow — that is what made
        // this menu stretch the header row to 210px, shove the row's contents
        // sideways and push the button off the top of the screen.
        <div
          role="menu"
          aria-label="Where to buy"
          className="absolute right-0 top-full z-50 mt-2 w-56"
        >
          <div className="wiz-card p-2">
            {VENUES.map((venue) => (
              <a
                key={venue.label}
                role="menuitem"
                href={venue.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-baseline justify-between gap-3 rounded px-3 py-2 text-sm transition-colors hover:bg-violet/15"
              >
                <span>{venue.label}</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                  {venue.note}
                </span>
              </a>
            ))}
            <p className="wiz-caption px-3 pb-1 pt-2">
              Outbound links only — this site never touches your wallet.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
