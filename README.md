# The Wizard's Tower

A single-page, real-time due-diligence dashboard for **Smoking Wizard ($WIZARD)** on Solana — price, liquidity, holder distribution, safety checks, a unified trade tape, the community feed, and a computed verdict, all on one dark data-dense page.

**Live:** https://www.smokingwiz.art

> **Community-built · unofficial · informational only · not financial advice · DYOR.**
> This dashboard is not affiliated with the token's creators. It reads public data and shows it straight — including concentration risk and safety flags as prominently as price. It never touches a wallet; every "Buy" control is an outbound link. Nothing here is investment advice.

---

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

### Environment variables

Create `.env.local` in the repo root:

| Var | Needed for | Notes |
|---|---|---|
| `HELIUS_API_KEY` | holder census | free tier is enough (1M credits/mo) |
| `DATABASE_URL` | holders + social feeds | Neon connection string |
| `X_BEARER_TOKEN` | social poller | paid, pay-per-use |
| `X_POLL_ENABLED` | poller kill switch | `false` = no-op with zero API calls |
| `CRON_SECRET` | cron routes | generate with `openssl rand -hex 32` |
| `NEXT_PUBLIC_SITE_URL` | canonical URLs | production only |
| `WIZARD_ANALYTICS` | Vercel Web Analytics | set to `1` only where Vercel's edge serves `/_vercel/insights/script.js`; anywhere else it is a 404 per page view |

Everything degrades without them — you can develop the market, chart, tape, and safety cards with no keys at all.

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | dev server on :3000 |
| `pnpm build` | production build |
| `pnpm test` | unit tests (vitest) |
| `pnpm test:e2e` | end-to-end + accessibility (Playwright, axe) |
| `pnpm db:push` | push schema to Neon |

---

## Architecture

**Stack:** Next.js 16 (App Router, strict TS) · Tailwind v4 · TanStack Query v5 · lightweight-charts v5 · Drizzle ORM + Neon Postgres · zod v4 · Vercel · GitHub Actions · vitest + Playwright.

### The source-lib pattern

Every upstream provider is one module in `lib/sources/`, shaped as:

```
zod boundary  →  pure mapper  →  cached SWR fetcher
```

1. **zod boundary** — raw responses validated at the system edge.
2. **Pure mapper** — deterministic, testable conversion to domain types.
3. **Cached SWR fetcher** — TTL cache + stale-while-revalidate, so a card never blanks on upstream failure.

Every fetcher returns:
```ts
{ ok: boolean; stale: boolean; dataAsOf: number | null; data: T | null; error?: string }
```

### Layout

- **`components/cards/`** — one component per metric + its `use*.ts` TanStack hook (query key, refetch interval).
- **`lib/sources/`** — one module per upstream provider (follows the pattern above).
- **`lib/metrics/`** — pure math (concentration, verdict, trade merging, safety). No fetching, no clock, no I/O.
- **`lib/holders.ts`, `lib/social.ts`** — database read paths.
- **`lib/trades-archive.ts`** — trades database (read/write).
- **`config/token.ts`** — **the only token-specific file.** Edit this to retarget the dashboard to another token.
- **`db/schema.ts`** — Drizzle schema: `holder_snapshots`, `x_posts`, `kv_cache`, `trades`.

### Key design principle

**Nothing token-specific goes anywhere except `config/token.ts`.** If you find a hardcoded mint, threshold, or social handle elsewhere, move it to config.

---

## How the crons work

One GitHub Actions schedule (`7,22,37,52 * * * *`) POSTs three Bearer-gated routes every 15 minutes. Each route enforces its own floor in code:

| Route | What it does | Runs at least every |
|---|---|---|
| `/api/cron/trades` | Archives trade windows → deduped on `tx_hash` | 15 min (sets the schedule) |
| `/api/cron/snapshot` | Helius holder scan → `holder_snapshots` | 50 min (route-enforced floor) |
| `/api/cron/social` | ~2 X API calls → `x_posts` | 4 h (route-enforced floor) |

The trade archive runs at every tick because it is the strictest consumer — GeckoTerminal's `/trades` endpoint serves at most 300 trades and 24h per pool; whatever leaves the window is unrecoverable. The other two declare their own floors to avoid wasting money (X is paid per call) or rows.

To change X's poll rate, edit `MIN_POLL_INTERVAL_MS` in `app/api/cron/social/route.ts`, not the cron expression.

---

## Local development gotchas

### The e2e port conflict

Before running e2e tests, kill anything on :3777:
```bash
lsof -ti :3777 | xargs kill -9 2>/dev/null
```

Playwright reuses an existing server locally; if you left a dev server running there, the tests hit your live upstreams and database instead of recorded fixtures.

### Database

`getDb()` returns null when `DATABASE_URL` is unset or e2e is gated with `WIZARD_DISABLE_DB=1`. Callers must degrade honestly — never throw.

---

## Retargeting to another token

Everything token-specific lives in **`config/token.ts`**:

1. **`TOKEN`** — mint, symbol, name, decimals, supply, mainPool (others discovered dynamically).
2. **`LINKS`** — site, socials, buy links, explorers (most derive from mint).
3. **`X`** — officialUsername, officialUserId (pin it to save API calls), communityId, communityQuery.
4. **`THRESHOLDS`** — safety bands and verdict rubric. Re-tune these for your token — bands tuned for a young memecoin are wrong for a large-cap.
5. **`MANUAL_LABELS`** — holder exclusion set (usually empty to start).

Non-configurable: the module set (edit `app/page.tsx` to swap cards), and non-Solana chains (all source modules assume Solana).

---

## Known limitations

- **Holder history is not retroactive.** The chart starts at the first recorded snapshot, not token launch. Δ7d and Δ30d show `—` until enough history exists.
- **ATH is a "high since"**, not all-time high. It comes from GeckoTerminal daily candles since the pool was created (2026-03-11 for $WIZARD), which does not span earlier pump.fun phases that no indexer covers.
- **The Coven tab is approximate.** The X API tier gates the `community_id:` search operator, so we search mentions instead (`"smoking wizard" OR $WIZARD -is:retweet`).
- **Creator-fee recipients are named off-chain.** The coin's "creator" is a pump.fun fee-share program account, not a wallet, and it splits every lamport between two accounts that carry no on-chain label. The chain proves the split and the cumulative total; the names shown beside them come from the token team.
- **Concentration is only as good as labels.** New AMMs not yet labeled by DexScreener or RugCheck inflate the top-10 figure. Add manual labels in `config/token.ts` with evidence.
- **GeckoTerminal is a single point of failure** for chart, tape, flow, and ATH. Accepted v1 trade-off. The trade archive cushions this: 24h flow figures work from our DB even if the live tape is stale.
- **Unique buyer/seller counts are approximate until the trade archive spans 24h.** Once it does, the UI drops the "~" prefix and reads `flowSource` to report which data source is live.
- **In-memory server caches don't survive cold starts or span instances.** Durable stores (`holder_snapshots`, `x_posts`, `kv_cache`) are what persist; expensive paths write to Postgres.

---

## Contributing

This is a community project. For infrastructure questions, see `.github/workflows/` and the code comments in `app/api/cron/`.

---

*Community-built, unofficial, informational only. Not financial advice. DYOR.*
