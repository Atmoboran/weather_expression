import { unzipSync } from 'fflate';
import { FEEDS, joinFeeds, parseProduct, type FeedCode, type WeatherRow } from './product';

/**
 * Fetches and joins the DWD 10-minute observations for one station.
 *
 * Each variable lives in its own zip, and each is published twice: a `now` feed
 * covering the current day only (~1.7 KB) and a `recent` feed reaching back
 * about 18 months (~840 KB zipped, ~5.7 MB open). Both are needed — the window
 * we care about straddles midnight — but only the tail of `recent` is ever read.
 */

const BASE =
  'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/10_minutes';

/** Directory and filename infix DWD uses for each variable. */
const FEED_PATHS: Record<FeedCode, { dir: string; code: string }> = {
  tu: { dir: 'air_temperature', code: 'TU' },
  ff: { dir: 'wind', code: 'wind' },
  rr: { dir: 'precipitation', code: 'nieder' },
};

/**
 * How much of the `recent` file to read, in lines from the end.
 *
 * 2000 lines is about 14 days at one row per 10 minutes — far more than the
 * ~2 days of webcam imagery that can ever be paired with it, and small enough
 * that the 78,000-line file never gets fully walked.
 */
const RECENT_TAIL_LINES = 2000;

const FETCH_TIMEOUT_MS = 20_000;

export class DwdError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'DwdError';
  }
}

async function fetchZipMember(url: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'weather-sonification (open data, non-commercial)' },
      cache: 'no-store',
    });
  } catch (cause) {
    throw new DwdError(`Could not reach DWD at ${url}`, cause);
  }

  // A missing `now` file is normal shortly after midnight UTC, before the day's
  // first product has been written. Absence is not an error; an empty result
  // just means this feed contributes nothing and `recent` carries the window.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new DwdError(`DWD returned ${response.status} for ${url}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buffer);
  } catch (cause) {
    throw new DwdError(`DWD sent something that is not a zip archive: ${url}`, cause);
  }

  // These archives hold exactly one produkt_*.txt. Pick it by name rather than
  // by position so an added readme or checksum file cannot displace it.
  const name = Object.keys(entries).find((n) => n.startsWith('produkt_') && n.endsWith('.txt'));
  if (!name) {
    throw new DwdError(`No produkt_*.txt inside ${url}`);
  }

  return new TextDecoder('latin1').decode(entries[name]);
}

/** Reads one variable from both feeds, with `now` winning on overlapping timestamps. */
async function loadFeed(
  stationId: string,
  feed: FeedCode,
): Promise<Map<number, Record<string, number>>> {
  const { dir, code } = FEED_PATHS[feed];
  const columns = FEEDS[feed];

  const [recentText, nowText] = await Promise.all([
    fetchZipMember(`${BASE}/${dir}/recent/10minutenwerte_${code}_${stationId}_akt.zip`),
    fetchZipMember(`${BASE}/${dir}/now/10minutenwerte_${code}_${stationId}_now.zip`),
  ]);

  const merged = recentText ? parseProduct(recentText, columns, RECENT_TAIL_LINES) : new Map();

  // The two feeds overlap across the current day. `now` is the fresher of the
  // two for those timestamps, so it is applied second and overwrites.
  if (nowText) {
    for (const [t, values] of parseProduct(nowText, columns)) {
      merged.set(t, values);
    }
  }

  return merged;
}

/**
 * Returns every complete observation for a station at or after `sinceMs`,
 * oldest first.
 */
export async function fetchWeather(stationId: string, sinceMs: number): Promise<WeatherRow[]> {
  const codes = Object.keys(FEEDS) as FeedCode[];
  const feeds = await Promise.all(codes.map((code) => loadFeed(stationId, code)));

  const rows = joinFeeds(feeds).filter((row) => row.t >= sinceMs);

  if (rows.length === 0) {
    throw new DwdError(
      `No usable 10-minute observations for station ${stationId} since ` +
        `${new Date(sinceMs).toISOString()}. The station may be offline, or DWD may not ` +
        `have published all three of temperature, wind and precipitation for this window.`,
    );
  }

  return rows;
}

export type { WeatherRow };
