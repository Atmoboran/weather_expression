'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WEBCAMS, type Resolution, type Webcam } from '@/lib/dwd/stations';
import type { WeatherRow } from '@/lib/dwd/product';
import { compose, STEP_BEATS } from '@/lib/soni/compose';
import { SonificationEngine, TRACK_LABELS } from '@/lib/audio/engine';
import { preloadFrames, type PreloadProgress } from '@/lib/preload';
import { WeatherPanels } from './WeatherPanels';
import { WebcamStage } from './WebcamStage';

/**
 * Tempo options.
 *
 * Upstream requires a BPM divisible by 60 so that its video frame rate
 * (bpm / 60) comes out whole. Nothing here needs an integer frame rate, but the
 * relationship is kept: one webcam frame per beat, one musical step per three
 * frames, so 420 BPM plays a 48-hour session in about 41 seconds — the tempo
 * the project's own example renders use.
 */
const TEMPOS = [
  { bpm: 180, label: 'Slow' },
  { bpm: 300, label: 'Medium' },
  { bpm: 420, label: 'Default' },
  { bpm: 600, label: 'Fast' },
] as const;

type SessionResponse = {
  webcam: Webcam;
  resolution: Resolution;
  frames: number[];
  rows: WeatherRow[];
  generatedAt: number;
};

type Status =
  | { kind: 'loading'; message: string; progress?: PreloadProgress }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

