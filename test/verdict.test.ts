import { describe, expect, it } from "vitest";
import { mapReport } from "@/lib/sources/rugcheck";
import { evaluateChecklist } from "@/lib/metrics/safety";
import {
  computeVerdict,
  avgDailyVolume,
  type VerdictInputs,
} from "@/lib/metrics/verdict";
import reportRaw from "./fixtures/rugcheck-report.json";

// The recorded clean fixture (0 risks, score 1, mint+freeze revoked, LP 93.9%,
// top-10 real 23.1%, HHI top-20 ~71.8) drives the all-pass axes; synthetic inputs
// below exercise the warn/fail/awaiting branches the live token never hits.
const report = mapReport(reportRaw);
const DAY = 86_400_000;
const now = report.detectedAt! + 130 * DAY;
const checklist = evaluateChecklist(report, { launchedAt: report.detectedAt, nowMs: now });

/** Live-shaped inputs captured 2026-07-19 (see the M7 report). */
function liveInputs(over: Partial<VerdictInputs> = {}): VerdictInputs {
  return {
    safetyChecklist: checklist,
    distribution: { top10Pct: report.top10Pct, hhiTop20: report.hhiTop20, sampleSize: report.concentrationSampleSize },
    liquidity: { totalLiquidityUsd: 52_121, liqToMcap: 0.2628 },
    activity: { volume24hUsd: 5_676, avgDailyVolume30d: 24_006, uniqueTraders24h: 47, fullyCovered: false },
    community: { postingCadence: null },
    ...over,
  };
}

describe("computeVerdict — the clean live token (fixture + captured numbers)", () => {
  const v = computeVerdict(liveInputs());
  const byKey = Object.fromEntries(v.axes.map((a) => [a.key, a]));

  it("axis order is exactly safety, distribution, liquidity, activity, community", () => {
    expect(v.axes.map((a) => a.key)).toEqual([
      "safety",
      "distribution",
      "liquidity",
      "activity",
      "community",
    ]);
  });

  it("Safety scores off mint/freeze/LP/RugCheck, all pass → 100", () => {
    expect(byKey.safety.status).toBe("scored");
    expect(byKey.safety.inputs.map((i) => i.key)).toEqual(["mint", "freeze", "lpLocked", "rugcheck"]);
    expect(byKey.safety.inputs.every((i) => i.status === "pass")).toBe(true);
    expect(byKey.safety.score).toBe(100);
    expect(byKey.safety.band).toBe("pass");
  });

  it("every input carries its measured value AND threshold (rubric, not oracle)", () => {
    const s = Object.fromEntries(byKey.safety.inputs.map((i) => [i.key, i]));
    expect(s.mint.display).toBe("revoked");
    expect(s.mint.threshold).toBe("must be revoked");
    expect(s.lpLocked.display).toBe("93.9%");
    expect(s.lpLocked.threshold).toBe("≥ 80%");
  });

  it("Distribution scores top-10 + HHI (both pass), flagged partial (top-20 window)", () => {
    expect(byKey.distribution.status).toBe("scored");
    expect(byKey.distribution.score).toBe(100);
    expect(byKey.distribution.partial).toBe(true);
    const d = Object.fromEntries(byKey.distribution.inputs.map((i) => [i.key, i]));
    expect(d.top10.display).toBe("23.1%");
    expect(d.top10.threshold).toBe("≤ 30%");
    expect(d.hhi.status).toBe("pass"); // HHI ~72 « 1500
    expect(d.hhi.note).toContain("window");
  });

  it("Liquidity: depth $52K + liq/mcap 26.3% both pass → 100", () => {
    expect(byKey.liquidity.score).toBe(100);
    expect(byKey.liquidity.partial).toBe(false);
  });

  it("Activity: volume 0.24× (fail) + 47 traders (pass) → mixed 50, flagged approximate", () => {
    const a = Object.fromEntries(byKey.activity.inputs.map((i) => [i.key, i]));
    expect(a.volumeTrend.display).toBe("0.24×");
    expect(a.volumeTrend.status).toBe("fail");
    expect(a.uniqueTraders.status).toBe("pass");
    expect(byKey.activity.score).toBe(50);
    expect(byKey.activity.band).toBe("warn");
    expect(byKey.activity.partial).toBe(true); // window < 24h → floor
  });

  it("Community is awaiting-data and EXCLUDED from the roll-up (never scored zero)", () => {
    expect(byKey.community.status).toBe("awaiting-data");
    expect(byKey.community.score).toBeNull();
    expect(byKey.community.note).toContain("coven");
  });

  it("overall = mean of the four scored axes (100,100,100,50) = 87.5, band strong", () => {
    expect(v.contributing).toBe(4);
    expect(v.total).toBe(5);
    expect(v.score).toBeCloseTo(87.5, 5);
    expect(v.band).toBe("pass");
    expect(v.summary).toBe("4 of 5 wards speak");
    expect(v.headline).toBe("The tower stands strong.");
  });
});

