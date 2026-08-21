from src.functions.video_funcs import read_station_data
import subprocess
import os
import imageio_ffmpeg
import pandas as pd

#####################################################################################
# --- Function to merge video and audio files ---
# This function uses FFmpeg to merge an MP4 video file with a WAV audio file.
def merge_video_audio(video_file, audio_file, output_file):
    """Merge an MP4 video with a WAV audio file using FFmpeg via subprocess."""
    
    # Check if the files exist
    if not os.path.exists(video_file):
        print(f"Error: Video file '{video_file}' not found.")
        return
    if not os.path.exists(audio_file):
        print(f"Error: Audio file '{audio_file}' not found.")
        return

    # FFmpeg command to merge audio and video
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-i", video_file,
        "-i", audio_file,
        "-c:v", "copy",  # Copy video stream without re-encoding
        "-c:a", "aac",    # Convert audio to AAC (compatible with MP4)
        "-b:a", "192k",   # Set audio bitrate
        "-strict", "experimental", 
        output_file
    ]

    try:
        # Run the command
        subprocess.run(command, check=True)
        print(f"Successfully merged {video_file} and {audio_file} into {output_file}")
    
    except subprocess.CalledProcessError as e:
        print("FFmpeg failed:", e)

#####################################################################################
# --- Columns actually consumed downstream, per DWD product file ---
# Everything else in these files (QN flags, dew point, wind direction, ...) is unused
# by the video and the sonification, so it is never read.
FEED_COLUMNS = {
    'tu': ['MESS_DATUM', 'PP_10', 'TT_10'],   # pressure + temperature
    'ff': ['MESS_DATUM', 'FF_10'],            # wind speed
    'rr': ['MESS_DATUM', 'RWS_10'],           # precipitation
    'sd': ['MESS_DATUM', 'GS_10'],            # global solar radiation
}

#####################################################################################
# --- Function to locate the newest DWD product file for a variable ---
def find_product_file(weather_data_dir, station_id, infix, variable):
    """
    Returns the newest product file for a variable, or raises a descriptive error.

    Args:
        infix (str): 'now' for the current-day feed, 'min' for the recent feed.
        variable (str): DWD variable code, one of 'tu', 'ff', 'rr', 'sd'.
    """
    pattern = f"produkt_zehn_{infix}_{variable}_*_{station_id}.txt"
    matches = sorted(weather_data_dir.glob(pattern))
    if not matches:
        raise FileNotFoundError(
            f"No file matching '{pattern}' in {weather_data_dir}. "
            "Run download_station_data for this station and mode first."
        )
    return matches[-1]

#####################################################################################
# --- Function to read and join one DWD feed ('now' or 'recent') ---
def load_feed(weather_data_dir, station_id, infix):
    """
    Reads the temperature, wind and precipitation files of a single DWD feed and
    joins them on their shared timestamps.
    """
    frames = []
    for variable, columns in FEED_COLUMNS.items():
        file_path = find_product_file(weather_data_dir, station_id, infix, variable)
        df = read_station_data(str(file_path), usecols=columns)
        df['MESS_DATUM'] = pd.to_datetime(df['MESS_DATUM'], format="%Y%m%d %H%M", errors='coerce')
        frames.append(df)

    # An inner merge already keeps only timestamps present in all three files, so no
    # separate set intersection is needed.
    merged = frames[0]
    for df in frames[1:]:
        merged = merged.merge(df, on='MESS_DATUM', how='inner')

    return merged.dropna(subset=['MESS_DATUM'])

#####################################################################################
# --- Function to merge weather data from DWD ---
def merge_station_data(station_id, weather_data_dir):
    """
    Merges the 'now' and 'recent' DWD feeds for a station into one chronological table.

    Args:
        station_id (str): The station ID to merge data for.
        weather_data_dir (Path): Directory holding this station's downloaded files.
    Returns:
        pd.DataFrame: Merged DataFrame containing weather data.
        Path: Path to the merged file.
    """
    print("Loading weather data...")
    df_merged_now = load_feed(weather_data_dir, station_id, 'now')
    df_merged_recent = load_feed(weather_data_dir, station_id, 'min')

    # === Merge BOTH dataframes into one along the datetime axis ===
    # The two feeds overlap around the current day, so duplicate timestamps are
    # dropped (keeping the 'now' reading) and the result is sorted before anything
    # downstream relies on .iloc[0] / .iloc[-1] being first and last in time.
    df_merged_all = pd.concat([df_merged_recent, df_merged_now], ignore_index=True)
    df_merged_all = (
        df_merged_all
        .drop_duplicates(subset='MESS_DATUM', keep='last')
        .sort_values('MESS_DATUM')
        .reset_index(drop=True)
    )

    if df_merged_all.empty:
        raise ValueError(f"No weather data available for station {station_id}.")

    print(f"now: {df_merged_now.shape}, recent: {df_merged_recent.shape}, combined: {df_merged_all.shape}")

    start_time_all = df_merged_all['MESS_DATUM'].iloc[0].strftime('%Y%m%d_%H%M')
    end_time_all = df_merged_all['MESS_DATUM'].iloc[-1].strftime('%Y%m%d_%H%M')
    merged_file_path_all = weather_data_dir / f"{station_id}_merged_full_{start_time_all}_{end_time_all}.txt"

    df_merged_all.to_csv(merged_file_path_all, sep=';', index=False)

    print("✅ Weather data merged and saved for both 'now' and 'recent'.")

    return df_merged_all, merged_file_path_all
