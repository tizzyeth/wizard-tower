/**
 * Ambient Wizardcore artwork behind the bento.
 *
 * The frames are lifted from `Wizardcore-Visuals-Pack.pdf` — the project's own
 * visual bible, already in the repo — rather than generated. They are the actual
 * character, which no generated approximation would be, and the pack is what §3
 * points at for the identity in the first place.
 *
 * Held to a strict rule: this is atmosphere, never content. The cards are opaque
 * panels, so the art only ever shows in the gutters and the page margins, and it
 * sits under the existing plum orbs and hearth glow rather than replacing them.
 * Each frame is masked to fade out well before it reaches the column where the
 * numbers live, and kept dim enough that nothing reads through a card edge.
 *
 * Fixed, not scrolling: the tower stays lit while the data moves past it.
 * `pointer-events-none` throughout, `aria-hidden` because it says nothing a
 * screen reader needs, and hidden entirely on small screens where the bento is
 * one full-width column with no gutters to show it in.
 */
export function WizardBackdrop() {
  return (
    <div aria-hidden className="wiz-backdrop">
      <div className="wiz-backdrop-frame wiz-backdrop-top" />
      <div className="wiz-backdrop-frame wiz-backdrop-bottom" />
    </div>
  );
}
