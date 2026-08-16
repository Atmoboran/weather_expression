'use client';

import { useEffect, useRef } from 'react';

/**
 * Draws the current frame to a canvas.
 *
 * A canvas rather than an `<img>` whose src changes: swapping src decodes on
 * the main thread and can paint a blank frame between the old image being
 * dropped and the new one arriving. Frames are already decoded by the
 * preloader, so drawImage is a straight blit and playback holds its rate.
 *
 * A missing frame keeps whatever was last drawn instead of clearing to black.
 * DWD occasionally publishes a gap, and a held frame reads as "nothing moved",
 * which is much closer to the truth than a flash of empty canvas.
 */

export type WebcamStageProps = {
  images: (HTMLImageElement | null)[];
  index: number;
  alt: string;
};

export function WebcamStage({ images, index, alt }: WebcamStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = images[index];
    if (!canvas || !image) return;

    if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
    }

    const context = canvas.getContext('2d');
    context?.drawImage(image, 0, 0);
  }, [images, index]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={alt}
      className="w-full rounded-lg border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', aspectRatio: '16 / 9' }}
    />
  );
}
