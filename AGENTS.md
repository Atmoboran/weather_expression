<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working in this repo

Read [README.md](README.md) first. This is a port of someone else's artistic
work, and that shapes what counts as a correct change here.

## Invariants

1. **The sonification mappings are not ours to improve.** Every rule in
   `lib/soni/` — the seasonal scales, the 15 m/s wind ceiling, the pressure
   bands, the every-third-row sampling — is ported from
   `music_video_from_weather`. They are the artistic content of the project. If
   one looks wrong, it is still not a bug: it is a deviation, and it needs a
   comment, a README entry, and a decision to make it *visible* rather than
   silently corrected. There are exactly two so far (`PITCH_OFFSET`, and
   synthesised voices in place of a soundfont); both are documented in both
   places.

2. **`parity.test.ts` is the real test suite.** It diffs the port against the
   original Python note for note. Changing `compose.ts` or `scales.ts` without
   it going red means either the change was a no-op or the fixture no longer
   covers the branch you touched — check which. Never edit
   `__fixtures__/python_oracle.json` by hand; regenerate it from `oracle.py`.

3. **-999 is a gap, not a reading.** DWD's missing-value sentinel is filtered in
   `parseProduct`, before anything downstream sees it. Never clamp it instead:
   a sentinel temperature becomes the lowest note of the scale, a sentinel wind
   speed becomes maximum velocity, and neither failure is visible in the output.

4. **Frames and readings pair on exact timestamp equality.** Both sides publish
   on the same 10-minute UTC grid. No tolerance window, no interpolation, no
   nearest-match. Anything unpaired is dropped — the piece gets shorter, which
   is the honest outcome.

5. **The frame proxy validates the timestamp.** `/api/frame/[webcam]/[stamp]`
   requires an integer on a 10-minute boundary and a known webcam id. Without
   both checks it is an open proxy for arbitrary paths against
   opendata.dwd.de.

6. **The visual frame is driven by the audio clock**, read from the Tone
   transport inside a rAF loop — never by a `setInterval` counting frames.
   Two independent clocks drift apart within seconds and the picture stops
   matching the music.

## Conventions

- Comment the *why*. Most of the non-obvious code here exists because DWD or
  the original project does something surprising; say which.
- Charts follow the `dataviz` guidance: no dual-axis plots (the original uses
  two, and that is the one place we deliberately diverge on presentation), one
  hue across small multiples, a table view always reachable.
- Pure functions with correctness risk get unit tests. Everything in
  `lib/soni/` and `lib/dwd/product.ts` qualifies.

## Non-goals

No accounts, no database, no server-side rendering of session data, no MP4
export (that would need a render queue and would put the bandwidth bill back).
No scheduled jobs — the CDN is the cache.
