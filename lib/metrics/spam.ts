/**
 * Promotional-post filtering for The Coven feed.
 *
 * WHY THIS EXISTS. The Coven tab cannot show the literal community timeline —
 * X's `community_id:` search operator is gated above our API tier (see
 * lib/sources/x.ts) — so it shows a cashtag/phrase search instead. Open search
 * on a memecoin ticker attracts coordinated promotion: vote-farming drives,
 * "listing" campaigns, giveaway bait. Those posts mention $WIZARD but say
 * nothing about it, and the dashboard's whole premise is that what it shows is
 * worth a reader's attention.
 *
 * DESIGN. Two independent detectors, because they fail in different directions:
 *
 *   1. `matchesPromoPattern` — explicit phrases from config. Precise, but only
 *      catches campaigns whose wording someone has already seen.
 *   2. `findDuplicateTexts` — the same normalised text posted by two or more
 *      DISTINCT accounts. Structural: it catches a copy-paste campaign on its
 *      first appearance, whatever the wording, because organic posts are not
 *      written identically by strangers.
 *
 * Everything here is PURE (plan §6: math and rules live in lib/metrics, not in
 * components) and filtering happens on READ, never on write — the poller stores
 * everything it fetches, so tuning these rules re-filters history instead of
 * needing a refetch of posts that upstream may no longer serve.
 */

export type FilterablePost = {
  id: string;
  authorHandle: string | null;
  text: string | null;
};

export type SpamRules = {
  /** Case-insensitive substrings; a post containing any is promotional. */
  patterns: readonly string[];
  /** Handles whose posts are always dropped (case-insensitive, no `@`). */
  blockedAuthors: readonly string[];
  /** Handles never filtered — the project's own account, whatever it posts. */
  allowedAuthors: readonly string[];
  /** How many distinct authors must share one text before it reads as a campaign. */
  duplicateAuthorThreshold: number;
};

export type SpamVerdict = {
  /** Posts worth showing, original order preserved. */
  kept: FilterablePost[];
  /** How many were dropped, and why — surfaced in the UI so filtering is visible. */
  hiddenCount: number;
  reasons: Record<string, SpamReason>;
};

export type SpamReason =
  | "pattern"
  | "duplicate"
  | "blocked-author"
  | "retweet"
  | "foreign-chain";

/**
 * A retweet, by X's own text convention. The search query already excludes them
 * (`-is:retweet`), but rows stored before that filter was fixed are still in the
 * table, and reading is where we can correct history without a refetch.
 */
export function isRetweet(text: string | null): boolean {
  return /^RT @\w+:/.test(text?.trimStart() ?? "");
}

/**
 * An EVM contract address (0x + 40 hex) in a feed about a SOLANA token. Solana
 * addresses are base58 and never take this shape, so a post carrying one is
 * advertising a different asset under our ticker — the impersonation that makes
 * open cashtag search risky to display unfiltered.
 */
export function mentionsForeignChainAddress(text: string | null): boolean {
  return /\b0x[a-fA-F0-9]{40}\b/.test(text ?? "");
}

/**
 * Strip everything a campaign varies between copies so identical messages
 * collapse to one key: case, links (each copy gets its own t.co), @mentions,
 * digits (listing ids, vote counts), punctuation, emoji and whitespace runs.
 */
export function normaliseText(text: string | null): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@\w+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesPromoPattern(
  text: string | null,
  patterns: readonly string[],
): boolean {
  if (!text) return false;
  const haystack = text.toLowerCase();
  return patterns.some((p) => haystack.includes(p.toLowerCase()));
}

/**
 * Normalised texts posted by at least `threshold` distinct authors. Short texts
 * are ignored: "gm" or "$WIZARD" legitimately repeat, and collapsing those would
 * silence the community rather than the campaign.
 */
export function findDuplicateTexts(
  posts: readonly FilterablePost[],
  threshold: number,
  minLength = 40,
): Set<string> {
  const authorsByText = new Map<string, Set<string>>();
  for (const p of posts) {
    const key = normaliseText(p.text);
    if (key.length < minLength) continue;
    const author = (p.authorHandle ?? "").toLowerCase();
    const set = authorsByText.get(key) ?? new Set<string>();
    set.add(author);
    authorsByText.set(key, set);
  }
  const duplicates = new Set<string>();
  for (const [key, authors] of authorsByText) {
    if (authors.size >= threshold) duplicates.add(key);
  }
  return duplicates;
}

/**
 * Apply both detectors. Allow-listed authors bypass every rule — the official
 * account announcing a real listing must not be filtered as a listing campaign.
 */
export function filterPromotional<T extends FilterablePost>(
  posts: readonly T[],
  rules: SpamRules,
): { kept: T[]; hiddenCount: number; reasons: Record<string, SpamReason> } {
  const allowed = new Set(rules.allowedAuthors.map((h) => h.toLowerCase()));
  const blocked = new Set(rules.blockedAuthors.map((h) => h.toLowerCase()));
  const duplicates = findDuplicateTexts(posts, rules.duplicateAuthorThreshold);

  const reasons: Record<string, SpamReason> = {};
  const kept: T[] = [];

  for (const post of posts) {
    const handle = (post.authorHandle ?? "").toLowerCase();
    if (allowed.has(handle)) {
      kept.push(post);
      continue;
    }
    if (blocked.has(handle)) {
      reasons[post.id] = "blocked-author";
      continue;
    }
    if (isRetweet(post.text)) {
      reasons[post.id] = "retweet";
      continue;
    }
    if (mentionsForeignChainAddress(post.text)) {
      reasons[post.id] = "foreign-chain";
      continue;
    }
    if (matchesPromoPattern(post.text, rules.patterns)) {
      reasons[post.id] = "pattern";
      continue;
    }
    if (duplicates.has(normaliseText(post.text))) {
      reasons[post.id] = "duplicate";
      continue;
    }
    kept.push(post);
  }

  return { kept, hiddenCount: posts.length - kept.length, reasons };
}
