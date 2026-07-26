import { describe, it, expect } from "vitest";
import { isShareCard, SHARE_CARDS, SHARE_TITLES } from "@/lib/share/cards";

describe("share card slugs", () => {
  it("accepts only the four modules that stand alone as an image", () => {
    expect([...SHARE_CARDS]).toEqual(["verdict", "ledger", "holders", "wards"]);
    for (const slug of SHARE_CARDS) expect(isShareCard(slug)).toBe(true);
  });

  it("rejects anything else, so /share/<junk> cannot render", () => {
    // The chart and the trade tape are deliberately absent: flattened to a still
    // image they say less than the screenshot someone would take anyway.
    for (const slug of ["chart", "tape", "flow", "", "../secret", "VERDICT"]) {
      expect(isShareCard(slug), slug).toBe(false);
    }
  });

  it("titles every shareable card", () => {
    for (const slug of SHARE_CARDS) {
      expect(SHARE_TITLES[slug], slug).toBeTruthy();
    }
  });
});
