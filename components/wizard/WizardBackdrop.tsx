/**
 * Ambient Wizardcore artwork behind the bento, rotating daily.
 *
 * The frames are lifted from `Wizardcore-Visuals-Pack.pdf` — the project's own
 * visual bible, already in the repo — rather than generated. They are the actual
 * character, which no generated approximation would be, and the pack is what §3
 * points at for the identity in the first place.
 *
 * ROTATION. The pair is chosen from the UTC day number, not at random: everyone
 * who opens the tower on the same day sees the same room, which is what makes it
 * feel like a place rather than a slideshow. It also keeps the server render and
 * the client agreeing — a random pick would differ between them and hydrate
 * wrong. The two indices are offset by half the set so the same frame never
 * appears twice at once.
 *
 * Held to a strict rule: this is atmosphere, never content. The cards are opaque
 * panels, so the art only ever shows in the gutters and the page margins, and it
 * sits under the existing plum orbs and hearth glow. Each frame is masked to fade
 * out well before it reaches the column where the numbers live, and kept dim
 * enough that nothing reads through a card edge.
 *
 * Fixed, not scrolling: the tower stays lit while the data moves past it.
 * `pointer-events-none` throughout, `aria-hidden` because it says nothing a
 * screen reader needs, and hidden entirely on small screens where the bento is
 * one full-width column with no gutters to show it in.
 */

/** Every clean frame from the pack. Two are shown per day. */
const FRAMES = [
  "/wizard-01.jpg", // the council at candlelight
  "/wizard-02.jpg", // three elders above the earth
  "/wizard-03.jpg", // the wizard himself
  "/wizard-04.jpg", // the turtle in orbit
  "/wizard-05.jpg", // the fisheye council
  "/wizard-06.jpg", // the rider
] as const;

/** Days since the epoch, UTC — the rotation clock. */
function utcDayNumber(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/** The pair for a given day: two different frames, stable for the whole day. */
export function framesForDay(now: Date = new Date()): { top: string; bottom: string } {
  const day = utcDayNumber(now);
  const n = FRAMES.length;
  return {
    top: FRAMES[((day % n) + n) % n],
    // Half the set apart, so the two are never the same frame.
    bottom: FRAMES[((day + Math.floor(n / 2)) % n + n) % n],
  };
}

export function WizardBackdrop() {
  const { top, bottom } = framesForDay();
  return (
    <div aria-hidden className="wiz-backdrop">
      <div
        className="wiz-backdrop-frame wiz-backdrop-top"
        style={{ backgroundImage: `url(${top})` }}
      />
      <div
        className="wiz-backdrop-frame wiz-backdrop-bottom"
        style={{ backgroundImage: `url(${bottom})` }}
      />
    </div>
  );
}
