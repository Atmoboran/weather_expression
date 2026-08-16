import { describe, expect, it } from 'vitest';
import type { WeatherRow } from '@/lib/dwd/product';
import { CHORD_PATTERN, STEP_BEATS, compose, midiToFrequency } from './compose';
import { noteToMidi } from './scales';

/** 2026-08-16 is summer, so the scale is G minor over a 5-35 °C range. */
const BASE = Date.UTC(2026, 7, 16, 0, 0);
const TEN_MIN = 10 * 60_000;

function makeRows(count: number, patch: Partial<WeatherRow>[] = []): WeatherRow[] {
  return Array.from({ length: count }, (_, i) => ({
    t: BASE + i * TEN_MIN,
    temperature: 20,
    pressure: 1000,
    windSpeed: 0,
    precipitation: 0,
    ...patch[i],
  }));
}

const track = (notes: ReturnType<typeof compose>['notes'], index: number) =>
  notes.filter((n) => n.track === index);

describe('compose — sampling', () => {
  it('takes every third observation, so one note covers 30 minutes', () => {
    const { steps, beats } = compose(makeRows(10));

    expect(steps.map((s) => s.rowIndex)).toEqual([0, 3, 6, 9]);
    expect(beats).toBe(4 * STEP_BEATS);
  });

  it('keeps a short run rather than failing', () => {
    expect(compose(makeRows(1)).steps).toHaveLength(1);
    expect(compose(makeRows(2)).steps).toHaveLength(1);
  });

  it('refuses an empty run', () => {
    expect(() => compose([])).toThrow(/empty/i);
  });
});

describe('compose — temperature to pitch', () => {
  it('places mid-range summer temperature at the middle of the G minor scale', () => {
    const { steps, notes } = compose(makeRows(1, [{ temperature: 20 }]));

    expect(steps[0].season).toBe('summer');
    expect(steps[0].scale).toBe('G minor');
    expect(steps[0].noteName).toBe('D5');
    expect(track(notes, 0)[0].pitch).toBe(noteToMidi('D5'));
  });

  it('pins the extremes of the season range to the ends of the scale', () => {
    expect(compose(makeRows(1, [{ temperature: 5 }])).steps[0].noteName).toBe('G1');
    expect(compose(makeRows(1, [{ temperature: 35 }])).steps[0].noteName).toBe('F7');
  });

  it('clamps a reading outside the season range instead of running off the scale', () => {
    expect(compose(makeRows(1, [{ temperature: -40 }])).steps[0].noteName).toBe('G1');
    expect(compose(makeRows(1, [{ temperature: 99 }])).steps[0].noteName).toBe('F7');
  });

  it('reads the same temperature differently in a different season', () => {
    const winter = Date.UTC(2026, 0, 16, 0, 0);
    const rows: WeatherRow[] = [
      { t: winter, temperature: 5, pressure: 1000, windSpeed: 0, precipitation: 0 },
    ];
    const { steps } = compose(rows);

    // 5 °C is the bottom of summer's range but well up winter's [-20, 15].
    expect(steps[0].scale).toBe('F minor');
    expect(steps[0].noteName).not.toBe('F1');
  });
});

describe('compose — wind to velocity', () => {
  it('maps still air to the floor and a gale to the ceiling', () => {
    expect(track(compose(makeRows(1, [{ windSpeed: 0 }])).notes, 0)[0].velocity).toBe(30);
    expect(track(compose(makeRows(1, [{ windSpeed: 15 }])).notes, 0)[0].velocity).toBe(127);
  });

  it('treats wind beyond the ceiling as the ceiling', () => {
    expect(track(compose(makeRows(1, [{ windSpeed: 40 }])).notes, 0)[0].velocity).toBe(127);
  });

  it('honours a custom velocity range', () => {
    const { notes } = compose(makeRows(1, [{ windSpeed: 0 }]), { velMin: 60, velMax: 100 });
    expect(track(notes, 0)[0].velocity).toBe(60);
  });
});

describe('compose — pressure gradient to rhythm', () => {
  it('treats the first step as steady, since it has nothing to compare against', () => {
    const { steps, notes } = compose(makeRows(1));
    expect(steps[0].pressureGradient).toBe(0);
    expect(track(notes, 0)[0].duration).toBe(0.5 * STEP_BEATS);
  });

  it('shortens the melody note when pressure is rising', () => {
    // Sampled rows are 0 and 3; only those two set the gradient.
    const rows = makeRows(4, [{ pressure: 1000 }, {}, {}, { pressure: 1004 }]);
    const { steps, notes } = compose(rows);

    expect(steps[1].pressureGradient).toBe(4);
    expect(track(notes, 0)[1].duration).toBe(0.5 * STEP_BEATS);
  });

  it('stretches the melody note past its slot when pressure is falling', () => {
    const rows = makeRows(4, [{ pressure: 1000 }, {}, {}, { pressure: 996 }]);
    const { steps, notes } = compose(rows);

    expect(steps[1].pressureGradient).toBe(-4);
    expect(track(notes, 0)[1].duration).toBeCloseTo(1.1 * STEP_BEATS);
  });

  it('splits the low double into two notes when rising, one when falling', () => {
    const rising = compose(makeRows(4, [{ pressure: 1000 }, {}, {}, { pressure: 1004 }]));
    const falling = compose(makeRows(4, [{ pressure: 1000 }, {}, {}, { pressure: 996 }]));

    // Step 0 is steady in both, so compare the second step's slot only. The
    // rising pair lands at 3 and 4.5, not both on the step boundary.
    const inSecondStep = (n: { time: number }) =>
      n.time >= STEP_BEATS && n.time < 2 * STEP_BEATS;

    expect(track(rising.notes, 1).filter(inSecondStep)).toHaveLength(2);
    expect(track(falling.notes, 1).filter(inSecondStep)).toHaveLength(1);
  });
});

