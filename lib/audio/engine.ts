import type * as ToneNS from 'tone';
import type { Composition, Note } from '@/lib/soni/compose';
import { midiToFrequency } from '@/lib/soni/compose';

/**
 * Plays a composition through Web Audio.
 *
 * The original renders its MIDI with pretty_midi's sine-wave synthesiser and its
 * README calls that the weak link. This replaces it with five voices chosen to
 * evoke the General MIDI programs upstream picks — alto sax, tuba, accordion,
 * synth drum, and the "rain" effect patch — without shipping a soundfont. A real
 * GM soundfont is several megabytes for instruments that are, in the end, a
 * stand-in for weather; synthesised voices cost nothing to download and can be
 * shaped to sit out of each other's way.
 *
 * Tone.js is imported dynamically because it touches `window` at module scope
 * and would break server rendering.
 */

export type EngineState = 'idle' | 'ready' | 'playing' | 'paused';

/** Matches the track order in `compose.ts`. */
export const TRACK_LABELS = ['Melody', 'Bass', 'Harmony', 'Drums', 'Rain'] as const;

type Voice = {
  triggerAttackRelease: (
    freq: number | number[],
    duration: number,
    time: number,
    velocity?: number,
  ) => void;
  dispose: () => void;
};

export class SonificationEngine {
  private tone: typeof ToneNS | null = null;
  private voices: Voice[] = [];
  private gains: ToneNS.Gain[] = [];
  private parts: ToneNS.Part[] = [];
  private composition: Composition | null = null;

  private bpm = 420;
  private muted = new Set<number>();

  state: EngineState = 'idle';

