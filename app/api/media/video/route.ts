/**
 * GET /api/media/video?u=<video.twimg.com URL> — streams a post's video.
 *
 * The parameter is `u`, not `src`, for an unglamorous reason: while this route
 * briefly carried `cache-control: public … immutable`, Vercel's edge stored a
 * PARTIAL response from a range probe as though it were the whole file, and
 * then served every later request a "complete" 1,001-byte video that no player
 * would touch. `private` (below) stops that recurring; renaming the parameter
 * retired the poisoned keys immediately instead of waiting out their TTL.
 *
 * WHY A PROXY. X's CDN refuses any request that carries a third-party `Referer`
 * (measured: no Referer → 206, our origin → 403), and `referrerPolicy` is not
 * honoured on <video> — every policy value still failed to load. A server fetch
 * sends no Referer, so it is served normally.
 *
 * It also keeps M6's headline guarantee intact: the browser talks only to our
 * own origin and never to X. An X embed widget would have played the video too,
 * and broken exactly that.
 *
 * SSRF is the obvious risk in "fetch a URL the client names", so the host is
 * matched exactly against one CDN and nothing else is reachable.
 *
 * Range requests are passed through in both directions, which is what makes
 * seeking work and keeps each invocation short — the browser asks for chunks
 * rather than holding one function open for the whole clip. Responses are
 * cached at the edge, so a second viewer of the same clip costs us nothing.
 */

import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The only host this route will fetch. Exact match — no suffix tricks. */
const ALLOWED_HOST = "video.twimg.com";

/** Headers worth forwarding from the upstream response. */
const PASS_THROUGH = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;

function bad(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("u");
  if (!src) return bad("missing u");

  let target: URL;
  try {
    target = new URL(src);
  } catch {
    return bad("u is not a URL");
  }
  if (target.protocol !== "https:" || target.hostname !== ALLOWED_HOST) {
    return bad(`only https://${ALLOWED_HOST} is proxied`, 403);
  }

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      // No Referer, no cookies — that is the entire point.
      headers: range ? { range } : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return bad(`upstream fetch failed: ${message}`, 502);
  }

  if (!upstream.ok && upstream.status !== 206) {
    return bad(`upstream returned ${upstream.status}`, upstream.status === 404 ? 404 : 502);
  }

  const headers = new Headers();
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Browser-only caching, deliberately NOT shared/edge. Vercel's CDN, once it
  // holds the full object, answers a Range request with `200` plus a
  // `content-range` header and a truncated body — which a <video> reads as a
  // corrupt file and refuses to play. (Measured: cache MISS → correct 206;
  // cache HIT → the broken 200.) The origin is cheap here and correctness is
  // not negotiable, so ranges always come straight from the function; the
  // browser still caches, so replays cost nothing.
  headers.set("cache-control", "private, max-age=3600");

  return new Response(upstream.body, { status: upstream.status, headers });
}