describe("computeVerdict — awaiting-data axes", () => {
  it("a missing axis renders awaiting-data and drops out of the mean", () => {
    const v = computeVerdict(liveInputs({ liquidity: null }));
    const liq = v.axes.find((a) => a.key === "liquidity")!;
    expect(liq.status).toBe("awaiting-data");
    expect(liq.score).toBeNull();
    // Now only safety, distribution, activity score → (100+100+50)/3.
    expect(v.contributing).toBe(3);
    expect(v.score).toBeCloseTo(83.333, 2);
    expect(v.summary).toBe("3 of 5 wards speak");
  });

  it("a numeric input with a null value is unmeasured, not zero", () => {
    const v = computeVerdict(liveInputs({ liquidity: { totalLiquidityUsd: null, liqToMcap: 0.2628 } }));
    const liq = v.axes.find((a) => a.key === "liquidity")!;
    const depth = liq.inputs.find((i) => i.key === "depth")!;
    expect(depth.status).toBeNull();
    expect(depth.points).toBeNull();
    expect(depth.display).toBe("—");
    // Scored off the one measured input only, and flagged partial.
    expect(liq.score).toBe(100);
    expect(liq.partial).toBe(true);
  });

  it("all axes empty → silent verdict, 0 of 5 speak", () => {
    const v = computeVerdict({
      safetyChecklist: null,
      distribution: null,
      liquidity: null,
      activity: null,
      community: null,
    });
    expect(v.score).toBeNull();
    expect(v.band).toBeNull();
    expect(v.contributing).toBe(0);
    expect(v.summary).toBe("0 of 5 wards speak");
  });
});

describe("computeVerdict — warn/fail bands", () => {
  it("liquidity depth: ≥40K pass, ≥15K warn, else fail", () => {
    const depth = (usd: number) =>
      computeVerdict(liveInputs({ liquidity: { totalLiquidityUsd: usd, liqToMcap: 0.2 } }))
        .axes.find((a) => a.key === "liquidity")!
        .inputs.find((i) => i.key === "depth")!.status;
    expect(depth(40_000)).toBe("pass");
    expect(depth(20_000)).toBe("warn");
    expect(depth(14_999)).toBe("fail");
  });

  it("volume trend: ≥0.75× pass, ≥0.35× warn, else fail", () => {
    const trend = (mult: number) =>
      computeVerdict(
        liveInputs({ activity: { volume24hUsd: mult * 1000, avgDailyVolume30d: 1000, uniqueTraders24h: 50, fullyCovered: true } }),
      )
        .axes.find((a) => a.key === "activity")!
        .inputs.find((i) => i.key === "volumeTrend")!.status;
    expect(trend(0.75)).toBe("pass");
    expect(trend(0.5)).toBe("warn");
    expect(trend(0.2)).toBe("fail");
  });

  it("HHI: ≤1500 pass, ≤2500 warn, else fail (concentrated → fail)", () => {
    const hhi = (v: number) =>
      computeVerdict(liveInputs({ distribution: { top10Pct: 20, hhiTop20: v, sampleSize: 19 } }))
        .axes.find((a) => a.key === "distribution")!
        .inputs.find((i) => i.key === "hhi")!.status;
    expect(hhi(1500)).toBe("pass");
    expect(hhi(2000)).toBe("warn");
    expect(hhi(3000)).toBe("fail");
  });

  it("a fully-covered activity window is not flagged partial", () => {
    const v = computeVerdict(
      liveInputs({ activity: { volume24hUsd: 1000, avgDailyVolume30d: 1000, uniqueTraders24h: 50, fullyCovered: true } }),
    );
    expect(v.axes.find((a) => a.key === "activity")!.partial).toBe(false);
  });

  it("a broken ward drags Safety below strong", () => {
    // Freeze authority still held → that input fails; Safety = (100+0+100+100)/4 = 75 = pass boundary.
    const held = evaluateChecklist(
      { ...report, freezeAuthority: "x", freezeAuthorityRevoked: false },
      { launchedAt: report.detectedAt, nowMs: now },
    );
    const s = computeVerdict(liveInputs({ safetyChecklist: held })).axes.find((a) => a.key === "safety")!;
    expect(s.score).toBe(75);
    expect(s.inputs.find((i) => i.key === "freeze")!.status).toBe("fail");
  });
});

