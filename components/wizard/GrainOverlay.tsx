/**
 * The VHS overlay: film grain, CRT scanlines, an edge vignette and a tracking
 * band that crawls down the picture. Pure CSS, desktop only — see .wiz-grain
 * in globals.css for the layers and the constraints they respect.
 * Always in the DOM; visibility is user-toggleable via the cmd+K palette (M7),
 * which flips `data-grain="off"` on <html> and persists the choice. Default on.
 */
export function GrainOverlay() {
  return (
    <div aria-hidden className="wiz-grain">
      {/* The sweeping tracking band; grain, scanlines and vignette are
          pseudo-elements on the parent (see .wiz-grain in globals.css). */}
      <span className="wiz-vhs-track" />
    </div>
  );
}
