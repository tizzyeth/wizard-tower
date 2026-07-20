import { CardFrame } from "@/components/wizard/CardFrame";
import { GrainOverlay } from "@/components/wizard/GrainOverlay";
import { CommandPalette } from "@/components/wizard/CommandPalette";
import { SiteFooter } from "@/components/footer/SiteFooter";
import { SiteHeader } from "@/components/header/SiteHeader";
import { WizardsLedger } from "@/components/cards/WizardsLedger";
import { TheCauldrons } from "@/components/cards/TheCauldrons";
import { TheScryingGlass } from "@/components/cards/TheScryingGlass";
import { TheLedgerOfDeeds } from "@/components/cards/TheLedgerOfDeeds";
import { FlowOfMana } from "@/components/cards/FlowOfMana";
import { WardsAndProtections } from "@/components/cards/WardsAndProtections";
import { TheWizardsVerdict } from "@/components/cards/TheWizardsVerdict";
import { TheProphecyFeed } from "@/components/cards/TheProphecyFeed";
import { CouncilOfHolders } from "@/components/cards/CouncilOfHolders";
import { MimosTribute } from "@/components/cards/MimosTribute";
import { getMarket } from "@/lib/sources/dexscreener";
import { getCreatorFeeRoute } from "@/lib/sources/creator-fees";
import { getOhlcv, DEFAULT_TIMEFRAME } from "@/lib/sources/geckoterminal";
import { activePoolsFromMarket } from "@/lib/sources/gecko-trades";
import { getTradesWithArchive } from "@/lib/trades-archive";
import { getSafety } from "@/lib/sources/rugcheck";
import { getHolders } from "@/lib/holders";
import { getHealth } from "@/lib/health";
import { getSocial, getPostingCadence } from "@/lib/social";
import { computeAth } from "@/lib/metrics/ath";
import { LINKS, TOKEN } from "@/config/token";

