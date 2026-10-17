import { PitchGraph } from './graph.js?v=98b19c1';
import { freqToMidi, midiToFreq, noteName } from './notes.js?v=98b19c1';
import { createYinDetector } from './pitch.js?v=98b19c1';
import { VERSION } from './version.js?v=98b19c1';

const FFT_SIZE = 2048;
const NOTE_MIN = 24;   // C1
const NOTE_MAX = 96;   // C7
const IDLE_AFTER_MS = 400;
const CENTS_STEP = 5;      // one LED per 5 cents, −50 … +50
const LEVEL_STEP = 5;      // one LED per 5 dB, −80 … 0 dB
const LEVEL_FLOOR = -80;
const SETTINGS_KEY = 'pitcher.settings';
const DEFAULTS = { autoRange: true, low: 36, high: 84, window: 10, gate: -50, deviceId: '' };

const $ = (id) => document.getElementById(id);
const els = {
  toggle: $('toggle'),
  device: $('device'),
  autoRange: $('autoRange'),
  rangeNotes: $('rangeNotes'),
  low: $('low'),
  high: $('high'),
  window: $('window'),
  windowValue: $('windowValue'),
  gate: $('gate'),
  gateValue: $('gateValue'),
  levelLeds: $('levelLeds'),
  overlay: $('overlay'),
  readout: $('readout'),
  note: $('note'),
  freq: $('freq'),
  cents: $('cents'),
  centsLeds: $('centsLeds'),
};

const centsLeds = makeLeds(els.centsLeds, 100 / CENTS_STEP + 1);
const centsZero = centsLeds.length >> 1;
const levelLeds = makeLeds(els.levelLeds, -LEVEL_FLOOR / LEVEL_STEP);

const settings = loadSettings();
const graph = new PitchGraph($('graph'));

let audio = null;     // { ctx, stream, analyser, buf, detect }
let rafId = 0;
let recent = [];      // last raw detections, for median smoothing
let lastVoiced = 0;

// ---------------------------------------------------------------- settings

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode etc.) — settings just won't persist.
  }
}

function applySettings() {
  graph.auto = settings.autoRange;
  if (!settings.autoRange) graph.setRange(settings.low, settings.high);
  graph.windowMs = settings.window * 1000;
  els.autoRange.checked = settings.autoRange;
  els.rangeNotes.hidden = settings.autoRange;
  els.low.value = graph.low;
  els.high.value = graph.high;
  els.window.value = settings.window;
  els.windowValue.textContent = `${settings.window} s`;
  els.gate.value = settings.gate;
  els.gateValue.textContent = `${settings.gate} dB`;
  setFill(els.window);
  setFill(els.gate);
  graph.render();
}

function fillNoteSelects() {
  for (let m = NOTE_MIN; m <= NOTE_MAX; m++) {
    els.low.add(new Option(noteName(m), m));
    els.high.add(new Option(noteName(m), m));
  }
}

// ---------------------------------------------------------------- audio

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications',
  );
  els.device.length = 1; // keep "System default"
  inputs.forEach((d, i) => els.device.add(new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
  els.device.value = inputs.some((d) => d.deviceId === settings.deviceId) ? settings.deviceId : '';
}

function openStream(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      // Processing meant for voice calls distorts pitch; turn it all off.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

async function start() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showOverlay('Microphone access needs a secure context — open this page via http://localhost or https.', true);
    return;
  }
  els.toggle.disabled = true;
  try {
    let stream;
    try {
      stream = await openStream(settings.deviceId);
    } catch (err) {
      if (!settings.deviceId || err.name !== 'OverconstrainedError') throw err;
      settings.deviceId = ''; // remembered device is gone; fall back to default
      stream = await openStream('');
    }

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    ctx.createMediaStreamSource(stream).connect(analyser);

    audio = {
      ctx,
      stream,
      analyser,
      buf: new Float32Array(FFT_SIZE),
      detect: createYinDetector({ sampleRate: ctx.sampleRate, bufferSize: FFT_SIZE, minFreq: 50, maxFreq: 2000 }),
    };
    recent = [];
    graph.reset(performance.now());
    els.toggle.textContent = 'Stop';
    els.toggle.classList.add('running');
    showOverlay(null);
    rafId = requestAnimationFrame(tick);
    await refreshDevices(); // labels become available once permission is granted
  } catch (err) {
    stop();
    showOverlay(
      err.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in the browser’s site settings and press Start again.'
        : `Could not open the microphone: ${err.message || err.name}`,
      true,
    );
  } finally {
    els.toggle.disabled = false;
  }
}

function stop() {
  cancelAnimationFrame(rafId);
  if (audio) {
    audio.stream.getTracks().forEach((t) => t.stop());
    audio.ctx.close();
    audio = null;
  }
  els.toggle.textContent = 'Start';
  els.toggle.classList.remove('running');
  showLevel(-Infinity);
  showCents(null);
  els.readout.classList.add('idle');
}

async function restart() {
  if (!audio) return;
  stop();
  await start();
}

