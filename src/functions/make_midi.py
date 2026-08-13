from src.packages.my_midiutil import MIDIFile
from src.functions.soni_functions import *

#######################################################################
# --- MIDI FILE GENERATION ---
def produce_midi_file(data, bpm, vel_min, vel_max, instruments):
    """
    Generates a MIDI file based on weather data and specified instruments.
    Args:
        data (pd.DataFrame): DataFrame containing weather data.
        bpm (int): Beats per minute for the MIDI file.
        vel_min (int): Minimum velocity for MIDI notes.
        vel_max (int): Maximum velocity for MIDI notes.
        instruments (list): List of instrument names for each track.
    Returns:
        MIDIFile: Generated MIDI file.
    """

    print("Generating MIDI file...")
    
    # Initialize MIDI File with 5 tracks
    midi = MIDIFile(5)
    track_names = ["Main Melody", "Bass", "Harmony", "Drums", "Rain Sounds"]
    
    for i, name in enumerate(track_names):
        midi.addTrackName(i, 0, name)
        midi.addTempo(i, 0, bpm)
        midi.addProgramChange(i, i, 0, get_midi_instrument_number(instruments[i]))
    
    start_time = 0
    # Set the duration of each note in beats
    duration = 3
    data = data.iloc[::duration]

    max_wind_speed = 15   # this is the wind speed with the highest volume
    chord_pattern = ["I", "IV", "V", "IV"]  # Chord progression pattern

    for idx, row in enumerate(data.iterrows()):
        _, row = row
        season = get_season(str(row['MESS_DATUM'])) # Get the season based on the date
        scale = get_scale(season) # Get the scale based on the season
        chords = get_chords_for_scale(scale) # Get the chords for the scale
        chords_from_pattern = [chords[chord] for chord in chord_pattern if chord in chords]  # Map to actual chords

        note_midis = [str2midi(n) for n in get_notes(scale)] # Get the MIDI numbers for the notes in the scale

        # Depending on the season, the allowed range of temperature changes
        min_temp, max_temp = get_minmax_temp(season)

        # Make sure values do not exceed the allowed range

        temp = max(min(row['TT_10'], max_temp), min_temp)
        wind_speed = abs(row['FF_10']) if abs(row['FF_10']) <= max_wind_speed else max_wind_speed 
        pressure = row['PP_10'] if row['PP_10'] >= 100 else 900
        rain = max(min(row['RWS_10'], 5), 0)
        
        # Calculate pressure gradient
        if idx > 0:
            prev_pressure = data.iloc[idx - 1]['PP_10']
            pressure_gradient = pressure - prev_pressure
        else:
            pressure_gradient = 0

        # Map the temperature to a MIDI note number
        note_index = round(map_value(temp, min_temp, max_temp, 0, len(note_midis) - 1))
        note_index = max(0, min(len(note_midis) - 1, note_index))
        midi_data = note_midis[note_index]
        
        # Map the wind speed to a velocity value
        w_data = map_value(wind_speed, 0, max_wind_speed, 0, 1)
        note_velocity = round(map_value(w_data, 0, 1, vel_min, vel_max)) 
        volume = note_velocity
        
        # Set the duration of the note based on the pressure gradient
        duration_melody = 0.5* duration if pressure_gradient >= 0 else 1.1* duration    

        # Add the main melody to track 0 (temperature)
        midi.addNote(0, 0, midi_data, start_time, duration_melody, volume)
        
        # Add the harmony to track 1 (temperature - 5 notes)
        # when pressure gradient is positive, play 2 short notes, else 1 long note
        if (pressure_gradient >= 0): 
            midi.addNote(1, 1, midi_data - 24, start_time, 0.5*duration, volume -10)
            midi.addNote(1, 1, midi_data - 24, start_time + 0.5*duration, 0.5*duration, volume -10)
        else: 
            midi.addNote(1, 1, midi_data - 24, start_time, duration, volume -10)
        
         # Add chord to track 2 every 3rd note
        if idx % 3 == 0:
            chord_notes = chords_from_pattern[(idx // 3) % len(chords_from_pattern)]
            # chord_notes = chords[chord_type]

            # Convert note names to MIDI numbers
            chord_notes_midi = [str2midi(note) for note in chord_notes]
    
            # For positive pressure gradient, transpose the chord up an octave
            if pressure_gradient >= 0:
                chord_notes_midi = [n + 12 for n in chord_notes_midi]
            
            # Add the chord notes to track 2
            for note in chord_notes_midi:
                midi.addNote(2, 2, note, start_time, 3*duration, volume -10)

        # define volume for bass notes depending on pressure
        volume_bass = max(vel_min, min(
            volume-10 + 10 if pressure < 980 else
            volume-10 + 5 if pressure < 1013.25 else
            volume-10 - 10 if pressure > 1040 else
            volume-10 - 5 if pressure >= 1013.25 else
            volume-10, vel_max
        ))

        # Add bass notes to track 3 (temperature - 36)
        midi.addNote(3, 3, midi_data - 24, start_time, duration/3 , volume_bass)
        midi.addNote(3, 3, midi_data - 24, start_time + duration/3, duration/3 , volume_bass)
        midi.addNote(3, 3, midi_data - 24, start_time + 2*duration/3, duration/3 , volume_bass)

        # Add rain sounds to track 4 (rain)
        if rain > 0:
            rain_volume = round(map_value(rain, 0, 5, vel_min, vel_max))
            midi.addNote(4, 4, midi_data, start_time, duration, rain_volume)

        start_time += duration
    
    return midi
