/**
 * THE config — everything token-specific lives here (IMPLEMENTATION_PLAN.md §6).
 * The dashboard is a reusable template; $WIZARD is its first deployment.
 * Display live values everywhere — never hardcode market numbers.
 */

export const TOKEN = {
  mint: "7XdCaKpqLmKE2K7yr9xaeWB1H2CVZ1oGwxB6hmd9pump",
  symbol: "WIZARD",
  name: "Smoking Wizard",
  decimals: 6,
  chain: "solana",
  supply: 1_000_000_000,
  /** PumpSwap WIZARD/SOL — main pool. Other pools are discovered dynamically. */
  mainPool: "Dw4kAH8LhdmgfW1cgyvnWSwSDqkt37jeY7pW4oFkbGTu",
} as const;

/**
 * Manual holder labels — the human override for the concentration exclusion set (§6).
 *
 * The label map is built automatically each census: DexScreener pool discovery ∪
 * RugCheck `knownAccounts` + `markets[].pubkey` ∪ the burn address (see
 * app/api/cron/snapshot/route.ts). Anything listed HERE is merged last and wins over
 * discovery — use it when an account is provably protocol-owned but no upstream
 * labels it (a new AMM, a locker, a bridge/CEX vault), or to correct a bad label.
 *
 * `pool` / `locker` / `burn` are EXCLUDED from the top-N bars, HHI and buckets;
 * `creator` is labeled but still counted. Keys are OWNER wallet addresses (a pool's
 * vault is owned by the pool address). Empty for $WIZARD: discovery covers every
 * pool we have observed. Add an entry only with evidence, and note why.
 */
export const MANUAL_LABELS: Record<string, "pool" | "locker" | "burn" | "creator"> = {
  // "SomeOwnerAddressHere1111111111111111111111": "pool", // why + link to evidence
};

/**
 * Tunable thresholds — kept here so the dashboard stays a config-first template.
 * A trade at or above `whaleUsd` earns the whale badge in the Ledger of Deeds (§4).
 */
export const THRESHOLDS = {
  whaleUsd: 500,

  /**
   * Wards & Protections (M5) — pass/warn/fail bands for the safety checklist.
   * Deliberate, documented values (not magic numbers): each row shows its
   * measured value AND the band it is judged against, so the card reads as a
   * rubric, not an oracle (plan §7 transparency principle). Tune here — never
   * hardcode a threshold in the evaluation code. Each band carries two
   * boundaries; whether higher or lower is safer is applied (and documented)
   * per-row in `lib/metrics/safety.ts`.
   */
  safety: {
    /** LP locked, % of the primary market's LP supply. Higher is safer. */
    lpLockedPct: { pass: 80, warn: 50 },
    /** Top-10 concentration (AMM pools / lockers / burn excluded), % of supply. Lower is safer. */
    top10Pct: { pass: 30, warn: 50 },
    /** Creator wallet holdings, % of supply. Lower is safer. */
    creatorPct: { pass: 5, warn: 10 },
    /** Token age in days since the earliest pool was created. Higher is safer. */
    ageDays: { pass: 90, warn: 30 },
    /** RugCheck normalised risk score (0 = clean; lower is safer — verified against the clean $WIZARD fixture). */
    rugScore: { pass: 20, warn: 50 },
  },

  /**
   * The Wizard's Verdict (M7) — the transparent five-axis rubric (plan §4 module
   * 11). Same pattern as `safety`: every band is deliberate and documented, and
   * the card renders each axis's inputs AND the threshold it was judged against so
   * it reads as a rubric, not an oracle. Whether higher or lower is safer is
   * applied (and documented) per-input in `lib/metrics/verdict.ts`.
   *
   * The Safety axis (mint/freeze/LP/RugCheck) and the Distribution top-10 input
   * REUSE the `safety` bands above — one source of truth, no drift. Only the bands
   * unique to the Verdict live here.
   */
  verdict: {
    /**
     * HHI over RugCheck's top-20 real-holder window (pools/lockers excluded).
     * Herfindahl-Hirschman on percent shares (0–10000; one holder = 10000). US
     * DOJ convention: < 1500 unconcentrated, 1500–2500 moderate, > 2500 highly
     * concentrated. Lower is safer. NOTE: this is a top-20-window figure — a lower
     * bound on the true HHI (the long tail adds negligible squared weight); M4's
     * full Helius holder set refines it.
     */
    hhiTop20: { pass: 1500, warn: 2500 },
    /** Total liquidity depth across active pools, USD. Higher is safer. */
    liquidityUsd: { pass: 40_000, warn: 15_000 },
    /** Liquidity / market-cap ratio. Higher is safer (thin books rug easily). */
    liqToMcap: { pass: 0.1, warn: 0.04 },
    /**
     * 24h volume as a multiple of the trailing 30d average DAILY volume. 1.0× =
     * trading at its recent norm. Higher is safer (fading volume is a risk); a
     * spike also reads high — the card shows the raw inputs so a buyer can judge.
     */
    volumeTrend: { pass: 0.75, warn: 0.35 },
    /** Distinct wallets that traded in the last 24h. Higher is safer. */
    uniqueTraders24h: { pass: 30, warn: 10 },
    /**
     * Community posting cadence — posts per week across BOTH feeds (official +
     * community) over the trailing 28 days, from our own x_posts buffer (M6).
     * Higher is safer: an active, talking community is a healthier sign than a
     * silent one. Bands are deliberately forgiving for a young memecoin community:
     *   pass ≥ 3 posts/week  · warn ≥ 1/week · else fail (effectively silent).
     * The Coven feed is an approximation (a $WIZARD cashtag search, see
     * lib/sources/x.ts), so cadence reads chatter volume, not a curated timeline —
     * a defensible floor, tunable here as the community grows.
     */
    postingCadence: { pass: 3, warn: 1 },
    /**
     * Score points awarded per input/axis status, and the score cut-offs that map
     * a 0–100 axis (or overall) score to a pass/warn/fail band. Equal weight per
     * input within an axis and per axis in the roll-up — documented in verdict.ts.
     */
    points: { pass: 100, warn: 50, fail: 0 },
    band: { strong: 75, fair: 45 },
  },
} as const;

