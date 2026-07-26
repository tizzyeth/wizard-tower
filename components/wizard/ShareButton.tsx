import type { ShareCardSlug } from "@/lib/share/cards";

/**
 * Opens this module's shareable PNG (IMPLEMENTATION_PLAN.md §10, hl.eco's
 * camera-button affordance).
 *
 * A plain link, not a button with a download handler: opening the image lets
 * people save it, drag it into a post, or long-press it on a phone — every way
 * anyone actually moves an image around. A forced download only supports one of
 * those, and on iOS barely that.
 *
 * Deliberately quiet until hover: these cards are dense with numbers, and a
 * permanently bright control on each one would compete with the data.
 */
export function ShareButton({ card, label }: { card: ShareCardSlug; label: string }) {
  return (
    <a
      href={`/share/${card}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open a shareable image of ${label}`}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-violet/25 text-muted opacity-60 transition-all hover:border-violet/60 hover:text-violet-soft hover:opacity-100 focus-visible:opacity-100"
    >
      <span className="sr-only">Open a shareable image of {label}</span>
      {/* Camera, drawn — the icon set here is CSS and glyphs, not an icon font. */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1-1.6A1.5 1.5 0 0 1 9 4.7h6a1.5 1.5 0 0 1 1.3.7l1 1.6h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
        <circle cx="12" cy="12.8" r="3.4" />
      </svg>
    </a>
  );
}
