import { describe, expect, it } from 'vitest';
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
} from './scales';

const at = (month: number, day = 15) => Date.UTC(2026, month - 1, day, 12, 0);

describe('getSeason', () => {
  it('follows meteorological season boundaries', () => {
    expect(getSeason(at(3))).toBe('spring');
    expect(getSeason(at(5))).toBe('spring');
    expect(getSeason(at(6))).toBe('summer');
    expect(getSeason(at(8))).toBe('summer');
    expect(getSeason(at(9))).toBe('autumn');
    expect(getSeason(at(11))).toBe('autumn');
    expect(getSeason(at(12))).toBe('winter');
    expect(getSeason(at(1))).toBe('winter');
    expect(getSeason(at(2))).toBe('winter');
  });
});

describe('noteToMidi', () => {
  it('puts A4 at 69, so the synth is in concert pitch', () => {
    expect(noteToMidi('A4')).toBe(69);
  });

  it('places middle C at 60', () => {
    expect(noteToMidi('C4')).toBe(60);
  });

  it('reads sharps', () => {
    expect(noteToMidi('C#4')).toBe(61);
    expect(noteToMidi('G#3')).toBe(56);
  });

  it('throws on a name it cannot parse', () => {
    expect(() => noteToMidi('H4')).toThrow();
    expect(() => noteToMidi('Cb4')).toThrow();
    expect(() => noteToMidi('C')).toThrow();
  });

  it('produces every note in every scale and chord table', () => {
    for (const notes of Object.values(SCALE_NOTES)) {
      for (const note of notes) {
        expect(Number.isFinite(noteToMidi(note))).toBe(true);
      }
    }
    for (const chords of Object.values(SCALE_CHORDS)) {
      for (const triad of Object.values(chords)) {
        expect(triad).toHaveLength(3);
        for (const note of triad) expect(Number.isFinite(noteToMidi(note))).toBe(true);
      }
    }
  });

  it('keeps every scale ascending, which the temperature mapping assumes', () => {
    for (const [scale, notes] of Object.entries(SCALE_NOTES)) {
      const midi = notes.map(noteToMidi);
      for (let i = 1; i < midi.length; i++) {
        expect(midi[i], `${scale} at index ${i}`).toBeGreaterThan(midi[i - 1]);
      }
    }
  });
});

describe('mapValue', () => {
  it('rescales linearly', () => {
    expect(mapValue(10, 0, 20, 0, 100)).toBe(50);
    expect(mapValue(-5, -5, 25, 0, 22)).toBe(0);
    expect(mapValue(25, -5, 25, 0, 22)).toBe(22);
  });

  it('does not clamp — callers do', () => {
    expect(mapValue(30, 0, 20, 0, 100)).toBe(150);
  });
});

describe('roundHalfEven', () => {
  it("matches Python's banker's rounding at the halves", () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(78.5)).toBe(78);
  });

  it('rounds normally away from the halves', () => {
    expect(roundHalfEven(1.4)).toBe(1);
    expect(roundHalfEven(1.6)).toBe(2);
    expect(roundHalfEven(12)).toBe(12);
  });
});

describe('clamp', () => {
  it('bounds on both sides', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('season tables', () => {
  it('defines a scale and a temperature range for every season', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const scale = SEASON_SCALE[season];
      expect(SCALE_NOTES[scale]).toBeDefined();
      expect(SCALE_CHORDS[scale]).toBeDefined();

      const [min, max] = SEASON_TEMP_RANGE[season];
      expect(max).toBeGreaterThan(min);
    }
  });

  it('gives every scale the same 23 degrees, so pitch resolution is season-independent', () => {
    for (const notes of Object.values(SCALE_NOTES)) {
      expect(notes).toHaveLength(23);
    }
  });
});
