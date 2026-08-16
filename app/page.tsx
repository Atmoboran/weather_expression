import { Player } from '@/components/Player';

/**
 * The whole site is one page.
 *
 * It stays a client component below this boundary because everything it does —
 * Web Audio, a canvas driven by the audio clock, scrubbing — happens after the
 * first paint. Server-rendering the session would also mean rendering it into
 * the HTML cache, and the session changes every ten minutes.
 */
export default function Home() {
  return (
    <main>
      <Player />
    </main>
  );
}
