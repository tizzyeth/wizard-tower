import { describe, expect, it } from "vitest";
import { mapReport, type SafetyReport } from "@/lib/sources/rugcheck";
import { evaluateChecklist } from "@/lib/metrics/safety";
import { TOKEN } from "@/config/token";
import reportRaw from "./fixtures/rugcheck-report.json";

// Recorded live 2026-07-18 from GET /v1/tokens/{mint}/report. The token was clean
// at capture (0 risks, score 1, mint+freeze revoked, LP ~93.9% locked) — so the
// fixture exercises every pass branch; synthetic reports below cover warn/fail.
const report = mapReport(reportRaw);

describe("mapReport — normalizing the RugCheck report (fixture)", () => {
  it("reads mint + freeze authority as revoked (both null)", () => {
    expect(report.mintAuthority).toBeNull();
    expect(report.freezeAuthority).toBeNull();
    expect(report.mintAuthorityRevoked).toBe(true);
    expect(report.freezeAuthorityRevoked).toBe(true);
  });

  it("picks the main pool's LP lock figure, skipping DLMM/CLMM markets", () => {
    expect(report.lpMarketPubkey).toBe(TOKEN.mainPool);
    expect(report.lpMarketType).toBe("pump_fun_amm");
    expect(report.lpLockedPct).toBeCloseTo(93.9048, 3);
    expect(report.lpLockedUsd).toBeCloseTo(46827.13, 1);
  });

  it("excludes the AMM pool from top-10 concentration (§6)", () => {
    // Holder #1 is the Pump Fun AMM vault (12.56%); it must not count as a holder.
    expect(report.concentrationExcluded).toBe(1);
    expect(report.top10PctRaw).toBeCloseTo(33.8, 2); // includes the pool
    expect(report.top10Pct).toBeCloseTo(23.0885, 3); // excludes it
    expect(report.top10Pct!).toBeLessThan(report.top10PctRaw!);
  });

  it("derives creator holdings from creatorBalance / supply", () => {
    expect(report.creator).toBe("3ecXTre9LyqzjheLKpiBbsEm29aLLLfm2KidrVjfAAkM");
    expect(report.creatorPct).toBe(0); // creatorBalance is 0
  });

  it("surfaces labeled pool/locker owner addresses for the M4 exclusion map (§6)", () => {
    // The PumpSwap main pool is labeled AMM and is one of the pool addresses.
    expect(report.poolAddresses).toContain(TOKEN.mainPool);
    expect(report.poolAddresses.length).toBeGreaterThan(1);
    // A "Printr Stake Pool" locker was labeled in the live report.
    expect(report.lockerAddresses.length).toBeGreaterThanOrEqual(1);
  });

  it("carries the RugCheck score, risks, holders, and first-seen", () => {
    expect(report.riskCount).toBe(0);
    expect(report.risks).toEqual([]);
    expect(report.score).toBe(1);
    expect(report.scoreNormalised).toBe(1);
    expect(report.rugged).toBe(false);
    expect(report.totalHolders).toBe(6067);
    expect(report.detectedAt).toBe(Date.parse("2026-03-11T14:59:52.74323502Z"));
  });
});

describe("evaluateChecklist — the clean fixture passes every ward", () => {
  const DAY = 86_400_000;
  const now = report.detectedAt! + 130 * DAY; // ~130 days old at eval time
  const checklist = evaluateChecklist(report, { launchedAt: report.detectedAt, nowMs: now });

  it("produces the seven §4 rows in order", () => {
    expect(checklist.checks.map((c) => c.key)).toEqual([
      "mint",
      "freeze",
      "lpLocked",
      "top10",
      "rugcheck",
      "creator",
      "age",
    ]);
  });

  it("marks all seven pass and reports overall pass", () => {
    expect(checklist.checks.every((c) => c.status === "pass")).toBe(true);
    expect(checklist.passCount).toBe(7);
    expect(checklist.warnCount).toBe(0);
    expect(checklist.failCount).toBe(0);
    expect(checklist.overall).toBe("pass");
  });

  it("shows each measured value alongside its threshold (rubric, not oracle)", () => {
    const byKey = Object.fromEntries(checklist.checks.map((c) => [c.key, c]));
    expect(byKey.mint.measured).toBe("revoked");
    expect(byKey.lpLocked.measured).toBe("93.9%");
    expect(byKey.lpLocked.threshold).toBe("≥ 80%");
    expect(byKey.top10.measured).toBe("23.1%");
    expect(byKey.top10.threshold).toBe("≤ 30%");
    expect(byKey.rugcheck.measured).toBe("0 risks · score 1");
    expect(byKey.creator.measured).toBe("0.0%");
    expect(byKey.creator.threshold).toBe("≤ 5%");
    expect(byKey.age.threshold).toBe("≥ 90d");
  });

  it("falls back to RugCheck detectedAt when no market launchedAt is given", () => {
    const c = evaluateChecklist(report, { launchedAt: null, nowMs: now });
    expect(c.checks.find((x) => x.key === "age")!.status).toBe("pass");
  });
});

