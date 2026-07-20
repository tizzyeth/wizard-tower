const TONE_CLASS = {
  default: "text-ink",
  green: "text-green",
  rose: "text-rose",
  gold: "text-gold",
  muted: "text-muted",
} as const;

const COLS_CLASS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
} as const;

export type StatItem = {
  label: string;
  /** Undefined value renders the loading skeleton. */
  value?: string;
  tone?: keyof typeof TONE_CLASS;
};

type StatGridProps = {
  items: StatItem[];
  cols?: keyof typeof COLS_CLASS;
  className?: string;
};

/** Small sub-metric grid under a hero number. Numerals stay monospace. */
export function StatGrid({ items, cols = 4, className = "" }: StatGridProps) {
  return (
    <dl className={`grid grid-cols-2 gap-x-4 gap-y-3 ${COLS_CLASS[cols]} ${className}`}>
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">
            {item.label}
          </dt>
          {item.value === undefined ? (
            <dd aria-hidden className="wiz-skel mt-1.5 h-4 w-20 max-w-full" />
          ) : (
            <dd
              className={`mt-0.5 font-mono text-sm tabular-nums ${TONE_CLASS[item.tone ?? "default"]}`}
            >
              {item.value}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
