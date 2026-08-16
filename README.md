# What the weather sounds like

Two days of German weather-station data and webcam imagery, played as music in
the browser.

Temperature picks the note from a seasonal scale, wind speed sets how loud it is,
the pressure gradient stretches or splits the rhythm, and rainfall opens a track
that is otherwise silent. The picture above the charts is the sky those numbers
were measured under, frame-matched to the moment.

A browser-native rebuild of
[music_video_from_weather](https://github.com/sandysgits/music_video_from_weather)
by **sandysgits**, supported by the UPAS Student Idea Pot 2024. The original
renders an MP4 offline with matplotlib and ffmpeg; this plays the same
composition live, with nothing to render and nothing to download.

## Status

Working end to end against live DWD data. Not deployed — see
[Before deploying](#before-deploying).

## Running it

```bash
npm install
npm run dev
```

No environment variables, no database, no accounts. Everything comes from
[opendata.dwd.de](https://opendata.dwd.de) at request time.

```bash
npm run check     # lint + typecheck + tests
```

## How it fits together

```
browser ── /api/session/[webcam] ──┬── opendata.dwd.de webcam index   (which frames exist)
        │                          └── opendata.dwd.de 10-minute feeds (temperature, wind, rain)
        └─ /api/frame/[webcam]/[t] ─── opendata.dwd.de webcam JPEG     (proxied, cached a year)
```

`/api/session` fetches both sides, joins them on exact timestamp equality — both
publish on the same 10-minute UTC grid — and returns only the moments where a
frame and a complete reading both exist. The browser composes the music from
those rows and schedules it through Web Audio.

There is no build step for the data and no scheduled job. The CDN is the cache:
sessions are held for five minutes, and individual frames — which are immutable
once published — for a year.

### Layout

| Path | What lives there |
|---|---|
| `lib/dwd/` | Talking to DWD: the station/webcam map, the product-file parser, the archive fetcher |
| `lib/soni/` | The sonification. `scales.ts` is the vocabulary, `compose.ts` turns observations into notes |
| `lib/audio/` | Web Audio playback |
| `lib/session.ts` | Pairing frames with readings |
| `components/` | The player, the charts, the canvas stage |
| `app/api/` | The two route handlers |

## The sonification

Ported from `src/functions/make_midi.py` and `soni_functions.py` upstream. Every
mapping is theirs:

| Track | Driven by | Mapping |
|---|---|---|
| Melody | Temperature | Pitch within the season's scale |
| Bass | Melody, two octaves down | Split in two when pressure rises, held when it falls |
| Harmony | Season | I–IV–V–IV, lifted an octave on a rising gradient |
| Drums | Pressure level | Three hits per step; louder the lower the pressure |
| Rain | Rainfall | Silent when dry — the one track whose absence is information |

Vivaldi picks the keys: spring is E major, summer G minor, autumn F major, winter
F minor. Each season also carries its own temperature range, so the music encodes
*anomaly* rather than absolute degrees — 5 °C is the bottom of summer's scale and
mid-range in winter's.

One observation every 30 minutes becomes one three-beat step. At the default 420
BPM a 48-hour session plays in about 41 seconds.

### Verifying the port

`lib/soni/parity.test.ts` diffs this implementation against the original Python,
note for note. `lib/soni/__fixtures__/oracle.py` runs upstream's own
`produce_midi_file` over 180 synthetic observations covering all four seasons,
both signs of the pressure gradient, all four bass-volume bands and readings past
every clamp, and records every note it emits. The TypeScript must reproduce all
445 of them exactly.

That test is the reason to trust the rest. The mappings *are* the project — a
plausible misreading of them would still pass unit tests written from the same
misreading.

To regenerate the fixture, check the upstream repo out beside the script and run:

```bash
python3 lib/soni/__fixtures__/oracle.py
```

### Two deliberate deviations

**Pitch is an octave higher.** Upstream's note table puts C0 at 0; MIDI puts it at
12, so the original renders an octave below the note names in its own scale
tables. Writing a MIDI file lets a listener shrug that off — synthesising
directly does not, and the bass lands near the floor of human hearing without the
correction. See `PITCH_OFFSET` in `lib/soni/scales.ts`; the parity test applies
the same shift to the reference before comparing, so the deviation stays visible
rather than absorbed.

**Synthesised voices, not a soundfont.** Five Tone.js voices stand in for the
General MIDI programs upstream selects. A real GM soundfont is several megabytes
for instruments that are, in the end, a stand-in for weather.

## Known quirks

**Mountain stations always play loud.** Schmücke (938 m) and Wasserkuppe (920 m)
report station-level pressure around 909 hPa, which sits permanently inside
upstream's `pressure < 980` band — so their bass is pinned at maximum for the
whole piece. That is faithful to the original, whose thresholds assume
near-sea-level pressure. Worth fixing one day by making the bands relative to each
station's own median.

**Hohenpeißenberg is missing.** DWD lists the camera but its directory is empty —
no frames at any resolution. It is the most interesting site of the nine (the
world's oldest mountain observatory, running since 1781), so it is worth
re-checking; see the comment in `lib/dwd/stations.ts` for how to add it back.

**Cameras have gaps.** Offenbach-O currently publishes about 125 usable frames
where Offenbach-W has 285. Unmatched frames and unmatched readings are both
dropped, which shortens the piece rather than inventing data.

## Before deploying

Three things are unresolved and none of them is code:

1. **Licence.** The upstream repository has no `LICENSE` file, which means all
   rights reserved by default. The sonification rules here are ported from it.
   Get permission or a licence from sandysgits / UPAS before publishing.
2. **DWD webcam terms.** The station data is open with attribution (GeoNutzV).
   Redistributing webcam *imagery* on a public site is a separate question from
   downloading it for personal use — read the terms rather than assuming.
3. **Vercel Hobby is non-commercial only.** Likely fine for a publicly funded
   outreach project, but worth a glance given the UPAS affiliation.

On cost: a visitor who plays a full session pulls about 9 MB (285 frames at ~30 KB,
plus ~30 KB of JSON). At 100 visitors a month that is well under 1% of a Vercel
Hobby bandwidth allowance. Nothing here needs Supabase.

## Attribution

Weather data and webcam imagery: **Deutscher Wetterdienst (DWD)**, via
opendata.dwd.de.

Sonification design: **sandysgits**, `music_video_from_weather`, supported by the
UPAS Student Idea Pot 2024 — <https://www.meteo-upas.de/>.
