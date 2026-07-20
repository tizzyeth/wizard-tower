const TONE_CLASS = {
  default: "text-ink",
  green: "text-green",
  rose: "text-rose",
  gold: "text-gold",
} as const;

type StatHeroProps = {
  label: string;
  /** Undefined value renders the loading skeleton. */
  value?: string;
  /** Italic caption under the number. */
  sub?: string;
  tone?: keyof typeof TONE_CLASS;
};

/** Giant monospace hero number — the one-glance answer of a card. */
export function StatHero({ label, value, sub, tone = "default" }: StatHeroProps) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>
      {value === undefined ? (
        <div aria-hidden className="wiz-skel mt-2 h-10 w-48 max-w-full" />
      ) : (
        <p
          className={`mt-1 font-mono text-3xl font-semibold tabular-nums md:text-4xl ${TONE_CLASS[tone]}`}
        >
          {value}
        </p>
      )}
      {sub && <p className="wiz-caption mt-1.5">{sub}</p>}
    </div>
  );
}
