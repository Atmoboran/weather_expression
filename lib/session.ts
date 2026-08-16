import type { WeatherRow } from '@/lib/dwd/product';
import { fetchWeather } from '@/lib/dwd/weather';
import { listFrames } from '@/lib/dwd/webcam';
import type { Resolution, Webcam } from '@/lib/dwd/stations';

/**
 * Everything one visit needs: the frames that exist, the weather that goes with
 * them, and nothing that cannot be paired.
 */
export type Session = {
  webcam: Webcam;
  resolution: Resolution;
  /** Frame timestamps, epoch ms UTC, oldest first. */
  frames: number[];
  /** Observations, one per frame, index-aligned with `frames`. */
  rows: WeatherRow[];
  /** When this was assembled, epoch ms — shown so a stale CDN copy is visible. */
  generatedAt: number;
};

/**
 * Pairs webcam frames with weather observations on exact timestamp equality.
 *
 * Both sides are published on the same 10-minute UTC grid, so an exact match is
 * the right join — no tolerance window, no interpolation. Upstream does the
 * same, and it is what keeps the picture honest: every frame shown is the sky at
 * the moment the numbers under it were measured.
 *
 * Either side can have gaps. A camera goes offline, an instrument fails its
 * quality check. Anything unmatched is dropped rather than filled, which
 * shortens the piece instead of inventing weather.
 */
export function pair(frames: number[], rows: WeatherRow[]): { frames: number[]; rows: WeatherRow[] } {
  const byTime = new Map(rows.map((row) => [row.t, row]));

  const pairedFrames: number[] = [];
  const pairedRows: WeatherRow[] = [];

  for (const t of frames) {
    const row = byTime.get(t);
    if (!row) continue;
    pairedFrames.push(t);
    pairedRows.push(row);
  }

  return { frames: pairedFrames, rows: pairedRows };
}

export class SessionError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'SessionError';
  }
}

export async function buildSession(webcam: Webcam, resolution: Resolution): Promise<Session> {
  const frames = await listFrames(webcam.id, resolution);

  // Only ask DWD for observations reaching as far back as the oldest frame.
  // The station archive covers 18 months; the camera covers about two days, and
  // the camera is what bounds the session.
  const rows = await fetchWeather(webcam.stationId, frames[0]);
  const paired = pair(frames, rows);

  if (paired.frames.length === 0) {
    throw new SessionError(
      `No moment where ${webcam.id} has a frame and ${webcam.stationName} has a complete ` +
        `reading. Both publish on a 10-minute grid, so this usually means one of them is ` +
        `currently down.`,
    );
  }

  return {
    webcam,
    resolution,
    frames: paired.frames,
    rows: paired.rows,
    generatedAt: Date.now(),
  };
}
