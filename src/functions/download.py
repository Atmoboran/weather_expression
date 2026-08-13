import requests
import os
import zipfile
from datetime import datetime, timedelta

# One session for the whole run. Each webcam image would otherwise pay for a fresh
# TCP + TLS handshake, which dominates the download stage (~156 ms per request
# against opendata.dwd.de, versus ~44 ms on a reused connection).
SESSION = requests.Session()

###################################################################
# --- Function to collect timestamps of webcam images already on disk
def scan_existing_datetimes(output_path, station):
    """
    Returns the datetimes of every webcam image for a station in the output directory.
    """
    datetimes = []
    for fname in os.listdir(output_path):
        if not (fname.startswith(station) and fname.endswith('.jpg')):
            continue
        try:
            parts = fname.replace('.jpg', '').split('_')
            datetimes.append(datetime.strptime(f"{parts[1]}{parts[2]}", "%Y%m%d%H%M"))
        except (IndexError, ValueError) as e:
            print(f"⚠️ Skipping malformed filename: {fname} ({e})")
    return datetimes

###################################################################
# --- Function to download webcam images from DWD Website
def download_webcam_images(station, res, output_path):
    """
    Downloads the latest webcam images for the given station,
    resolution, and output path.

    Returns the (earliest, latest) timestamp across every image on disk for this
    station, not just the ones fetched by this call, so that a run which finds most
    images already cached still reports the full available range.
    """
    now = datetime.now()

    # get current date and two days before
    dates = [(now - timedelta(days=offset)).strftime('%Y%m%d') for offset in (0, 1, 2)]

    # 10-min interval
    dt = 10
    times = [
        f'{str(i).zfill(4)}'
        for i in range(0, 2400, dt)
        if i % 100 not in [60, 70, 80, 90]
    ]

    os.makedirs(output_path, exist_ok=True)

    downloaded = 0
    for d in dates:
        for t in times:
            # Timestamps in the future cannot exist yet; requesting them is 144
            # guaranteed 404s on the first day of the range.
            if datetime.strptime(f"{d}{t}", "%Y%m%d%H%M") > now:
                continue

            file_path = os.path.join(output_path, f"{station}_{d}_{t}.jpg")
            if os.path.exists(file_path):
                continue

            url = f"https://opendata.dwd.de/weather/webcam/{station}/{station}_{d}_{t}_{res}.jpg"
            try:
                response = SESSION.get(url, timeout=10)
                # Check the status explicitly rather than inferring success from body
                # size: an error page or a truncated image over 1 KB would otherwise
                # be saved with a .jpg extension.
                if response.status_code == 200 and len(response.content) > 1024:
                    with open(file_path, "wb") as f:
                        f.write(response.content)
                    print(f"Downloaded: {file_path}")
                    downloaded += 1
            except requests.RequestException as e:
                print(f"⚠️ Failed to download {url}: {e}")

    print(f'✅ Finished downloading webcam images ({downloaded} new)')

    available = scan_existing_datetimes(output_path, station)
    if not available:
        raise FileNotFoundError(
            f"No webcam images for station '{station}' in {output_path}. "
            "The station name or resolution may be wrong, or DWD may have no recent images."
        )

    return min(available), max(available)

###############################################################################
# --- Function to download station data from DWD Website
def download_station_data(station_id, output_path, type):
    """
    Downloads the latest weather station data for the given station ID,
    extracts the zip files, and removes the original zip files.
    """
    # Ensure output directory exists
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Define DWD base directory
    dwd_base_dir = 'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/10_minutes/'
    
    if type == 'recent':
        suffix = 'akt'
    elif type == 'now':
        suffix = 'now'
    else:
        raise ValueError(
            f"Unsupported type '{type}' in download_station_data, "
            "only 'now' or 'recent' are available."
        )
    # URLs for different data types
    data_sources = {
        "temp": f"{dwd_base_dir}air_temperature/" + type + f"/10minutenwerte_TU_{station_id}_" + suffix + ".zip",
        "precip": f"{dwd_base_dir}precipitation/" + type + f"/10minutenwerte_nieder_{station_id}_" + suffix + ".zip",
        "wind": f"{dwd_base_dir}wind/" + type + f"/10minutenwerte_wind_{station_id}_" + suffix + ".zip",
    }
    
    for data_type, url in data_sources.items():
        zip_file_path = output_path / f"{data_type}.zip"
        
        # Download file
        response = SESSION.get(url, timeout=30)
        if response.status_code == 200:
            with open(zip_file_path, "wb") as f:
                f.write(response.content)
            print(f"Downloaded: {zip_file_path}")
        else:
            print(f"Failed to download {url}")
            continue
        
        # Extract the zip file
        try:
            with zipfile.ZipFile(zip_file_path, 'r') as zip_ref:
                zip_ref.extractall(output_path)
            print(f"Extracted: {zip_file_path}")
        except zipfile.BadZipFile:
            print(f"Error: Corrupt zip file {zip_file_path}")
            continue
        
        # Delete the zip file
        os.remove(zip_file_path)
        print(f"Deleted: {zip_file_path}")




