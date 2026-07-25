import { describe, it, expect } from "vitest";
import {
  normaliseText,
  matchesPromoPattern,
  findDuplicateTexts,
  filterPromotional,
  mentionsForeignChainAddress,
  type FilterablePost,
  type SpamRules,
} from "@/lib/metrics/spam";
import { X } from "@/config/token";

/** The real rules the app ships with — these tests are the guard on them. */
const RULES: SpamRules = X.spam;

/**
 * Verbatim from the live Coven feed, 2026-07-25. The same drive was posted by
 * three unrelated accounts with a different t.co link each — the case that
 * motivated this filter.
 */
const VOTE_DRIVE = `Attention $WIZARD Family! YOUR vote matters!

Less than 100 votes are needed to list $WIZARD on the Moonshot Top 100 Leaderboard.

- Listing ID: 2470

Every vote counts - Moonshot would be huge for community growth.
https://t.co/1aG2i9tCIU`;

const post = (id: string, authorHandle: string | null, text: string | null): FilterablePost => ({
  id,
  authorHandle,
  text,
});

describe("normaliseText", () => {
  it("collapses the parts a campaign varies between copies", () => {
    const a = normaliseText("Vote NOW! Listing ID: 2470 https://t.co/aaa @someone");
    const b = normaliseText("vote now! listing id: 9999 https://t.co/zzz @other");
    expect(a).toBe(b);
    expect(a).toBe("vote now listing id");
  });

  it("is empty for null or link-only text", () => {
    expect(normaliseText(null)).toBe("");
    expect(normaliseText("https://t.co/abc")).toBe("");
  });
});

describe("matchesPromoPattern", () => {
  it("catches the live vote-farming drive", () => {
    expect(matchesPromoPattern(VOTE_DRIVE, RULES.patterns)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesPromoPattern("FREE AIRDROP for holders", RULES.patterns)).toBe(true);
  });

  it("leaves ordinary community talk alone", () => {
    for (const text of [
      "forever bullish on smoking wizard",
      "Smoking Wizard coded",
      "the wizard art in this one is unreal",
      "just bought more $WIZARD, chart looks healthy",
      "gm wizards",
    ]) {
      expect(matchesPromoPattern(text, RULES.patterns), text).toBe(false);
    }
  });
});

describe("findDuplicateTexts", () => {
  it("flags one message posted by several accounts", () => {
    const posts = [
      post("1", "asterdaodex", VOTE_DRIVE),
      post("2", "centerfeudesy", VOTE_DRIVE.replace("1aG2i9tCIU", "9zZz1QqQ")),
      post("3", "someone_else", "unrelated chatter about the wizard art"),
    ];
    const dupes = findDuplicateTexts(posts, 2);
    expect(dupes.has(normaliseText(VOTE_DRIVE))).toBe(true);
    expect(dupes.size).toBe(1);
  });

  it("does not flag one account repeating itself", () => {
    const posts = [
      post("1", "same_guy", VOTE_DRIVE),
      post("2", "same_guy", VOTE_DRIVE),
    ];
    expect(findDuplicateTexts(posts, 2).size).toBe(0);
  });

  it("ignores short repeated text so 'gm' does not silence the feed", () => {
    const posts = [post("1", "a", "gm wizards"), post("2", "b", "gm wizards")];
    expect(findDuplicateTexts(posts, 2).size).toBe(0);
  });
});

describe("filterPromotional", () => {
  it("hides the campaign, keeps the conversation", () => {
    const posts = [
      post("1", "asterdaodex", VOTE_DRIVE),
      post("2", "centerfeudesy", VOTE_DRIVE),
      post("3", "dolesgems", "Smoking Wizard coded"),
      post("4", "mpourekogalakto", "✨smoking wizard always to the point"),
    ];
    const { kept, hiddenCount, reasons } = filterPromotional(posts, RULES);
    expect(kept.map((p) => p.id)).toEqual(["3", "4"]);
    expect(hiddenCount).toBe(2);
    expect(reasons["1"]).toBe("pattern");
  });

  it("catches a copy-paste campaign whose wording no pattern knows", () => {
    const novel =
      "Wizards assemble — the ritual begins at midnight, be there or stay poor forever ok";
    const posts = [
      post("1", "shill_one", novel),
      post("2", "shill_two", novel),
      post("3", "real_person", "love this project"),
    ];
    const { kept, reasons } = filterPromotional(posts, RULES);
    expect(kept.map((p) => p.id)).toEqual(["3"]);
    expect(reasons["1"]).toBe("duplicate");
  });

  it("never filters the project's own account", () => {
    // The official account announcing a genuine listing must survive a rule
    // written to catch listing spam.
    const posts = [post("1", "swizardcore", "We are live on the leaderboard — vote matters!")];
    const { kept, hiddenCount } = filterPromotional(posts, RULES);
    expect(kept).toHaveLength(1);
    expect(hiddenCount).toBe(0);
  });

  it("honours a blocked author regardless of content", () => {
    const rules: SpamRules = { ...RULES, blockedAuthors: ["Repeat_Offender"] };
    const posts = [post("1", "repeat_offender", "perfectly innocuous words here")];
    const { kept, reasons } = filterPromotional(posts, rules);
    expect(kept).toHaveLength(0);
    expect(reasons["1"]).toBe("blocked-author");
  });

  it("passes a clean feed through untouched, order preserved", () => {
    const posts = [
      post("1", "a", "the wizard chart is looking good today"),
      post("2", "b", "picked up a bag, lets see where this goes"),
    ];
    const { kept, hiddenCount } = filterPromotional(posts, RULES);
    expect(kept.map((p) => p.id)).toEqual(["1", "2"]);
    expect(hiddenCount).toBe(0);
  });
});

describe("retweets and foreign-chain impersonation", () => {
  it("drops retweets left in the table from before the query was fixed", () => {
    // The `-is:retweet` operator only applies to polls made after the fix; these
    // rows are already stored, so read-time filtering is what corrects them.
    const posts = [
      post("1", "luke2slow", "RT @swizardcore: @a1lon9 forever bullish on smoking wizard"),
      post("2", "swizardcore", "@a1lon9 forever bullish on smoking wizard"),
    ];
    const { kept, reasons } = filterPromotional(posts, RULES);
    expect(kept.map((p) => p.id)).toEqual(["2"]);
    expect(reasons["1"]).toBe("retweet");
  });

  it("drops a post carrying an EVM address — wrong chain for a Solana token", () => {
    const posts = [
      post("1", "Robinhood_Bankr", "$WIZARD WizardLands CA: 0xae1bebca195251ddcf3a5ab8f5f6b7efa88b1e12"),
      post("2", "real", `real talk about ${"7XdCaKpqLmKE2K7yr9xaeWB1H2CVZ1oGwxB6hmd9pump"}`),
    ];
    const { kept, reasons } = filterPromotional(posts, RULES);
    expect(kept.map((p) => p.id)).toEqual(["2"]);
    expect(reasons["1"]).toBe("foreign-chain");
  });

  it("does not mistake our own base58 mint for a foreign address", () => {
    expect(mentionsForeignChainAddress("CA: 7XdCaKpqLmKE2K7yr9xaeWB1H2CVZ1oGwxB6hmd9pump")).toBe(false);
  });

  it("catches the 'vote us onto' variant the first pattern list missed", () => {
    expect(
      matchesPromoPattern("Holding bags? Then vote us onto Moonshot too", RULES.patterns),
    ).toBe(true);
  });
});
