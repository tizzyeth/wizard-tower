import { LINKS, TOKEN } from "@/config/token";
import type { MarketResult } from "@/lib/sources/dexscreener";
import type { HealthReport } from "@/lib/health";
import { CaChip } from "./CaChip";
import { CommandKButton } from "./CommandKButton";
import { VhsToggle } from "./VhsToggle";
import { BuyMenu } from "./BuyMenu";
import { LiveDot } from "./LiveDot";
import { PriceTicker } from "./PriceTicker";

const SOCIALS = [
  { label: "X", href: LINKS.x },
  { label: "Coven", href: LINKS.xCommunity },
  { label: "Telegram", href: LINKS.telegram },
  { label: "TikTok", href: LINKS.tiktok },
  { label: "Site", href: LINKS.site },
] as const;

/**
 * Sticky header (plan §4). A server component — only the price ticker needs to be
 * live, so it is extracted as a small client child rather than making the whole
 * header (and its link tree) client-side. `initialMarket` is the page's existing
 * server-rendered snapshot, passed straight through as the ticker's seed.
 *
 * `health` is the cron-freshness report (lib/health.ts) that colours the live dot.
 * Nullable so the header still renders if the page ever chooses not to read it.
 */
export function SiteHeader({
  initialMarket,
  health = null,
}: {
  initialMarket: MarketResult;
  health?: HealthReport | null;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-violet/25 bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 md:px-6">
        <a href="#top" className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded border border-violet/40 bg-panel-2 text-sm text-violet-soft"
          >
            ✦
          </span>
          <span className="font-mono text-sm font-semibold tracking-tight">
            ${TOKEN.symbol}
          </span>
          <span className="hidden text-sm text-muted lg:inline">
            · The Wizard’s Tower
          </span>
        </a>

        <CaChip address={TOKEN.mint} />

        <PriceTicker initial={initialMarket} />

        <div className="ml-auto flex items-center gap-3">
          <VhsToggle />

          <CommandKButton />

          <nav aria-label="community links" className="hidden items-center gap-3 md:flex">
            {SOCIALS.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted transition-colors hover:text-violet-soft"
              >
                {social.label}
              </a>
            ))}
          </nav>

          <BuyMenu />

          <LiveDot health={health} />
        </div>
      </div>
    </header>
  );
}
