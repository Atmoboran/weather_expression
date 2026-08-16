/**
 * The nine DWD webcams, each paired with the weather station whose readings
 * drive the music.
 *
 * DWD publishes webcam imagery for a fixed, small set of its own sites
 * (https://opendata.dwd.de/weather/webcam/). Every entry below was checked
 * against the live directory listing and against the 10-minute product feeds:
 * each `stationId` returns HTTP 200 for all three feeds (air temperature,
 * precipitation, wind), which is what `fetchWeather` needs to build a row.
 *
 * Pairing rule: prefer the station co-located with the camera. The upstream
 * project's README suggests Frankfurt airport (01420) for the Offenbach
 * cameras, but Offenbach-Wetterpark (07341) is the site the cameras actually
 * stand at, ~25 km away from the airport — close enough to look similar on a
 * calm day and quite different during a passing shower.
 */

export type Webcam = {
  /** DWD webcam id — also the directory name and the image filename prefix. */
  id: string;
  /** Human label for the UI. */
  label: string;
  /** Which way the camera points, spelled out from the id's suffix. */
  bearing: string;
  /** DWD 10-minute station id, zero-padded to five digits. */
  stationId: string;
  /** Station name as DWD spells it. */
  stationName: string;
  /** Station elevation in metres, from the station description file. */
  elevationM: number;
  /** Roughly what you are looking at, to orient a visitor. */
  blurb: string;
};

export const WEBCAMS: Webcam[] = [
  {
    id: 'Offenbach-W',
    label: 'Offenbach',
    bearing: 'west',
    stationId: '07341',
    stationName: 'Offenbach-Wetterpark',
    elevationM: 119,
    blurb: "Looking west from DWD's headquarters towards the Frankfurt skyline.",
  },
  {
    id: 'Offenbach-O',
    label: 'Offenbach',
    bearing: 'east',
    stationId: '07341',
    stationName: 'Offenbach-Wetterpark',
    elevationM: 119,
    blurb: 'The opposite view from the same roof — weather arriving from behind you.',
  },
  {
    id: 'Hamburg-SW',
    label: 'Hamburg',
    bearing: 'southwest',
    stationId: '01975',
    stationName: 'Hamburg-Fuhlsbüttel',
    elevationM: 11,
    blurb: 'North German coastal air, 11 m above sea level and rarely still.',
  },
  {
    id: 'Hamburg-SO',
    label: 'Hamburg',
    bearing: 'southeast',
    stationId: '01975',
    stationName: 'Hamburg-Fuhlsbüttel',
    elevationM: 11,
    blurb: 'The second Hamburg camera, turned towards the city.',
  },
  // Hohenpeissenberg-S is deliberately absent.
  //
  // DWD lists the camera at https://opendata.dwd.de/weather/webcam/ but its
  // directory holds nothing at all — not a single frame at any resolution, not
  // even the `_latest` alias every other camera publishes. It is the most
  // interesting site of the nine (the world's oldest mountain observatory,
  // running since 1781, station 02290 at 977 m), so it is worth re-checking
  // occasionally: if frames reappear, add it back with stationId '02290'. The
  // session route already degrades to a clear message, but a picker entry that
  // always fails is worse than one that isn't offered.
  {
    id: 'Wasserkuppe-SW',
    label: 'Wasserkuppe',
    bearing: 'southwest',
    stationId: '05371',
    stationName: 'Wasserkuppe',
    elevationM: 920,
    blurb: 'The highest point of the Rhön. Windy enough that gliding was invented here.',
  },
  {
    id: 'Schmuecke-SW',
    label: 'Schmücke',
    bearing: 'southwest',
    stationId: '04501',
    stationName: 'Schmücke',
    elevationM: 938,
    blurb: 'A ridge station in the Thuringian Forest, often inside the cloud rather than under it.',
  },
  {
    id: 'Warnemuende-NW',
    label: 'Warnemünde',
    bearing: 'northwest',
    stationId: '04271',
    stationName: 'Rostock-Warnemünde',
    elevationM: 5,
    blurb: 'Baltic coast, looking out over the water.',
  },
  {
    id: 'Lindenberg-NNE',
    label: 'Lindenberg',
    bearing: 'north-northeast',
    stationId: '03015',
    stationName: 'Lindenberg',
    elevationM: 98,
    blurb: 'Brandenburg flatland — a research observatory with a very long horizon.',
  },
];

export const DEFAULT_WEBCAM_ID = 'Offenbach-W';

export function findWebcam(id: string): Webcam | undefined {
  return WEBCAMS.find((w) => w.id === id);
}

/**
 * Image widths DWD publishes for every frame. 400 is the default: at ~30 KB per
 * frame a full 48-hour span is ~8.6 MB, which is a reasonable thing to stream to
 * a browser. 1920 would be ~20x that for the same 288 frames.
 */
export const RESOLUTIONS = [400, 640, 816, 1200, 1920] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const DEFAULT_RESOLUTION: Resolution = 400;
