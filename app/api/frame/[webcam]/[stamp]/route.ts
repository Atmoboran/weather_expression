import type { NextRequest } from 'next/server';
import { DEFAULT_RESOLUTION, RESOLUTIONS, findWebcam, type Resolution } from '@/lib/dwd/stations';
import { frameUrl } from '@/lib/dwd/webcam';

/**
 * Proxies one webcam frame from DWD.
 *
 * The browser could load opendata.dwd.de directly and cost us nothing, but that
 * puts a public site's full traffic onto a public-good research server: ~290
 * requests per visitor who plays a whole session. Going through the CDN means
 * DWD serves each frame once and every later visitor is served from the edge.
 *
 * A frame at a given timestamp is immutable — DWD never rewrites one — so it is
 * cached for a year. The frames are ~30 KB at the 400px default.
 */
const IMMUTABLE = 'public, max-age=31536000, s-maxage=31536000, immutable';

const UPSTREAM_TIMEOUT_MS = 15_000;

function parseResolution(raw: string | null): Resolution {
  if (!raw) return DEFAULT_RESOLUTION;
  const value = Number(raw);
  return (RESOLUTIONS as readonly number[]).includes(value)
    ? (value as Resolution)
    : DEFAULT_RESOLUTION;
}

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/frame/[webcam]/[stamp]'>,
) {
  const { webcam: webcamId, stamp } = await ctx.params;

  const webcam = findWebcam(webcamId);
  if (!webcam) {
    return new Response(`Unknown webcam '${webcamId}'.`, { status: 404 });
  }

  // Only accept a timestamp that lands exactly on the 10-minute grid DWD
  // publishes to. Without this the route is an open proxy for arbitrary
  // filenames against opendata.dwd.de.
  const t = Number(stamp);
  if (!Number.isInteger(t) || t <= 0 || t % 600_000 !== 0) {
    return new Response('Frame timestamps must be epoch milliseconds on a 10-minute boundary.', {
      status: 400,
    });
  }

  const resolution = parseResolution(request.nextUrl.searchParams.get('resolution'));

  let upstream: Response;
  try {
    upstream = await fetch(frameUrl(webcam.id, t, resolution), {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { 'User-Agent': 'weather-sonification (open data, non-commercial)' },
      cache: 'no-store',
    });
  } catch {
    return new Response('Could not reach the DWD webcam archive.', { status: 504 });
  }

  // A frame that has aged out of DWD's ~2.5-day retention is gone for good, so
  // let the CDN remember the 404 rather than re-asking on every scrub past it.
  if (!upstream.ok) {
    return new Response('No such frame.', {
      status: upstream.status === 404 ? 404 : 502,
      headers: { 'Cache-Control': 'public, s-maxage=3600' },
    });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': IMMUTABLE,
    },
  });
}
