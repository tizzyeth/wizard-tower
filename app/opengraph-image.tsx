/**
 * Open Graph / Twitter share image — generated with code (IMPLEMENTATION_PLAN.md
 * §4: "static wizard art in v1"; there is no raster asset in the repo). Next 16's
 * `opengraph-image.tsx` renders it via `ImageResponse` (next/og) at build time and
 * caches it; Next auto-emits the og:image + twitter:image tags. See the
 * metadata-and-og-images + opengraph-image docs in node_modules/next/dist/docs/.
 *
 * satori (behind ImageResponse) supports only flexbox + a subset of CSS — every
 * container sets display:flex, no grid. Typeface is ImageResponse's bundled
 * default (v1); the Wizardcore identity is carried by the palette, ornaments, and
 * layout. A bundled JetBrains Mono for the ticker is a cheap later refinement.
 *
 * Ornaments are CSS-drawn diamonds (rotated squares), NOT Unicode dingbats
 * (✦/✳/◆): the bundled font lacks those glyphs and satori would try to fetch a
 * dynamic font per-glyph — flaky and network-dependent at build. Drawn shapes
 * render identically everywhere with no network.
 */

import { ImageResponse } from "next/og";
import { TOKEN } from "@/config/token";

/** A rotated-square "◆" ornament — the Wizardcore diamond, drawn (no font glyph). */
function Diamond({ size = 14, color = "#A863D4", opacity = 1 }: { size?: number; color?: string; opacity?: number }) {
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

export const alt =
  "The Wizard's Tower — a live due-diligence terminal for $WIZARD on Solana. Community-built, informational only, not financial advice.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Wizardcore palette (§3), inlined — satori has no access to CSS tokens.
const CANVAS = "#120C15";
const PANEL = "#1A1321";
const INK = "#F4EFF6";
const MUTED = "#9C8BA3";
const AMETHYST = "#A863D4";
const AMETHYST_SOFT = "#CFA6EA";
const GOLD = "#EAB308";

export default function OpengraphImage() {
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
          // Deep plum orbs + faint hearth-glow — the tower at night (§3 body motif).
          backgroundImage:
            "radial-gradient(900px 620px at 88% -12%, rgba(110,36,150,0.34), transparent 62%), radial-gradient(900px 700px at -8% 112%, rgba(110,36,150,0.22), transparent 62%), radial-gradient(680px 380px at 55% 118%, rgba(255,130,60,0.10), transparent 60%)",
          padding: "64px 72px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Corner ornaments (drawn diamonds) */}
        <div style={{ position: "absolute", top: 40, left: 48, display: "flex" }}>
          <Diamond size={16} color={AMETHYST_SOFT} opacity={0.55} />
        </div>
        <div style={{ position: "absolute", top: 40, right: 48, display: "flex" }}>
          <Diamond size={16} color={AMETHYST_SOFT} opacity={0.55} />
        </div>
        <div style={{ position: "absolute", bottom: 40, left: 48, display: "flex" }}>
          <Diamond size={16} color={AMETHYST_SOFT} opacity={0.55} />
        </div>
        <div style={{ position: "absolute", bottom: 40, right: 48, display: "flex" }}>
          <Diamond size={16} color={AMETHYST_SOFT} opacity={0.55} />
        </div>

        {/* Eyebrow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            color: AMETHYST,
            fontSize: 24,
            letterSpacing: 8,
            textTransform: "uppercase",
          }}
        >
          <Diamond size={11} color={AMETHYST} />
          <span style={{ display: "flex" }}>Wizardcore Terminal</span>
          <Diamond size={11} color={AMETHYST} />
        </div>

        {/* Title — the thesis */}
        <div
          style={{
            display: "flex",
            marginTop: 30,
            color: INK,
            fontSize: 104,
            fontWeight: 700,
            lineHeight: 1.02,
            letterSpacing: -1,
          }}
        >
          The Wizard’s Tower
        </div>

        {/* Ticker chip */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 26 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: PANEL,
              border: `1px solid rgba(168,99,212,0.4)`,
              borderRadius: 8,
              padding: "10px 20px",
              color: AMETHYST_SOFT,
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            ${TOKEN.symbol}
          </div>
          <div style={{ display: "flex", color: MUTED, fontSize: 30 }}>{TOKEN.name} · Solana</div>
        </div>

        {/* Rule with centered diamond ornament */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 40 }}>
          <div style={{ display: "flex", height: 1, width: 120, backgroundColor: "rgba(168,99,212,0.4)" }} />
          <Diamond size={12} color={AMETHYST} />
          <div style={{ display: "flex", height: 1, flexGrow: 1, backgroundColor: "rgba(168,99,212,0.18)" }} />
        </div>

        {/* What it shows */}
        <div style={{ display: "flex", marginTop: 24, color: MUTED, fontSize: 30, letterSpacing: 1 }}>
          Price · Liquidity · Holders · Safety wards · The Verdict
        </div>

        <div style={{ display: "flex", flexGrow: 1 }} />

        {/* Disclaimer footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Diamond size={12} color={GOLD} />
          <div style={{ display: "flex", color: MUTED, fontSize: 22, letterSpacing: 0.5 }}>
            community-built · unofficial · informational only · not financial advice · DYOR
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
