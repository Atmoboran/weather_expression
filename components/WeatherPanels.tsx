'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WeatherRow } from '@/lib/dwd/product';

/**
 * Four small multiples over one shared time axis, with a crosshair, a playhead,
 * and a table view.
 *
 * Deliberately *not* the two dual-axis plots the original produces. Pressure and
 * wind on twinned y-scales, then temperature and rainfall on another pair, makes
 * the two lines in each panel look comparable when they share nothing but the
 * frame — and which line is "high" depends entirely on the invisible choice of
 * scale. Four separate panels cost a little vertical space and remove the
 * question.
 *
 * The x axis is frame index, not wall clock. The music advances one step per
 * three frames regardless of whether DWD skipped a slot, so index space is what
 * the playhead actually lives in; tick labels carry the real times, which makes
 * any gap visible as a jump rather than hiding it.
 */

type Panel = {
  key: keyof Pick<WeatherRow, 'temperature' | 'pressure' | 'windSpeed' | 'precipitation'>;
  title: string;
  unit: string;
  /** Bars for an amount accumulated in each interval; a line for a level. */
  mark: 'line' | 'bar';
  /** Rain starts at zero even on a dry day; a level panel frames its own range. */
  zeroBased: boolean;
  decimals: number;
};

const PANELS: Panel[] = [
  { key: 'temperature', title: 'Temperature', unit: '°C', mark: 'line', zeroBased: false, decimals: 1 },
  { key: 'pressure', title: 'Pressure', unit: 'hPa', mark: 'line', zeroBased: false, decimals: 1 },
  { key: 'windSpeed', title: 'Wind speed', unit: 'm/s', mark: 'line', zeroBased: true, decimals: 1 },
  { key: 'precipitation', title: 'Rainfall', unit: 'mm', mark: 'bar', zeroBased: true, decimals: 2 },
];

const PANEL_HEIGHT = 84;
/** Room for a panel title plus clear air above the topmost gridline label. */
const PANEL_GAP = 34;
const PAD_LEFT = 54;
const PAD_RIGHT = 12;
const AXIS_HEIGHT = 22;

const BERLIN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
});
const BERLIN_FULL = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Rounds a range outward to values a reader can hold in their head. */
function niceScale(min: number, max: number, zeroBased: boolean): [number, number, number[]] {
  let lo = zeroBased ? 0 : min;
  let hi = max;

  if (hi === lo) {
    hi = lo + 1;
  }

  const span = hi - lo;
  const rawStep = span / 3;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;

  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));

  return [lo, hi, ticks];
}

export type WeatherPanelsProps = {
  rows: WeatherRow[];
  /** Frame currently sounding, as an index into `rows`. */
  playhead: number;
  /** Called when the reader clicks or drags to scrub. */
  onSeek: (index: number) => void;
};

