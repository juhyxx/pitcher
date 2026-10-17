<p align="center"><img src="assets/logo.svg" width="360" alt="Pitcher"></p>

Real-time pitch tracker that runs entirely in the browser. It listens to an audio
input, detects the fundamental frequency, and draws it on a scrolling graph where
every horizontal line is one semitone. Installable as a PWA and works offline.

**Live:** <https://juhyxx.github.io/pitcher/>

## Develop

No dependencies. Browsers only allow microphone access and ES modules from
`http://localhost` or `https://`, so serve the folder rather than opening the file:

```sh
npm run dev        # or: python3 -m http.server 8000
```

Then open <http://localhost:8000> and press **Start** (or Space). The unbuilt source
reports its version as `dev` and does not register the service worker, so there
is no caching to fight while editing.

## Build and versioning

```sh
npm run build      # writes dist/
npm run preview    # build, then serve dist/ on :8000
```

`scripts/build.js` copies the app into `dist/` and stamps a version of the form
`<package.json version>+<content hash>`, for example `1.0.0+1ef02b15`:

- `dist/src/version.js` gets the version (shown next to the logo).
- `dist/sw.js` is generated from `sw.js` with that version as its cache name and
  the list of files to precache.

Any change to a shipped file changes the hash, so browsers see a new service
worker, install it in the background and show a **Reload** prompt; the old cache
is deleted once the new version takes over. An unchanged tree always builds to
the same version. Bump `version` in `package.json` for releases.

## Deploy

Every push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which builds and publishes `dist/` to GitHub Pages. One-time setup: in the repo's
**Settings → Pages**, set **Source** to **GitHub Actions**.

## Features

- One grid line per semitone; C notes are emphasised, sharps get a shaded band.
- Trace colour shows tuning: green within ±10¢, amber within ±25¢, red beyond.
- **Snap to notes** quantises the trace so each held tone is a flat line.
- Input device picker, note range, time window (5–30 s), and a noise gate with a level meter.
- Settings are remembered in `localStorage`.

## Files

- `src/pitch.js`: YIN pitch detector
- `src/graph.js`: canvas renderer for the scrolling graph
- `src/notes.js`: frequency/MIDI/note-name helpers
- `src/main.js`: microphone setup, detection loop, UI wiring
- `src/pwa.js`: service worker registration and update prompt
- `sw.js`: service worker template (filled in by the build)
- `scripts/build.js`: build and versioning
- `icons/`, `assets/logo.svg`: app icons and logo
