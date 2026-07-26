/**
 * GET /share/<card> — a shareable PNG of one module, drawn from live data
 * (IMPLEMENTATION_PLAN.md §10, "per-card share-as-image").
 *
 * 1200×630 because that is the card size X and Telegram crop to; anything else
 * gets letterboxed in the place these are actually posted.
 *
 * One renderer for every card: `lib/share/cards.ts` shapes the numbers and the
 * wording, this file only draws them. That keeps the four cards visually
 * identical and makes the copy testable without rendering an image.
 *
 * satori (behind ImageResponse) constraints, learned the hard way in
 * `app/opengraph-image.tsx` and unchanged here:
 *   • flexbox only — no grid, and EVERY container needs an explicit display:flex
 *   • the bundled typeface only; a Unicode dingbat (✦ ✳ ◆) makes satori try to
 *     fetch a font per glyph, which is flaky and network-dependent. Ornaments
 *     are therefore drawn as rotated squares.
 *
 * Cached at the edge for a minute: these are posted in bursts (one person
 * shares, several open it), and a minute keeps the numbers honest while
 * absorbing that burst.
 */

import { ImageResponse } from "next/og";
import { TOKEN } from "@/config/token";
import {
  buildShareCard,
  isShareCard,
  SHARE_CARDS,
  type ShareStat,
} from "@/lib/share/cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 };

// Wizardcore palette (§3), inlined — satori cannot read CSS tokens.
const CANVAS = "#120C15";
const PANEL = "#1A1321";
const INK = "#F4EFF6";
const MUTED = "#9C8BA3";
const AMETHYST = "#A863D4";
const AMETHYST_SOFT = "#CFA6EA";
const GREEN = "#86EFAC";
const ROSE = "#FB7185";
const GOLD = "#EAB308";

const TONE: Record<NonNullable<ShareStat["tone"]>, string> = {
  default: INK,
  green: GREEN,
  rose: ROSE,
  gold: GOLD,
};

/** The Wizardcore diamond, drawn as a rotated square — never a font glyph. */
function Diamond({ size = 12, color = AMETHYST, opacity = 1 }: { size?: number; color?: string; opacity?: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        backgroundColor: color,
        opacity,
        transform: "rotate(45deg)",
        borderRadius: 2,
      }}
    />
  );
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ card: string }> },
) {
  const { card: slug } = await ctx.params;
  if (!isShareCard(slug)) {
    return Response.json(
      { ok: false, error: `unknown card`, available: SHARE_CARDS },
      { status: 404 },
    );
  }

  const card = await buildShareCard(slug);
  const headlineColor = TONE[card.headlineTone ?? "default"];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundColor: CANVAS,
          backgroundImage:
            "radial-gradient(900px 620px at 88% -12%, rgba(110,36,150,0.34), transparent 62%), radial-gradient(900px 700px at -8% 112%, rgba(110,36,150,0.22), transparent 62%), radial-gradient(680px 380px at 55% 118%, rgba(255,130,60,0.10), transparent 60%)",
          padding: "54px 64px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Corner ornaments */}
        {[
          { top: 32, left: 40 },
          { top: 32, right: 40 },
          { bottom: 32, left: 40 },
          { bottom: 32, right: 40 },
        ].map((pos, i) => (
          <div key={i} style={{ position: "absolute", display: "flex", ...pos }}>
            <Diamond size={14} color={AMETHYST_SOFT} opacity={0.5} />
          </div>
        ))}

        {/* Which module this is, and which token */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: AMETHYST,
              fontSize: 22,
              letterSpacing: 6,
              textTransform: "uppercase",
            }}
          >
            <Diamond size={10} color={AMETHYST} />
            <span style={{ display: "flex" }}>{card.eyebrow}</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: PANEL,
              border: "1px solid rgba(168,99,212,0.4)",
              borderRadius: 8,
              padding: "6px 16px",
              color: AMETHYST_SOFT,
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            ${TOKEN.symbol}
          </div>
        </div>

        {/* The number the card exists to show */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
          <div
            style={{
              display: "flex",
              color: headlineColor,
              fontSize: 118,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: -2,
            }}
          >
            {card.headline}
          </div>
          {card.headlineNote && (
            <div style={{ display: "flex", marginTop: 14, color: MUTED, fontSize: 30 }}>
              {card.headlineNote}
            </div>
          )}
        </div>

        {/* Rule */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 34 }}>
          <div style={{ display: "flex", height: 1, width: 90, backgroundColor: "rgba(168,99,212,0.45)" }} />
          <Diamond size={10} color={AMETHYST} />
          <div style={{ display: "flex", height: 1, flexGrow: 1, backgroundColor: "rgba(168,99,212,0.16)" }} />
        </div>

        {/* Supporting figures */}
        <div style={{ display: "flex", marginTop: 30, gap: 26 }}>
          {card.stats.map((stat) => (
            <div
              key={stat.label}
              style={{
                display: "flex",
                flexDirection: "column",
                flexGrow: 1,
                flexBasis: 0,
                backgroundColor: PANEL,
                border: "1px solid rgba(168,99,212,0.22)",
                borderRadius: 8,
                padding: "18px 20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: MUTED,
                  fontSize: 17,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                }}
              >
                {stat.label}
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: 10,
                  color: TONE[stat.tone ?? "default"],
                  fontSize: 38,
                  fontWeight: 700,
                }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexGrow: 1, minHeight: 20 }} />

        {/* The bottom block is ONE column with a gap. Given two siblings each
            carrying their own margin, satori lets a wrapped footnote run under
            the attribution line instead of pushing it down — measured, and the
            reason this is not two divs. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", color: MUTED, fontSize: 19, lineHeight: 1.4 }}>
            {card.footnote}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Diamond size={10} color={GOLD} />
            <div style={{ display: "flex", color: AMETHYST_SOFT, fontSize: 20, letterSpacing: 1 }}>
              smokingwiz.art
            </div>
            <div style={{ display: "flex", color: MUTED, fontSize: 20 }}>
              · community-built · not financial advice
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...SIZE,
      headers: {
        "cache-control": "public, max-age=60, s-maxage=60",
        "content-disposition": `inline; filename="wizard-${slug}.png"`,
      },
    },
  );
}
