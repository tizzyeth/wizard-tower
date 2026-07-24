import { describe, it, expect } from "vitest";
import {
  classifyAge,
  evaluateFeed,
  rollUp,
  summarize,
  buildReport,
  type FeedHealth,
} from "@/lib/health";
import { freshnessSignal } from "@/components/header/LiveDot";
import { THRESHOLDS } from "@/config/token";

/**
 * Freshness logic (lib/health.ts) — the app-side cron monitor. Pure throughout, so
 * every case is exercised with an injected clock and no database.
 *
 * The cases that matter are the ones where a naive implementation lies: an empty
 * table must not read as an outage, a dead database must not read as healthy, and
 * a feed that is merely quiet must not read as broken.
 */

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
const band = { warnHours: 6, failHours: 24 };
const agoHours = (h: number) => NOW - h * HOUR;

describe("classifyAge", () => {
  it("is ok inside the warn band", () => {
    expect(classifyAge(0, band)).toBe("ok");
    expect(classifyAge(3 * HOUR, band)).toBe("ok");
  });

  it("treats the boundaries as still-acceptable (strictly greater-than trips)", () => {
    // "stale after 6h" means 6h itself has not yet gone stale.
    expect(classifyAge(6 * HOUR, band)).toBe("ok");
    expect(classifyAge(6 * HOUR + 1, band)).toBe("degraded");
    expect(classifyAge(24 * HOUR, band)).toBe("degraded");
    expect(classifyAge(24 * HOUR + 1, band)).toBe("down");
  });

  it("returns unknown for an unmeasurable age rather than guessing", () => {
    expect(classifyAge(null, band)).toBe("unknown");
    expect(classifyAge(Number.NaN, band)).toBe("unknown");
    expect(classifyAge(Number.POSITIVE_INFINITY, band)).toBe("unknown");
  });
});

describe("evaluateFeed", () => {
  it("reports a fresh feed with its age and the band it was judged against", () => {
    const feed = evaluateFeed("holderSnapshots", agoHours(1.5), band, NOW);
    expect(feed.status).toBe("ok");
    expect(feed.ageHours).toBe(1.5);
    expect(feed.warnAfterHours).toBe(6);
    expect(feed.failAfterHours).toBe(24);
    expect(feed.detail).toContain("warn > 6h");
  });

  it("warns past the warn threshold", () => {
    const feed = evaluateFeed("holderSnapshots", agoHours(9), band, NOW);
    expect(feed.status).toBe("degraded");
    expect(feed.ageHours).toBe(9);
  });

  it("goes down past the fail threshold", () => {
    const feed = evaluateFeed("holderSnapshots", agoHours(30), band, NOW);
    expect(feed.status).toBe("down");
    expect(feed.ageHours).toBe(30);
  });

  it("calls no-data-at-all unknown, NOT down — never recorded is not an outage", () => {
    const feed = evaluateFeed("xPosts", null, band, NOW);
    expect(feed.status).toBe("unknown");
    expect(feed.ageMs).toBeNull();
    expect(feed.ageHours).toBeNull();
    expect(feed.lastWriteAt).toBeNull();
    expect(feed.detail).toContain("no rows recorded yet");
  });

  it("clamps a future timestamp to age 0 instead of reporting a negative age", () => {
    // Clock skew between Neon and the runtime must not read as impossibly fresh.
    const feed = evaluateFeed("holderSnapshots", NOW + 5 * HOUR, band, NOW);
    expect(feed.ageMs).toBe(0);
    expect(feed.status).toBe("ok");
  });

  it("documents what each feed's clock actually measures", () => {
    expect(evaluateFeed("holderSnapshots", agoHours(1), band, NOW).detail).toContain(
      "holder_snapshots.ts",
    );
    // The x_posts clock conflates poller health with community silence — the
    // report has to say so, because the threshold choice depends on it.
    expect(evaluateFeed("xPosts", agoHours(1), band, NOW).detail).toContain(
      "advances only when the poller actually stores a post",
    );
  });
});