// ---------------------------------------------------------------- loop

function tick() {
  const now = performance.now();
  const { analyser, buf, detect } = audio;
  analyser.getFloatTimeDomainData(buf);

  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
  const db = 20 * Math.log10(Math.sqrt(sumSq / buf.length) || 1e-10);
  const open = db >= settings.gate;
  showLevel(db);

  let raw = null;
  if (open) {
    const result = detect(buf);
    if (result) raw = freqToMidi(result.frequency);
  }
  const midi = smooth(raw);

  graph.push(now, midi);
  graph.render();
  updateReadout(midi, now);

  rafId = requestAnimationFrame(tick);
}

/** Median of the last three detections — kills single-frame octave jumps. */
function smooth(raw) {
  recent.push(raw);
  if (recent.length > 3) recent.shift();
  if (raw == null || recent.some((v) => v == null) || recent.length < 3) return raw;
  return [...recent].sort((a, b) => a - b)[1];
}

function updateReadout(midi, now) {
  if (midi == null) {
    if (now - lastVoiced > IDLE_AFTER_MS && !els.readout.classList.contains('idle')) {
      els.readout.classList.add('idle');
      showCents(null);
    }
    return;
  }
  lastVoiced = now;
  const nearest = Math.round(midi);
  const cents = Math.round((midi - nearest) * 100);

  els.readout.classList.remove('idle');
  els.note.textContent = noteName(nearest);
  els.freq.textContent = `${midiToFreq(midi).toFixed(1)} Hz`;
  els.cents.textContent = `${cents > 0 ? '+' : cents < 0 ? '−' : '±'}${Math.abs(cents)}¢`;
  showCents(cents);
}

// ---------------------------------------------------------------- UI

function makeLeds(container, count) {
  for (let i = 0; i < count; i++) container.append(document.createElement('span'));
  return [...container.children];
}

function setLed(led, cls) {
  if (led.className !== cls) led.className = cls;
}

/** Lights the LED nearest to `cents` (null: all off), coloured by how far off it is. */
function showCents(cents) {
  const lit = cents == null ? -1 : centsZero + Math.round(cents / CENTS_STEP);
  const abs = Math.abs(cents ?? 0);
  const tone = abs <= 10 ? 'good' : abs <= 25 ? 'warn' : 'bad';
  centsLeds.forEach((led, i) => setLed(led, [i === centsZero && 'center', i === lit && `on ${tone}`].filter(Boolean).join(' ')));
}

/** Level meter: LEDs below the gate light grey, the top ones yellow and red. */
function showLevel(db) {
  levelLeds.forEach((led, i) => {
    const ledDb = LEVEL_FLOOR + i * LEVEL_STEP;
    let cls = '';
    if (db > ledDb) cls = ledDb < settings.gate ? 'on dim' : ledDb >= -10 ? 'on bad' : ledDb >= -20 ? 'on warn' : 'on good';
    setLed(led, cls);
  });
}

/** Lights the slider groove up to its value. */
function setFill(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--pct', `${pct}%`);
}

function showOverlay(message, isError = false) {
  els.overlay.hidden = !message;
  els.overlay.classList.toggle('error', isError);
  if (message) els.overlay.firstElementChild.textContent = message;
}

function onRangeChange(changed) {
  let low = Number(els.low.value);
  let high = Number(els.high.value);
  if (high - low < 5) {
    if (changed === 'low') high = Math.min(NOTE_MAX, low + 12);
    else low = Math.max(NOTE_MIN, high - 12);
  }
  Object.assign(settings, { low, high });
  saveSettings();
  applySettings();
}

els.toggle.addEventListener('click', () => (audio ? stop() : start()));

els.device.addEventListener('change', () => {
  settings.deviceId = els.device.value;
  saveSettings();
  restart();
});

// Keep the (hidden) selects in step with auto mode, so switching it off starts from there.
graph.onRangeChange = (low, high) => {
  els.low.value = low;
  els.high.value = high;
};

els.autoRange.addEventListener('change', () => {
  settings.autoRange = els.autoRange.checked;
  // Switching auto off keeps the range it was showing.
  if (!settings.autoRange) Object.assign(settings, { low: graph.low, high: graph.high });
  saveSettings();
  applySettings();
});

els.low.addEventListener('change', () => onRangeChange('low'));
els.high.addEventListener('change', () => onRangeChange('high'));

els.window.addEventListener('input', () => {
  settings.window = Number(els.window.value);
  saveSettings();
  applySettings();
});

els.gate.addEventListener('input', () => {
  settings.gate = Number(els.gate.value);
  saveSettings();
  applySettings();
});

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target.closest('select, input, button')) return;
  e.preventDefault();
  audio ? stop() : start();
});

navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);

document.querySelector('.brand').title = `Pitcher ${VERSION}`;

fillNoteSelects();
applySettings();
showCents(null);
refreshDevices();
// The canvas only uses the pixel font once it has loaded.
document.fonts?.load('10px Silkscreen').then(() => graph.render());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