describe("computeVerdict — Community axis (M6 posting cadence)", () => {
  const community = (postingCadence: number | null) =>
    computeVerdict(liveInputs({ community: { postingCadence } }));

  it("null cadence (no posts recorded) → awaiting, excluded from the roll-up", () => {
    const v = community(null);
    const c = v.axes.find((a) => a.key === "community")!;
    expect(c.status).toBe("awaiting-data");
    expect(c.score).toBeNull();
    expect(v.contributing).toBe(4);
    expect(v.summary).toBe("4 of 5 wards speak");
  });

  it("cadence ≥3/wk → pass, joins the roll-up as the 5th ward", () => {
    const v = community(5);
    const c = v.axes.find((a) => a.key === "community")!;
    expect(c.status).toBe("scored");
    expect(c.score).toBe(100);
    const cadence = c.inputs.find((i) => i.key === "cadence")!;
    expect(cadence.status).toBe("pass");
    expect(cadence.display).toBe("5.0/wk");
    expect(cadence.threshold).toBe("≥ 3/wk");
    // Now all five axes score: (100+100+100+50+100)/5 = 90.
    expect(v.contributing).toBe(5);
    expect(v.score).toBeCloseTo(90, 5);
    expect(v.summary).toBe("5 of 5 wards speak");
  });

  it("cadence bands: ≥3 pass, ≥1 warn, else fail (0 = gone quiet, a real fail)", () => {
    const status = (n: number) =>
      community(n).axes.find((a) => a.key === "community")!.inputs.find((i) => i.key === "cadence")!.status;
    expect(status(3)).toBe("pass");
    expect(status(1)).toBe("warn");
    expect(status(0.5)).toBe("fail");
    expect(status(0)).toBe("fail");
  });
});

describe("avgDailyVolume — the Activity baseline helper", () => {
  it("averages complete days, excluding today's partial bar", () => {
    const candles = [
      { time: 1, volume: 100 },
      { time: 2, volume: 200 },
      { time: 3, volume: 300 }, // today (partial) — dropped
    ];
    expect(avgDailyVolume(candles, 30)).toBe(150); // (100+200)/2
  });

  it("respects the window length", () => {
    const candles = Array.from({ length: 40 }, (_, i) => ({ time: i, volume: i < 39 ? 10 : 999 }));
    // Last (partial) dropped; last 30 of the remaining 39 are all volume 10.
    expect(avgDailyVolume(candles, 30)).toBe(10);
  });

  it("returns null without enough history", () => {
    expect(avgDailyVolume([], 30)).toBeNull();
    expect(avgDailyVolume([{ time: 1, volume: 5 }], 30)).toBeNull();
  });
});
