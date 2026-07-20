import { fmtClockUtc } from "@/lib/format";

/**
 * In-character staleness banner (§3 voice: "The crystal ball is cloudy…").
 * Rendered only when a refresh is failing but last-good data is still on screen,
 * so a card is never blank and never silently wrong. Styled in pipe-smoke mauve
 * with a faint rose edge — ember and gold stay reserved (live / verdict).
 */
export function StaleBanner({ dataAsOf }: { dataAsOf: number | null }) {
  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-2 rounded border border-rose/25 bg-rose/5 px-3 py-2"
    >
      <span aria-hidden className="mt-0.5 text-rose/70">
        ◐
      </span>
      <p className="text-xs leading-relaxed text-muted">
        <span className="italic">The crystal ball is cloudy — the live feed is unreachable.</span>{" "}
        Showing the last clear reading
        {dataAsOf != null && (
          <>
            {" "}
            from <span className="font-mono text-violet-soft">{fmtClockUtc(dataAsOf)}</span>
          </>
        )}
        .
      </p>
    </div>
  );
}

/**
 * "Awaiting the crystal ball" — the honest empty state when we have no data at
 * all yet (cold start + upstream down). Keeps the card present and truthful
 * rather than blank.
 */
export function AwaitingReading({ label }: { label: string }) {
  return (
    <p className="wiz-caption py-6 text-center">
      The crystal ball is dark — {label} will appear the moment the feed answers.
    </p>
  );
}

/** Deterministic "as of HH:MM UTC" attribution (safe for SSR — no clock drift). */
export function AsOf({ dataAsOf, stale }: { dataAsOf: number | null; stale?: boolean }) {
  if (dataAsOf == null) return null;
  return (
    <p className="mt-4 text-right text-[10px] uppercase tracking-[0.14em] text-muted">
      {stale ? "last good" : "as of"}{" "}
      <span className="font-mono normal-case tracking-normal">{fmtClockUtc(dataAsOf)}</span>
    </p>
  );
}