describe('compose — harmony', () => {
  it('lays down a chord every third step and holds it across all three', () => {
    const { notes } = compose(makeRows(30));
    const chords = track(notes, 2);

    const onsets = [...new Set(chords.map((n) => n.time))];
    expect(onsets).toEqual([0, 9, 18, 27]);
    expect(chords.every((n) => n.duration === 3 * STEP_BEATS)).toBe(true);
    expect(chords.filter((n) => n.time === 0)).toHaveLength(3);
  });

  it('walks the I-IV-V-IV progression', () => {
    const { notes } = compose(makeRows(36));
    const roots = [0, 9, 18, 27].map(
      (time) => Math.min(...track(notes, 2).filter((n) => n.time === time).map((n) => n.pitch)),
    );

    // I and V differ; the two IV chords are the same chord in the same voicing.
    expect(CHORD_PATTERN).toEqual(['I', 'IV', 'V', 'IV']);
    expect(roots[1]).toBe(roots[3]);
    expect(roots[0]).not.toBe(roots[1]);
  });

  it('lifts the chord an octave when pressure is rising', () => {
    const rising = compose(makeRows(1, [{ pressure: 1000 }]));
    const chord = track(rising.notes, 2).map((n) => n.pitch).sort((a, b) => a - b);

    // G minor tonic is G3/A#3/D4, transposed up one octave on a steady-or-rising step.
    expect(chord).toEqual(
      ['G3', 'A#3', 'D4'].map((n) => noteToMidi(n) + 12).sort((a, b) => a - b),
    );
  });
});

describe('compose — pressure level to drum volume', () => {
  const drumVelocity = (pressure: number) =>
    track(compose(makeRows(1, [{ pressure, windSpeed: 15 }])).notes, 3)[0].velocity;

  it('is loudest in a deep low and quietest in a strong high', () => {
    // volume at 15 m/s is 127, so base is 117 before the pressure adjustment.
    expect(drumVelocity(970)).toBe(127);
    expect(drumVelocity(1000)).toBe(122);
    expect(drumVelocity(1020)).toBe(112);
    expect(drumVelocity(1050)).toBe(107);
  });

  it('falls monotonically as pressure rises', () => {
    const readings = [960, 1000, 1020, 1050].map(drumVelocity);
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeLessThanOrEqual(readings[i - 1]);
    }
  });

  it('never drops below the velocity floor', () => {
    const { notes } = compose(makeRows(1, [{ pressure: 1050, windSpeed: 0 }]));
    expect(track(notes, 3)[0].velocity).toBeGreaterThanOrEqual(30);
  });

  it('strikes three even hits per step', () => {
    const { notes } = compose(makeRows(1));
    const hits = track(notes, 3);

    expect(hits).toHaveLength(3);
    expect(hits.map((n) => n.time)).toEqual([0, 1, 2]);
    expect(hits.every((n) => n.duration === 1)).toBe(true);
  });
});

describe('compose — rain', () => {
  it('stays silent when it is dry', () => {
    expect(track(compose(makeRows(9)).notes, 4)).toHaveLength(0);
  });

  it('sounds only on the steps where rain was measured', () => {
    const rows = makeRows(4, [{ precipitation: 0 }, {}, {}, { precipitation: 2.5 }]);
    const rain = track(compose(rows).notes, 4);

    expect(rain).toHaveLength(1);
    expect(rain[0].time).toBe(STEP_BEATS);
  });

  it('scales velocity with intensity and caps at 5 mm', () => {
    const light = track(compose(makeRows(1, [{ precipitation: 0.5 }])).notes, 4)[0];
    const heavy = track(compose(makeRows(1, [{ precipitation: 5 }])).notes, 4)[0];
    const absurd = track(compose(makeRows(1, [{ precipitation: 50 }])).notes, 4)[0];

    expect(light.velocity).toBeLessThan(heavy.velocity);
    expect(heavy.velocity).toBe(127);
    expect(absurd.velocity).toBe(127);
  });
});

describe('compose — output invariants', () => {
  it('keeps every pitch and velocity inside the MIDI range', () => {
    const rows = makeRows(60, [
      { temperature: -50, pressure: 1, windSpeed: 200, precipitation: 99 },
      { temperature: 60, pressure: 1100, windSpeed: -30 },
    ]);
    const { notes } = compose(rows);

    for (const note of notes) {
      expect(note.pitch).toBeGreaterThanOrEqual(0);
      expect(note.pitch).toBeLessThanOrEqual(127);
      expect(note.velocity).toBeGreaterThanOrEqual(0);
      expect(note.velocity).toBeLessThanOrEqual(127);
      expect(note.duration).toBeGreaterThan(0);
      expect(note.time).toBeGreaterThanOrEqual(0);
    }
  });

  it('substitutes a floor for a nonsense pressure instead of dropping the note', () => {
    const { notes, steps } = compose(makeRows(1, [{ pressure: 3 }]));
    expect(steps).toHaveLength(1);
    expect(track(notes, 0)).toHaveLength(1);
  });

  it('is deterministic', () => {
    const rows = makeRows(30, [{ precipitation: 1 }, { windSpeed: 9 }, { pressure: 990 }]);
    expect(compose(rows)).toEqual(compose(rows));
  });
});

describe('midiToFrequency', () => {
  it('anchors A4 at 440 Hz', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440);
    expect(midiToFrequency(81)).toBeCloseTo(880);
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
  });
});
