const RUNE = {
  pass: { glyph: "✦", className: "text-green border-green/40 bg-green/10", sr: "passed" },
  warn: { glyph: "◆", className: "text-gold border-gold/40 bg-gold/10", sr: "warning" },
  fail: { glyph: "✕", className: "text-rose border-rose/40 bg-rose/10", sr: "failed" },
} as const;

type RuneProps = {
  status: keyof typeof RUNE;
  /** What the ward checks, e.g. "Liquidity locked". */
  label: string;
  /**
   * The measured reading behind the verdict, e.g. "93.9%" or "revoked". Rendered
   * in ink monospace — the glyph carries the verdict color so numerals stay
   * undecorated (§3: numbers always play it straight).
   */
  measured?: string;
  /** The band it was judged against, e.g. "≥ 80%" — rendered dimmer, alongside. */
  threshold?: string;
  /** Optional context under the label, e.g. "pools & lockers excluded". */
  note?: string;
};

/**
 * One pass/warn/fail row of the safety checklist (Wards & Protections). Shows the
 * measured value AND the threshold it was judged against, so the card reads as a
 * transparent rubric rather than an oracle.
 */
export function Rune({ status, label, measured, threshold, note }: RuneProps) {
  const rune = RUNE[status];
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[11px] ${rune.className}`}
      >
        {rune.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink">{label}</span>
          {measured && (
            <span className="shrink-0 font-mono text-sm tabular-nums text-ink">{measured}</span>
          )}
        </div>
        {(note || threshold) && (
          <div className="mt-0.5 flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-muted">{note}</span>
            {threshold && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                {threshold}
              </span>
            )}
          </div>
        )}
      </div>
      <span className="sr-only">{rune.sr}</span>
    </div>
  );
}
