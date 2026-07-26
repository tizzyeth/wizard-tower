/**
 * Shareable card data — IMPLEMENTATION_PLAN.md §10 ("per-card share-as-image").
 *
 * A screenshot of a module leaves the page and has to survive on its own: the
 * reader has none of the surrounding bento, no source attribution, no
 * disclaimer. So each share card carries its own headline, its own supporting
 * numbers, and a footnote saying what the number means and where it came from.
 *
 * This module only SHAPES data; `app/share/[card]/route.tsx` draws it. Keeping
 * them apart means the wording and the number formatting are unit-testable
 * without rendering a PNG, and one renderer styles every card identically.
 *
 * Only four modules are shareable, and deliberately so: these four answer a
 * question on their own. A candle chart or a trade tape flattened to a still
 * image says less than the screenshot someone would take anyway.
 */

import { TOKEN } from "@/config/token";
import { getMarket } from "@/lib/sources/dexscreener";
import { getSafety } from "@/lib/sources/rugcheck";
import { getHolders } from "@/lib/holders";
import { getPostingCadence } from "@/lib/social";
import { getOhlcv } from "@/lib/sources/geckoterminal";
import { activePoolsFromMarket } from "@/lib/sources/gecko-trades";
import { getTradesWithArchive } from "@/lib/trades-archive";
import { evaluateChecklist } from "@/lib/metrics/safety";
import { computeVerdict, avgDailyVolume, BAND_LABEL } from "@/lib/metrics/verdict";
import { computeAth } from "@/lib/metrics/ath";
import { fmtPrice, fmtUsdCompact, fmtInt, fmtPct, fmtMonthUtc } from "@/lib/format";

export const SHARE_CARDS = ["verdict", "ledger", "holders", "wards", "flow"] as const;
export type ShareCardSlug = (typeof SHARE_CARDS)[number];

export function isShareCard(value: string): value is ShareCardSlug {
  return (SHARE_CARDS as readonly string[]).includes(value);
}

export type ShareStat = {
  label: string;
  value: string;
  /** Colours the value. Reserved semantics: green = good/buys, rose = bad/sells. */
  tone?: "default" | "green" | "rose" | "gold";
};

export type ShareCard = {
  slug: ShareCardSlug;
  /** The module's lore name — what the reader is looking at. */
  eyebrow: string;
  /** The one number the card exists to show. */
  headline: string;
  /** Qualifies the headline, e.g. "STRONG · 5 of 5 wards speak". */
  headlineNote?: string;
  headlineTone?: ShareStat["tone"];
  /** Supporting figures, 3–4 of them; more than that stops being readable at a glance. */
  stats: ShareStat[];
  /** What the number means and where it came from — the card's honesty line. */
  footnote: string;
};

/** Human title used for the file name and the image's alt text. */
export const SHARE_TITLES: Record<ShareCardSlug, string> = {
  verdict: "The Wizard’s Verdict",
  ledger: "The Wizard’s Ledger",
  holders: "Council of Holders",
  wards: "Wards & Protections",
  flow: "Flow of Mana",
};

const dash = "—";

/**
 * Trim a checklist label to something that fits one line in a share tile. The
 * page has room for "Mint authority revoked"; a 1200×630 image split four ways
 * does not, and the tile's value says "revoked" right underneath anyway.
 */
function shorten(label: string): string {
  return label
    .replace(/\s+revoked$/i, "")
    .replace(/^Top-10 concentration$/i, "Top-10 held")
    .replace(/^RugCheck risks$/i, "RugCheck");
}

export async function buildShareCard(slug: ShareCardSlug): Promise<ShareCard> {
  switch (slug) {
    case "ledger":
      return buildLedger();
    case "holders":
      return buildHolders();
    case "wards":
      return buildWards();
    case "verdict":
      return buildVerdict();
    case "flow":
      return buildFlow();
  }
}

