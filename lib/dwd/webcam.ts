import type { Resolution } from './stations';
import { DwdError } from './weather';

/**
 * Discovery of the webcam frames DWD currently holds.
 *
 * DWD serves an Apache directory index per camera, which lists exactly the
 * frames that exist. The upstream Python project instead brute-forced every
 * 10-minute slot across three days — 432 requests per camera, most of them
 * 404s. Reading the index is one request and, unlike probing, it cannot report
 * a frame as missing just because the naming convention shifted.
 *
 * Frames are retained for roughly two and a half days, so this is also the
 * authority on how far back a session can reach.
 */

const WEBCAM_BASE = 'https://opendata.dwd.de/weather/webcam';
const FETCH_TIMEOUT_MS = 20_000;

/** `Offenbach-W_20260814_1940_400.jpg` — the `latest` alias is deliberately excluded. */
const FRAME_PATTERN = /href="([A-Za-z-]+)_(\d{8})_(\d{4})_(\d+)\.jpg"/g;

/** Filenames carry UTC, matching MESS_DATUM in the station feeds. */
export function parseFrameStamp(date: string, time: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
  );
}

/** Rebuilds the DWD filename for a frame. */
export function frameFilename(station: string, t: number, resolution: Resolution): string {
  const d = new Date(t);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `${station}_${date}_${time}_${resolution}.jpg`;
}

export function frameUrl(station: string, t: number, resolution: Resolution): string {
  return `${WEBCAM_BASE}/${station}/${frameFilename(station, t, resolution)}`;
}

/**
 * Lists the timestamps this camera currently has, oldest first.
 *
 * Only frames published at `resolution` are counted. DWD writes all eight sizes
 * together, but a listing is a snapshot of a directory being written to, and
 * counting a size we will not request would let the UI promise a frame the
 * player then cannot load.
 */
export async function listFrames(station: string, resolution: Resolution): Promise<number[]> {
  let response: Response;
  try {
    response = await fetch(`${WEBCAM_BASE}/${station}/`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'weather-sonification (open data, non-commercial)' },
      cache: 'no-store',
    });
  } catch (cause) {
    throw new DwdError(`Could not reach the DWD webcam index for ${station}`, cause);
  }

  if (response.status === 404) {
    throw new DwdError(`DWD has no webcam named '${station}'.`);
  }
  if (!response.ok) {
    throw new DwdError(`DWD returned ${response.status} for the ${station} webcam index`);
  }

  const html = await response.text();
  const stamps: number[] = [];

  for (const match of html.matchAll(FRAME_PATTERN)) {
    const [, name, date, time, res] = match;
    if (name !== station) continue;
    if (Number(res) !== resolution) continue;

    const t = parseFrameStamp(date, time);
    if (Number.isFinite(t)) stamps.push(t);
  }

  if (stamps.length === 0) {
    throw new DwdError(
      `The DWD index for ${station} lists no ${resolution}px frames. The camera may be ` +
        `offline, or may not publish this size.`,
    );
  }

  stamps.sort((a, b) => a - b);
  return stamps;
}