// ── Synthetic reports for the warn/fail branches the live token never hits ────

function baseReport(over: Partial<SafetyReport> = {}): SafetyReport {
  return {
    mint: TOKEN.mint,
    mintAuthority: null,
    mintAuthorityRevoked: true,
    freezeAuthority: null,
    freezeAuthorityRevoked: true,
    lpLockedPct: 95,
    lpLockedUsd: 1000,
    lpMarketPubkey: TOKEN.mainPool,
    lpMarketType: "pump_fun_amm",
    top10Pct: 20,
    top10PctRaw: 30,
    concentrationExcluded: 1,
    concentrationSampleSize: 19,
    hhiTop20: 100,
    creator: "creatorwallet",
    creatorPct: 1,
    poolAddresses: [],
    lockerAddresses: [],
    risks: [],
    riskCount: 0,
    score: 1,
    scoreNormalised: 1,
    totalHolders: 6000,
    rugged: false,
    detectedAt: 0,
    ...over,
  };
}

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;

describe("evaluateChecklist — threshold bands (higher/lower is safer)", () => {
  const get = (r: SafetyReport, key: string) =>
    evaluateChecklist(r, { launchedAt: NOW - 200 * DAY, nowMs: NOW }).checks.find((c) => c.key === key)!;

  it("LP locked: ≥80 pass, ≥50 warn, else fail", () => {
    expect(get(baseReport({ lpLockedPct: 80 }), "lpLocked").status).toBe("pass");
    expect(get(baseReport({ lpLockedPct: 79.9 }), "lpLocked").status).toBe("warn");
    expect(get(baseReport({ lpLockedPct: 50 }), "lpLocked").status).toBe("warn");
    expect(get(baseReport({ lpLockedPct: 49.9 }), "lpLocked").status).toBe("fail");
    expect(get(baseReport({ lpLockedPct: null }), "lpLocked").status).toBe("warn"); // unmeasurable
  });

  it("top-10 concentration: ≤30 pass, ≤50 warn, else fail", () => {
    expect(get(baseReport({ top10Pct: 30 }), "top10").status).toBe("pass");
    expect(get(baseReport({ top10Pct: 30.1 }), "top10").status).toBe("warn");
    expect(get(baseReport({ top10Pct: 50 }), "top10").status).toBe("warn");
    expect(get(baseReport({ top10Pct: 50.1 }), "top10").status).toBe("fail");
  });

  it("creator holdings: ≤5 pass, ≤10 warn, else fail", () => {
    expect(get(baseReport({ creatorPct: 5 }), "creator").status).toBe("pass");
    expect(get(baseReport({ creatorPct: 7 }), "creator").status).toBe("warn");
    expect(get(baseReport({ creatorPct: 12 }), "creator").status).toBe("fail");
  });

  it("token age: ≥90d pass, ≥30d warn, else fail", () => {
    const age = (days: number) =>
      evaluateChecklist(baseReport(), { launchedAt: NOW - days * DAY, nowMs: NOW }).checks.find(
        (c) => c.key === "age",
      )!.status;
    expect(age(90)).toBe("pass");
    expect(age(45)).toBe("warn");
    expect(age(10)).toBe("fail");
  });

  it("mint/freeze authority still held → fail", () => {
    const r = baseReport({
      mintAuthority: "someauthority",
      mintAuthorityRevoked: false,
      freezeAuthority: "someauthority",
      freezeAuthorityRevoked: false,
    });
    expect(get(r, "mint").status).toBe("fail");
    expect(get(r, "freeze").status).toBe("fail");
  });
});

describe("evaluateChecklist — RugCheck score + risk severity", () => {
  const rug = (r: SafetyReport) =>
    evaluateChecklist(r, { launchedAt: NOW - 200 * DAY, nowMs: NOW }).checks.find(
      (c) => c.key === "rugcheck",
    )!.status;

  it("scores by band when there are no labeled risks (lower is safer)", () => {
    expect(rug(baseReport({ scoreNormalised: 20 }))).toBe("pass");
    expect(rug(baseReport({ scoreNormalised: 30 }))).toBe("warn");
    expect(rug(baseReport({ scoreNormalised: 60 }))).toBe("fail");
  });

  it("a danger-level risk forces fail even at score 0", () => {
    const r = baseReport({
      scoreNormalised: 0,
      riskCount: 1,
      risks: [{ name: "Danger", level: "danger", score: 0, description: null }],
    });
    expect(rug(r)).toBe("fail");
  });

  it("a warn-level risk forces at least warn even at score 0", () => {
    const r = baseReport({
      scoreNormalised: 0,
      riskCount: 1,
      risks: [{ name: "Heads up", level: "warn", score: 0, description: null }],
    });
    expect(rug(r)).toBe("warn");
  });

  it("overall is the worst row status", () => {
    const r = baseReport({ lpLockedPct: 40 }); // one fail
    const checklist = evaluateChecklist(r, { launchedAt: NOW - 200 * DAY, nowMs: NOW });
    expect(checklist.overall).toBe("fail");
    expect(checklist.failCount).toBe(1);
  });
});
