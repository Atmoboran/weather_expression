/**
 * Parser for DWD 10-minute "produkt_*.txt" files.
 *
 * Format, verified against the live feeds:
 *
 *   STATIONS_ID;MESS_DATUM;  QN;PP_10;TT_10;TM5_10;RF_10;TD_10;eor
 *          1420;202608160000;    2; 1002.8;  24.1;  23.7;  48.4;  12.5;eor
 *
 * Semicolon separated, every field space-padded to a fixed width, a literal
 * `eor` terminator, and a header row naming the columns. MESS_DATUM is
 * YYYYMMDDHHMM in **UTC** — the same clock the webcam filenames use, which is
 * what lets the two be paired on an exact timestamp match.
 */

/**
 * DWD writes -999 where an instrument reported nothing. Anything at or below
 * this is a gap in the record, not a reading.
 *
 * This threshold is the single most important number in the file. Treating a
 * sentinel as data does not fail loudly: -999 °C maps to the bottom note of the
 * scale, -999 m/s maps to full velocity, and a -999 hPa point drags a plot's
 * y-axis down so far that the real signal collapses into a flat line.
 */
export const MISSING_THRESHOLD = -900;

/** One 10-minute observation, after the three feeds have been joined. */
export type WeatherRow = {
  /** Observation time, epoch milliseconds UTC. */
  t: number;
  /** Air temperature, °C. */
  temperature: number;
  /** Pressure at station level, hPa. */
  pressure: number;
  /** Mean wind speed, m/s. */
  windSpeed: number;
  /** Precipitation in the 10-minute interval, mm. */
  precipitation: number;
};

/** The DWD variable codes this app reads, and the column each one contributes. */
export const FEEDS = {
  tu: ['PP_10', 'TT_10'],
  ff: ['FF_10'],
  rr: ['RWS_10'],
} as const;

export type FeedCode = keyof typeof FEEDS;

/** `202608160000` -> epoch ms. Returns NaN for anything malformed. */
export function parseMessDatum(raw: string): number {
  const s = raw.trim();
  if (!/^\d{12}$/.test(s)) return NaN;
  return Date.UTC(
    Number(s.slice(0, 4)),
    Number(s.slice(4, 6)) - 1,
    Number(s.slice(6, 8)),
    Number(s.slice(8, 10)),
    Number(s.slice(10, 12)),
  );
}

/**
 * Reads a product file into `timestamp -> { column: value }`.
 *
 * Only `wanted` columns are kept. Rows whose timestamp will not parse are
 * dropped rather than carried as NaN, and so are values at the missing
 * sentinel — a partial row is useless downstream, and letting one through
 * would push the sentinel into whichever consumer forgot to re-check.
 *
 * `tailLines` limits the work to the end of the file. The `recent` feed is
 * ~5.7 MB and reaches back 18 months, but the webcams only retain about two
 * days, so everything before that can never be paired with an image.
 */
export function parseProduct(
  text: string,
  wanted: readonly string[],
  tailLines?: number,
): Map<number, Record<string, number>> {
  const out = new Map<number, Record<string, number>>();

  const newline = text.indexOf('\n');
  if (newline === -1) return out;

  const header = text
    .slice(0, newline)
    .split(';')
    .map((h) => h.trim());

  const dateIdx = header.indexOf('MESS_DATUM');
  if (dateIdx === -1) return out;

  const columns = wanted
    .map((name) => ({ name, idx: header.indexOf(name) }))
    .filter((c) => c.idx !== -1);
  if (columns.length !== wanted.length) return out;

  let lines = text.slice(newline + 1).split('\n');
  if (tailLines !== undefined && lines.length > tailLines) {
    lines = lines.slice(-tailLines);
  }

  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.split(';');

    const t = parseMessDatum(fields[dateIdx] ?? '');
    if (Number.isNaN(t)) continue;

    const record: Record<string, number> = {};
    let usable = true;
    for (const { name, idx } of columns) {
      const value = Number((fields[idx] ?? '').trim());
      if (!Number.isFinite(value) || value <= MISSING_THRESHOLD) {
        usable = false;
        break;
      }
      record[name] = value;
    }
    if (usable) out.set(t, record);
  }

  return out;
}

/**
 * Inner-joins the three feeds on their shared timestamps.
 *
 * Inner rather than outer on purpose: the sonification reads all four
 * measurements for every note it writes, so a timestamp missing any one of them
 * cannot produce a note. Dropping it here shortens the piece; carrying it would
 * mean re-checking for holes at every use site.
 */
export function joinFeeds(feeds: Map<number, Record<string, number>>[]): WeatherRow[] {
  if (feeds.length === 0) return [];

  const [first, ...rest] = feeds;
  const rows: WeatherRow[] = [];

  for (const [t, values] of first) {
    const merged: Record<string, number> = { ...values };
    let complete = true;

    for (const feed of rest) {
      const other = feed.get(t);
      if (!other) {
        complete = false;
        break;
      }
      Object.assign(merged, other);
    }
    if (!complete) continue;

    rows.push({
      t,
      pressure: merged.PP_10,
      temperature: merged.TT_10,
      windSpeed: merged.FF_10,
      precipitation: merged.RWS_10,
    });
  }

  rows.sort((a, b) => a.t - b.t);
  return rows;
}
