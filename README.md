# The Wizard's Tower

A single-page, real-time due-diligence terminal for **Smoking Wizard ($WIZARD)** on Solana — price, liquidity, holder distribution, safety wards, a unified trade tape, the community feed, and an auto-computed verdict, all on one dark data-dense page.

**Live:** <https://wizard-tower-nu.vercel.app>

> **Community-built · unofficial · informational only · not financial advice · DYOR.**
> This dashboard is not affiliated with the token's creators. It reads public data and shows it straight — including the unflattering parts (concentration risk, safety flags) as prominently as price. It never touches a wallet; every "Buy" control is a plain outbound link. Nothing here is a recommendation to buy or sell anything.

Product and design decisions live in [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md); the visual bible is `Wizardcore-Visuals-Pack.pdf`. This README is the **operator's runbook** — how to run it, rotate its keys, tune its polling, and keep it honest.

---

## Contents

- [Architecture](#architecture)
- [Data sources](#data-sources)
- [Local development](#local-development)
- [Operations](#operations)
- [Key rotation](#key-rotation)
- [Poll cadence tuning](#poll-cadence-tuning)
- [Adding a pool label](#adding-a-pool-label)
- [Retargeting to a different token](#retargeting-to-a-different-token)
- [Known limitations](#known-limitations)
- [What's still on you](#whats-still-on-you)

---

## Architecture

**Stack:** Next.js 16.2.10 (App Router, TypeScript strict) · Tailwind v4 · TanStack Query v5 · `lightweight-charts` v5 (candles) + hand-rolled SVG (bars/areas) · Drizzle ORM + Neon serverless Postgres · zod v4 · Vercel · GitHub Actions (cron) · vitest + Playwright.

> ⚠️ **This is Next.js 16, not 15.** APIs and conventions differ from what most references (and most LLM training data) assume. Read `node_modules/next/dist/docs/` before changing any route or component pattern — this is a binding rule, see [`AGENTS.md`](./AGENTS.md).

### The source-lib pattern

Every upstream provider gets exactly one module in `lib/sources/`, and every one has the same three-layer shape. Follow it when adding a provider — it is why the data layer is testable and why a dead upstream never blanks a card.

```
  zod boundary  →  pure mapper  →  cached SWR fetcher
```

1. **zod boundary** — the raw response is validated at the edge of the system. Upstreams return numbers as strings, omit fields on thin markets, and change shape without warning; nothing untyped gets past this line.
2. **Pure mapper** — a deterministic function from validated response → our domain type. No fetching, no `Date.now()`, no I/O. This is what the unit tests exercise, against **real recorded responses** in `test/fixtures/`.
3. **Cached SWR fetcher** — a module-level cache with a TTL, in-flight de-duplication (two concurrent callers share one request), an `AbortController` timeout, and **stale-while-revalidate**: on any upstream failure it serves the last good data flagged `stale: true` with a `dataAsOf` timestamp. **A card never goes blank** — it shows the previous reading behind a stale banner.

Every fetcher returns the same envelope, which is what makes the cards uniform:

```ts
type Result<T> = { ok: boolean; stale: boolean; dataAsOf: number | null; data: T | null; error?: string }
```

### Layout

```
app/
  page.tsx                     # bento layout; server-fetches every card's seed
  layout.tsx                   # fonts, metadata, <Providers> (TanStack)
  opengraph-image.tsx          # generated OG image
  api/market/route.ts          # DexScreener aggregate
  api/ohlcv/route.ts           # ?pool=&tf=   candles
  api/trades/route.ts          # merged multi-pool tape
  api/holders/route.ts         # latest census + deltas + top-20   (reads DB)
  api/safety/route.ts          # RugCheck report
  api/social/route.ts          # ?source=official|community        (reads DB)
  api/cron/snapshot/route.ts   # POST, Bearer CRON_SECRET → Helius scan → DB
  api/cron/social/route.ts     # POST, Bearer CRON_SECRET → X poll  → DB
  api/cron/trades/route.ts     # POST, Bearer CRON_SECRET → trade windows → DB
components/cards/*             # one component per module + its use*.ts query hook
components/wizard/*            # CardFrame, StatHero, StatGrid, Rune, DataStatus, …
components/header/ components/footer/
lib/sources/*                  # one module per provider (the pattern above)
lib/metrics/*                  # PURE math: concentration, verdict, merge-trades, safety, cadence
lib/holders.ts lib/social.ts   # DB read paths (same Result envelope)
lib/trades-archive.ts          # DB read/write for the trade archive + flow overlay
config/token.ts                # THE config — the only token-specific file
db/schema.ts                   # Drizzle schema
test/fixtures/                 # recorded live responses (unit tests)
test/e2e/fixtures/             # recorded /api/* responses (Playwright)
.github/workflows/             # data-crons.yml — THE schedule (15 min, POSTs all three cron routes)
                               # snapshot/social/trades-archive.yml — same routes, dispatch-only
                               # cron-failure-issue.yml — reusable failure → GitHub issue
```

**Where things live — the rules:**

- **Cards** live in `components/cards/`, one file per module, each paired with a `use*.ts` TanStack hook that owns its query key and refetch interval. Cards are `"use client"`; they receive a **server-rendered seed** as `initial` so the page paints real numbers with no skeleton flash, then poll from there.
- **Pure metrics** live in `lib/metrics/`. No fetching, no clock, no randomness — every derived number (HHI, top-N shares, buckets, the verdict rubric, trade merge/dedupe, ATH) is a pure function unit-tested against recorded fixtures. **Put math here, not in a component.**
- **Nothing token-specific** goes anywhere except `config/token.ts`. See [Retargeting](#retargeting-to-a-different-token).

### Server rendering and the shared query key

`app/page.tsx` is `force-dynamic` and fetches every card's seed on the server in one pass. On the client, cards that need the same data **share a TanStack query key**, so N consumers cost one poll:

| Query key | Interval | Consumers |
|---|---|---|
| `["market"]` | 30s | Wizard's Ledger · The Cauldrons · The Wizard's Verdict · header price ticker |
| `["holders"]` | 60s | Council of Holders · Wizard's Ledger (holder count) |
| `["trades"]` | 30s | Ledger of Deeds · Flow of Mana |
| `["safety"]` | 10min | Wards & Protections · Cauldrons (LP locked) · Verdict |
| `["ohlcv", pool, tf]` | 60s | Scrying Glass · Flow of Mana (1d series) |
| `["social", source]` | 60s | Prophecy Feed (per tab) |

**If you add a consumer of existing data, reuse its hook** (`useMarket`, `useHolders`, …). Do not write a second fetcher against the same route — that doubles the poll rate for nothing. Verified empirically: four `["market"]` consumers produce exactly two `/api/market` requests per 70s.

---

## Data sources

All keys are **server-side only**. The browser talks exclusively to our own `/api/*` routes — it never contacts an upstream, and never contacts X at all.

| Source | Endpoint | Server cache | Client refetch | Upstream limit | Consumed by |
|---|---|---|---|---|---|
| **DexScreener** (no key) | `GET api.dexscreener.com/latest/dex/tokens/{mint}` | **30s** | 30s | 300 req/min | `/api/market` → Ledger, Cauldrons, Verdict, header ticker |
| **GeckoTerminal** OHLCV (no key) | `GET api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/{tf}` | **60s** | 60s | ~30 req/min, **shared** | `/api/ohlcv` → Scrying Glass, Flow of Mana |
| **GeckoTerminal** trades (no key) | `GET …/networks/solana/pools/{pool}/trades` | **30s** | 30s | ~30 req/min, **shared**; **≤300 trades AND ≤24h per pool** | `/api/trades` → Ledger of Deeds, Flow of Mana; `cron/trades` → `trades` |
| **RugCheck** (no key) | `GET api.rugcheck.xyz/v1/tokens/{mint}/report` | **1h** | 10min | "be polite" | `/api/safety` → Wards, Cauldrons, Verdict |
| **Helius** DAS (key) | `POST mainnet.helius-rpc.com/?api-key=` — `getTokenAccounts`, `getTokenSupply` | none — **the DB is the store** | n/a | 1M credits/mo, 10 rps | `cron/snapshot` → `holder_snapshots` |
| **Helius** RPC (key) | `POST mainnet.helius-rpc.com/?api-key=` — `getAccountInfo` | **1h** | n/a | ↑ same quota | Mimo's Tribute (fee-share route) |
| **Our DB** (holders) | `holder_snapshots` via Drizzle | **60s** | 60s | — | `/api/holders` → Council, Ledger, Wards, Verdict |
| **Our DB** (trades) | `trades` via Drizzle | **60s** | 30s (via `/api/trades`) | — | `/api/trades` flow → Flow of Mana, Verdict Activity |
| **X API v2** (bearer, paid) | `GET api.x.com/2/users/{id}/tweets` · `GET /2/tweets/search/recent` | DB-buffered; **60s** read cache | 60s | pay-per-use | `cron/social` → `x_posts` → `/api/social` → Prophecy Feed |

**The GeckoTerminal budget is shared.** Both Gecko modules go through one token-bucket limiter in `lib/sources/geckoLimiter.ts` — capacity **25/min** (deliberately under the ~30/min ceiling), refilled continuously, and it will never block a request longer than **3s**: past that the caller bails to its stale-while-revalidate path instead of queueing. If you add a third Gecko consumer, import `acquireGeckoToken` — do **not** add a second limiter.

**Helius pacing:** the holder scan pages at 1000 accounts/page with a 120ms delay between pages (well under 10 rps), capped at 50 pages (~50K accounts) so a pagination bug can't loop forever.

### Database

Neon serverless Postgres via the `neon-http` driver (one HTTPS round-trip per query — no pooled socket, which is right for serverless). Four tables (`db/schema.ts`):

- `holder_snapshots` — one row per hourly census: totals, top-10/20/50 %, HHI, buckets, top-20 holders.
- `x_posts` — buffered X posts, keyed by post id, `source` = `official` | `community`.
- `kv_cache` — small durable KV (RugCheck persistence, X `since_id` cursors) that survives serverless cold starts.
- `trades` — **the trade archive.** One row per swap, PK `tx_hash`, `ts` indexed. Written every 15 min by `cron/trades`; read by `/api/trades` to turn the 24h flow figures into a real census. See [The trade archive](#the-trade-archive).

**Storage.** Measured on a 50,000-row scale test with the same shape and indexes: **~480 B/row** (273 B heap + 206 B index — the PK is an 88-char signature, which is most of the index cost). At the current ~180 merged trades/day that is **~31 MB/year, about 6% of Neon's 0.5 GB free tier**. Ten times the volume is ~315 MB/year (59%) — still fits. A *full year sustained* at the busiest day ever observed (~5,900 trades/day) would be ~1.03 GB and would not fit; if volume ever lives there, prune with `delete from trades where ts < now() - interval '90 days'`. Nothing depends on rows older than the 24h window except the coverage-start date — **ATH does not come from this table** (see below), so pruning is safe.

`getDb()` returns **null** when there is no database (`DATABASE_URL` unset, or the e2e gate `WIZARD_DISABLE_DB=1`). Callers must treat null as "no durable store right now" and degrade honestly — never throw.

---

## Local development

**Prerequisites:** Node 20+ and pnpm.

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

### Env vars

Create `.env.local` in the repo root:

| Var | Needed for | Notes |
|---|---|---|
| `HELIUS_API_KEY` | holder census, Mimo's Tribute | free tier is enough (1M credits/mo) |
| `DATABASE_URL` | holders + social feeds | Neon connection string |
| `X_BEARER_TOKEN` | the social poller | paid, pay-per-use |
| `X_POLL_ENABLED` | poller kill switch | `false` = no-op with zero API calls |
| `CRON_SECRET` | the two cron routes | generate with `openssl rand -hex 32` |
| `NEXT_PUBLIC_SITE_URL` | canonical + OG URLs | production only; falls back to the live URL |

**Everything degrades honestly without them.** With no `DATABASE_URL` the holder and social cards render their in-character empty states rather than erroring — you can develop the market, chart, tape and safety cards with no keys at all, since those upstreams need none.

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | dev server on :3000 |
| `pnpm build` | production build |
| `pnpm lint` | ESLint |
| `pnpm test` | vitest — 107 unit tests against recorded fixtures |
| `pnpm test:e2e` | `next build` + Playwright (5 specs incl. axe a11y) on **:3777** |
| `pnpm test:e2e:run` | Playwright only, skipping the rebuild |
| `pnpm db:push` | push `db/schema.ts` to Neon (drizzle-kit) |
| `pnpm db:studio` | Drizzle Studio |

### ⚠️ The e2e port gotcha

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`. Locally that means **Playwright will silently reuse whatever is already listening on port 3777** instead of starting its own mocked server.

If you left a dev server or a manual `next start` on :3777, it hijacks the entire e2e run: the tests hit **live upstreams and your real database** instead of the recorded fixtures. The symptoms are confusing — non-deterministic failures, assertions on fixture values failing against real numbers, or the "no live network requests" guard tripping.

**Before running e2e, always:**

```bash
lsof -ti :3777 | xargs kill -9 2>/dev/null; echo ok
```

And kill anything you start on :3777 when you're done. Under CI (`CI=true`) Playwright always starts its own server, so this only bites locally.

The e2e run is deterministic by construction: the web server boots with `WIZARD_DISABLE_DB=1` (no live DB) and `NODE_OPTIONS='--import ./test/e2e/fetch-mock.mjs'` (all server-side upstream fetches served from `test/fixtures/`), and the browser additionally intercepts every `/api/**` call with `test/e2e/fixtures/`. The tests assert that **zero** requests reach a live upstream host — including `api.x.com`.

---

## Operations

### Deployment

Vercel, deployed from `main`. Production env vars are set in the Vercel project. `DATABASE_URL` is injected by the Neon marketplace integration and shows blank in `vercel env pull` because it is marked Sensitive — it is present at runtime.

### The three crons

Vercel Hobby's cron allowance is too coarse, so scheduling lives in **GitHub Actions**. The workflow does nothing but `POST` Bearer-gated routes — all the real work, and every paid API key, stay server-side in the app.

**One schedule drives everything.** `Data crons (every 15 min)` (`7,22,37,52 * * * *`) POSTs all three cron routes in a single job, trades first. Offset off the quarter-hours on purpose: GitHub's scheduler is most congested, and most delayed, at the top of the hour.

| Route | Effect | Runs how often, really |
|---|---|---|
| `POST /api/cron/trades` | pool trade windows → `trades`, deduped on `tx_hash` | **every tick (15 min)** — sets the schedule |
| `POST /api/cron/snapshot` | Helius scan → one `holder_snapshots` row | **≥50 min apart** (route-enforced floor) |
| `POST /api/cron/social` | ~2 X API calls → upsert `x_posts` | **≥4 h apart** (route-enforced floor) |

> **The cadence you care about is in the route, not the cron.** The schedule serves its strictest consumer — the trade archive, whose missed windows are unrecoverable. The other two would only waste money (X is billed per call) or rows (a second holder census in the same hour says nothing new), so each declares its own floor in code and returns `{ "skipped": true }` when a tick arrives early. `?force=1` overrides either. **To change how often X is polled, edit `MIN_POLL_INTERVAL_MS` in `app/api/cron/social/route.ts` — not the cron expression.**

The per-route workflows (`snapshot.yml`, `social.yml`, `trades-archive.yml`) still exist but carry **no schedule** — they are dispatch-only, for debugging and backfill.

Requires, on the repo (Settings → Secrets and variables → Actions):

- **Variable** `SITE_URL` = production origin, e.g. `https://wizard-tower-nu.vercel.app`
- **Secret** `CRON_SECRET` = the *same* value as in Vercel

A `concurrency` group prevents overlapping runs; a non-200 from any route fails the job loudly (`::error::`) and opens a `cron-failure` issue.

**Trigger a run manually:**

```bash
gh workflow run "Data crons (every 15 min)"     # all three routes
gh workflow run "Holder snapshot (manual)"      # or just one
gh workflow run "Prophecy Feed poll (manual)"
gh workflow run "Trade archive (manual)"
```

Or hit the route directly (this spends real API credits):

```bash
curl -i -X POST https://wizard-tower-nu.vercel.app/api/cron/snapshot \
  -H "Authorization: Bearer $CRON_SECRET"
```

The snapshot route responds with a full audit body — holder totals, excluded counts, top-N, HHI, pages scanned, labeled pools/lockers, elapsed ms. Read it; it tells you whether labeling worked.

**Check cron health:**

```bash
gh workflow list                    # both should read "active"
gh run list --limit 20              # recent runs + conclusions
gh run list --workflow="Holder snapshot (hourly)" --limit 10
gh run view <run-id> --log          # the response body is echoed into the log
```

Cron failure modes, in likelihood order:

| Symptom | Cause | Fix |
|---|---|---|
| HTTP 401 | `CRON_SECRET` differs between Vercel and Actions | rotate **both together** — see [Key rotation](#key-rotation) |
| HTTP 503 `database unavailable` | `DATABASE_URL` missing/rotated in Vercel | re-link the Neon integration, redeploy |
| HTTP 502 from snapshot | Helius scan failed (key, quota, timeout) | check the key and the Helius dashboard quota |
| `SITE_URL variable is unset` | Actions Variable missing | add it under Actions → Variables |
| Scheduled runs never appear | GitHub schedule lag | see the note below |

> **GitHub's schedule is best-effort, not a guarantee.** Scheduled workflows only fire from the **default branch**, often do not fire at all for the first period after a repo is pushed, and are routinely delayed under platform load (occasionally by 30+ minutes). A missing run right after setup is usually GitHub, not your config — confirm with a `workflow_dispatch` run first, and only then investigate. GitHub also **disables schedules automatically after 60 days of repository inactivity**; if the crons quietly stop months from now, check that first.

### Knowing when the crons break

Both cron failure modes are covered, because they are genuinely different problems and neither alarm catches the other.

| | **A run failed** | **Runs "succeed" but data is dead** |
|---|---|---|
| Looks like | red X in the Actions tab | all green, chart quietly flat |
| Caught by | `.github/workflows/cron-failure-issue.yml` | `GET /api/health` + the header dot |
| Alerts | a GitHub issue (+ GitHub's own email) | HTTP 503, and the live dot goes stale |

**Why both.** A failure alert can only fire when a run happens *and* fails. If the schedule stops firing at all — the 60-day auto-disable above, or a workflow someone disabled by hand — there is no run, no failure, and no alert. Equally, a run can exit 0 having written nothing: `X_POLL_ENABLED=false` left on, or a 200 that upserted zero rows. Only the data can testify to those, which is what the freshness check reads.

#### A · Failure → a GitHub issue

On a failed run, both cron workflows call the shared reusable workflow `cron-failure-issue.yml`, which opens an issue labelled **`cron-failure`** naming the workflow, the time, and a link to the failed run, with the triage table above inlined. If an open issue for that same workflow already exists it **comments on it instead** — repeat failures do not spam duplicates. The label is created automatically on first use.

One reusable workflow rather than a copy in each cron: the logic exists once, and calling it inline (rather than via a `workflow_run` listener) means the alert shares the failed run's own context, so the link can never point at the wrong run.

> GitHub *already* emails the repo owner when a **scheduled** workflow fails. That email is the fast path; the issue is the durable one — it lives in the repo, survives a filtered inbox, is visible to anyone with access, and carries the triage steps. Treat the issue as the record of truth.

**Close the issue once the cron is green again.** The next failure after that opens a fresh one; leaving it open means the next incident only shows up as a comment on a stale issue.

**Requires** `issues: write`, declared on the calling job in each cron workflow (a called workflow can only narrow the caller's permissions, never widen them). If issue creation fails with 403, check **Settings → Actions → General → Workflow permissions** allows write access.

#### B · Freshness → `GET /api/health`

Reads the database only — no third-party API, two `max()` queries behind a 30s cache. Cheap enough for an uptime monitor or a bot to poll.

```bash
curl -s https://wizard-tower-nu.vercel.app/api/health | jq
```

```json
{
  "status": "ok",
  "dbAvailable": true,
  "feeds": [
    { "key": "holderSnapshots", "status": "ok", "ageHours": 0.4, "warnAfterHours": 6, "failAfterHours": 24 },
    { "key": "xPosts",          "status": "ok", "ageHours": 0.2, "warnAfterHours": 12, "failAfterHours": 36 }
  ],
  "note": "all feeds fresh"
}
```

Per feed and overall: **`ok`** fresh · **`degraded`** past its warn threshold · **`down`** past its fail threshold · **`unknown`** not judgeable (no database, or nothing recorded yet). HTTP status is **200** for ok/degraded/unknown and **503** for down, so a monitor that only reads status codes still catches a real outage. `unknown` never counts as a fault — an alert that fires when it knows nothing is an alert people learn to ignore.

In the UI this is the header's live dot, and nothing else: ember pulsing = fresh, dim mauve = degraded, rose = down, with the literal age in its tooltip and in screen-reader text ("holder snapshots last recorded 9h ago"). Stale states *stop* the pulse rather than adding motion. This is deliberately not duplicated in the cards — their stale banners report an **upstream provider** outage, which is a different fault from **our own pipeline** going quiet.

#### Tuning the thresholds

They live in `config/token.ts` → `THRESHOLDS.freshness`, in hours, with the full reasoning in the comment there:

```ts
freshness: {
  holderSnapshots: { warnHours: 6,  failHours: 24 },
  xPosts:          { warnHours: 12, failHours: 36 },
}
```

These are **much looser than the cron cadence, on purpose** — they are set from measured write intervals on a healthy system, not from the cron expression. Observed gaps while everything worked: **13.4h** between snapshots (an overnight run of GitHub's best-effort scheduler) and **8.9h** between `x_posts` writes. Thresholds at the nominal cadence would have fired on all of them, and an indicator that cries wolf is worse than none.

Two things to understand before tightening them:

- **`x_posts.fetched_at` is not a heartbeat.** The poller is `since_id`-narrowed, so a run that finds no new posts writes nothing and leaves the timestamp untouched. That clock measures "the community posted and we caught it", not "the poller ran" — it goes quiet overnight on a perfectly healthy system, which is why its warn band is 12h and not 30 minutes. Making it a true heartbeat would mean writing a per-run marker (e.g. into `kv_cache`) from the social cron.
- **Loosen freely, tighten only with evidence.** If the dot warns during normal operation, the threshold is wrong, not the pipeline.

#### Testing it

```bash
pnpm test                     # 25 freshness unit tests (test/health.test.ts)
curl -s localhost:3000/api/health | jq   # against your real DATABASE_URL
```

To see the degraded and down states end-to-end, temporarily tighten a threshold in `config/token.ts` below the live data's age (e.g. `warnHours: 0.1`), rebuild, hit `/api/health`, then **put it back**. The unit tests cover fresh / warn / stale / never-recorded / DB-unreachable without touching config.

The failure-issue workflow cannot be tested without a real failing run. To force one safely, run a cron workflow manually with a deliberately broken `SITE_URL` Actions Variable, confirm the issue appears, then restore the variable and close the issue.
### The trade archive

**Why it exists.** GeckoTerminal's `/trades` endpoint is a rolling **window, not a history**: at most **300 trades AND at most 24h**, per pool, whichever binds first. (Measured 2026-07-20: a busy reference pool returned exactly 300 spanning 22 minutes — count-bound; the WIZARD main pool returned 168 spanning exactly 24.0h — time-bound. The older "last ~100 trades" note in this repo was an observation of WIZARD's volume, not the endpoint's limit.) Nothing was persisted, so every 24h figure derived from it was a **lower bound**, which is why unique buyers/sellers were labeled "approximate".

`cron/trades` archives each run's window into `trades`, deduped on `tx_hash`. What lands is exactly what the tape calls one trade: a swap routed across several pools is collapsed by `mergeTrades` to its largest-USD leg *before* insertion, so `pool`/`dex_id` are the swap's dominant venue.

**The honesty rule.** `/api/trades` swaps the window-derived flow for an archive-derived census **only when the archive's oldest row predates the window start**. Until then the approximate numbers and the "~" prefixes stay. There is no in-between: `flowSource` is `"archive"` or `"window"`, and the card reads it directly.

Note the archive reaches full coverage almost immediately, not after 24 hours — the *first* run ingests the upstream's own 24h window, so `since` starts out ~24h in the past. What accrues afterwards is history *beyond* 24h, which is what protects the figures during a volume spike (when the upstream window shrinks to a few hours).

**Verify it:**

```bash
# rows === distinct tx_hash is the dedupe invariant (tx_hash is the PK, so they cannot diverge)
psql "$DATABASE_URL" -c "select count(*), count(distinct tx_hash), min(ts) since, max(ts) latest from trades"

# run it twice, spaced apart: the second run should insert ~0 new rows
curl -s -X POST "$SITE_URL/api/cron/trades" -H "Authorization: Bearer $CRON_SECRET" | jq '{offered,inserted,archive}'

# which source is the flow actually using right now?
curl -s "$SITE_URL/api/trades" | jq '{flowSource, archiveSince, archiveRows, covered: .flow.fullyCovered}'
```

The route's response body is a full audit: `offered` / `inserted`, `archive.rows` vs `archive.distinctTxHash` (with `dedupeHolds`), per-pool trade counts and time ranges, and `gap`.

**Two failure signals to watch for in the logs**, both emitted by the route:

| Log line | Meaning | Fix |
|---|---|---|
| `COVERAGE GAP — no trades archived between …` | More than 300 trades hit one pool between runs, or the cron was down >24h. **Unrecoverable** — that slice is gone from upstream. | Increase the cadence; see below |
| `… returned a FULL 300-trade window` | A pool saturated the window; trades may have been missed | Increase the cadence |

The workflow also raises a `::warning::` annotation when the response contains a gap, so it surfaces in the Actions UI without failing the run (the data that *was* fetched is still archived).

### When a card shows the stale banner

The banner ("last good reading, as of …") means the upstream failed and stale-while-revalidate served the previous data. **This is working as designed** — it is not an outage.

1. Check whether it is one card or all of them. One card = that provider; all = our deploy or network.
2. Hit the route directly: `curl -s https://wizard-tower-nu.vercel.app/api/market | head -c 400`. The envelope's `error` field names the cause.
3. If the GeckoTerminal cards (chart, tape, flow) are stale together, you are likely being throttled — the shared 25/min limiter bailed after its 3s wait. It recovers on its own.
4. It clears itself on the next successful poll. Only intervene if it persists across several intervals, which usually means the upstream changed shape and the zod boundary is rejecting it — check the deploy logs for a validation error, then update the mapper *and* its recorded fixture.

### Cold-start cache behavior — known and expected

The server-side caches are **module-level, in-memory, per serverless instance**. On Vercel that means:

- A cold start begins with an empty cache, so the first request after idle pays a full upstream fetch. First paint after inactivity is slower.
- Instances do not share cache. Two concurrent visitors on different instances can each trigger their own upstream fetch, and can briefly see `dataAsOf` timestamps a few seconds apart.
- The stale-while-revalidate fallback is also per-instance: a fresh instance has no "last good" data to fall back on, so a cold start that coincides with an upstream failure shows the empty state rather than a stale banner.

This is an accepted v1 trade-off ($0 infrastructure, no Redis). The durable stores — `holder_snapshots`, `x_posts`, `kv_cache` — are the parts that genuinely persist, which is why the expensive paths (Helius, X) write to Postgres and the cards read from it.

---

## Key rotation

Four secrets. **Read the whole procedure for a key before starting it** — one of them (`CRON_SECRET`) lives in two systems that must change together.

Where each key lives:

| Key | `.env.local` | Vercel env | GitHub Actions secret |
|---|---|---|---|
| `HELIUS_API_KEY` | ✅ | ✅ | — |
| `X_BEARER_TOKEN` | ✅ | ✅ | — |
| `DATABASE_URL` | ✅ | ✅ (via Neon integration) | — |
| `CRON_SECRET` | ✅ | ✅ | ✅ **← both, together** |

After changing **any** Vercel env var you must **redeploy** — env vars are bound at build/boot, so an existing deployment keeps serving the old value.

### `CRON_SECRET` — the one with a footgun

It is a shared secret between the GitHub workflows (which send it) and the cron routes (which compare it). If the two ever disagree, **both crons 401** and data silently stops updating: holder history develops a gap and the feed goes quiet, while the site itself keeps serving cached market data and looks perfectly healthy. Nothing alerts you except the workflow runs going red.

```bash
NEW=$(openssl rand -hex 32)

# 1. Vercel (all environments)
vercel env rm CRON_SECRET production
echo "$NEW" | vercel env add CRON_SECRET production

# 2. GitHub Actions — the same value
gh secret set CRON_SECRET --body "$NEW"

# 3. Redeploy so the routes pick it up, THEN verify
gh workflow run "Holder snapshot (hourly)"
gh run list --limit 3          # expect success, not 401
```

Do steps 1 and 2 back to back, and redeploy before verifying. There is an unavoidable window between the redeploy and the secret update in which a scheduled run can 401 — harmless (the next hourly run recovers), but do not rotate and walk away; confirm with a manual dispatch. Update `.env.local` too if you run crons locally.

### `HELIUS_API_KEY`

Server-side only; used by the snapshot cron and Mimo's Tribute. Not in GitHub.

1. Create a **new** key in the Helius dashboard (don't revoke the old one yet).
2. Update `.env.local`, then Vercel: `vercel env rm HELIUS_API_KEY production` → `vercel env add HELIUS_API_KEY production`.
3. Redeploy.
4. Verify with a manual snapshot dispatch — a 200 with a sane `scan.owners` count means the new key works.
5. Only then revoke the old key.

### `X_BEARER_TOKEN`

Paid, and the only key that costs money per call. Server-side only; not in GitHub.

1. Set `X_POLL_ENABLED=false` in Vercel and redeploy — this stops all X calls while you swap keys.
2. Regenerate the bearer token in the X developer portal.
3. Update `.env.local` and Vercel, set `X_POLL_ENABLED=true`, redeploy.
4. Manually dispatch the social workflow and read the response — it reports `calls` and `upserted` per run.
5. A wrong token degrades rather than breaks: the Prophecy Feed reads our DB, so it keeps showing buffered posts while the poller fails.

### `DATABASE_URL`

Managed by the **Neon ⟷ Vercel marketplace integration** in production — prefer rotating through Neon/Vercel rather than pasting a string.

1. Rotate the password in the Neon console (or re-provision the integration).
2. Vercel: the integration re-injects the value. If you ever set it manually, update it manually.
3. Redeploy.
4. Update `.env.local` separately for local work.
5. Verify: `curl -s https://wizard-tower-nu.vercel.app/api/holders | head -c 200` should return a census, not `database unavailable`.

A bad `DATABASE_URL` degrades rather than breaks: `getDb()` returns null, the holders and social cards show empty states, and the crons return 503.

---

## Poll cadence tuning

Cadence is set in **three independent places**. Changing one does not change the others — and only the first two cost money or quota.

### 1. Cron cadence (the expensive one) — **two layers, edit the right one**

| Layer | Where | Governs |
|---|---|---|
| The schedule | `.github/workflows/data-crons.yml` → `cron: "7,22,37,52 * * * *"` | how often the **trade archive** ingests. Bound by GeckoTerminal's ≤300-trade window, so this is a correctness limit, not a preference. |
| Per-route floors | `MIN_SNAPSHOT_INTERVAL_MS` in `app/api/cron/snapshot/route.ts` (**50 min**) · `MIN_POLL_INTERVAL_MS` in `app/api/cron/social/route.ts` (**4 h**) | how often the census and the **paid** X poll actually do work. A tick arriving early returns `{ "skipped": true, "calls": 0 }`. |

Raising the schedule speeds up **only** the trade archive. To poll X more or less often, change its floor — that is the number that costs money.

### 2. Server cache TTLs (upstream request rate)

| Constant | File | Value |
|---|---|---|
| `CACHE_TTL_MS` | `lib/sources/dexscreener.ts` | 30s |
| `CACHE_TTL_MS` | `lib/sources/geckoterminal.ts` | 60s |
| `CACHE_TTL_MS` | `lib/sources/gecko-trades.ts` | 30s |
| `CACHE_TTL_MS` | `lib/sources/rugcheck.ts` | 1h |
| `CACHE_TTL_MS` | `lib/sources/creator-fees.ts` | 1h |
| `CACHE_TTL_MS` | `lib/holders.ts` | 60s |
| `CACHE_TTL_MS` | `lib/social.ts` | 60s |
| `CAPACITY` / `MAX_WAIT_MS` | `lib/sources/geckoLimiter.ts` | 25/min · 3s |

The server cache is the real throttle on upstream load: a hundred visitors polling `/api/market` every 30s still produce **one** DexScreener request per 30s per instance.

### 3. Client refetch intervals (browser → our own routes)

`refetchInterval` in `components/cards/use*.ts` — `useMarket` 30s, `useTrades` 30s, `useOhlcv` 60s, `useHolders` 60s, `useSocial` 60s, `useSafety` 10min. All set `refetchIntervalInBackground: false`, so a backgrounded tab stops polling.

**Keep the client interval ≥ the server TTL.** Polling faster than the cache TTL just re-serves the same cached bytes and burns the visitor's battery for nothing. (`useSafety` is deliberately far *slower* than needed — the server cache is 1h anyway.)

### X API cost math

The only pay-per-use source. Current steady state:

```
2 calls/poll  ×  6 polls/day  =  12 calls/day   (floor: 4h, in app/api/cron/social/route.ts)
```

Two calls because the official user id is **pinned** in `config/token.ts` (`X.officialUserId`), so a run spends one call on the official timeline and one on the community search — no username→id lookup. Both are narrowed with `since_id` from `kv_cache`, so a run returns only genuinely new posts. Leave `officialUserId` null and the first run spends one extra bootstrap call, then caches it.

**Cost is inversely proportional to the floor** (`MIN_POLL_INTERVAL_MS`):

| Floor | Polls/day | Calls/day |
|---|---|---|
| 15 min (i.e. every tick) | 96 | **192** |
| 30 min | 48 | **96** |
| 1 h | 24 | **48** |
| **4 h ← current** | **6** | **12** |

Set at 4h on 2026-07-25 to match actual activity: the two feeds together produce ~10 posts/week, so most polls found nothing and paid 2 calls to learn it. Raise it (lower the number) if the token gets busier — the feed's freshness bands in `THRESHOLDS.freshness.xPosts` were widened to 24h/48h to match and should be revisited alongside it.

**Halving the interval doubles the bill.** Before speeding it up, check whether the feed actually moves that fast — a community that posts a few times a day gains nothing from a 15-minute poll.

### Trade archive cadence math

Unlike the X poller, this cron's cadence is not a cost/freshness trade-off — it is a **correctness** constraint. Upstream serves at most 300 trades / 24h per pool, and **whatever falls out of that window before we read it is lost forever.** There is no backfill.

> The rule: **no pool may produce 300 trades between two consecutive runs.**

| | Trades/day (main pool) | Trades/hour | Time to fill 300 |
|---|---|---|---|
| Measured 2026-07-20 | 168 | 7 | **~43 hours** |
| Busiest day observed (2026-03-21, $343K vs $9.8K volume ≈ 35×) | ~5,900 | ~246 | **~73 minutes** |

| Cadence | Trades/interval at that peak | Headroom | Survives GitHub's 30–60 min schedule lag? |
|---|---|---|---|
| `0 * * * *` (hourly) | 246 | 1.2× | ✗ — a 30-min delay alone breaches it |
| `*/30` | 123 | 2.4× | ✓ at 30 min, marginal at 60 |
| **`*/15` ← current** | **61** | **4.9×** | ✓ — 246 < 300 even at a full hour late |

**Cost** (private repo, 2,000 free Actions minutes/month): 96 runs/day = 2,880 runs/month at ~12s each ≈ **576 min/month**, on top of the ~450 min/month the other two crons use ⇒ **~1,030 of 2,000**.

> ⚠️ **Verify this against real billing.** GitHub bills each job **rounded up to the whole minute**. Under that model these 2,880 runs count as 2,880 minutes and the repo's total would *exceed* the free tier. The ~12s figure above is wall-clock, which is how this repo has always accounted for cron cost — but the two models disagree by 5×. Check Settings → Billing after the first full month. If it bites, drop to `*/30` (still 2.4× headroom at the historical peak) rather than hourly.

### Kill switch

Set `X_POLL_ENABLED=false` in Vercel and redeploy. The cron route then returns `{ ok: true, skipped: true, calls: 0 }` — **zero** X API calls, the workflow still goes green (no alert noise), and the Prophecy Feed keeps serving whatever is already buffered in `x_posts`. Use it if billing spikes, a token is compromised, or the X API misbehaves. It is checked before any upstream call, so it is a true hard stop.

---

## Adding a pool label

The **concentration exclusion set** is why the top-10 / HHI / bucket figures mean anything. An AMM pool's vault often holds 10%+ of supply; counting it as a "holder" would make an ordinary token look dangerously concentrated. So pools, lockers and the burn address are **excluded** from the concentration math — while the creator wallet is **labeled but still counted** (a buyer should see it).

### How the set is built

Rebuilt from scratch on **every hourly census**, in `buildLabels()` in `app/api/cron/snapshot/route.ts`:

```
DexScreener pool discovery      market.pools[].pairAddress            → "pool"
  ∪ RugCheck labeled accounts   knownAccounts + markets[].pubkey      → "pool" / "locker"
  ∪ burn address                1nc1nerator1111…                      → "burn"
  ∪ RugCheck creator            (only if not already labeled)         → "creator"
  ∪ MANUAL_LABELS               config/token.ts — wins over all       → any
```

The map is keyed by **owner wallet**, not token account — a pool's WIZARD vault is a token account whose *owner* is the pool address (verified live: the PumpSwap main pool owns its ~12.9% vault).

What each label does (`lib/metrics/concentration.ts`):

| Label | Top-N bars · HHI · buckets | Top-20 table |
|---|---|---|
| `pool` `locker` `burn` | **excluded** | shown, badged, marked excluded |
| `creator` | **included** | shown, badged |
| (unlabeled) | included | shown |

The top-20 table always lists everything, so nothing is hidden; only the *statistics* exclude. The raw un-excluded top-N is computed too, so the card can show how much the pools inflate the naive figure.

### Adding one manually

Discovery covers every pool we have observed, so `MANUAL_LABELS` is empty for $WIZARD. Add an entry when an account is provably protocol-owned but no upstream labels it — a brand-new AMM, a locker contract, a bridge or CEX vault — or to correct a wrong label.

1. **Get evidence first.** Open the account on Solscan and confirm what it actually is. Labeling a large *real* holder as a pool would silently understate concentration — the exact dishonesty this dashboard exists to avoid. If you are not sure, don't.
2. Add it to `MANUAL_LABELS` in **`config/token.ts`**, with a comment saying why:

   ```ts
   export const MANUAL_LABELS: Record<string, "pool" | "locker" | "burn" | "creator"> = {
     "9xQeWvG8...": "pool", // Orca whirlpool, opened 2026-08; not in RugCheck markets yet
   };
   ```

3. Deploy, then dispatch a snapshot run: `gh workflow run "Holder snapshot (hourly)"`.
4. Verify in the response body — `scan.labeledPools` / `scan.labeledLockers` should increment, and `snapshot.top10Pct` should drop relative to `snapshot.top10PctRaw`.

Labels apply **going forward only**: existing `holder_snapshots` rows keep the numbers they were computed with. The history will not retroactively correct itself, which is deliberate — stored snapshots are immutable records of what we measured at the time.

---

## Retargeting to a different token

This dashboard is a **reusable template**; $WIZARD is its first deployment. Everything token-specific is in **`config/token.ts`** — that is the whole point, and a rule worth defending: if you find yourself hardcoding an address, a threshold or a handle anywhere else, it belongs in the config instead.

To point it at another Solana token:

1. **`TOKEN`** — `mint`, `symbol`, `name`, `decimals`, `supply`, `chain`, and `mainPool` (the primary pool address; the rest are discovered dynamically).
2. **`LINKS`** — site, socials, buy links, explorers. Most are derived from the mint, so they update themselves.
3. **`X`** — `officialUsername`, `officialUserId` (pin it; saves a call per run), `communityId`, `communityQuery`.
4. **`THRESHOLDS`** — the safety bands and the five-axis verdict rubric. **Re-read these**; bands tuned for a young memecoin are wrong for a large-cap.
5. **`MANUAL_LABELS`** — usually empty to start.
6. Re-record fixtures (`test/fixtures/`) if you want the unit tests to reflect the new token, and update `test/e2e/fixtures/` for the Playwright run.
7. `pnpm db:push` against a fresh Neon database — holder history is per-token and not retroactive, so a new deployment starts its chart from day one.

What is *not* configurable and would need code: non-Solana chains (every source module assumes Solana), and the module set itself (`app/page.tsx` composes the bento explicitly).

---

## Known limitations

Honest caveats. Several are surfaced in the UI too — the dashboard's whole premise is that it says what it doesn't know.

- **Holder history is not retroactive.** The chart starts at the **first snapshot we ever recorded**, not at token launch — we can only record from the moment the cron started running. Δ7d and Δ30d render `—` until enough history exists. The card carries a "recorded since <date>" banner. A paid backfill is possible but was never budgeted.
- **ATH is a "high since", not an all-time high.** The Wizard's Ledger now shows **$0.0009331 (2026-05-20)**, computed as the maximum daily high across the main pool's full candle history — 131 candles back to **2026-03-11**, which is the day DexScreener reports the pool was created, so the series spans the pool's entire life. It does **not** span $WIZARD's earlier pump.fun bonding-curve phase (the mint ends in `pump`), which no source we have indexes. The card therefore labels it **"ATH · since 11 Mar 2026"** and never claims an unqualified all-time high. It comes from GeckoTerminal daily OHLCV, *not* from the trade archive — the archive only knows prices since archiving began, so its maximum would be a "high since last Tuesday" masquerading as an ATH.
  - Prior research (2026-07-17) recorded ATH ≈ **$0.0003529**. **It does not agree** and is treated as superseded: $0.0009331 is corroborated by that day's *hourly* candles (07:00 UTC high 9.3307e-4 on $9.5k volume, $41.7k the next hour, neighbouring hours in the 8e-4 range — a sustained level, not a wick), while $0.0003529 matches no maximum we could reproduce on any of the four pools over any trailing 7/14/30/60/90-day window as of either date. Regression-tested in `test/ath.test.ts`.
  - `TF_MAP["1d"]` fetches `limit: 1000` (not 180) specifically so this stays true — a truncated window would make a displayed "ATH" silently *drop* over time.
- **The Coven tab is an approximation.** The `community_id:` search operator is **gated on our X API tier** (candidate A returned HTTP 400 — recorded in `test/fixtures/x-community-A-rejected.json`). The tab therefore runs a cashtag/phrase search (`"smoking wizard" OR $WIZARD -is:retweet`) and shows *mentions*, not the literal community member feed. The UI says so. The decision log is in `lib/sources/x.ts`. If the tier is ever upgraded, switch `X.communityQuery` to the `community_id:` operator.
- **Mimo's Tribute shows no cumulative total, deliberately.** RugCheck's `creator` (`3ecXTre9…AAkM`) is **not a personal wallet** — it is a pump.fun fee-share *program* account (owner `pfeeUxB6…VojVZ`, independently verified) that splits fees 50/50 between two unidentified wallets, with a third wallet having received 124.65 SOL under an earlier config. The arithmetic reconciles with pump.fun's own display (823.76 vs 824 SOL — 0.03%); **the blocker is attribution, not math.** We can prove fees flowed; we cannot prove *to whom*. So the card ships as an honest link-out showing the fee route structurally, with no money total. The full method is documented in the header of `lib/sources/creator-fees.ts`. Do not add a total unless the recipient wallets are independently identified.
- **The Origin Scroll's "100% of creator fees flow to Mimo's wallet" is under review.** That line predates the research above, which found the destination to be a fee-share program splitting to unidentified wallets. **The claim is not currently verifiable on-chain** and is being revised separately. Treat it as unverified until that lands.
- **Concentration is only as good as the labels.** If a new AMM appears that neither DexScreener nor RugCheck labels, its vault counts as a holder and inflates the top-10 figure until someone adds a [manual label](#adding-a-pool-label).
- **GeckoTerminal is a single point of failure** for the chart, the trade tape, Flow of Mana and the ATH figure. Accepted for v1 and documented in the plan's risk table. If it throttles, those cards go stale together — though the trade archive now cushions this: the 24h flow figures keep working from our own DB even while the live tape is stale.
- **Unique buyer/seller counts are approximate *only until the archive covers the window*.** They used to be permanently approximate (read off the upstream's rolling window — which is ≤300 trades / ≤24h per pool, not "~100 trades" as previously documented). Since M10 they are counted from our own `trades` table whenever it spans the full 24h, and the UI drops the "~" and says "counted from our own trade archive · recorded since <date>". When it does *not* span the window — right after a deploy, or after a gap — the "~" and the "approximate" wording come straight back. `flowSource` in `/api/trades` tells you which is live.
  - **What remains:** the archive is **not retroactive** (same caveat as holder history — it starts at the first cron run), and a gap longer than the upstream window is **unrecoverable**. The route detects and logs both; see [The trade archive](#the-trade-archive).
- **In-memory caches don't survive cold starts or span instances.** See [cold-start behavior](#cold-start-cache-behavior--known-and-expected).
- **Vercel Hobby is non-commercial.** Fine for a community dashboard; revisit if referral or affiliate links are ever added.
- **The Verdict is a rubric, not an oracle.** Every axis shows its inputs and thresholds inline precisely so it can be argued with. The thresholds are judgement calls, and they live in `config/token.ts`.

---

## What's still on you

- **Custom domain — not set up.** No domain has been chosen. When you pick one: add it in Vercel → Project → Domains, point DNS at Vercel, then update **`NEXT_PUBLIC_SITE_URL`** (canonical + OG URLs) *and* the GitHub Actions **`SITE_URL`** variable, and redeploy. Entirely optional — the `.vercel.app` URL works fine.
- **X API polling is floored at 4 hours inside the route**, not by the cron schedule. The shared cron ticks every 15 minutes because the trade archive needs it, but X is the one paid upstream (2 calls/run, ~12 calls/day at this floor), so `/api/cron/social` skips a tick that arrives too soon and logs `calls: 0`. `?force=1` overrides. The holder census does the same at 50 minutes. If you change the cron cadence, these floors are what actually govern cost and row growth.
- **Watch the first 24h of crons.** The snapshot and social workflows are active and have succeeded end to end (Actions → prod route → Helius → Neon). Confirm the *scheduled* runs land too: `gh run list --limit 20`. See the schedule-lag note in [Operations](#the-three-crons).
- **The trade archive workflow is new and has never run on a schedule.** `trades-archive.yml` needs no new secrets (it reuses `SITE_URL` + `CRON_SECRET`), but confirm the first scheduled runs land — a missed window is unrecoverable. Watch for `COVERAGE GAP` in the run logs, and re-check the Actions minutes bill after a full month against the [cadence math](#trade-archive-cadence-math).
- **Revisit the Origin Scroll copy** once the creator-fee attribution review concludes.

---

*Community-built, unofficial, informational only. Not financial advice. DYOR.*