async function buildFlow(): Promise<ShareCard> {
  const market = await getMarket();
  const trades = await getTradesWithArchive({ pools: activePoolsFromMarket(market) });
  const flow = trades.flow;
  // The window's own counts are a lower bound until our archive covers the full
  // 24h; the "~" and the footnote say so rather than quietly presenting them as
  // a census (same rule the card on the page follows).
  const counted = !!flow?.fullyCovered;
  const approx = counted ? "" : "~";
  const net = flow?.netUsd ?? null;

  return {
    slug: "flow",
    eyebrow: SHARE_TITLES.flow,
    headline: flow ? fmtUsdCompact(flow.totalUsd) : dash,
    headlineNote: "traded in 24h",
    stats: [
      {
        // Count rides in the label so the value stays one line — two lines here
        // push the footer off a 630px canvas.
        label: flow ? `Buys · ${fmtInt(flow.buyCount)}` : "Buys",
        value: flow ? fmtUsdCompact(flow.buyUsd) : dash,
        tone: "green",
      },
      {
        label: flow ? `Sells · ${fmtInt(flow.sellCount)}` : "Sells",
        value: flow ? fmtUsdCompact(flow.sellUsd) : dash,
        tone: "rose",
      },
      {
        label: "Net flow",
        value: net == null ? dash : `${net >= 0 ? "+" : "−"}${fmtUsdCompact(Math.abs(net))}`,
        tone: net == null ? "default" : net >= 0 ? "green" : "rose",
      },
      {
        label: "Traders",
        value: flow ? `${approx}${fmtInt(flow.uniqueTraders)}` : dash,
      },
    ],
    footnote: counted
      ? "Every trade across all active pools, deduplicated by transaction and counted from our own archive."
      : "Trades across all active pools, deduplicated by transaction. Counts marked ~ are a lower bound — our archive does not yet cover the whole window.",
  };
}

async function buildLedger(): Promise<ShareCard> {
  const [market, holders] = await Promise.all([getMarket(), getHolders()]);
  const m = market.data;
  const pools = activePoolsFromMarket(market);
  const daily = await getOhlcv({ pool: pools[0]?.pool ?? TOKEN.mainPool, timeframe: "1d" });
  const ath = computeAth(daily.data?.candles ?? []);

  return {
    slug: "ledger",
    eyebrow: SHARE_TITLES.ledger,
    headline: m ? fmtPrice(m.priceUsd) : dash,
    headlineNote: m ? `${fmtPct(m.priceChange.h24)} in 24h` : undefined,
    headlineTone: !m ? "default" : (m.priceChange.h24 ?? 0) >= 0 ? "green" : "rose",
    stats: [
      { label: "Market cap", value: m ? fmtUsdCompact(m.marketCap) : dash },
      { label: "Liquidity", value: m ? fmtUsdCompact(m.totalLiquidityUsd) : dash },
      { label: "24h volume", value: m ? fmtUsdCompact(m.volumeH24Usd) : dash },
      {
        label: "Holders",
        value: holders.data ? fmtInt(holders.data.totalHolders) : dash,
      },
    ],
    footnote: ath
      ? `ATH ${fmtPrice(ath.priceUsd)} since ${fmtMonthUtc(ath.sinceMs)} · price and liquidity from DexScreener, holders from our own on-chain census`
      : "Price and liquidity from DexScreener; holders from our own on-chain census",
  };
}

async function buildHolders(): Promise<ShareCard> {
  const h = (await getHolders()).data;
  const top10 = h?.top10Pct ?? null;

  return {
    slug: "holders",
    eyebrow: SHARE_TITLES.holders,
    headline: h ? fmtInt(h.totalHolders) : dash,
    headlineNote: "holders",
    stats: [
      { label: "Top 10 hold", value: top10 == null ? dash : `${top10.toFixed(1)}%` },
      { label: "Top 20 hold", value: h?.top20Pct == null ? dash : `${h.top20Pct.toFixed(1)}%` },
      {
        label: "Concentration",
        value: h?.hhi == null ? dash : Math.round(h.hhi).toString(),
        tone: h?.hhi != null && h.hhi < 1500 ? "green" : "gold",
      },
      {
        label: "Wallets under $10",
        value: h ? fmtInt(h.buckets?.find((b) => b.key === "u10")?.count ?? 0) : dash,
      },
    ],
    footnote:
      "Counted from a full on-chain scan, hourly. AMM pools, lockers and the burn address are excluded from the concentration figures.",
  };
}

