# $WIZARD — "The Wizard's Tower" Dashboard · Implementation Plan

> **How to use this document.** This is the complete, delegation-ready spec for building an hl.eco-style analytics dashboard for the Smoking Wizard ($WIZARD) Solana token. It was produced by the product owner / tech lead session on 2026-07-17 after analyzing hl.eco in the browser, validating every data endpoint live, and studying `Wizardcore-Visuals-Pack.pdf` (in this folder — the visual bible; keep it). Execute milestone by milestone (Section 7); each milestone is sized for one focused agent session and has its own definition of done. Do not relitigate decisions in Section 12.

---

## 0. Product vision

**The Wizard's Tower**: a single-page, real-time due-diligence terminal for $WIZARD, in the spirit of hl.eco: every number a prospective buyer needs, on one dark data-dense page, wrapped in the Wizardcore aesthetic. Honest by design: it shows concentration risk and safety flags as prominently as price. Informational only — **not financial advice**, and the UI must say so.

- **Primary user**: someone who found $WIZARD on X/TikTok and wants 5 minutes of facts before deciding whether to buy.
- **Secondary**: existing holders monitoring the token; community members sharing modules as screenshots.
- **v1 success criteria**: loads < 2s; all data auto-refreshes; $0 fixed infrastructure (only pay-per-use X API pennies); works on mobile; every claim traceable to a named data source.

## 1. Token facts (verified 2026-07-17 — display live values, hardcode nothing)

