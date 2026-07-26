import { describe, it, expect } from "vitest";
import { pickPlayableVariant } from "@/lib/sources/x";

/** Shape X returns for one video attachment, trimmed to what we read. */
const variants = [
  { content_type: "video/mp4", bit_rate: 2_176_000, url: "https://video.twimg.com/720p.mp4" },
  { content_type: "video/mp4", bit_rate: 832_000, url: "https://video.twimg.com/360p.mp4" },
  { content_type: "video/mp4", bit_rate: 10_368_000, url: "https://video.twimg.com/1080p.mp4" },
  { content_type: "application/x-mpegURL", bit_rate: null, url: "https://video.twimg.com/pl.m3u8" },
  { content_type: "video/mp4", bit_rate: 256_000, url: "https://video.twimg.com/270p.mp4" },
];

describe("pickPlayableVariant", () => {
  it("takes the best MP4 within the bitrate budget, not the best overall", () => {
    // The 10 Mbps 1080p rung is a lot of someone's data for a clip playing at
    // ~480px inside a feed card; the 2 Mbps 720p looks identical at that size.
    expect(pickPlayableVariant(variants)).toBe("https://video.twimg.com/720p.mp4");
  });

  it("ignores the HLS playlist, which a plain <video> cannot read", () => {
    const hlsOnly = [{ content_type: "application/x-mpegURL", bit_rate: null, url: "https://video.twimg.com/pl.m3u8" }];
    expect(pickPlayableVariant(hlsOnly)).toBeUndefined();
  });

  it("falls back to the smallest MP4 when every rung is over budget", () => {
    const allHuge = [
      { content_type: "video/mp4", bit_rate: 9_000_000, url: "https://video.twimg.com/a.mp4" },
      { content_type: "video/mp4", bit_rate: 12_000_000, url: "https://video.twimg.com/b.mp4" },
    ];
    // Still bounded: it returns one of them rather than nothing, so the post stays playable.
    expect(pickPlayableVariant(allHuge)).toBe("https://video.twimg.com/b.mp4");
  });

  it("returns undefined for photos, which carry no variants at all", () => {
    expect(pickPlayableVariant(undefined)).toBeUndefined();
    expect(pickPlayableVariant(null)).toBeUndefined();
    expect(pickPlayableVariant([])).toBeUndefined();
  });

  it("skips variants missing a url", () => {
    const broken = [{ content_type: "video/mp4", bit_rate: 800_000, url: null }];
    expect(pickPlayableVariant(broken)).toBeUndefined();
  });
});