export function WeatherPanels({ rows, playhead, onSeek }: WeatherPanelsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(320, entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const plotWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const totalHeight = PANELS.length * (PANEL_HEIGHT + PANEL_GAP) + AXIS_HEIGHT;

  const xFor = useCallback(
    (index: number) =>
      PAD_LEFT + (rows.length <= 1 ? 0 : (index / (rows.length - 1)) * plotWidth),
    [plotWidth, rows.length],
  );

  const scales = useMemo(
    () =>
      PANELS.map((panel) => {
        const values = rows.map((r) => r[panel.key]);
        return niceScale(Math.min(...values), Math.max(...values), panel.zeroBased);
      }),
    [rows],
  );

  /**
   * Time ticks at roughly six-hour spacing, always including both ends.
   *
   * The last regular tick is dropped when it would sit within half a step of
   * the end label — otherwise the two render on top of each other and the right
   * edge reads as one unparseable smudge.
   */
  const timeTicks = useMemo(() => {
    if (rows.length === 0) return [];
    if (rows.length === 1) return [0];

    const step = Math.max(1, Math.floor(rows.length / 6));
    const last = rows.length - 1;

    const out: number[] = [];
    for (let i = 0; i < last; i += step) out.push(i);
    while (out.length > 1 && last - out[out.length - 1] < step / 2) out.pop();
    out.push(last);

    return out;
  }, [rows]);

  const indexFromPointer = useCallback(
    (clientX: number) => {
      const node = wrapRef.current;
      if (!node || rows.length === 0) return 0;
      const box = node.getBoundingClientRect();
      const ratio = (clientX - box.left - PAD_LEFT) / plotWidth;
      return Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1))));
    },
    [plotWidth, rows.length],
  );

  if (rows.length === 0) return null;

  const active = hover ?? playhead;
  const activeRow = rows[active];

  return (
    <section aria-label="Weather measurements" className="w-full">
      <div
        ref={wrapRef}
        className="relative w-full touch-none select-none"
        onPointerMove={(e) => setHover(indexFromPointer(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(indexFromPointer(e.clientX));
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      >
        <svg
          width={width}
          height={totalHeight}
          role="img"
          aria-label={`Temperature, pressure, wind speed and rainfall across ${rows.length} ten-minute observations`}
        >
          {PANELS.map((panel, panelIndex) => {
            const top = panelIndex * (PANEL_HEIGHT + PANEL_GAP) + PANEL_GAP * 0.6;
            const [lo, hi, ticks] = scales[panelIndex];
            const yFor = (value: number) =>
              top + PANEL_HEIGHT - ((value - lo) / (hi - lo)) * PANEL_HEIGHT;

            const points = rows.map((row, i) => `${xFor(i)},${yFor(row[panel.key])}`).join(' ');
            const barWidth = Math.max(1, Math.min(24, plotWidth / rows.length - 1));

            return (
              <g key={panel.key}>
                <text
                  x={PAD_LEFT}
                  y={top - 11}
                  fill="var(--text-primary)"
                  fontSize="12"
                  fontWeight="600"
                >
                  {panel.title}
                  <tspan fill="var(--text-muted)" fontWeight="400">
                    {' '}
                    ({panel.unit})
                  </tspan>
                </text>

                {ticks.map((tick) => (
                  <g key={tick}>
                    <line
                      x1={PAD_LEFT}
                      x2={width - PAD_RIGHT}
                      y1={yFor(tick)}
                      y2={yFor(tick)}
                      stroke="var(--gridline)"
                      strokeWidth="1"
                    />
                    <text
                      x={PAD_LEFT - 8}
                      y={yFor(tick) + 4}
                      fill="var(--text-muted)"
                      fontSize="10"
                      textAnchor="end"
                      className="tabular"
                    >
                      {tick}
                    </text>
                  </g>
                ))}

                {panel.mark === 'line' ? (
                  <polyline
                    points={points}
                    fill="none"
                    stroke="var(--series-1)"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ) : (
                  rows.map((row, i) =>
                    row[panel.key] > 0 ? (
                      <rect
                        key={i}
                        x={xFor(i) - barWidth / 2}
                        y={yFor(row[panel.key])}
                        width={barWidth}
                        height={Math.max(1, top + PANEL_HEIGHT - yFor(row[panel.key]))}
                        rx={Math.min(2, barWidth / 2)}
                        fill="var(--series-1)"
                      />
                    ) : null,
                  )
                )}

                <line
                  x1={PAD_LEFT}
                  x2={width - PAD_RIGHT}
                  y1={top + PANEL_HEIGHT}
                  y2={top + PANEL_HEIGHT}
                  stroke="var(--baseline)"
                  strokeWidth="1"
                />

                {/* Value at the playhead, ringed in the surface colour so it
                    stays readable where it sits on the line. */}
                <circle
                  cx={xFor(active)}
                  cy={yFor(activeRow[panel.key])}
                  r="4"
                  fill="var(--series-1)"
                  stroke="var(--surface-1)"
                  strokeWidth="2"
                />
              </g>
            );
          })}

          {/* Crosshair spanning all four panels — they share one time axis. */}
          <line
            x1={xFor(active)}
            x2={xFor(active)}
            y1={PANEL_GAP * 0.3}
            y2={totalHeight - AXIS_HEIGHT}
            stroke={hover === null ? 'var(--playhead)' : 'var(--text-muted)'}
            strokeWidth="1"
          />

          {timeTicks.map((i) => (
            <text
              key={i}
              x={xFor(i)}
              y={totalHeight - 6}
              fill="var(--text-muted)"
              fontSize="10"
              textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}
              className="tabular"
            >
              {BERLIN.format(rows[i].t)}
            </text>
          ))}
        </svg>

        {hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 rounded-md border px-3 py-2 text-xs shadow-lg"
            style={{
              left: Math.min(Math.max(xFor(hover) + 12, 8), Math.max(8, width - 190)),
              background: 'var(--surface-1)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <div className="mb-1 font-semibold">{BERLIN_FULL.format(rows[hover].t)}</div>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
              {PANELS.map((panel) => (
                <div key={panel.key} className="contents">
                  <dt style={{ color: 'var(--text-secondary)' }}>{panel.title}</dt>
                  <dd className="tabular text-right">
                    {rows[hover][panel.key].toFixed(panel.decimals)} {panel.unit}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>Click or drag the charts to scrub. Times are Europe/Berlin.</span>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="underline underline-offset-2 hover:opacity-80"
          aria-expanded={showTable}
        >
          {showTable ? 'Hide' : 'Show'} data table
        </button>
      </div>

      {showTable && (
        <div className="mt-3 max-h-80 overflow-auto rounded-md border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-xs tabular">
            <caption className="sr-only">
              Every ten-minute observation in this session
            </caption>
            <thead className="sticky top-0" style={{ background: 'var(--surface-1)' }}>
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Time (Berlin)</th>
                {PANELS.map((panel) => (
                  <th key={panel.key} scope="col" className="px-3 py-2 text-right font-semibold">
                    {panel.title} ({panel.unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.t}
                  style={{
                    background: i === playhead ? 'var(--series-1-wash)' : undefined,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <th scope="row" className="px-3 py-1 text-left font-normal">
                    {BERLIN_FULL.format(row.t)}
                  </th>
                  {PANELS.map((panel) => (
                    <td key={panel.key} className="px-3 py-1 text-right">
                      {row[panel.key].toFixed(panel.decimals)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
