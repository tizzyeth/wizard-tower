import { describe, expect, it } from "vitest";
import { mapTimeline, mapUserLookup, type XMedia } from "@/lib/sources/x";
import { postingCadencePerWeek } from "@/lib/metrics/cadence";
import officialRaw from "./fixtures/x-official-tweets.json";
import communityRaw from "./fixtures/x-community-search.json";
import userRaw from "./fixtures/x-official-user.json";

const DAY = 86_400_000;
const NOW = 1_760_000_000_000; // fixed clock so fetchedAt is deterministic

describe("mapUserLookup — resolve @swizardcore → id", () => {
  it("extracts the numeric user id and username", () => {
    expect(mapUserLookup(userRaw)).toEqual({ id: "2040859395236474881", username: "swizardcore" });
  });
});

describe("mapTimeline — official timeline (recorded fixture)", () => {
  const res = mapTimeline(officialRaw, "official", NOW);

  it("maps every returned post and carries the since_id cursor", () => {
    expect(res.resultCount).toBe(10);
    expect(res.posts).toHaveLength(10);
    expect(res.newestId).toBe("2078848064429658447");
    expect(res.posts.every((p) => p.source === "official")).toBe(true);
  });

  it("joins author, metrics, media, url and upgrades the avatar", () => {
    const first = res.posts[0];
    expect(first.id).toBe("2078848064429658447");
    expect(first.authorHandle).toBe("swizardcore");
    // Display name is stylized Unicode on this account — preserved verbatim.
    expect(first.authorName).toBe("𝐒𝐌𝐎𝐊𝐈𝐍𝐆 𝐖𝐈𝐙𝐀𝐑𝐃");
    // 48px _normal avatar → crisp 400px variant.
    expect(first.authorAvatarUrl).toBe(
      "https://pbs.twimg.com/profile_images/2040859684135993344/qjDj7-F__400x400.jpg",
    );
    expect(first.likes).toBe(246);
    expect(first.reposts).toBe(53);
    expect(first.replies).toBe(15);
    // A video attachment maps to its preview thumbnail.
    const media = first.media as XMedia[];
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("video");
    expect(media[0].thumbUrl).toContain("pbs.twimg.com/amplify_video_thumb/");
    // Link back to the post on X (display requirement).
    expect(first.url).toBe("https://x.com/swizardcore/status/2078848064429658447");
    // fetchedAt uses the injected clock (deterministic).
    expect((first.fetchedAt as Date).getTime()).toBe(NOW);
  });
});

describe("mapTimeline — community search / The Coven (recorded fixture)", () => {
  const res = mapTimeline(communityRaw, "community", NOW);

  it("maps the search results as community posts with the cursor", () => {
    expect(res.posts).toHaveLength(20);
    expect(res.newestId).toBe("2078908442983743515");
    expect(res.posts.every((p) => p.source === "community")).toBe(true);
    expect(res.posts.every((p) => p.url?.startsWith("https://x.com/"))).toBe(true);
  });

  it("resolves photo media to its full url (not a preview)", () => {
    const withPhoto = res.posts.find((p) => (p.media as XMedia[])?.some((m) => m.type === "photo"));
    expect(withPhoto).toBeDefined();
    const photo = (withPhoto!.media as XMedia[]).find((m) => m.type === "photo")!;
    expect(photo.thumbUrl).toContain("pbs.twimg.com/media/");
  });
});

describe("mapTimeline — resilience", () => {
  it("maps a post whose author is not in includes (author fields null)", () => {
    const raw = {
      data: [{ id: "42", text: "orphan", author_id: "999", created_at: "2026-07-01T00:00:00.000Z" }],
      includes: {},
      meta: { result_count: 1, newest_id: "42" },
    };
    const res = mapTimeline(raw, "community", NOW);
    expect(res.posts).toHaveLength(1);
    const p = res.posts[0];
    expect(p.authorHandle).toBeNull();
    expect(p.authorName).toBeNull();
    expect(p.media).toBeNull();
    // No handle → the i/web/status permalink still links back to X.
    expect(p.url).toBe("https://x.com/i/web/status/42");
  });

  it("handles an empty result set", () => {
    const res = mapTimeline({ data: [], meta: { result_count: 0 } }, "official", NOW);
    expect(res.posts).toEqual([]);
    expect(res.resultCount).toBe(0);
    expect(res.newestId).toBeNull();
  });
});

describe("postingCadencePerWeek — the Community axis metric", () => {
  it("returns null with no history (→ awaiting, never zero)", () => {
    expect(postingCadencePerWeek([], NOW)).toBeNull();
    expect(postingCadencePerWeek([null, undefined], NOW)).toBeNull();
  });

  it("counts in-window posts / weeks over the 28d window", () => {
    // 2 posts inside 28d → 2 / (28/7=4) = 0.5 per week.
    expect(postingCadencePerWeek([NOW, NOW - 1 * DAY], NOW, 28)).toBe(0.5);
    // 12 posts inside the window → 12 / 4 = 3 per week (the pass boundary).
    const twelve = Array.from({ length: 12 }, (_, i) => NOW - i * DAY);
    expect(postingCadencePerWeek(twelve, NOW, 28)).toBe(3);
  });

  it("history exists but nothing recent → 0 (gone quiet, a real signal)", () => {
    expect(postingCadencePerWeek([NOW - 100 * DAY], NOW, 28)).toBe(0);
  });

  it("ignores invalid timestamps and future-dated posts", () => {
    expect(postingCadencePerWeek([null, NOW, NOW + 5 * DAY], NOW, 28)).toBe(0.25); // only NOW counts
  });
});