export const X_COMMUNITY_ID = "2031864427176476866";

/**
 * X / Prophecy Feed config (M6). Config-first so the template re-targets to any
 * token by editing these values. See lib/sources/x.ts for the endpoint-verification
 * decision log (which community candidate won and why).
 *
 * - `officialUsername` → the @handle whose timeline is the Official tab.
 * - `officialUserId`   → its numeric id, resolved once via the users/by/username
 *   lookup (verified 2026-07-20) and pinned here so the steady-state poller spends
 *   exactly 2 calls/run (no per-run username→id bootstrap). Leave null to have the
 *   poller resolve + cache it on first run instead.
 * - `communityQuery`   → the recent-search query powering The Coven tab. The ideal
 *   `community_id:` operator is NOT available on this API tier (candidate A → 400),
 *   so this is the documented fallback C: a $WIZARD cashtag / phrase search, shown
 *   in the UI as an approximation of community chatter (not the literal member feed).
 */
export const X = {
  officialUsername: "swizardcore",
  officialUserId: "2040859395236474881",
  communityId: X_COMMUNITY_ID,
  /** Community display name from the communities lookup (candidate B, HTTP 200). */
  communityName: "Smoking $WIZARD",
  communityQuery: `"smoking wizard" OR $WIZARD -is:retweet`,
} as const;

export const LINKS = {
  site: "https://smokingwizard.xyz",
  x: "https://x.com/swizardcore",
  xCommunity: `https://x.com/i/communities/${X_COMMUNITY_ID}`,
  telegram: "https://t.me/thesmokingwizards",
  tiktok: "https://www.tiktok.com/@mimofrl",
  creator: "https://mimofr.com",
  /**
   * The source repository. NOTE: currently PRIVATE — this footer link 404s for
   * visitors until the repo is made public (README → "What's still on you").
   */
  github: "https://github.com/Neutize/wizard-tower",
  buy: {
    pumpFun: `https://pump.fun/coin/${TOKEN.mint}`,
    jupiter: `https://jup.ag/swap/SOL-${TOKEN.mint}`,
  },
  explorers: {
    solscan: `https://solscan.io/token/${TOKEN.mint}`,
    dexscreener: `https://dexscreener.com/solana/${TOKEN.mint}`,
    geckoterminal: `https://www.geckoterminal.com/solana/pools/${TOKEN.mainPool}`,
    rugcheck: `https://rugcheck.xyz/tokens/${TOKEN.mint}`,
    bubblemaps: `https://v2.bubblemaps.io/map?address=${TOKEN.mint}&chain=solana`,
  },
} as const;
