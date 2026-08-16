"""
Generates a cross-check fixture from the ORIGINAL Python sonification.

Runs upstream's `produce_midi_file` over a deterministic synthetic dataset and
records every addNote() call, so the TypeScript port can be diffed against the
implementation it claims to reproduce rather than against my own reading of it.

Two patches are applied, both to make the comparison exact rather than to change
behaviour:

  * MIDIFile is replaced by a recorder — we want the note list, not a file.
  * clamp_pitch becomes the identity, so raw pitches are recorded before the
    0-127 clamp. The port shifts every pitch up an octave (see PITCH_OFFSET in
    scales.ts), which changes *which* notes hit the clamp; comparing unclamped
    values keeps that deliberate deviation from masking an accidental one.
"""

import json
import sys
from pathlib import Path

import pandas as pd

REPO = Path(__file__).parent / "music_video_from_weather"
sys.path.insert(0, str(REPO))

from src.functions import make_midi  # noqa: E402


class RecordingMIDI:
    """Stands in for MIDIFile, capturing addNote calls in order."""

    def __init__(self, num_tracks):
        self.num_tracks = num_tracks
        self.notes = []

    def addTrackName(self, *_args, **_kwargs):
        pass

    def addTempo(self, *_args, **_kwargs):
        pass

    def addProgramChange(self, *_args, **_kwargs):
        pass

    def addNote(self, track, channel, pitch, time, duration, volume):
        self.notes.append(
            {
                "track": int(track),
                "pitch": int(pitch),
                "time": float(time),
                "duration": float(duration),
                "velocity": int(volume),
            }
        )


def build_rows():
    """
    A deterministic spread designed to exercise every branch:
    all four seasons, both signs of the pressure gradient, all four bass-volume
    bands, rain present and absent, and readings past both ends of every clamp.
    """
    rows = []
    # Four month starts, one per season, 45 observations each.
    for month in (1, 4, 7, 10):
        base = pd.Timestamp(f"2026-{month:02d}-05 00:00")
        for i in range(45):
            # Deterministic, non-repeating, and crosses every threshold.
            temp = -25 + ((i * 7 + month * 11) % 70)
            wind = (i * 3 + month) % 22
            pressure = 955 + ((i * 13 + month * 5) % 100)
            # Coprime with the every-third-row sampling, so the sampled rows
            # get a mix of wet and dry. A period of 3 here would put every
            # sampled row on the same phase and silence the rain track
            # entirely, leaving it untested.
            rain = 0.0 if i % 7 == 0 else round(((i * 17) % 65) / 10.0, 2)
            rows.append(
                {
                    "MESS_DATUM": base + pd.Timedelta(minutes=10 * i),
                    "TT_10": float(temp),
                    "FF_10": float(wind),
                    "PP_10": float(pressure),
                    "RWS_10": float(rain),
                }
            )
    return pd.DataFrame(rows)


def main():
    make_midi.MIDIFile = RecordingMIDI
    make_midi.clamp_pitch = lambda pitch: int(pitch)

    data = build_rows()

    midi = make_midi.produce_midi_file(
        data,
        bpm=420,
        vel_min=30,
        vel_max=127,
        instruments=["alto sax", "tuba", "accordion", "synth drum", "fx 1 (rain)"],
    )

    fixture = {
        "rows": [
            {
                "t": int(r.MESS_DATUM.timestamp() * 1000),
                "temperature": r.TT_10,
                "windSpeed": r.FF_10,
                "pressure": r.PP_10,
                "precipitation": r.RWS_10,
            }
            for r in data.itertuples()
        ],
        "notes": midi.notes,
    }

    out = Path(__file__).parent / "python_oracle.json"
    out.write_text(json.dumps(fixture, indent=None))
    print(f"{len(fixture['rows'])} rows -> {len(fixture['notes'])} notes -> {out}")


if __name__ == "__main__":
    main()
