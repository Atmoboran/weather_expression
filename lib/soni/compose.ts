import type { WeatherRow } from '@/lib/dwd/product';
import {
  SCALE_CHORDS,
  SCALE_NOTES,
  SEASON_SCALE,
  SEASON_TEMP_RANGE,
  clamp,
  getSeason,
  mapValue,
  noteToMidi,
  roundHalfEven,
  type Scale,
  type Season,
} from './scales';

/**
 * Turns a run of weather observations into a note schedule.
 *
 * A faithful port of `produce_midi_file` from the upstream project, with one
 * change of product rather than logic: it returns notes in beats instead of
 * writing MIDI bytes, so the browser can schedule them directly. Every mapping
 * decision — which pitch, how loud, how long — is upstream's.
 *
 * The mappings, in one place:
 *
 *   temperature       -> pitch, within the season's scale
 *   wind speed        -> velocity, 0-15 m/s across the usable range
 *   pressure gradient -> rhythm; rising splits notes, falling stretches them
 *   pressure level    -> bass volume; low pressure is loud
 *   rainfall          -> velocity of the rain track, which is silent when dry
 */

/** Beats per observation step. Upstream's `duration`. */
export const STEP_BEATS = 3;

/**
 * Wind speed at which velocity tops out, m/s.
 * Beyond this it would only get louder, and 15 m/s is already a strong gale.
 */
export const MAX_WIND_SPEED = 15;

/** The progression the harmony track cycles through, one chord per three steps. */
export const CHORD_PATTERN = ['I', 'IV', 'V', 'IV'] as const;

/**
 * Pressure floor, hPa.
 *
 * Readings under 100 hPa are not weather at sea level or on any German
 * mountain — they are a sensor fault that survived the -999 filter. Upstream
 * substitutes 900 rather than dropping the row, which keeps the melody
 * continuous through a bad barometer.
 */
const PRESSURE_FLOOR = 900;
const PRESSURE_SUBSTITUTE = 900;

const MIDI_PITCH_MIN = 0;
const MIDI_PITCH_MAX = 127;

export const TRACKS = [
  { name: 'Melody', drives: 'temperature' },
  { name: 'Bass', drives: 'pressure' },
  { name: 'Harmony', drives: 'season' },
  { name: 'Drums', drives: 'temperature' },
  { name: 'Rain', drives: 'rainfall' },
] as const;

export type TrackIndex = 0 | 1 | 2 | 3 | 4;

export type Note = {
  track: TrackIndex;
  /** MIDI note number, 0-127. */
  pitch: number;
  /** Onset, in beats from the start of the piece. */
  time: number;
  /** Length in beats. */
  duration: number;
  /** MIDI velocity, 0-127. */
  velocity: number;
};

/** One observation's worth of music, kept for the UI to narrate. */
export type Step = {
  /** Observation time, epoch ms UTC. */
  t: number;
  /** Index into the full row list this step was sampled from. */
  rowIndex: number;
  season: Season;
  scale: Scale;
  /** The melody note sounding during this step. */
  noteName: string;
  /** Change in pressure since the previous step, hPa. */
  pressureGradient: number;
};

export type Composition = {
  notes: Note[];
  steps: Step[];
  /** Total length in beats. */
  beats: number;
};

export type ComposeOptions = {
  /** Quietest note, MIDI velocity. */
  velMin?: number;
  /** Loudest note, MIDI velocity. */
  velMax?: number;
};

function clampPitch(pitch: number): number {
  return clamp(Math.trunc(pitch), MIDI_PITCH_MIN, MIDI_PITCH_MAX);
}

/**
 * Bass volume as a step function of absolute pressure.
 *
 * Low pressure is loud and high pressure is quiet, which is the piece's one
 * genuinely emotional mapping: a deepening low audibly leans on the music
 * before the melody line makes the drop obvious.
 */
function bassVolume(pressure: number, volume: number, velMin: number, velMax: number): number {
  const base = volume - 10;
  let adjusted: number;

  if (pressure < 980) adjusted = base + 10;
  else if (pressure < 1013.25) adjusted = base + 5;
  else if (pressure > 1040) adjusted = base - 10;
  else adjusted = base - 5;

  return clamp(adjusted, velMin, velMax);
}

