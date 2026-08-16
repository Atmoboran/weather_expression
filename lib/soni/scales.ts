/**
 * The musical vocabulary the sonification draws on, ported from the upstream
 * project's `src/functions/soni_functions.py`.
 *
 * The organising idea is Vivaldi's: each season gets its own key, and the
 * temperature range that counts as "normal" shifts with it. A 5 °C reading is
 * near the bottom of summer's range and comfortably mid-scale in winter, so the
 * same temperature produces a different note depending on when it was measured.
 * That is deliberate — the music encodes *anomaly*, not absolute degrees.
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Scale = 'E major' | 'G minor' | 'F major' | 'F minor';

/**
 * Meteorological seasons, from the observation's UTC month.
 *
 * UTC rather than Europe/Berlin, matching upstream. The two disagree only for
 * observations in the first hour or two of the 1st of a month, and only in the
 * four months that begin a season — at which point the argument for either is
 * equally thin.
 */
export function getSeason(t: number): Season {
  const month = new Date(t).getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export const SEASON_SCALE: Record<Season, Scale> = {
  spring: 'E major',
  summer: 'G minor',
  autumn: 'F major',
  winter: 'F minor',
};

/**
 * The temperature window each season's scale spans, in °C.
 *
 * Readings outside it are clamped, so an unseasonable day pins to the top or
 * bottom note rather than running off the scale.
 */
export const SEASON_TEMP_RANGE: Record<Season, [min: number, max: number]> = {
  spring: [-5, 25],
  summer: [5, 35],
  autumn: [-10, 25],
  winter: [-20, 15],
};

/**
 * Each scale as an ascending note list spanning six octaves.
 *
 * Not a plain scale: the low octaves are sparse (root, root, third) and the
 * middle octaves are dense pentatonic runs. Mapping temperature across this list
 * therefore spends most of its resolution in the middle of the range, where
 * readings actually cluster, and moves in bigger leaps at the extremes.
 */
export const SCALE_NOTES: Record<Scale, string[]> = {
  'E major': [
    'E1', 'E2', 'G#2',
    'E3', 'F#3', 'G#3', 'B3', 'C#4',
    'E4', 'F#4', 'G#4', 'B4', 'C#5',
    'E5', 'F#5', 'G#5', 'B5', 'C#6',
    'E6', 'F#6', 'G#6', 'B6', 'C#7',
  ],
  'G minor': [
    'G1', 'G2', 'C3',
    'G3', 'A#3', 'C4', 'D4', 'F4',
    'G4', 'A#4', 'C5', 'D5', 'F5',
    'G5', 'A#5', 'C6', 'D6', 'F6',
    'G6', 'A#6', 'C7', 'D7', 'F7',
  ],
  'F major': [
    'F1', 'F2', 'A2',
    'F3', 'G3', 'A3', 'C4', 'D4',
    'F4', 'G4', 'A4', 'C5', 'D5',
    'F5', 'G5', 'A5', 'C6', 'D6',
    'F6', 'G6', 'A6', 'C7', 'D7',
  ],
  'F minor': [
    'F1', 'F2', 'A#2',
    'F3', 'G#3', 'A#3', 'C4', 'D#4',
    'F4', 'G#4', 'A#4', 'C5', 'D#5',
    'F5', 'G#5', 'A#5', 'C6', 'D#6',
    'F6', 'G#6', 'A#6', 'C7', 'D#7',
  ],
};

/** Tonic, subdominant and dominant triads for each scale. */
export const SCALE_CHORDS: Record<Scale, Record<'I' | 'IV' | 'V', string[]>> = {
  'E major': {
    I: ['E3', 'G#3', 'B3'],
    IV: ['A3', 'C#4', 'E4'],
    V: ['B3', 'D#4', 'F#4'],
  },
  'G minor': {
    I: ['G3', 'A#3', 'D4'],
    IV: ['C4', 'D#4', 'G4'],
    V: ['D4', 'F4', 'A4'],
  },
  'F major': {
    I: ['F3', 'A3', 'C4'],
    IV: ['A#3', 'D4', 'F4'],
    V: ['C4', 'E4', 'G4'],
  },
  'F minor': {
    I: ['F3', 'G#3', 'C4'],
    IV: ['A#3', 'C#4', 'F4'],
    V: ['C4', 'D#4', 'G4'],
  },
};

const SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
  'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

/**
 * Corrects the octave of every pitch produced by `noteToMidi`.
 *
 * Upstream's note table starts at C0 = 0. The MIDI standard puts C0 at 12
 * (A4 = 69 = 440 Hz), so every note in that table is written an octave below
 * the name it carries, and the original renders an octave lower than its own
 * scale tables claim. Writing a MIDI file lets a listener shrug that off;
 * synthesising directly does not, and the bass — the melody less two octaves —
 * lands near the bottom of human hearing without this.
 */
export const PITCH_OFFSET = 12;

/** `"C#4"` -> MIDI note number. Throws on anything unparseable. */
export function noteToMidi(note: string): number {
  const match = /^([A-G]#?)(\d)$/.exec(note);
  if (!match) throw new Error(`Invalid note name: ${note}`);

  const [, name, octave] = match;
  return SEMITONES[name] + Number(octave) * 12 + PITCH_OFFSET;
}

/** Linear rescale of `value` from one range onto another. No clamping. */
export function mapValue(
  value: number,
  minValue: number,
  maxValue: number,
  minResult: number,
  maxResult: number,
): number {
  return minResult + ((value - minValue) / (maxValue - minValue)) * (maxResult - minResult);
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Rounds half away from zero, the way Python's `round()` does *not*.
 *
 * Python uses banker's rounding, so `round(0.5)` is 0 and `round(1.5)` is 2.
 * JavaScript's `Math.round` always rounds .5 upward. The difference lands on
 * exactly one note index per run at most, but it is the kind of discrepancy
 * that makes a port impossible to check against its original, so it is spelled
 * out here rather than discovered later.
 */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}
