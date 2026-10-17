# Pitcher

Real-time pitch tracker that runs entirely in the browser. It listens to an audio
input, detects the fundamental frequency, and draws it on a scrolling graph where
every horizontal line is one semitone.

## Run

No build step or dependencies. Browsers only allow microphone access and ES modules
from `http://localhost` or `https://`, so serve the folder rather than opening the file:

```sh
python3 -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000> and press **Start** (or Space).

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
