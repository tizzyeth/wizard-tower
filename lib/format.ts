/**
 * Display formatters — pure, deterministic, framework-free so they can be
 * unit-tested and shared by server and client without a hydration mismatch.
 * Numerals always render in JetBrains Mono (the caller supplies the font);
 * these functions only decide the digits.
 */

const EM_DASH = "—";

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Fixed-notation with `sig` significant figures, never exponential. */
function toFixedSig(n: number, sig: number): string {
  if (n === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(n)));
  const decimals = Math.min(Math.max(0, sig - 1 - exp), 20);
  return trimZeros(n.toFixed(decimals));
}

/**
 * A USD price. Sub-dollar values (this token trades at ~$0.0002) keep four
 * significant figures so the reading matches DexScreener's headline digit-for-digit.
 */
export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  if (n === 0) return "$0";
  if (n >= 1) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return "$" + toFixedSig(n, 4);
}

/** A native-token price (e.g. SOL per WIZARD), four significant figures. */
export function fmtNative(n: number | null | undefined, symbol = ""): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  const digits = toFixedSig(n, 4);
  return symbol ? `${digits} ${symbol}` : digits;
}

/** Compact USD for large magnitudes: $210.4K, $53.6K, $1.24M. */
export function fmtUsdCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${trimZeros((abs / 1e9).toFixed(2))}B`;
  if (abs >= 1e6) return `${sign}$${trimZeros((abs / 1e6).toFixed(2))}M`;
  if (abs >= 1e3) return `${sign}$${trimZeros((abs / 1e3).toFixed(abs >= 1e5 ? 1 : 2))}K`;
  return `${sign}$${abs.toFixed(abs < 1 ? 2 : 0)}`;
}

/** Full USD with grouping — used in title tooltips for exact values. */
export function fmtUsdFull(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Signed percentage: +4.95%, -2.45%. */
export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** Sign classifier for polarity coloring (green up / rose down / muted flat). */
export function signTone(n: number | null | undefined): "green" | "rose" | "muted" {
  if (n == null || !Number.isFinite(n) || n === 0) return "muted";
  return n > 0 ? "green" : "rose";
}

/** Grouped integer: 1,234. */
export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  return Math.round(n).toLocaleString("en-US");
}

/** Compact integer with a large-count suffix: 1.0B, 12.5M, 1,000. */
export function fmtSupply(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  if (n >= 1e9) return `${trimZeros((n / 1e9).toFixed(2))}B`;
  if (n >= 1e6) return `${trimZeros((n / 1e6).toFixed(2))}M`;
  return fmtInt(n);
}

/** A ratio (0..1) as a percentage: 0.2547 -> "25.5%". */
export function fmtRatioPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Human token age from a launch timestamp. Coarse by design (days -> months ->
 * years) so server and client agree despite a few seconds of clock drift.
 */
export function fmtAge(launchedAtMs: number | null | undefined, nowMs: number = Date.now()): string {
  if (launchedAtMs == null || !Number.isFinite(launchedAtMs)) return EM_DASH;
  const ms = nowMs - launchedAtMs;
  if (ms < 0) return EM_DASH;
  const days = ms / 86_400_000;
  if (days < 1) {
    const hours = Math.max(1, Math.round(ms / 3_600_000));
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (days < 60) {
    const d = Math.round(days);
    return `${d} ${d === 1 ? "day" : "days"}`;
  }
  const years = days / 365.25;
  if (years >= 1) {
    const y = Math.round(years * 10) / 10;
    return `${trimZeros(y.toFixed(1))} ${y === 1 ? "year" : "years"}`;
  }
  const months = Math.round(days / 30.44);
  return `${months} ${months === 1 ? "month" : "months"}`;
}

/** Relative "time ago" for the stale banner and data-as-of captions. */
export function fmtAgo(tsMs: number | null | undefined, nowMs: number = Date.now()): string {
  if (tsMs == null || !Number.isFinite(tsMs)) return EM_DASH;
  const s = Math.max(0, Math.round((nowMs - tsMs) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Calendar date (e.g. "19 Jul 2026") in UTC — deterministic so the SSR-seeded
 * "recorded since" banner matches the client and never triggers hydration drift.
 */
export function fmtDateUtc(tsMs: number | null | undefined): string {
  if (tsMs == null || !Number.isFinite(tsMs)) return EM_DASH;
  const d = new Date(tsMs);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Compact date + time (e.g. "19 Jul 14:00 UTC") for chart-point tooltips. */
export function fmtDateTimeUtc(tsMs: number | null | undefined): string {
  if (tsMs == null || !Number.isFinite(tsMs)) return EM_DASH;
  const d = new Date(tsMs);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${hh}:${mm} UTC`;
}

/** Clock label (HH:MM UTC) for exact "as of" attribution. */
export function fmtClockUtc(tsMs: number | null | undefined): string {
  if (tsMs == null || !Number.isFinite(tsMs)) return EM_DASH;
  const d = new Date(tsMs);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

/**
 * Seconds-precision clock (HH:MM:SS UTC) for the trade tape. Deterministic and
 * UTC-based so the SSR-seeded first row matches the client and never triggers a
 * hydration mismatch (unlike a "2m ago" relative label computed from Date.now()).
 */
export function fmtTimeUtc(tsMs: number | null | undefined): string {
  if (tsMs == null || !Number.isFinite(tsMs)) return EM_DASH;
  const d = new Date(tsMs);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Truncate a Solana address for display: "Dw4k…bGTu". */
export function fmtAddr(addr: string | null | undefined, lead = 4, tail = 4): string {
  if (!addr) return EM_DASH;
  if (addr.length <= lead + tail + 1) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

/** Compact token amount without a currency sign: 973.4K, 1.25M, 850. */
export function fmtTokenAmount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${trimZeros((abs / 1e9).toFixed(2))}B`;
  if (abs >= 1e6) return `${sign}${trimZeros((abs / 1e6).toFixed(2))}M`;
  if (abs >= 1e3) return `${sign}${trimZeros((abs / 1e3).toFixed(abs >= 1e5 ? 1 : 2))}K`;
  return fmtInt(n);
}

/**
 * USD for a single trade: cents below $10K (so a $196.44 swap reads exactly),
 * compact above ($12.3K). Distinct from `fmtUsdCompact`, which rounds to whole
 * dollars under $1K and would blur small-trade amounts on the tape.
 */
export function fmtUsdTrade(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  const abs = Math.abs(n);
  if (abs >= 1e4) return fmtUsdCompact(n);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
