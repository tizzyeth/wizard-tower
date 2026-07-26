"use client";

/**
 * The Prophecy Feed — X posts for $WIZARD (plan §4 module 8, M6). Two tabs:
 * **Official** (@swizardcore's own timeline) and **The Coven** (community chatter).
 * Reads OUR DB only via /api/social — zero client-side X calls (the milestone's
 * headline guarantee); a 30-min poller (app/api/cron/social) fills the buffer.
 *
 * X display requirements: every post shows author attribution (avatar · name ·
 * @handle) and links back to the original post on X. The Coven tab is honestly
 * labeled an APPROXIMATION — it is a $WIZARD cashtag search, not the community's
 * literal member feed (the `community_id` operator is gated above our API tier; see
 * lib/sources/x.ts for the verification decision).
 *
 * Relative times are hydration-safe: the server + first client render both show a
 * deterministic UTC date, then the client swaps to a live "2h ago" after mount, so
 * there is never an SSR/client text mismatch.
 */

import { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { CardFrame } from "@/components/wizard/CardFrame";
import { StaleBanner } from "@/components/wizard/DataStatus";
import { X, LINKS } from "@/config/token";
import { fmtAgo, fmtDateUtc, fmtDateTimeUtc, fmtInt } from "@/lib/format";
import type { SocialPost, SocialResult } from "@/lib/social";
import type { XSource, XMedia } from "@/lib/sources/x";
import { useSocial } from "./useSocial";

const TABS: Array<{ key: XSource; label: string }> = [
  { key: "official", label: "Official" },
  { key: "community", label: "The Coven" },
];

/**
 * True only AFTER hydration — the React-sanctioned way to render a client-only
 * value without a hydration mismatch (getServerSnapshot returns false, so the SSR
 * and first client render agree; a post-hydration re-render flips it to true).
 * Lets relative "2h ago" times upgrade from a deterministic UTC date after mount.
 */
const noopSubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function TheProphecyFeed({
  initialOfficial,
  initialCommunity,
  className = "",
}: {
  initialOfficial: SocialResult;
  initialCommunity: SocialResult;
  className?: string;
}) {
  const [tab, setTab] = useState<XSource>("official");
  const official = useSocial("official", initialOfficial);
  const community = useSocial("community", initialCommunity);

  const active = tab === "official" ? official : community;
  const stale = active.degraded || active.result.stale;
  const posts = active.result.data?.posts ?? [];

  return (
    <CardFrame
      id="feed"
      title="The Prophecy Feed"
      subtitle="posts from X"
      source={`X API · ${X.officialUsername} · 4h poller`}
      controls={<FeedTabs value={tab} onChange={setTab} />}
      fill
      className={className}
    >
      {stale && <StaleBanner dataAsOf={active.result.dataAsOf} />}

      {tab === "community" && <CovenNote />}

      {posts.length === 0 ? (
        <EmptyFeed tab={tab} />
      ) : (
        // Posts carry media, so this card grew taller than anything beside it.
        // Same treatment as the trade tape: cap and scroll inside the card.
        // `relative` is load-bearing, not decoration: each post carries an
        // absolutely-positioned `sr-only` span, and an absolutely-positioned
        // element is only clipped by an overflow ancestor that is also its
        // CONTAINING BLOCK. Left static, this list was not — the spans resolved
        // against the card `section` (`.wiz-card` is relative), laid out at full
        // height outside the scroller, and added ~9,000px of scrollable void
        // below the footer.
        // The list must TAKE the row's height without SETTING it. A plain
        // `flex-1` list still reports its content height to the grid, so it grew
        // the row to 10,000px and dragged its neighbour along; a fixed cap did
        // the reverse and left the card half empty. Absolute positioning removes
        // the list from layout entirely: the wrapper claims the leftover space,
        // the row is sized by the taller card beside it, and the list fills
        // whatever that turns out to be.
        //
        // `min-h-[22rem]` is the standalone floor — on mobile the bento is one
        // column and there is no tall neighbour to inherit height from.
        <div className="relative min-h-[22rem] min-h-0 flex-1">
          <ol className="absolute inset-0 space-y-4 overflow-y-auto pr-1">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </ol>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-violet/15 pt-3">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted">
          Posts via{" "}
          <a
            href={tab === "official" ? LINKS.x : LINKS.xCommunity}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-soft underline decoration-violet/40 underline-offset-2 transition-colors hover:text-ink"
          >
            X
          </a>
        </p>
        <AsOfInline dataAsOf={active.result.dataAsOf} stale={stale} />
      </div>
    </CardFrame>
  );
}

// ── Tabs (segmented control, matches the tape's SideToggle) ──────────────────

function FeedTabs({ value, onChange }: { value: XSource; onChange: (v: XSource) => void }) {
  return (
    <div
      role="group"
      aria-label="Choose feed"
      className="inline-flex overflow-hidden rounded border border-violet/25"
    >
      {TABS.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(t.key)}
            className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors ${
              active ? "bg-violet/20 text-violet-soft" : "text-muted hover:text-violet-soft"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── The Coven honesty note (fallback C is an approximation) ──────────────────

function CovenNote() {
  return (
    <p className="mb-4 rounded border border-violet/20 bg-violet/[0.05] px-3 py-2 text-[11px] leading-relaxed text-muted">
      <span aria-hidden className="text-violet-soft">
        ◈{" "}
      </span>
      The Coven scries every mention of{" "}
      <span className="font-mono text-violet-soft">$WIZARD</span> across X — an open
      reading of the wider circle, not the community’s private timeline.
    </p>
  );
}

// ── One post ─────────────────────────────────────────────────────────────────

function PostCard({ post }: { post: SocialPost }) {
  const href = post.url ?? undefined;
  return (
    <li className="flex gap-3">
      <Avatar src={post.authorAvatarUrl} name={post.authorName ?? post.authorHandle} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-x-1.5">
          <span className="truncate text-sm font-semibold text-ink" title={post.authorName ?? undefined}>
            {post.authorName ?? "Unknown"}
          </span>
          {post.authorHandle && (
            <span className="shrink-0 truncate text-xs text-muted">@{post.authorHandle}</span>
          )}
          <span aria-hidden className="text-muted">
            ·
          </span>
          <PostTime ts={post.createdAt} />
        </div>

        {post.text && (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink/90">
            {post.text}
          </p>
        )}

        {post.media.length > 0 && (
          <MediaThumbs media={post.media} postUrl={post.url ?? undefined} />
        )}

        <div className="mt-2 flex items-center gap-4">
          <Metric glyph="♥" value={post.likes} label="likes" />
          <Metric glyph="⇄" value={post.reposts} label="reposts" />
          <Metric glyph="↳" value={post.replies} label="replies" />
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto shrink-0 text-[11px] font-medium text-violet-soft/90 transition-colors hover:text-ink"
            >
              Open on X <span aria-hidden>↗</span>
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function Avatar({ src, name }: { src: string | null; name: string | null }) {
  const monogram = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (!src) {
    return (
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-violet/30 bg-violet/10 font-mono text-sm text-violet-soft"
      >
        {monogram}
      </span>
    );
  }
  return (
    <Image
      src={src}
      alt=""
      width={36}
      height={36}
      className="h-9 w-9 shrink-0 rounded-full border border-violet/25 object-cover"
      // Twitter's CDN sets short cache headers; avatars change rarely, so let Next
      // cache the optimized variant. `unoptimized` is intentionally not set — the
      // host is allow-listed in next.config.ts remotePatterns.
    />
  );
}

/** Media attachments (up to 4): photos, and videos that play in place. */
function MediaThumbs({ media, postUrl }: { media: XMedia[]; postUrl?: string }) {
  const shown = media.slice(0, 4);
  return (
    <div className={`mt-2 grid gap-1.5 ${shown.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
      {shown.map((m, i) => (
        <MediaTile key={`${m.thumbUrl}-${i}`} media={m} postUrl={postUrl} />
      ))}
    </div>
  );
}

/**
 * One attachment. A photo is just a thumbnail; a video shows its poster with a
 * play control and swaps in a real <video> on click.
 *
 * Click-to-play, never autoplay: these cards sit in a scrolling feed, and a
 * page that starts downloading several clips on load spends someone's data
 * without being asked. The poster is already loaded, so the swap is instant.
 *
 * Rows stored before the poller requested `variants` have no `videoUrl`. Those
 * fall back to opening the post on X rather than showing a control that does
 * nothing — which is exactly the bug this replaces.
 */
function MediaTile({ media, postUrl }: { media: XMedia; postUrl?: string }) {
  const [playing, setPlaying] = useState(false);
  const isVideo = media.type !== "photo";
  const label =
    media.type === "photo" ? "Photo attached to the post" : "Video preview from the post";

  if (isVideo && playing && media.videoUrl) {
    return (
      <div className="relative aspect-video overflow-hidden rounded border border-violet/20 bg-panel-2">
        {/* Streamed through our own origin: X's CDN 403s any request carrying a
            third-party Referer, and `referrerPolicy` is ignored on <video>
            (all values measured, all failed). See app/api/media/video/route.ts. */}
        <video
          src={`/api/media/video?u=${encodeURIComponent(media.videoUrl)}`}
          poster={media.thumbUrl}
          controls
          autoPlay
          playsInline
          loop={media.type === "animated_gif"}
          muted={media.type === "animated_gif"}
          className="h-full w-full object-contain bg-black"
        />
      </div>
    );
  }

  const tile = (
    <>
      <Image
        src={media.thumbUrl}
        alt={label}
        fill
        sizes="(max-width: 768px) 45vw, 300px"
        className="object-cover"
      />
      {isVideo && (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas/75 text-sm text-ink ring-1 ring-violet/40 transition-transform group-hover:scale-110">
            ▶
          </span>
        </span>
      )}
    </>
  );

  const shell = "group relative aspect-video overflow-hidden rounded border border-violet/20 bg-panel-2";

  if (!isVideo) return <div className={shell}>{tile}</div>;

  // Playable here → a button. Not playable (old row) → a link to the post on X.
  return media.videoUrl ? (
    <button type="button" onClick={() => setPlaying(true)} className={`${shell} cursor-pointer`}>
      <span className="sr-only">Play the video attached to this post</span>
      {tile}
    </button>
  ) : (
    <a
      href={postUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`${shell} block`}
      title="Watch on X"
    >
      <span className="sr-only">Watch this video on X</span>
      {tile}
    </a>
  );
}

function Metric({ glyph, value, label }: { glyph: string; value: number | null; label: string }) {
  const n = value ?? 0;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <span aria-hidden>{glyph}</span>
      <span className="font-mono tabular-nums">{fmtInt(n)}</span>
      <span className="sr-only">
        {fmtInt(n)} {label}
      </span>
    </span>
  );
}

// ── Hydration-safe post time (deterministic date → relative after mount) ─────

function PostTime({ ts }: { ts: number | null }) {
  const hydrated = useHydrated();
  if (ts == null) return null;
  // Server + first client render agree on the UTC date; after hydration the client
  // upgrades to a live "2h ago" (never a hydration mismatch).
  const label = hydrated ? fmtAgo(ts) : fmtDateUtc(ts);
  return (
    <time
      dateTime={new Date(ts).toISOString()}
      title={fmtDateTimeUtc(ts)}
      className="shrink-0 text-xs text-muted"
    >
      {label}
    </time>
  );
}

// ── Empty + attribution ──────────────────────────────────────────────────────

function EmptyFeed({ tab }: { tab: XSource }) {
  return (
    <p className="wiz-caption py-10 text-center">
      {tab === "official"
        ? "The prophecies are silent — no signs from the tower yet."
        : "The prophecies are silent — the coven has not stirred."}
    </p>
  );
}

/** Compact "as of" line, inline in the footer row. */
function AsOfInline({ dataAsOf, stale }: { dataAsOf: number | null; stale: boolean }) {
  if (dataAsOf == null) return null;
  return (
    <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted">
      {stale ? "last good" : "polled"}{" "}
      <TimeAgoInline ts={dataAsOf} />
    </span>
  );
}

function TimeAgoInline({ ts }: { ts: number }) {
  const hydrated = useHydrated();
  return (
    <span className="font-mono normal-case tracking-normal">
      {hydrated ? fmtAgo(ts) : fmtDateUtc(ts)}
    </span>
  );
}
