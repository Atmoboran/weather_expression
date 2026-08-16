import { describe, expect, it } from 'vitest';
import type { WeatherRow } from '@/lib/dwd/product';
import { pair } from './session';

const T = (minutes: number) => Date.UTC(2026, 7, 16, 0, 0) + minutes * 60_000;

const row = (t: number): WeatherRow => ({
  t,
  temperature: 20,
  pressure: 1000,
  windSpeed: 3,
  precipitation: 0,
});

describe('pair', () => {
  it('keeps only moments present on both sides, index-aligned', () => {
    const frames = [T(0), T(10), T(20), T(30)];
    const rows = [row(T(10)), row(T(30)), row(T(40))];

    const result = pair(frames, rows);

    expect(result.frames).toEqual([T(10), T(30)]);
    expect(result.rows.map((r) => r.t)).toEqual([T(10), T(30)]);
    expect(result.frames).toHaveLength(result.rows.length);
  });

  it('drops a frame with no reading rather than carrying a hole', () => {
    expect(pair([T(0)], []).frames).toEqual([]);
  });

  it('drops a reading with no frame', () => {
    expect(pair([], [row(T(0))]).rows).toEqual([]);
  });

  it('follows the frame order, not the row order', () => {
    const frames = [T(0), T(10)];
    const rows = [row(T(10)), row(T(0))];

    expect(pair(frames, rows).rows.map((r) => r.t)).toEqual([T(0), T(10)]);
  });

  it('does not match timestamps that are merely close', () => {
    // A five-minute offset would be a different observation, not the same one.
    expect(pair([T(0)], [row(T(0) + 5 * 60_000)]).frames).toEqual([]);
  });
});