describe("rollUp", () => {
  const feed = (status: FeedHealth["status"]): FeedHealth =>
    ({ ...evaluateFeed("holderSnapshots", agoHours(1), band, NOW), status }) as FeedHealth;

  it("takes the worst judgeable status", () => {
    expect(rollUp([feed("ok"), feed("ok")])).toBe("ok");
    expect(rollUp([feed("ok"), feed("degraded")])).toBe("degraded");
    expect(rollUp([feed("degraded"), feed("down")])).toBe("down");
    expect(rollUp([feed("down"), feed("ok")])).toBe("down");
  });

  it("skips unknown feeds rather than counting them as healthy or failing", () => {
    expect(rollUp([feed("unknown"), feed("ok")])).toBe("ok");
    expect(rollUp([feed("unknown"), feed("down")])).toBe("down");
  });

  it("is unknown only when nothing at all is judgeable", () => {
    expect(rollUp([feed("unknown"), feed("unknown")])).toBe("unknown");
    expect(rollUp([])).toBe("unknown");
  });
});

describe("buildReport", () => {
  it("reports both feeds fresh against the shipped thresholds", () => {
    const report = buildReport(
      { holderSnapshotsAt: agoHours(0.5), xPostsAt: agoHours(2), dbAvailable: true },
      NOW,
    );
    expect(report.status).toBe("ok");
    expect(report.dbAvailable).toBe(true);
    expect(report.feeds.map((f) => f.key)).toEqual(["holderSnapshots", "xPosts"]);
    expect(report.note).toBe("all feeds fresh");
    expect(report.error).toBeUndefined();
  });

  it("does not cry wolf on the measured healthy gaps that motivated the bands", () => {
    // Real production gaps observed 2026-07-19/20 on a WORKING pipeline:
    // a 3.0h snapshot gap (GitHub schedule lag) and an 8.9h x_posts write gap
    // (quiet overnight community). Both must still read ok.
    const report = buildReport(
      { holderSnapshotsAt: agoHours(3.0), xPostsAt: agoHours(8.9), dbAvailable: true },
      NOW,
    );
    expect(report.status).toBe("ok");
  });

  it("tolerates a quiet community plus a full 4h poll cycle", () => {
    // The scenario the xPosts bands were widened for (2026-07-25): the poll floor
    // is 4h, so a post landing right after a poll waits a cycle to be seen. Stack
    // that on the measured 8.9h quiet stretch and a HEALTHY feed can read ~13h
    // old — which the previous 12h warn band would have flagged as degraded.
    const report = buildReport(
      { holderSnapshotsAt: agoHours(0.5), xPostsAt: agoHours(13), dbAvailable: true },
      NOW,
    );
    expect(report.status).toBe("ok");
    expect(report.feeds.find((f) => f.key === "xPosts")?.status).toBe("ok");
  });

  it("still catches the 13.4h snapshot gap as degraded, not silently fine", () => {
    const report = buildReport(
      { holderSnapshotsAt: agoHours(13.4), xPostsAt: agoHours(1), dbAvailable: true },
      NOW,
    );
    expect(report.status).toBe("degraded");
    expect(report.note).toContain("holder snapshots");
  });

  it("flags a dead snapshot cron as down and names the offending feed", () => {
    const report = buildReport(
      { holderSnapshotsAt: agoHours(48), xPostsAt: agoHours(1), dbAvailable: true },
      NOW,
    );
    expect(report.status).toBe("down");
    expect(report.note).toContain("feed down");
    expect(report.note).toContain("holder snapshots");
  });

  it("catches X_POLL_ENABLED=false — snapshots fine, prophecy feed long dead", () => {
    // The silent killer: every run exits 0, nothing is ever written.
    // 52h is past the 48h fail band — the bands were widened from 12h/36h when
    // the poll floor went to 4h, so this age must stay clear of the new one.
    const report = buildReport(
      { holderSnapshotsAt: agoHours(0.5), xPostsAt: agoHours(52), dbAvailable: true },
      NOW,
    );
    expect(report.status).toBe("down");
    expect(report.feeds.find((f) => f.key === "xPosts")?.status).toBe("down");
    expect(report.feeds.find((f) => f.key === "holderSnapshots")?.status).toBe("ok");
  });

  it("degrades to unknown with no database (WIZARD_DISABLE_DB=1 / e2e)", () => {
    const report = buildReport(
      { holderSnapshotsAt: null, xPostsAt: null, dbAvailable: false },
      NOW,
    );
    expect(report.status).toBe("unknown");
    expect(report.dbAvailable).toBe(false);
    expect(report.note).toContain("not judgeable");
    expect(report.error).toBeUndefined();
  });

  it("reports a DB read failure as unknown + an error — never as ok, never as down", () => {
    const report = buildReport(
      {
        holderSnapshotsAt: null,
        xPostsAt: null,
        dbAvailable: true,
        error: "connection terminated unexpectedly",
      },
      NOW,
    );
    expect(report.status).toBe("unknown");
    expect(report.error).toBe("connection terminated unexpectedly");
    expect(report.note).toContain("database did not answer");
  });

  it("uses the thresholds from config, not hardcoded numbers", () => {
    const snap = buildReport(
      { holderSnapshotsAt: agoHours(1), xPostsAt: agoHours(1), dbAvailable: true },
      NOW,
    ).feeds;
    expect(snap[0].warnAfterHours).toBe(THRESHOLDS.freshness.holderSnapshots.warnHours);
    expect(snap[0].failAfterHours).toBe(THRESHOLDS.freshness.holderSnapshots.failHours);
    expect(snap[1].warnAfterHours).toBe(THRESHOLDS.freshness.xPosts.warnHours);
    expect(snap[1].failAfterHours).toBe(THRESHOLDS.freshness.xPosts.failHours);
  });
});