const BERLIN_FULL = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function Player() {
  const [webcamId, setWebcamId] = useState(WEBCAMS[0].id);
  const [bpm, setBpm] = useState<number>(420);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [images, setImages] = useState<(HTMLImageElement | null)[]>([]);
  const [status, setStatus] = useState<Status>({
    kind: 'loading',
    message: `Asking DWD for ${WEBCAMS[0].id}…`,
  });
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [muted, setMuted] = useState<Set<number>>(new Set());

  const engineRef = useRef<SonificationEngine | null>(null);
  const rafRef = useRef<number | null>(null);

  const webcam = useMemo(() => WEBCAMS.find((w) => w.id === webcamId)!, [webcamId]);

  const composition = useMemo(
    () => (session && session.rows.length > 0 ? compose(session.rows) : null),
    [session],
  );

  /** One frame per beat — the relationship upstream's video and MIDI share. */
  const fps = bpm / 60;
  const frameCount = session?.frames.length ?? 0;

  // ---------------------------------------------------------------------------
  // Fetch a session and pull every frame into memory before offering playback.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const abort = new AbortController();

    (async () => {
      try {
        const response = await fetch(`/api/session/${webcamId}`, { signal: abort.signal });
        const body = await response.json();

        if (!response.ok) {
          setStatus({ kind: 'error', message: body.error ?? 'DWD did not answer.' });
          return;
        }

        const data = body as SessionResponse;
        setSession(data);
        setStatus({
          kind: 'loading',
          message: 'Loading webcam frames…',
          progress: { loaded: 0, total: data.frames.length, failed: 0 },
        });

        const urls = data.frames.map(
          (t) => `/api/frame/${webcamId}/${t}?resolution=${data.resolution}`,
        );

        const { images: loaded, failed } = await preloadFrames(
          urls,
          (progress) => setStatus({ kind: 'loading', message: 'Loading webcam frames…', progress }),
          abort.signal,
        );

        if (abort.signal.aborted) return;

        setImages(loaded);
        setStatus(
          failed === loaded.length
            ? { kind: 'error', message: 'Every webcam frame failed to load.' }
            : { kind: 'ready' },
        );
      } catch (error) {
        if (abort.signal.aborted) return;
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Something went wrong.',
        });
      }
    })();

    return () => abort.abort();
  }, [webcamId]);

  // ---------------------------------------------------------------------------
  // Re-schedule whenever the piece or the tempo changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || engine.state === 'idle' || !composition) return;

    engine.load(composition, bpm);
    engine.seek((frame / fps) || 0);
    if (playing) engine.play();
    // `frame` is intentionally not a dependency: this reloads on tempo or piece
    // changes and reads the current frame once to restore position. Including it
    // would tear down and rebuild the schedule on every animation tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition, bpm]);

  // ---------------------------------------------------------------------------
  // Drive the visual frame from the audio clock, never from a separate timer.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!playing) return;

    const tick = () => {
      const engine = engineRef.current;
      if (!engine) return;

      const next = Math.floor(engine.seconds * fps);
      if (next >= frameCount) {
        engine.stop();
        setPlaying(false);
        setFrame(Math.max(0, frameCount - 1));
        return;
      }

      setFrame(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, fps, frameCount]);

  useEffect(() => () => engineRef.current?.dispose(), []);

  const togglePlay = useCallback(async () => {
    if (!composition) return;

    if (!engineRef.current) {
      engineRef.current = new SonificationEngine();
    }
    const engine = engineRef.current;

    // The AudioContext can only start inside a user gesture, so this is the
    // first point at which the engine can exist at all.
    if (engine.state === 'idle') {
      await engine.init();
      engine.load(composition, bpm);
      for (const track of muted) engine.setMuted(track, true);
      engine.seek(frame / fps);
    }

    if (playing) {
      engine.pause();
      setPlaying(false);
    } else {
      if (frame >= frameCount - 1) {
        engine.seek(0);
        setFrame(0);
      }
      engine.play();
      setPlaying(true);
    }
  }, [composition, bpm, muted, frame, fps, frameCount, playing]);

  const seekToFrame = useCallback(
    (index: number) => {
      setFrame(index);
      engineRef.current?.seek(index / fps);
    },
    [fps],
  );

  /**
   * Switching cameras resets everything the old session owned.
   *
   * This belongs in the handler rather than in the fetch effect: the reset is
   * caused by the click, not by the fetch, and doing it in an effect body would
   * render the stale session once before clearing it.
   */
  const changeWebcam = useCallback((id: string) => {
    engineRef.current?.stop();
    setPlaying(false);
    setSession(null);
    setImages([]);
    setFrame(0);
    setStatus({ kind: 'loading', message: `Asking DWD for ${id}…` });
    setWebcamId(id);
  }, []);

  const toggleTrack = useCallback((track: number) => {
    setMuted((previous) => {
      const next = new Set(previous);
      if (next.has(track)) next.delete(track);
      else next.add(track);
      engineRef.current?.setMuted(track, next.has(track));
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------

  if (status.kind === 'error') {
    return (
      <Shell webcam={webcam} webcamId={webcamId} onWebcamChange={changeWebcam}>
        <div
          className="rounded-lg border p-6 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
        >
          <p className="mb-2 font-semibold">This camera is not answering right now.</p>
          <p style={{ color: 'var(--text-secondary)' }}>{status.message}</p>
          <p className="mt-3" style={{ color: 'var(--text-muted)' }}>
            DWD keeps roughly two days of imagery and publishes on a ten-minute grid. Try
            another camera, or come back in a few minutes.
          </p>
        </div>
      </Shell>
    );
  }

  if (status.kind === 'loading' || !session || !composition) {
    const progress = status.kind === 'loading' ? status.progress : undefined;
    const percent = progress && progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0;

    return (
      <Shell webcam={webcam} webcamId={webcamId} onWebcamChange={changeWebcam}>
        <div
          className="rounded-lg border p-6"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {status.kind === 'loading' ? status.message : 'Loading…'}
          </p>
          {progress && (
            <>
              <div
                className="mt-3 h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--gridline)' }}
                role="progressbar"
                aria-valuenow={Math.round(percent)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-150"
                  style={{ width: `${percent}%`, background: 'var(--series-1)' }}
                />
              </div>
              <p className="mt-2 text-xs tabular" style={{ color: 'var(--text-muted)' }}>
                {progress.loaded} of {progress.total} frames
                {progress.failed > 0 && ` · ${progress.failed} unavailable`}
              </p>
            </>
          )}
        </div>
      </Shell>
    );
  }

  const stepIndex = Math.min(Math.floor(frame / STEP_BEATS), composition.steps.length - 1);
  const step = composition.steps[stepIndex];
  const row = session.rows[frame];
  const durationSeconds = frameCount / fps;

  return (
    <Shell webcam={webcam} webcamId={webcamId} onWebcamChange={changeWebcam}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div>
          <WebcamStage
            images={images}
            index={frame}
            alt={`${webcam.label} looking ${webcam.bearing}, ${BERLIN_FULL.format(row.t)}`}
          />

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm tabular" style={{ color: 'var(--text-secondary)' }}>
              {BERLIN_FULL.format(row.t)}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {step.noteName} · {step.scale} · {step.season}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              className="rounded-md px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'var(--series-1)' }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>

            <input
              type="range"
              min={0}
              max={Math.max(0, frameCount - 1)}
              value={frame}
              onChange={(e) => seekToFrame(Number(e.target.value))}
              aria-label="Position"
              className="min-w-40 flex-1 accent-[var(--series-1)]"
            />

            <span className="text-xs tabular" style={{ color: 'var(--text-muted)' }}>
              {(frame / fps).toFixed(1)}s / {durationSeconds.toFixed(0)}s
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">Tracks</legend>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Tracks
              </span>
              {TRACK_LABELS.map((label, track) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleTrack(track)}
                  aria-pressed={!muted.has(track)}
                  className="rounded-full border px-3 py-1 text-xs transition-opacity"
                  style={{
                    borderColor: 'var(--border)',
                    background: muted.has(track) ? 'transparent' : 'var(--series-1-wash)',
                    color: muted.has(track) ? 'var(--text-muted)' : 'var(--text-primary)',
                    textDecoration: muted.has(track) ? 'line-through' : 'none',
                  }}
                >
                  {label}
                </button>
              ))}
            </fieldset>

            <label className="ml-auto flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Tempo
              <select
                value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                className="rounded-md border px-2 py-1"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--surface-1)',
                  color: 'var(--text-primary)',
                }}
              >
                {TEMPOS.map((tempo) => (
                  <option key={tempo.bpm} value={tempo.bpm}>
                    {tempo.label} ({tempo.bpm})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <WeatherPanels rows={session.rows} playhead={frame} onSeek={seekToFrame} />
      </div>
    </Shell>
  );
}

function Shell({
  webcam,
  webcamId,
  onWebcamChange,
  children,
}: {
  webcam: Webcam;
  webcamId: string;
  onWebcamChange: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Wetterklang</h1>
        <p className="mt-1 text-base" style={{ color: 'var(--text-secondary)' }}>
          What the weather sounds like
        </p>
        <p className="mt-3 max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>
          The last two days at a German weather station, played as music. Temperature picks
          the note, wind sets how loud it is, and falling pressure stretches every note
          longer. The picture is the sky those numbers were measured under.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span style={{ color: 'var(--text-muted)' }}>Camera</span>
          <select
            value={webcamId}
            onChange={(e) => onWebcamChange(e.target.value)}
            className="rounded-md border px-3 py-1.5"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface-1)',
              color: 'var(--text-primary)',
            }}
          >
            {WEBCAMS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.bearing}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {webcam.blurb} Readings from {webcam.stationName} ({webcam.elevationM} m).
        </p>
      </div>

      {children}

      <footer className="mt-10 border-t pt-6 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
        <p>
          Weather data and webcam imagery: Deutscher Wetterdienst (DWD), via{' '}
          <a
            href="https://opendata.dwd.de"
            className="underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            opendata.dwd.de
          </a>
          .
        </p>
        <p className="mt-1">
          The sonification rules — the seasonal scales, the pressure-to-rhythm mapping — are
          ported from{' '}
          <a
            href="https://github.com/sandysgits/music_video_from_weather"
            className="underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            music_video_from_weather
          </a>{' '}
          by sandysgits, supported by the UPAS Student Idea Pot 2024.
        </p>
      </footer>
    </div>
  );
}
