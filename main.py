# --- USER CONFIGURATION ---
from pathlib import Path
import pandas as pd
import os
from src.functions.video_funcs import *
from src.packages.my_midiutil import MIDIFile
from src.functions.soni_functions import *
from src.functions.make_midi import *
from src.functions.midi_to_wav_prettymidi import *
from src.functions.merge import *
from src.functions.download import *

def create_music_video_from_weather():
    print("Hello from weather-webcam-sonification! Let's create some music video from the weather!")

    # --- USER CONFIGURATION ---
    # --- Please specify the settings you want ---

    station_id =  "01420"      # Choose the weather statdion you want to use, e.g. "07341", "01420", ... 
    mode       = "now"         # You can eather get a long run with "historic" or todays data with "now"
    station    = "Offenbach-W" # Choose the webcam station you want to use, e.g. "Offenbach-O", "Offenbach-W", ...

    bpm = 420  # beats per minute for MIDI # choose BPM that can be divided by 60 !
    fps = int(bpm / 60)


    # Choose your instruments = ['Melody', 'Bass', 'Harmony', 'Drums', 'Rain Sounds']
    instruments = ['alto sax', 'tuba', 'accordion', 'synth drum', 'fx 1 (rain)']

    # Set the minimum and maximum velocity of the sound
    vel_min = 30
    vel_max = 127 # max is 127

    # Set the resolution of the webcam images
    resolution = "400"  # options: 114, 1200, 180, 1920, 400, 640, 816

    # Set the start and end time for the video if you chose "historic" mode
    if mode == 'historic':
        # only works for 01420 + Offenbach-O or Offenbach-W
        # between 2025-03-01 09:30 and 2025-03-07 14:00
        start_datetime = pd.to_datetime("2025-03-01 09:30")
        end_datetime = pd.to_datetime("2025-03-05 09:30")
    elif mode != 'now':
        raise ValueError(f"Unsupported mode '{mode}', expected 'now' or 'historic'.")


# ----- CONFIGURATION END ---

    # --- PATH SETUP ---
    BASE_DIR = Path.cwd()
    WEATHER_DATA_DIR = BASE_DIR / "weatherdata" / f"{station_id}_{mode}"
    WEATHER_DATA_DIR.mkdir(parents=True, exist_ok=True)
    if mode == 'now':
        # Clear the station product and merged files so they are re-fetched, but leave
        # webcam_data/ in place: those images never change once published, and wiping
        # them forced a full ~430-image re-download on every run.
        for stale in list(WEATHER_DATA_DIR.glob("produkt_*")) + list(WEATHER_DATA_DIR.glob("*merged_*")):
            stale.unlink()
    WEBCAM_DATA_DIR = WEATHER_DATA_DIR / f"webcam_data/{station}"
    AUDIO_OUTPUT_DIR = BASE_DIR / "assets/audio"
    VIDEO_OUTPUT_DIR = BASE_DIR / "assets/video"
    FINAL_OUTPUT_DIR = BASE_DIR / "final_output"

    for path in [WEBCAM_DATA_DIR, AUDIO_OUTPUT_DIR, VIDEO_OUTPUT_DIR, FINAL_OUTPUT_DIR]:
        os.makedirs(path, exist_ok=True)


    if mode == 'now':
        # --- DOWNLOAD WEBCAM DATA ---
        first_image, last_image = download_webcam_images(station, resolution, WEBCAM_DATA_DIR)
        print(f"Webcam images on disk span {first_image} to {last_image}")


    # --- DOWNLOAD WEATHER DATA ---
    download_station_data(station_id, WEATHER_DATA_DIR, 'now')
    download_station_data(station_id, WEATHER_DATA_DIR, 'recent')

    # --- MERGE WEATHER DATA ---
    print("Merging latest station data...")
    df_merged, merged_file_path = merge_station_data(station_id, WEATHER_DATA_DIR)
    print("Merged file path: ", merged_file_path)

    # --- LOAD IMAGE DATA ---
    print("Loading image and weather data for video...")
    if mode == 'now':
        image_df, full_weather_data, start_datetime_webcam, end_datetime_webcam = load_weather_and_image_data_now(WEBCAM_DATA_DIR, df_merged)
    elif mode == 'historic':
        image_df, full_weather_data = load_weather_and_image_data_historic(WEBCAM_DATA_DIR, df_merged, start_datetime, end_datetime)

    frames = len(image_df)

    # --- GENERATE WEATHER VIDEO ---
    # Name the outputs after the range actually rendered. The webcam cache on disk can
    # reach further back than the frames that survived pairing with weather data.
    start_str = image_df['DateTime'].min().strftime('%Y-%m-%d_%H-%M')
    end_str = image_df['DateTime'].max().strftime('%Y-%m-%d_%H-%M')
    output_filename = VIDEO_OUTPUT_DIR / f"{start_str}_to_{end_str}_animation.mp4"
    print("Generating weather animation video...")
    generate_weather_animation(station, image_df, full_weather_data, WEBCAM_DATA_DIR, output_filename,frames, fps)
    print(f"Video saved to: {output_filename}")

    # --- GENERATE MIDI ---
    audio_filename = f"output_{start_str}_{end_str}_{bpm}.mid"
    audio_path = AUDIO_OUTPUT_DIR / audio_filename
    print("Generating MIDI file...")
    midi = produce_midi_file(full_weather_data, bpm, vel_min, vel_max, instruments)
    with open(audio_path, "wb") as output_file:
        midi.writeFile(output_file)
    print(f"MIDI saved to: {audio_path}")

    # --- CONVERT MIDI TO WAV ---
    print("Converting MIDI to WAV...")
    midi_to_wav(str(audio_path), BASE_DIR / "assets/weather_audio.wav")

    # --- MERGE VIDEO AND AUDIO ---
    final_output_path = FINAL_OUTPUT_DIR / f"{station}_{station_id}_{start_str}_{end_str}_{bpm}_{mode}.mp4"
    merge_video_audio(str(output_filename), BASE_DIR / "assets/weather_audio.wav", str(final_output_path))
    print(f"Final video with audio saved to: {final_output_path}")

if __name__ == "__main__":
    create_music_video_from_weather()