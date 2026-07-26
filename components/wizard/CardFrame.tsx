import type { ReactNode } from "react";

const CORNERS = [
  "wiz-corner-tl",
  "wiz-corner-tr",
  "wiz-corner-bl",
  "wiz-corner-br",
] as const;

type CardFrameProps = {
  /** Anchor id — every module card is deep-linkable. */
  id: string;
  /** Lore name, e.g. "Council of Holders". */
  title: string;
  /** Functional subtitle, e.g. "holder distribution & concentration". */
  subtitle?: string;
  /** Data-source attribution, e.g. "DexScreener · 30s". */
  source?: string;
  /** Controls rendered top-right (timeframes, toggles, tabs). */
  controls?: ReactNode;
  variant?: "default" | "gold";
  /**
   * Make the body fill the card's height instead of sizing to its content.
   * For a card whose neighbour in the bento row is taller, this is what lets an
   * internally-scrolling list use the whole column rather than stopping short
   * and leaving the rest of the card empty. The body becomes a flex child with
   * `min-h-0`, so a `flex-1 overflow-y-auto` list inside it can actually shrink.
   */
  fill?: boolean;
  className?: string;
  children: ReactNode;
};

export function CardFrame({
  id,
  title,
  subtitle,
  source,
  controls,
  variant = "default",
  fill = false,
  className = "",
  children,
}: CardFrameProps) {
  return (
    <section
      id={id}
      aria-label={title}
      className={`wiz-card ${variant === "gold" ? "wiz-card-gold" : ""} scroll-mt-20 p-4 md:p-5 ${
        fill ? "flex flex-col" : ""
      } ${className}`}
    >
      {CORNERS.map((corner) => (
        <span key={corner} aria-hidden className={`wiz-corner ${corner}`}>
          ✦
        </span>
      ))}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="wiz-title text-[13px] font-semibold uppercase tracking-[0.18em]">
            {title}
          </h2>
          {(subtitle || source) && (
            <p className="mt-1 text-xs text-muted">
              {subtitle}
              {subtitle && source && <span aria-hidden> ◆ </span>}
              {source && <span>via {source}</span>}
            </p>
          )}
        </div>
        {controls && <div className="shrink-0">{controls}</div>}
      </header>
      <div className="wiz-rule my-3 text-[10px]">
        <span aria-hidden>✳</span>
      </div>
      {fill ? (
        // `min-h-0` is what allows a scrolling child to shrink below its content
        // height; without it the flex child refuses to compress and the card grows.
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}
