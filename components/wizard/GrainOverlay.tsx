/**
 * Subtle film-grain texture over the whole page (PDF motif).
 * Pure CSS, static (no motion), desktop only — see .wiz-grain in globals.css.
 * Always in the DOM; visibility is user-toggleable via the cmd+K palette (M7),
 * which flips `data-grain="off"` on <html> and persists the choice. Default on.
 */
export function GrainOverlay() {
  return <div aria-hidden className="wiz-grain" />;
}