  /**
   * Boots Web Audio and builds the voices.
   *
   * Must be called from a user gesture — browsers refuse to start an
   * AudioContext otherwise, and the failure is silent rather than an exception.
   */
  async init(): Promise<void> {
    if (this.tone) return;

    const Tone = await import('tone');
    await Tone.start();
    this.tone = Tone;

    // A limiter on the master bus. Five tracks that all take their volume from
    // the same wind reading peak together on a gusty day, and the sum clips.
    const limiter = new Tone.Limiter(-2).toDestination();
    const reverb = new Tone.Reverb({ decay: 2.4, wet: 0.22 }).connect(limiter);

    const mk = (voice: Voice & ToneNS.ToneAudioNode, gainDb: number, dry = false) => {
      const gain = new Tone.Gain(Tone.dbToGain(gainDb));
      voice.connect(gain);
      gain.connect(dry ? limiter : reverb);
      this.voices.push(voice);
      this.gains.push(gain);
    };

    // Melody — a reedy FM voice standing in for the alto sax.
    mk(
      new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2.5,
        modulationIndex: 6,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.04, decay: 0.3, sustain: 0.5, release: 0.5 },
        modulation: { type: 'triangle' },
        modulationEnvelope: { attack: 0.1, decay: 0.2, sustain: 0.3, release: 0.4 },
      }) as unknown as Voice & ToneNS.ToneAudioNode,
      -6,
    );

    // Bass — broad and slow-speaking, like the tuba it replaces.
    mk(
      new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 1.5,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.06, decay: 0.4, sustain: 0.6, release: 0.6 },
      }) as unknown as Voice & ToneNS.ToneAudioNode,
      -10,
    );

    // Harmony — a sustained bellows pad in place of the accordion.
    mk(
      new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
        envelope: { attack: 0.35, decay: 0.5, sustain: 0.75, release: 1.4 },
      }) as unknown as Voice & ToneNS.ToneAudioNode,
      -20,
    );

    // Drums — pitched membrane hit, kept dry so the pulse stays legible.
    mk(
      new Tone.MembraneSynth({
        pitchDecay: 0.03,
        octaves: 4,
        envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.2 },
      }) as unknown as Voice & ToneNS.ToneAudioNode,
      -14,
      true,
    );

    // Rain — filtered noise rather than a pitched note. Upstream sends the rain
    // track a pitch, but a pitched raindrop is a stranger choice than a hiss,
    // and the frequency is still used: it sets the filter's centre, so heavier,
    // warmer rain sits lower in the spectrum.
    const rain = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.02, decay: 0.4, sustain: 0.35, release: 0.5 },
    });
    const rainFilter = new Tone.Filter({ type: 'bandpass', Q: 0.7, frequency: 1200 });
    rain.connect(rainFilter);

    const rainGain = new Tone.Gain(Tone.dbToGain(-12));
    rainFilter.connect(rainGain);
    rainGain.connect(reverb);

    this.voices.push({
      triggerAttackRelease: (freq, duration, time, velocity) => {
        rainFilter.frequency.setValueAtTime(
          Math.min(6000, Math.max(300, (Array.isArray(freq) ? freq[0] : freq) * 4)),
          time,
        );
        rain.triggerAttackRelease(duration, time, velocity);
      },
      dispose: () => {
        rain.dispose();
        rainFilter.dispose();
      },
    });
    this.gains.push(rainGain);

    this.state = 'ready';
  }

  /** Schedules a composition, replacing whatever was loaded before. */
  load(composition: Composition, bpm: number): void {
    const Tone = this.requireTone();

    this.clearParts();
    this.composition = composition;
    this.bpm = bpm;
    Tone.getTransport().bpm.value = bpm;

    const secondsPerBeat = 60 / bpm;
    const byTrack = new Map<number, Note[]>();
    for (const note of composition.notes) {
      const list = byTrack.get(note.track) ?? [];
      list.push(note);
      byTrack.set(note.track, list);
    }

    for (const [track, notes] of byTrack) {
      const voice = this.voices[track];
      if (!voice) continue;

      // Tone reads `time` off each event, in seconds. Durations stay in beats
      // on the Note and are converted at trigger time.
      const events = notes.map((note) => ({ ...note, time: note.time * secondsPerBeat }));

      const part = new Tone.Part<Note>((time, note) => {
        if (this.muted.has(track)) return;
        voice.triggerAttackRelease(
          midiToFrequency(note.pitch),
          // Never schedule a zero-length note: some Tone voices treat it as
          // "hold indefinitely" and the track jams on.
          Math.max(0.02, note.duration * secondsPerBeat),
          time,
          note.velocity / 127,
        );
      }, events);

      part.start(0);
      this.parts.push(part);
    }

    Tone.getTransport().stop();
    Tone.getTransport().seconds = 0;
    this.state = 'ready';
  }

  play(): void {
    this.requireTone().getTransport().start();
    this.state = 'playing';
  }

  pause(): void {
    this.requireTone().getTransport().pause();
    this.state = 'paused';
  }

  stop(): void {
    const transport = this.requireTone().getTransport();
    transport.stop();
    transport.seconds = 0;
    this.releaseAll();
    this.state = 'ready';
  }

  seek(seconds: number): void {
    const transport = this.requireTone().getTransport();
    transport.seconds = Math.max(0, seconds);
    // Voices already sounding were triggered for the old position and would
    // otherwise hang until their release finishes.
    this.releaseAll();
  }

  get seconds(): number {
    return this.tone ? this.tone.getTransport().seconds : 0;
  }

  get durationSeconds(): number {
    return this.composition ? (this.composition.beats * 60) / this.bpm : 0;
  }

  setMuted(track: number, muted: boolean): void {
    if (muted) this.muted.add(track);
    else this.muted.delete(track);
  }

  isMuted(track: number): boolean {
    return this.muted.has(track);
  }

  dispose(): void {
    if (!this.tone) return;
    this.clearParts();
    for (const voice of this.voices) voice.dispose();
    for (const gain of this.gains) gain.dispose();
    this.voices = [];
    this.gains = [];
    this.tone = null;
    this.state = 'idle';
  }

  private releaseAll(): void {
    for (const voice of this.voices) {
      const poly = voice as unknown as { releaseAll?: () => void };
      poly.releaseAll?.();
    }
  }

  private clearParts(): void {
    for (const part of this.parts) {
      part.stop();
      part.dispose();
    }
    this.parts = [];
  }

  private requireTone(): typeof ToneNS {
    if (!this.tone) throw new Error('SonificationEngine.init() must be awaited before use.');
    return this.tone;
  }
}