describe("summarize", () => {
  it("names every stale feed, with literal ages", () => {
    const feeds = [
      evaluateFeed("holderSnapshots", agoHours(30), band, NOW),
      evaluateFeed("xPosts", agoHours(40), band, NOW),
    ];
    const note = summarize("down", feeds);
    expect(note).toContain("holder snapshots 30h old");
    expect(note).toContain("the prophecy feed 40h old");
  });
});

describe("freshnessSignal (the header dot's wording)", () => {
  const report = (over: Partial<ReturnType<typeof buildReport>>) => ({
    ...buildReport(
      { holderSnapshotsAt: agoHours(1), xPostsAt: agoHours(1), dbAvailable: true },
      NOW,
    ),
    ...over,
  });

  it("shows the normal live dot when everything is fresh", () => {
    const signal = freshnessSignal(report({}));
    expect(signal.tone).toBe("live");
    expect(signal.label).toBe("live");
    expect(signal.title).toBe("the pipe is lit");
  });

  it("shows the normal live dot when freshness is unknown — no alarm without evidence", () => {
    const unknown = buildReport(
      { holderSnapshotsAt: null, xPostsAt: null, dbAvailable: false },
      NOW,
    );
    expect(freshnessSignal(unknown).tone).toBe("live");
    // Also the e2e / no-report path.
    expect(freshnessSignal(null).tone).toBe("live");
  });

  it("dims to warn and states the literal age when a feed is degraded", () => {
    const degraded = buildReport(
      { holderSnapshotsAt: agoHours(9), xPostsAt: agoHours(1), dbAvailable: true },
      NOW,
    );
    const signal = freshnessSignal(degraded);
    expect(signal.tone).toBe("warn");
    expect(signal.label).toBe("stale");
    expect(signal.title).toContain("watchfires have burned low");
    expect(signal.title).toContain("holder snapshots last recorded 9h ago");
    expect(signal.title).toContain("expected hourly");
  });

  it("goes to the down tone and names both feeds when both are stale", () => {
    const down = buildReport(
      { holderSnapshotsAt: agoHours(48), xPostsAt: agoHours(40), dbAvailable: true },
      NOW,
    );
    const signal = freshnessSignal(down);
    expect(signal.tone).toBe("down");
    expect(signal.title).toContain("watchfires have gone out");
    expect(signal.title).toContain("holder snapshots last recorded 48h ago");
    expect(signal.title).toContain("the prophecy feed last stored a post 40h ago");
  });
});
