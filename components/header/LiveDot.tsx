import type { FeedHealth, HealthReport } from "@/lib/health";

/**
 * The header's live indicator, told the truth.
 *
 * The dot used to mean one thing: "this page is live". It still does — but a page
 * can be perfectly live while the data behind it quietly stopped arriving, which is
 * exactly the failure the crons can suffer without anyone noticing. So the dot now
 * carries freshness too, at the lowest volume that is still honest.
 *
 * Restraint is the design constraint here, not decoration:
 *   - NO new accent colour. Fresh keeps the reserved ember (`.wiz-live-dot`); stale
 *     drops to muted mauve; down uses rose. Gold stays the Verdict's alone.
 *   - Stale states STOP the pulse instead of adding motion. An alarm that blinks
 *     harder is the wrong instinct — a dead feed should look dead, not urgent.
 *   - The cards already own their per-source stale banners (components/wizard/
 *     DataStatus.tsx). This is a different signal — our OWN pipeline, not an
 *     upstream outage — so it says its piece in the header and does not repeat
 *     itself in the grid.
 *
 * `unknown` deliberately renders as the normal live dot: no database (the e2e gate)
 * or nothing recorded yet is not evidence of an outage, and an indicator that warns
 * when it does not know is an indicator people learn to ignore. This also keeps the
 * Playwright run (WIZARD_DISABLE_DB=1) deterministic.
 */

type Tone = "live" | "warn" | "down";

export type FreshnessSignal = {
  tone: Tone;
  /** The 10px uppercase word beside the dot. */
  label: string;
  /** Hover text + the screen-reader sentence. Literal numbers, in-character frame. */
  title: string;
};

/** How each feed's clock reads in a sentence — the two measure different things. */
function phrase(feed: FeedHealth): string {
  return feed.key === "holderSnapshots"
    ? `holder snapshots last recorded ${feed.ageHours}h ago (expected hourly)`
    : `the prophecy feed last stored a post ${feed.ageHours}h ago (polled every 30 minutes)`;
}

/**
 * PURE: health report → what the dot should say. Exported for unit testing so the
 * wording is pinned by a test rather than by a screenshot.
 */
export function freshnessSignal(report: HealthReport | null): FreshnessSignal {
  if (!report || report.status === "ok" || report.status === "unknown") {
    return { tone: "live", label: "live", title: "the pipe is lit" };
  }
  const stale = report.feeds.filter((f) => f.status === "degraded" || f.status === "down");
  const detail = stale.map(phrase).join(" · ");
  return report.status === "down"
    ? {
        tone: "down",
        label: "stale",
        title: `The tower's watchfires have gone out — ${detail}.`,
      }
    : {
        tone: "warn",
        label: "stale",
        title: `The tower's watchfires have burned low — ${detail}.`,
      };
}

const TONE_CLASS: Record<Tone, string> = {
  live: "",
  warn: "wiz-live-dot--warn",
  down: "wiz-live-dot--down",
};

export function LiveDot({ health }: { health: HealthReport | null }) {
  const signal = freshnessSignal(health);
  return (
    <span
      className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted"
      title={signal.title}
    >
      <span
        aria-hidden
        className={`wiz-live-dot inline-block h-1.5 w-1.5 rounded-full ${TONE_CLASS[signal.tone]}`}
      />
      {signal.label}
      {/* The dot is decorative; this is what a screen reader actually announces.
          `title` on an aria-hidden element is never read out, so the sentence has
          to exist as real text. */}
      <span className="sr-only">— {signal.title}</span>
    </span>
  );
}
