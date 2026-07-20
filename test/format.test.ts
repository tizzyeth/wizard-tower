import { describe, expect, it } from "vitest";
import { fmtAddr, fmtTimeUtc, fmtTokenAmount, fmtUsdTrade } from "@/lib/format";

describe("fmtAddr", () => {
  it("truncates a Solana address to lead…tail", () => {
    expect(fmtAddr("Dw4kAH8LhdmgfW1cgyvnWSwSDqkt37jeY7pW4oFkbGTu")).toBe("Dw4k…bGTu");
  });
  it("leaves short strings and nullish untouched", () => {
    expect(fmtAddr("abc")).toBe("abc");
    expect(fmtAddr(null)).toBe("—");
    expect(fmtAddr(undefined)).toBe("—");
  });
});

describe("fmtTokenAmount", () => {
  it("compacts large amounts and groups small ones", () => {
    expect(fmtTokenAmount(973365.782651)).toBe("973.4K");
    expect(fmtTokenAmount(1_250)).toBe("1.25K");
    expect(fmtTokenAmount(2_400_000)).toBe("2.4M");
    expect(fmtTokenAmount(850)).toBe("850");
  });
  it("returns a dash for nullish / non-finite", () => {
    expect(fmtTokenAmount(null)).toBe("—");
    expect(fmtTokenAmount(Number.NaN)).toBe("—");
  });
});

describe("fmtUsdTrade", () => {
  it("keeps cents below $10K and compacts above", () => {
    expect(fmtUsdTrade(196.439293)).toBe("$196.44");
    expect(fmtUsdTrade(1_250)).toBe("$1,250.00");
    expect(fmtUsdTrade(12_300)).toBe("$12.3K");
  });
});

describe("fmtTimeUtc", () => {
  it("renders HH:MM:SS in UTC (deterministic, SSR-safe)", () => {
    // 2026-07-18T05:06:51Z
    expect(fmtTimeUtc(Date.parse("2026-07-18T05:06:51Z"))).toBe("05:06:51");
  });
});