| Fact | Value |
|---|---|
| Mint | `7XdCaKpqLmKE2K7yr9xaeWB1H2CVZ1oGwxB6hmd9pump` (Solana, pump.fun launch, 6 decimals, 1B supply) |
| Symbol / name | WIZARD / Smoking Wizard |
| Main pool | PumpSwap WIZARD/SOL `Dw4kAH8LhdmgfW1cgyvnWSwSDqkt37jeY7pW4oFkbGTu` (~$50K liquidity, ~$6.5K 24h volume at research time) |
| Other active pools | Meteora DLMM WIZARD/SOL `6ChdkdgBjzdwCPv4PYoriyr1xDT6KzjWKojzuhWjEMqr` · Meteora DLMM WIZARD/USDC `2jwbtvZf8dxZkQrERBZERDZfPMQoFpHGYEESPCxWibaG` · Meteora DAMM v2 USD2/WIZARD `GpvSKgSJ4sSNqoMmcGUhfnj78f2vgtspoCFk4boVCwaK` · Raydium CLMM WIZARD/USDC (+ ~10 dust pools — **discover pools dynamically**, don't hardcode the list) |
| Graduated bonding curve | pump-fun pool `AC1oM8…` is empty — token graduated to PumpSwap ~Mar 2026 |
| Market snapshot | ~$200K mcap · ATH $0.0003529 · LP 87.66% locked · RugCheck score clean, 0 risk flags (all at research time) |
| Links | smokingwizard.xyz · X [@swizardcore](https://x.com/swizardcore) · X community `2031864427176476866` · t.me/thesmokingwizards · TikTok/IG @mimofrl · mimofr.com |
| Lore | Wizardcore character by creator **Mimo (@mimofrl)** — wizard videos since 2022, 1.3B+ views, 1,900+ videos. Original token dev was suspended on X; the community CTO'd (community-takeover) the token. **100% of creator fees flow to Mimo's wallet.** |

## 2. What we copy from hl.eco (design principles)

1. **Bento grid of self-contained cards** — each card answers one question and stands alone as a screenshot.
2. **Card anatomy**: small-caps title + data-source attribution → giant monospace hero number → small sub-metric grid → chart underneath. Controls (timeframe, toggles) top-right.
3. **One thesis metric gets hero treatment** (hl.eco: burns/revenue → here: holder growth + creator fees to Mimo).
4. **cmd+K palette** and per-card share affordance.
5. **Playful art around serious data** — mascot moments allowed, numerals never decorated.
6. Auto-refresh with a subtle "live" indicator; source attribution on every card builds trust.

## 3. Visual identity — "Wizardcore terminal" (from `Wizardcore-Visuals-Pack.pdf`)

- *(Palette revised 2026-07-18 by product owner: the original stock Tailwind violet read as AI-default. Recolored to the wizard's own materials — amethyst, pipe smoke, candlelight. Values below are current; token names in code are unchanged.)*
- **Canvas**: smoke-black with plum warmth `#120C15`; deep plum orb glows in upper background corners + a faint ember hearth-glow from below (PDF cover motif, candlelit).
- **Cards**: `#1A1321` charcoal-plum panels · 1px `rgba(168,99,212,.32)` borders · corner ✦ ornaments (CSS pseudo-elements) · 8px radius · deep shadows.
- **Type**: Inter or Geist Bold for headings (white); **amethyst `#A863D4`→`#CFA6EA` for section titles and highlighted words**; **JetBrains Mono for every numeral and address**; italic smoke-mauve `#9C8BA3` captions under charts (PDF style).
- **Data accents**: terminal green `#86EFAC` = positive/buys and mono data blocks (echoes the PDF's green prompt boxes); rose `#FB7185` = negative/sells; gold `#EAB308` reserved for verdict/insight callouts styled like the PDF's "THE WHOLE GAME" boxes (thick purple left bar); ember `#FF9E4A` reserved for the live indicator only (the wizard's lit pipe).
- **Ornament**: thin horizontal rule with centered ✳ under every card title; ◆ separators in footers.
- **Texture**: subtle film-grain/scanline overlay (pure CSS, honors `prefers-reduced-motion`, user-toggleable, off on mobile); fisheye-vignette masks on hero art only — never on charts.
- **Voice**: lore names with functional subtitles (e.g. **"Council of Holders — holder distribution & concentration"**). Error states in-character ("The crystal ball is cloudy — retrying…"); numbers always play it straight.
- Dark-only in v1. Implementing agents must load the `frontend-design` and `dataviz` skills before building UI/charts.

## 4. Modules (product spec — single page, two-column bento, stacks on mobile)

**Sticky header**: wizard mark + "$WIZARD · The Wizard's Tower" · CA chip (mono, truncated, click = copy) · live price + 24h% ticker · Buy menu (outbound links only: pump.fun swap, Jupiter) · socials row · refresh indicator.

1. **The Wizard's Ledger** *(hero market card, full width)* — price USD & SOL; 24h/6h/1h change chips; market cap; FDV; total liquidity (sum of active pools); 24h volume (sum); ATH + % from ATH; token age; holder count (from our snapshots); supply. Source: DexScreener (30s) + DB.
2. **The Scrying Glass** *(chart)* — candlesticks + volume histogram (`lightweight-charts`); timeframes 1m/5m/15m/1h/4h/1d; pool selector (default: PumpSwap main); price⇄mcap toggle. Source: GeckoTerminal OHLCV (60s).
3. **Council of Holders** — hero: total holders + Δ7d/Δ30d; holder-count area chart from hourly snapshots (banner: "recorded since <launch date>" — history is not retroactive); top-10/20/50 concentration bars **excluding labeled pool/locker accounts**; HHI concentration meter; holder buckets (<$10, $10–100, $100–1K, $1K–10K, >$10K); top-20 table (rank, address→Solscan, label [pool/creator/locker], balance, % supply, USD). Sources: Helius scan (hourly), RugCheck `creator`, pool labels from discovery.
4. **The Cauldrons** *(pools & liquidity)* — table of active pools (liq > $100): DEX badge, pair, liquidity, 24h vol, 24h txns, price, spread vs main pool %; footer: total liquidity, liquidity/mcap ratio, LP locked % (RugCheck). Sources: DexScreener + GeckoTerminal (60s).
5. **The Ledger of Deeds** *(unified trade tape)* — merged trades across active pools, newest first: time, BUY/SELL, WIZARD amount, USD, price, pool badge, wallet (truncated → Solscan). Whale badge ≥ $500. Filters: pool, side, min USD. GeckoTerminal `/trades` per pool every 30s, merged + deduped by tx hash.
6. **Flow of Mana** *(volume & momentum)* — 30d daily volume bars; 24h buy-vs-sell pressure (counts and USD); net flow ≈ buyUSD − sellUSD (24h); unique buyers/sellers 24h (labeled approximate). Sources: GeckoTerminal daily OHLCV + trades aggregation.
7. **Wards & Protections** *(safety)* — checklist with pass/warn/fail runes: mint authority revoked · freeze authority revoked · LP locked % · top-10 concentration vs threshold · RugCheck risks + normalized score · creator wallet holdings % · token age. Deep links: RugCheck, Solscan. Bubblemaps (`https://v2.bubblemaps.io/map?address=<mint>&chain=solana`) is offered separately as an explained "holder relationship map" link-out — embedding it is not possible, see §12. Source: RugCheck full report (1h cache) + Helius.
8. **The Prophecy Feed** *(X)* — tabs **Official** (@swizardcore) and **The Coven** (community `2031864427176476866`). Post cards: avatar, name, @handle, text, media thumbs, ❤/RT/reply counts, relative time, link to X. Reads **our DB only**; a scheduled poller fills it (fixed pay-per-use cost, zero per-visitor X calls). Follow X display requirements (attribution + link back).
9. **The Origin Scroll** *(lore/about)* — honest short story: Wizardcore by Mimo since 2022 (1.3B+ views, 1,900+ videos); suspended-dev → community CTO; 100% creator fees to Mimo; what buying this actually is (creator-aligned memecoin, volatile, can go to zero); all official links. One wizard art panel with fisheye-vignette treatment.
10. **Mimo's Tribute** *(creator-fee tracker — stretch, see M9)* — cumulative creator fees earned/claimed by the creator wallet via the pump.fun/PumpSwap creator-fee mechanism; 30d bars; "supports Mimo directly" framing. Ship only if on-chain numbers verify against pump.fun's own display; otherwise link out.
11. **The Wizard's Verdict** *(gold callout card — the screenshot card)* — transparent auto-computed rubric across five axes: Safety (mint/freeze/LP) · Distribution (top-10 %, HHI) · Liquidity (depth, liq/mcap) · Activity (volume trend, unique traders) · Community (posting cadence). Every axis shows its inputs and thresholds inline — a rubric, not an oracle; disclaimer in the footer.

**Footer**: data-source credits (DexScreener, GeckoTerminal, Helius, RugCheck, X) · "community-built · unofficial · informational only · not financial advice · DYOR" · GitHub link · ✳ ornament.

**Cross-cutting**: cmd+K palette (copy CA; open Solscan / DexScreener / GeckoTerminal / RugCheck / pump.fun / Bubblemaps; jump to module) · skeleton loaders in card shapes · anchor id per card · OG meta image (static wizard art in v1) · tape virtualized on mobile.

## 5. Data source playbook (endpoints verified live 2026-07-17 unless noted)

| Source | Endpoint | Provides | Limit | Server cache |
|---|---|---|---|---|
| DexScreener (no key) | `GET https://api.dexscreener.com/latest/dex/tokens/{mint}` | all pairs: priceUsd/Native, liquidity, fdv, marketCap, volume m5/h1/h6/h24, txn counts, priceChange, socials, images | 300 req/min | 30s |
| GeckoTerminal (no key) | `GET https://api.geckoterminal.com/api/v2/networks/solana/tokens/{mint}/pools` | pool discovery, reserves, volume, tx counts | 30 req/min (shared) | 60s |
| GeckoTerminal | `GET …/networks/solana/pools/{pool}/ohlcv/{day\|hour\|minute}?aggregate=&limit=` | candles `[ts,o,h,l,c,v]` | shared | 60s |
| GeckoTerminal | `GET …/networks/solana/pools/{pool}/trades` | last 100 trades: `block_timestamp`, `kind` (buy/sell), token amounts, `price_*_in_usd`, `volume_in_usd`, `tx_hash`, `tx_from_address` | shared | 30s |
| RugCheck (no key) | `GET https://api.rugcheck.xyz/v1/tokens/{mint}/report` (light: `…/report/summary`) | mint/freeze authority, creator, topHolders, markets, `lpLockedPct`, risks[], score | be polite | 1h |
| Helius (free key) | DAS `getTokenAccounts` by mint, paginated 1K/page | full holder list → count, buckets, top-N, HHI | 1M credits/mo, 10 rps | hourly job |
| Helius | RPC `getTokenLargestAccounts` | quick top-20 between snapshots | ↑ | 5m |
| X API v2 (bearer, pay-per-use) | `GET /2/users/by/username/swizardcore` → `GET /2/users/{id}/tweets?tweet.fields=public_metrics,created_at,attachments&expansions=attachments.media_keys,author_id&exclude=replies` | official posts | per-use $ | poller 30m |
| X API v2 | Community posts — **verify with `xurl` before building** (see M6): candidate A `GET /2/tweets/search/recent?query=community_id:2031864427176476866`; candidate B communities lookup endpoints | community feed | per-use $ | poller 30m |
| Solana public RPC (fallback) | `getTokenSupply`, `getTokenLargestAccounts` | supply cross-check | public | 1h |

**Implementation rules**: one `lib/sources/<provider>.ts` per provider · zod-validate every response · per-provider token-bucket rate limiter · stale-while-revalidate everywhere (on upstream failure serve last good data + `dataAsOf` timestamp — never blank a card) · all keys server-side only.

**X cost control**: poller runs on schedule (default 30 min, env-tunable), ≤2 endpoint calls per run using `since_id`, upserts to Postgres; visitors read only our DB. Kill switch `X_POLL_ENABLED=false`. Estimated ≲100 calls/day. `xurl` (X's official CLI) is for local OAuth bootstrap and endpoint verification; production uses `X_BEARER_TOKEN`.

## 6. Architecture

**Stack**: Next.js 15 (App Router, TypeScript strict) · Tailwind v4 + shadcn/ui · TanStack Query (client polling) · `lightweight-charts` (candles) + Recharts (bars/areas/donuts) · Drizzle ORM + Neon serverless Postgres · zod · Vercel Hobby · GitHub Actions (cron) · vitest + Playwright smoke.

```
app/
  page.tsx                      # bento layout, module composition
  api/market/route.ts           # DexScreener agg            (revalidate 30s)
  api/ohlcv/route.ts            # ?pool=&tf=                 (60s)
  api/trades/route.ts           # merged tape                (30s)
  api/holders/route.ts          # snapshots + deltas + top20 (60s, reads DB)
  api/safety/route.ts           # RugCheck report            (1h)
  api/social/route.ts           # ?source=official|community (reads DB)
  api/cron/snapshot/route.ts    # POST, Bearer CRON_SECRET → Helius scan → insert
  api/cron/social/route.ts      # POST, Bearer CRON_SECRET → X poll → upsert
components/cards/*              # one component per module (Section 4)
components/wizard/*             # CardFrame (border+✦+✳), StatHero, StatGrid, Rune, GrainOverlay
lib/sources/*                   # dexscreener.ts geckoterminal.ts helius.ts rugcheck.ts x.ts
lib/metrics/*                   # concentration.ts (HHI/topN/buckets), verdict.ts, merge-trades.ts
config/token.ts                 # THE config: mint, pool labels, socials, community id, thresholds
db/schema.ts                    # Drizzle schema
.github/workflows/snapshot.yml  # hourly   → POST /api/cron/snapshot
.github/workflows/social.yml    # */30 min → POST /api/cron/social
```

**DB schema (Neon Postgres via Drizzle)**
- `holder_snapshots(id, ts timestamptz, total_holders int, top10_pct real, top20_pct real, top50_pct real, hhi real, buckets jsonb, top_holders jsonb)`
- `x_posts(id text pk, source text check (source in ('official','community')), author_handle text, author_name text, author_avatar_url text, text text, created_at timestamptz, likes int, reposts int, replies int, media jsonb, url text, fetched_at timestamptz)`
- `kv_cache(key text pk, value jsonb, updated_at timestamptz)` — RugCheck & misc persistence across cold starts.

**Env vars**: `HELIUS_API_KEY` · `DATABASE_URL` · `X_BEARER_TOKEN` · `X_POLL_ENABLED` · `CRON_SECRET` · `NEXT_PUBLIC_SITE_URL`.

**Config-first**: everything token-specific lives in `config/token.ts` — the dashboard is a reusable template; $WIZARD is its first deployment.

**Concentration math**: exclude accounts labeled as AMM pools (addresses from pool discovery), lockers, and the burn address; label (but include, with a note) the creator wallet. Document the exclusion list in a UI tooltip.

## 7. Milestones (each = one delegable agent session, with definition of done)

| # | Scope | Definition of done |
|---|---|---|
| **M0** | Scaffold + Wizardcore design system: Next.js app, Tailwind tokens (Section 3), `CardFrame`/`StatHero`/`StatGrid`/skeletons, page shell with placeholder cards, header + CA copy chip, footer + disclaimers | Deployed to Vercel preview; Lighthouse perf ≥ 90; bento responsive |
| **M1** | `lib/sources/dexscreener.ts` + `/api/market` + **The Wizard's Ledger** + **The Cauldrons** | Numbers match dexscreener.com within one refresh window; API failure shows stale banner, never a blank card |
| **M2** | **The Scrying Glass**: GeckoTerminal OHLCV + lightweight-charts (timeframes, pool select, price/mcap toggle) | Candles match GeckoTerminal UI; timeframe switch feels < 300ms |
| **M3** | **The Ledger of Deeds** + **Flow of Mana**: trades merge lib + tape UI + volume/pressure card | New trades visible ≤ 60s after on-chain; 24h buy/sell totals within ±10% of DexScreener txn counts |
| **M4** | Holders pipeline + **Council of Holders**: Helius scan lib, snapshot cron route + GitHub Action, Neon schema, concentration math **with unit tests**, card UI + top-20 table | Hourly snapshots landing in Neon; holder count within ±1% of Solscan; math tests green |
| **M5** | **Wards & Protections**: RugCheck integration + checklist card + deep links | Flags render pass/warn/fail correctly vs live report; 1h cache verified |
| **M6** | **The Prophecy Feed**: verify community endpoint **with `xurl` first** and record the decision in code comments; poller cron + upsert; feed UI with Official/Coven tabs | Fresh posts within one poll interval; zero client-side X calls; per-poll cost logged |
| **M7** | **The Wizard's Verdict** (rubric lib + thresholds in config + tests) + **Origin Scroll** + cmd+K palette + grain overlay + OG meta + error-state copy | Playwright smoke: all cards render with mocked APIs; axe: no critical a11y violations |
| **M8** | Production: Vercel prod + domain, Actions secrets, README runbook (key rotation, poll cadence tuning, adding pool labels) | Public URL live; both crons green for 24h; README complete |
| **M9** *(stretch)* | **Mimo's Tribute**: research spike first — resolve creator wallet (RugCheck `creator` / pump.fun frontend API), find creator-vault PDA, decode fee claims via Helius Enhanced Transactions | Ship only if totals verify against pump.fun's displayed creator rewards; else link out |

**Delegation template per milestone**: "Read `IMPLEMENTATION_PLAN.md`. Execute milestone **M\<n\>** exactly as specified. Its Definition of Done is your exit criteria. Load the `frontend-design` and `dataviz` skills before any UI/chart work. Record real API responses you encounter into `test/fixtures/`."

## 8. Testing & verification

- **Unit (vitest)**: concentration math, trade merge/dedupe, verdict rubric, zod mappers — against **saved live fixtures** (`test/fixtures/`, recorded during M1–M6).
- **Contract**: each `lib/sources/*` gets a `pnpm check:sources` script that hits live endpoints and prints drift warnings.
- **E2E**: Playwright smoke with mocked routes (deterministic).
- **Whole-system check**: compare every card against its reference UI (dexscreener.com, geckoterminal.com, solscan.io, rugcheck.xyz, x.com) — values must agree within one refresh window.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Free APIs change or throttle | zod validation, SWR-stale fallbacks, per-provider limiters; GeckoTerminal is the single source for chart+tape — documented and accepted for v1 |
| X community-search operator availability uncertain | M6 starts with `xurl` verification; fallback A: recent search `"smoking wizard" OR $WIZARD` filtered; fallback B: curated member-handle timelines. Decision recorded in code |
| Thin/no trades on a low-liquidity token | Empty states designed in-character ("The ledger is quiet…") — a quiet tape is itself signal for a buyer |
| Holder history not retroactive | Banner "recorded since <date>"; optional paid backfill later if ever budgeted |
| Legal/ethical | Persistent "community-built · informational only · not financial advice · DYOR" footer + verdict disclaimer; no yield/return language; buy buttons are plain outbound links |
| Vercel Hobby is non-commercial | Fine for a community dashboard; revisit if referral/affiliate links are ever added |

## 10. Backlog (post-v1)

Per-card share-as-image (wizard-framed PNG, hl.eco camera-button style) · Telegram price/holder alert bot · i18n (RU first, hl.eco-style) · PWA install · historical trade archive table · extract the token-template (deploy for any CA) · curated TikTok/IG content module · light theme.

## 11. Reference links

[hl.eco](https://hl.eco) (pattern reference) · [DexScreener token page](https://dexscreener.com/solana/7XdCaKpqLmKE2K7yr9xaeWB1H2CVZ1oGwxB6hmd9pump) · [GeckoTerminal API docs](https://apiguide.geckoterminal.com/) · [Helius DAS docs](https://docs.helius.dev/) · [RugCheck](https://rugcheck.xyz/tokens/7XdCaKpqLmKE2K7yr9xaeWB1H2CVZ1oGwxB6hmd9pump) · [X API v2 docs](https://developer.x.com/) + `xurl` · [smokingwizard.xyz](http://smokingwizard.xyz) · `Wizardcore-Visuals-Pack.pdf` (repo root)

## 12. Decision log (settled — do not relitigate)

**Bubblemaps stays a link-out — do not re-attempt the iframe** (verified 2026-07-20): `v2.bubblemaps.io` serves `Content-Security-Policy: frame-ancestors 'self' localhost:* 0.0.0.0:* bubblemaps.io *.bubblemaps.io assetdash.com *.assetdash.com mobyscreener.com *.mobyscreener.com bullx.io *.bullx.io tinyastro.io *.tinyastro.io` — this origin is not on it, so a framed map renders as a browser block page in production. Note the trap: `localhost` **is** allow-listed, so the embed appears to work in local dev and fails only once deployed. Independently, even from an allow-listed origin the map boots blank inside a frame (document loads, app never paints). The token itself is fine — it is indexed and renders correctly as a top-level page. Getting on that allow-list would need a commercial arrangement with Bubblemaps.

$0 data stack, holders via Helius free tier · X via official API (pay-per-use) with DB-buffered poller, showing @swizardcore + community `2031864427176476866` · Vercel free + Neon free + GitHub Actions cron · full Wizardcore lore styling per the PDF · Next.js 15 / TypeScript / Tailwind / shadcn / lightweight-charts / Drizzle · single-page bento, dark-only v1 · config-driven so the dashboard is reusable as a template.

---

*Community-built, unofficial, informational only. Not financial advice. DYOR.*