async function buildWards(): Promise<ShareCard> {
  const [safety, market, holders] = await Promise.all([getSafety(), getMarket(), getHolders()]);
  const checklist = safety.data
    ? evaluateChecklist(safety.data, {
        launchedAt: market.data?.launchedAt ?? null,
        refinedTop10: holders.data
          ? { pct: holders.data.top10Pct, excludedCount: holders.data.excludedCount ?? null }
          : null,
      })
    : null;

  const passed = checklist?.checks.filter((r) => r.status === "pass").length ?? 0;
  const total = checklist?.checks.length ?? 0;
  const failed = checklist?.checks.filter((r) => r.status === "fail").length ?? 0;

  return {
    slug: "wards",
    eyebrow: SHARE_TITLES.wards,
    headline: total ? `${passed} / ${total}` : dash,
    headlineNote: total
      ? failed
        ? `wards hold · ${failed} failing`
        : "wards hold · none failing"
      : undefined,
    headlineTone: failed ? "rose" : "green",
    stats: (checklist?.checks ?? []).slice(0, 4).map((row) => ({
      // The row's own value already says "revoked" / "93.9%", so the label must
      // not repeat it — a two-line label pushes the footer off a 630px canvas.
      label: shorten(row.label),
      value: row.measured || dash,
      tone: row.status === "pass" ? "green" : row.status === "fail" ? "rose" : "gold",
    })),
    footnote:
      "Each ward shows what it measured and the threshold it was judged against. Sources: RugCheck and a full on-chain holder scan.",
  };
}

async function buildVerdict(): Promise<ShareCard> {
  const [market, safety, holders, cadence] = await Promise.all([
    getMarket(),
    getSafety(),
    getHolders(),
    getPostingCadence(),
  ]);
  const pools = activePoolsFromMarket(market);
  const [daily, trades] = await Promise.all([
    getOhlcv({ pool: pools[0]?.pool ?? TOKEN.mainPool, timeframe: "1d" }),
    getTradesWithArchive({ pools }),
  ]);

  const checklist = safety.data
    ? evaluateChecklist(safety.data, {
        launchedAt: market.data?.launchedAt ?? null,
        refinedTop10: holders.data
          ? { pct: holders.data.top10Pct, excludedCount: holders.data.excludedCount ?? null }
          : null,
      })
    : null;

  const verdict = computeVerdict({
    safetyChecklist: checklist,
    distribution: holders.data
      ? {
          top10Pct: holders.data.top10Pct,
          hhiTop20: holders.data.hhi,
          sampleSize: holders.data.countedHolders ?? holders.data.totalHolders,
          windowed: false,
        }
      : null,
    liquidity: market.data
      ? { totalLiquidityUsd: market.data.totalLiquidityUsd, liqToMcap: market.data.liqToMcap }
      : null,
    activity:
      market.data && trades.flow
        ? {
            volume24hUsd: market.data.volumeH24Usd,
            avgDailyVolume30d: avgDailyVolume(daily.data?.candles ?? []),
            uniqueTraders24h: trades.flow.uniqueTraders,
            fullyCovered: trades.flow.fullyCovered,
            source: trades.flowSource,
          }
        : null,
    community: { postingCadence: cadence.perWeek },
  });

  return {
    slug: "verdict",
    eyebrow: SHARE_TITLES.verdict,
    headline: verdict.score == null ? dash : `${Math.round(verdict.score)} / 100`,
    headlineNote: verdict.band
      ? `${BAND_LABEL[verdict.band]} · ${verdict.summary}`
      : verdict.summary,
    headlineTone: "gold",
    // Four axes fit; the fifth is usually the one still awaiting data, and the
    // footnote says so rather than showing an empty row.
    stats: verdict.axes.slice(0, 4).map((axis) => ({
      label: axis.label,
      value: axis.status === "scored" && axis.score != null ? `${Math.round(axis.score)}` : "awaiting",
      tone:
        axis.status !== "scored"
          ? "default"
          : (axis.score ?? 0) >= 75
            ? "green"
            : (axis.score ?? 0) >= 45
              ? "gold"
              : "rose",
    })),
    footnote: `A transparent rubric, not an oracle — ${verdict.summary}, each axis scored against thresholds published in the open. Informational only, not financial advice.`,
  };
}
