<p align="center"><img src="assets/logo.svg" width="360" alt="Pitcher"></p>

Real-time pitch tracker that runs entirely in the browser. It listens to an audio
input, detects the fundamental frequency, and draws it on a scrolling graph where
every horizontal line is one semitone. Installable as a PWA and works offline.

**Live:** <https://juhyxx.github.io/pitcher/>

## Develop

No dependencies and no build step. Browsers only allow microphone access and ES
modules from `http://localhost` or `https://`, so serve the folder rather than
opening the file:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000> and press **Start** (or Space). Locally the version
is `dev` and the service worker fetches everything from the network first, so edits
show up on reload.

## Deploy and versioning

Every push to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml),
the same setup as [dots](https://github.com/juhyxx/dots):

1. Copies the published files to `_site/`.
2. Fails if `sw.js` doesn't list every published file (or lists one that doesn't exist).
3. Stamps the version, the short commit hash: `?v=<hash>` goes on the `styles.css` and
   `src/*.js` URLs in `index.html` and `sw.js` and on the modules' imports of each other,
   and `VERSION` in `sw.js` and `src/version.js` (shown next to the logo).
4. Force-pushes the result as a single commit to the `gh-pages` branch.

Because each deploy changes `sw.js`, browsers install the new worker, which caches that
version's files and deletes the old cache. The page is always fetched from the network
first, so a new deploy shows up on the next start; offline, everything comes from the cache.

When adding a file, list it in `FILES` in `sw.js`.

## Features

- One grid line per semitone; C notes are emphasised, sharps get a shaded band.
- Trace colour shows tuning: green within ±10¢, amber within ±25¢, red beyond.
- **Auto range** (default) shows the octave you're singing in, grows as soon as a note
  on screen falls outside it, and zooms back in once those notes scroll away. Turn it
  off to pick the lowest and highest note yourself.
- Input device picker, time window slider (3–30 s), and a noise gate with a level meter.
- Settings are remembered in `localStorage`.

## Files

- `src/pitch.js`: YIN pitch detector
- `src/graph.js`: canvas renderer for the scrolling graph
- `src/notes.js`: frequency/MIDI/note-name helpers
- `src/main.js`: microphone setup, detection loop, UI wiring
- `src/version.js`: version shown in the header (stamped on deploy)
- `sw.js`: service worker (offline cache)
- `icons/`, `assets/logo.svg`: app icons and logo
