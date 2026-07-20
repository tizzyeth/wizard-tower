type SkeletonProps = {
  className?: string;
};

/** Shimmering placeholder block. Size it with height/width utilities. */
export function Skeleton({ className = "" }: SkeletonProps) {
  return <div aria-hidden className={`wiz-skel ${className}`} />;
}

/** A stack of text-shaped skeleton lines. */
export function SkeletonLines({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="wiz-skel h-3.5"
          style={{ width: `${100 - (i % 3) * 18}%` }}
        />
      ))}
    </div>
  );
}