export function compose(rows: WeatherRow[], options: ComposeOptions = {}): Composition {
  const velMin = options.velMin ?? 30;
  const velMax = options.velMax ?? 127;

  if (rows.length === 0) {
    throw new Error('Cannot compose from an empty observation list.');
  }

  // One note per three observations — 30 minutes of weather per step. Sampling
  // rather than averaging is upstream's choice, and it matters: a 10-minute rain
  // burst between two sampled rows is inaudible, which is why the plots stay on
  // screen alongside the music.
  const steps: { row: WeatherRow; rowIndex: number }[] = [];
  for (let i = 0; i < rows.length; i += STEP_BEATS) {
    steps.push({ row: rows[i], rowIndex: i });
  }

  // Gradients are computed over the sampled rows, so each one spans 30 minutes.
  // The first step has nothing to compare against and is treated as steady.
  const pressures = steps.map(({ row }) =>
    row.pressure >= 100 ? row.pressure : PRESSURE_SUBSTITUTE,
  );
  const gradients = pressures.map((p, i) => (i === 0 ? 0 : p - pressures[i - 1]));

  const notes: Note[] = [];
  const stepInfo: Step[] = [];
  let time = 0;

  steps.forEach(({ row, rowIndex }, idx) => {
    const season = getSeason(row.t);
    const scale = SEASON_SCALE[season];
    const scaleNotes = SCALE_NOTES[scale];
    const chords = SCALE_CHORDS[scale];
    const [minTemp, maxTemp] = SEASON_TEMP_RANGE[season];

    const temperature = clamp(row.temperature, minTemp, maxTemp);
    const windSpeed = Math.min(Math.abs(row.windSpeed), MAX_WIND_SPEED);
    const pressure = row.pressure >= 100 ? row.pressure : PRESSURE_FLOOR;
    const rain = clamp(row.precipitation, 0, 5);
    const gradient = gradients[idx];

    const noteIndex = clamp(
      roundHalfEven(mapValue(temperature, minTemp, maxTemp, 0, scaleNotes.length - 1)),
      0,
      scaleNotes.length - 1,
    );
    const noteName = scaleNotes[noteIndex];
    const pitch = noteToMidi(noteName);

    const volume = roundHalfEven(mapValue(windSpeed, 0, MAX_WIND_SPEED, velMin, velMax));

    // Rising pressure shortens the note to well under its slot, leaving audible
    // space; falling pressure overruns the slot so notes bleed into each other.
    const melodyDuration = gradient >= 0 ? 0.5 * STEP_BEATS : 1.1 * STEP_BEATS;

    notes.push({
      track: 0,
      pitch: clampPitch(pitch),
      time,
      duration: melodyDuration,
      velocity: volume,
    });

    // Track 1 doubles the melody two octaves down, split in two when pressure
    // is rising and held as one note when it is falling.
    const lowPitch = clampPitch(pitch - 24);
    if (gradient >= 0) {
      notes.push({ track: 1, pitch: lowPitch, time, duration: 0.5 * STEP_BEATS, velocity: volume - 10 });
      notes.push({
        track: 1,
        pitch: lowPitch,
        time: time + 0.5 * STEP_BEATS,
        duration: 0.5 * STEP_BEATS,
        velocity: volume - 10,
      });
    } else {
      notes.push({ track: 1, pitch: lowPitch, time, duration: STEP_BEATS, velocity: volume - 10 });
    }

    // A chord every third step, held across all three.
    if (idx % 3 === 0) {
      const chordName = CHORD_PATTERN[Math.floor(idx / 3) % CHORD_PATTERN.length];
      const chordNotes = chords[chordName];
      const transpose = gradient >= 0 ? 12 : 0;

      for (const name of chordNotes) {
        notes.push({
          track: 2,
          pitch: clampPitch(noteToMidi(name) + transpose),
          time,
          duration: 3 * STEP_BEATS,
          velocity: volume - 10,
        });
      }
    }

    // Track 3 is the pulse: three even hits per step, at a volume set by how
    // low the pressure is.
    const drumVolume = bassVolume(pressure, volume, velMin, velMax);
    for (let hit = 0; hit < 3; hit++) {
      notes.push({
        track: 3,
        pitch: lowPitch,
        time: time + (hit * STEP_BEATS) / 3,
        duration: STEP_BEATS / 3,
        velocity: drumVolume,
      });
    }

    // Silent unless it is actually raining — the one track whose absence is
    // information.
    if (rain > 0) {
      notes.push({
        track: 4,
        pitch: clampPitch(pitch),
        time,
        duration: STEP_BEATS,
        velocity: roundHalfEven(mapValue(rain, 0, 5, velMin, velMax)),
      });
    }

    stepInfo.push({
      t: row.t,
      rowIndex,
      season,
      scale,
      noteName,
      pressureGradient: gradient,
    });

    time += STEP_BEATS;
  });

  return { notes, steps: stepInfo, beats: time };
}

/** MIDI note number -> Hz, equal temperament, A4 = 440. */
export function midiToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}
