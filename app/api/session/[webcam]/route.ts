import type { NextRequest } from 'next/server';
import { DEFAULT_RESOLUTION, RESOLUTIONS, findWebcam, type Resolution } from '@/lib/dwd/stations';
import { DwdError } from '@/lib/dwd/weather';
import { SessionError, buildSession } from '@/lib/session';

/**
 * One visit's worth of paired frames and observations.
 *
 * Held at the CDN for five minutes: DWD publishes on a 10-minute grid, so a
 * shorter TTL would re-fetch ~1.4 MB of station archive for no new data. The
 * stale-while-revalidate window means a visitor arriving during a refresh gets
 * the previous copy immediately rather than waiting on DWD.
 */
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';

/**
 * A cold session fetches ~1.4 MB of zipped station archive from DWD and takes
 * around 6-7 seconds. That is comfortably inside a 30-second budget but well
 * over the 10-second default some plans apply, and the failure mode — a timeout
 * on the very first request a visitor makes — looks exactly like the site being
 * broken.
 */
export const maxDuration = 30;

function parseResolution(raw: string | null): Resolution {
  if (!raw) return DEFAULT_RESOLUTION;
  const value = Number(raw);
  return (RESOLUTIONS as readonly number[]).includes(value)
    ? (value as Resolution)
    : DEFAULT_RESOLUTION;
}

export async function GET(request: NextRequest, ctx: RouteContext<'/api/session/[webcam]'>) {
  const { webcam: webcamId } = await ctx.params;

  const webcam = findWebcam(webcamId);
  if (!webcam) {
    return Response.json(
      { error: `Unknown webcam '${webcamId}'.` },
      { status: 404, headers: { 'Cache-Control': 'public, s-maxage=3600' } },
    );
  }

  const resolution = parseResolution(request.nextUrl.searchParams.get('resolution'));

  try {
    const session = await buildSession(webcam, resolution);
    return Response.json(session, { headers: { 'Cache-Control': CACHE_CONTROL } });
  } catch (error) {
    // DWD being down is not this app being broken, and the difference matters
    // to whoever reads the message. Anything else is a real bug and should not
    // be dressed up as an upstream outage.
    if (error instanceof DwdError || error instanceof SessionError) {
      return Response.json(
        { error: error.message },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }
}
