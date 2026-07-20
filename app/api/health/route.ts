/**
 * GET /api/health — machine-readable feed freshness (the cron-monitoring surface).
 *
 * Answers one question: is the data still arriving? The GitHub Actions workflows
 * alert on a run that FAILS; this catches the run that succeeds while writing
 * nothing, and the run that never happened at all (a schedule GitHub disabled after
 * 60 days of repo inactivity produces no failure to alert on). See lib/health.ts.
 *
 * Cheap by construction: two `max()` reads behind a 30s cache, NO third-party API.
 * Safe for an uptime monitor or a future Telegram bot to poll on a short interval.
 *
 * Status codes are chosen so a dumb HTTP monitor that only looks at the code still
 * catches a real outage:
 *   200 — ok, degraded, or unknown. Degraded is a nudge, not a page-out, and
 *         `unknown` (no database / nothing recorded yet) is not evidence of a fault.
 *   503 — down. A feed is past its fail threshold; the dashboard is showing old data.
 * Read `status` in the body for the actual verdict — the code is the coarse signal.
 */

import { getHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await getHealth();
  return Response.json(report, {
    status: report.status === "down" ? 503 : 200,
    // A cached health check is a broken health check.
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
