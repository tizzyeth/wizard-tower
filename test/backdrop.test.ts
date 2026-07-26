import { describe, it, expect } from "vitest";
import { framesForDay } from "@/components/wizard/WizardBackdrop";

describe("backdrop rotation", () => {
  it("shows two different frames", () => {
    const { top, bottom } = framesForDay(new Date("2026-07-27T12:00:00Z"));
    expect(top).not.toBe(bottom);
  });

  it("is stable across a whole UTC day", () => {
    // Everyone opening the tower on the same day must see the same room —
    // this is also what keeps the server render and the client agreeing.
    const morning = framesForDay(new Date("2026-07-27T00:00:01Z"));
    const night = framesForDay(new Date("2026-07-27T23:59:59Z"));
    expect(morning).toEqual(night);
  });

  it("changes at UTC midnight", () => {
    const day1 = framesForDay(new Date("2026-07-27T23:59:59Z"));
    const day2 = framesForDay(new Date("2026-07-28T00:00:01Z"));
    expect(day2.top).not.toBe(day1.top);
  });

  it("cycles through the whole set without skipping any frame", () => {
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) {
      const { top, bottom } = framesForDay(new Date(Date.UTC(2026, 6, 1 + d)));
      seen.add(top);
      seen.add(bottom);
    }
    expect(seen.size).toBe(6);
  });
});
