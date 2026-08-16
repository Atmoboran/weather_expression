/**
 * Loads every frame of a session before playback starts.
 *
 * Swapping an `<img>` src at seven frames a second only looks smooth if the
 * bytes are already there; a cache miss mid-playback shows as a blank frame
 * while the music keeps going, which reads as a bug rather than as buffering.
 * A whole 48-hour session at the 400px default is ~290 frames and ~8.6 MB, so
 * fetching it upfront behind a progress bar is affordable and makes the
 * playhead honest.
 *
 * Concurrency is capped because 290 parallel requests is worse than useless:
 * browsers queue them anyway, and the CDN sees a burst it will rate-limit.
 */

const CONCURRENCY = 8;

export type PreloadProgress = {
  loaded: number;
  total: number;
  /** Frames that failed. Playback skips these rather than stalling. */
  failed: number;
};

export type PreloadResult = {
  images: (HTMLImageElement | null)[];
  failed: number;
};

export async function preloadFrames(
  urls: string[],
  onProgress: (progress: PreloadProgress) => void,
  signal?: AbortSignal,
): Promise<PreloadResult> {
  const images: (HTMLImageElement | null)[] = new Array(urls.length).fill(null);
  let loaded = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      if (signal?.aborted) return;
      const index = cursor++;

      images[index] = await loadOne(urls[index]).catch(() => null);
      if (images[index] === null) failed++;

      loaded++;
      onProgress({ loaded, total: urls.length, failed });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return { images, failed };
}

function loadOne(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${url}`));
    image.src = url;
  });
}