// Live market data: fetch the initial snapshot on the server so the page paints
// real numbers with no skeleton flash; the cards keep it live from there (30s).
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Dev-only fault injection (`/?fault=1`) to prove the stale banner renders the
  // last-good snapshot instead of a blank card. Ignored in production.
  const fault =
    process.env.NODE_ENV !== "production" && (await searchParams).fault === "1";
  const initialMarket = await getMarket(
    fault ? { simulateFailure: true, forceRefresh: true } : undefined,
  );

  // Seed the Scrying Glass with the default series (primary pool · 1h) so the
  // chart paints real candles without a skeleton flash. Same pool the card
  // defaults to, so the client query adopts this seed instead of refetching.
  const seedPool =
    initialMarket.data?.pools.find((p) => p.isPrimary)?.pairAddress ??
    TOKEN.mainPool;
  const initialOhlcv = await getOhlcv({
    pool: seedPool,
    timeframe: DEFAULT_TIMEFRAME,
    forceRefresh: fault,
    simulateFailure: fault,
  });

  // Seed the M3 cards on the server so the tape + flow paint real deeds with no
  // skeleton flash. The trade tape merges every active pool; Flow of Mana's 30d
  // volume bars reuse the daily OHLCV series (tf=1d) for the primary pool.
  // M10: `getTradesWithArchive` serves the same tape, but swaps in an archive-backed
  // 24h flow census once our own `trades` table covers the whole window (and says so
  // via flowSource/archiveSince). Before that it is the live window, unchanged.
  const initialTrades = await getTradesWithArchive({
    pools: activePoolsFromMarket(initialMarket),
    forceRefresh: fault,
    simulateFailure: fault,
  });
  const initialDaily = await getOhlcv({
    pool: seedPool,
    timeframe: "1d",
    forceRefresh: fault,
    simulateFailure: fault,
  });

  // M10: ATH from the daily series that is already fetched above — no extra call.
  // It is a max over the main pool's whole indexed life, which begins at the pool's
  // creation and NOT at the token's pump.fun launch, so the card labels it
  // "ATH (since <date>)" rather than claiming an absolute high. Null → the card
  // keeps its honest em-dash.
  const ath = computeAth(initialDaily.data?.candles ?? []);

  // Seed Wards & Protections on the server so the runes paint with no skeleton
  // flash (RugCheck report, 1h server cache). Token age for the card comes from
  // the market's earliest pool creation (already computed by DexScreener).
  const initialSafety = await getSafety(
    fault ? { simulateFailure: true, forceRefresh: true } : undefined,
  );
  // Mimo's Tribute (M9): resolve the creator-fee route from the creator account
  // RugCheck reports — nothing about the route is hardcoded. Structural data only
  // (who the fee splits between), never a money total; see the reasoning in
  // lib/sources/creator-fees.ts. Degrades to the static explainer if unreadable.
  const creatorFeeRoute = await getCreatorFeeRoute(initialSafety.data?.creator ?? null);

  // Seed the Council of Holders from the latest snapshot in our DB (hourly cron).
  // Reads DB only — null (no snapshot yet / no DB) renders the honest empty state.
  const initialHolders = await getHolders();
  const launchedAt = initialMarket.data?.launchedAt ?? null;

  // Seed both Prophecy Feed tabs from our DB (filled by the 30-min social poller).
  // Reads DB only — no X API on a page load. Also read posting cadence for the
  // Verdict's Community axis (M6 hookup) so the axis joins the roll-up.
  // Cron freshness for the header's live dot (lib/health.ts). Joins this Promise.all
  // so it costs no extra serial round-trip, and it can never reject or block the
  // render — an unreadable database yields an `unknown` report, not a throw.
  const [initialOfficial, initialCommunity, cadence, health] = await Promise.all([
    getSocial("official"),
    getSocial("community"),
    getPostingCadence(),
    getHealth(),
  ]);

  return (
    <>
      <GrainOverlay />
      <CommandPalette />
      <SiteHeader initialMarket={initialMarket} health={health} />

      <main
        id="top"
        className="mx-auto grid w-full max-w-7xl grid-cols-12 gap-4 px-4 py-6 md:px-6"
      >
        {/* Page heading — visually the bento speaks for itself; this names the
            page for screen readers and SEO (the cards carry the h2s below it). */}
        <h1 className="sr-only">
          The Wizard’s Tower — live $WIZARD due-diligence terminal on Solana
        </h1>

        {/* 1 · The Wizard's Ledger — hero market card (live · M1 + holder count M4) */}
        <WizardsLedger
          initial={initialMarket}
          initialHolders={initialHolders}
          ath={ath}
          className="col-span-12"
        />

        {/* 2 · The Scrying Glass — price chart (live · M2) */}
        <TheScryingGlass
          initialMarket={initialMarket}
          initialOhlcv={initialOhlcv}
          className="col-span-12 lg:col-span-8"
        />

        {/* 3 · Council of Holders — holder distribution & concentration (live · M4) */}
        <CouncilOfHolders initial={initialHolders} className="col-span-12 lg:col-span-4" />

        {/* 4 · The Cauldrons — pools & liquidity (live · M1) */}
        <TheCauldrons
          initial={initialMarket}
          initialSafety={initialSafety}
          className="col-span-12 lg:col-span-6"
        />

        {/* 5 · The Ledger of Deeds — unified trade tape (live · M3) */}
        <TheLedgerOfDeeds initial={initialTrades} className="col-span-12 lg:col-span-6" />

        {/* 6 · Flow of Mana — volume & momentum (live · M3) */}
        <FlowOfMana
          initialTrades={initialTrades}
          initialDaily={initialDaily}
          pool={seedPool}
          className="col-span-12 lg:col-span-5"
        />

        {/* 7 · Wards & Protections — safety checklist (live · M5) */}
        <WardsAndProtections
          initial={initialSafety}
          initialHolders={initialHolders}
          launchedAt={launchedAt}
          className="col-span-12 lg:col-span-7"
        />

        {/* 8 · The Prophecy Feed — X posts (live · M6) */}
        <TheProphecyFeed
          initialOfficial={initialOfficial}
          initialCommunity={initialCommunity}
          className="col-span-12 lg:col-span-7"
        />

        {/* 9 · The Origin Scroll — lore/about (static, real copy) */}
        <CardFrame
          id="origin"
          title="The Origin Scroll"
          subtitle="what $WIZARD actually is"
          className="col-span-12 lg:col-span-5"
        >
          <div className="space-y-3 text-sm leading-relaxed">
            <p>
              Wizardcore is the creation of{" "}
              <a
                href={LINKS.tiktok}
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-soft underline decoration-violet/40 underline-offset-2 transition-colors hover:text-ink"
              >
                Mimo (@mimofrl)
              </a>{" "}
              — wizard videos since 2022, over 1.3&nbsp;billion views across
              1,900+ videos.
            </p>
            <p>
              $WIZARD launched on pump.fun. After the original deployer was
              suspended on X, the community took the token over. Creator fees
              are{" "}
              <span className="text-violet-soft">
                split 50/50 between two wallets
              </span>{" "}
              — the community says one is Mimo’s and one is the token team’s,
              but the chain can’t confirm who owns them. See Mimo’s Tribute
              below for the full route the money takes.
            </p>
            <p className="text-muted">
              Buying $WIZARD is buying a creator-aligned memecoin: volatile,
              speculative, and it can go to zero. This page exists so you can
              see the facts first.
            </p>
          </div>
        </CardFrame>

        {/* 10 · Mimo's Tribute — creator-fee route (M9, link-out variant) */}
        <MimosTribute route={creatorFeeRoute} className="col-span-12 lg:col-span-5" />

        {/* 11 · The Wizard's Verdict — gold rubric callout (live · M7) */}
        <TheWizardsVerdict
          initialMarket={initialMarket}
          initialSafety={initialSafety}
          initialTrades={initialTrades}
          initialDaily={initialDaily}
          initialHolders={initialHolders}
          initialCadence={cadence}
          launchedAt={launchedAt}
          pool={seedPool}
          className="col-span-12 lg:col-span-7"
        />
      </main>

      <SiteFooter />
    </>
  );
}
