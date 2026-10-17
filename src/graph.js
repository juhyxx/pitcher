import { isC, isSharp, noteName } from './notes.js?v=98b19c1';

const GUTTER = 52;          // px reserved on the left for note labels
const FONT = 'Silkscreen, monospace';
const HISTORY_MS = 31000;   // keep enough for the largest window option
const MAX_GAP_MS = 120;     // longer gaps between frames break the trace
const LABEL_MIN_ROW = 12;   // below this row height only C notes get labels
const RIGHT_PAD = 12;       // px between "now" and the right edge
const NOTE_MIN = 24;        // C1, lowest note the range can reach
const NOTE_MAX = 96;        // C7
const AUTO_SPAN = 12;       // auto range shows at least one octave
const SETTLE_DELAY_MS = 1500; // a new auto target must hold this long before the view moves
const EASE_MS = 120;        // time constant of the range animation

/**
 * Scrolling pitch-over-time plot. Each horizontal line is one semitone; the
 * newest sample sits at the right edge and older ones scroll off to the left.
 *
 * With `auto` on, the range follows the singer: it shows the C-to-C octave of
 * the current note, grows at once when a visible note falls outside it, and
 * zooms back in once the outlying notes have scrolled away.
 */
export class PitchGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.history = [];
    this.low = 60;
    this.high = 72;
    this.view = { low: this.low, high: this.high }; // animated towards low/high
    this.auto = true;
    this.onRangeChange = null;
    this.windowMs = 10000;
    this.t0 = performance.now();
    this.now = this.t0;
    this.lastRender = 0;
    this.voiced = false;      // seen a note since reset(); the first one sets the range at once
    this.settleSince = null;

    this.readColors();
    this.resize();

    new ResizeObserver(() => {
      this.resize();
      this.render();
    }).observe(canvas);
  }

  readColors() {
    const style = getComputedStyle(document.documentElement);
    const v = (name) => style.getPropertyValue(name).trim();
    this.colors = {
      gutter: v('--plot-gutter'),
      band: v('--plot-band'),
      line: v('--plot-line'),
      lineStrong: v('--plot-line-strong'),
      label: v('--plot-label'),
      labelStrong: v('--plot-label-strong'),
      time: v('--plot-time'),
      good: v('--led'),
      warn: v('--led-warn'),
      bad: v('--led-bad'),
    };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.w = width;
    this.h = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  reset(now) {
    this.history = [];
    this.t0 = now;
    this.now = now;
    this.voiced = false;
    this.settleSince = null;
  }

  setRange(low, high) {
    low = Math.max(NOTE_MIN, low);
    high = Math.min(NOTE_MAX, high);
    if (low === this.low && high === this.high) return;
    this.low = low;
    this.high = high;
    this.onRangeChange?.(low, high);
  }

  updateAutoRange() {
    const from = this.now - this.windowMs;
    let lo = Infinity;
    let hi = -Infinity;
    let current = null;
    for (const p of this.history) {
      if (p.t < from || p.midi == null) continue;
      current = Math.round(p.midi);
      lo = Math.min(lo, current);
      hi = Math.max(hi, current);
    }
    if (current == null) return; // nothing on screen: keep what we have

    const octave = 12 * Math.floor(current / 12);
    const targetLow = Math.min(lo, octave);
    const targetHigh = Math.max(hi, octave + AUTO_SPAN);

    if (!this.voiced) {
      this.voiced = true;
      this.setRange(targetLow, targetHigh);
    } else if (lo < this.low || hi > this.high) {
      this.settleSince = null;
      this.setRange(Math.min(lo, this.low), Math.max(hi, this.high));
    } else if (targetLow !== this.low || targetHigh !== this.high) {
      // Wait before moving to the current octave, so hovering around a C
      // doesn't flip the view back and forth.
      this.settleSince ??= this.now;
      if (this.now - this.settleSince >= SETTLE_DELAY_MS) {
        this.settleSince = null;
        this.setRange(targetLow, targetHigh);
      }
    } else {
      this.settleSince = null;
    }
  }

  /** Eases the drawn range towards low/high; jumps there when not animating. */
  stepView() {
    const t = performance.now();
    const dt = t - this.lastRender;
    this.lastRender = t;
    const k = dt > 200 ? 1 : 1 - Math.exp(-dt / EASE_MS);
    for (const key of ['low', 'high']) {
      this.view[key] += (this[key] - this.view[key]) * k;
      if (Math.abs(this[key] - this.view[key]) < 0.01) this.view[key] = this[key];
    }
  }

  /** Append one frame. `midi` is a fractional MIDI note number or null for silence. */
  push(t, midi) {
    this.now = t;
    this.history.push({ t, midi });
    const cutoff = t - HISTORY_MS;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
  }

  get latest() {
    return this.history.length ? this.history[this.history.length - 1].midi : null;
  }

  render() {
    const { ctx, w, h, colors } = this;
    if (!w || !h) return;

    if (this.auto) this.updateAutoRange();
    this.stepView();
    const { low, high } = this.view;

    const plotW = w - GUTTER;
    const rowH = h / (high - low + 1);
    const y = (m) => (high + 0.5 - m) * rowH;
    // Integer notes to draw; one extra each side so rows slide in while animating.
    const first = Math.floor(low) - 1;
    const last = Math.ceil(high) + 1;
    const pxPerMs = (plotW - RIGHT_PAD) / this.windowMs;
    const x = (t) => w - RIGHT_PAD - (this.now - t) * pxPerMs;
    const current = this.latest;
    const currentRow = current == null ? null : Math.round(current);

    ctx.clearRect(0, 0, w, h);

    // Darker bands on sharps, piano-roll style.
    ctx.fillStyle = colors.band;
    for (let m = first; m <= last; m++) {
      if (!isSharp(m)) continue;
      ctx.fillRect(GUTTER, y(m) - rowH / 2, plotW, rowH);
    }

    this.drawTimeGrid(pxPerMs, x);

    // One line per semitone; C lines are emphasised as octave markers.
    ctx.lineWidth = 1;
    for (let m = first; m <= last; m++) {
      const py = Math.round(y(m)) + 0.5;
      ctx.strokeStyle = isC(m) ? colors.lineStrong : colors.line;
      ctx.beginPath();
      ctx.moveTo(GUTTER, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    this.drawTrace(x, y);
    this.drawLabels(y, rowH, currentRow, first, last);
  }

  drawTimeGrid(pxPerMs, x) {
    const { ctx, w, h, colors } = this;
    const pxPerSec = pxPerMs * 1000;
    const labelEvery = pxPerSec >= 60 ? 1 : pxPerSec >= 25 ? 2 : 5;
    const first = Math.ceil((this.now - this.windowMs - this.t0) / 1000);
    const last = Math.floor((this.now - this.t0) / 1000);

    ctx.font = `8px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let s = Math.max(0, first); s <= last; s++) {
      const px = Math.round(x(this.t0 + s * 1000)) + 0.5;
      if (px < GUTTER) continue;
      ctx.strokeStyle = colors.time;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
      if (s % labelEvery === 0 && px > GUTTER + 14 && px < w - 14) {
        ctx.fillStyle = colors.label;
        ctx.fillText(formatTime(s), px, h - 4);
      }
    }
  }

  drawTrace(x, y) {
    const { ctx, w, h, colors } = this;
    const paths = { good: new Path2D(), warn: new Path2D(), bad: new Path2D() };
    const tStart = this.now - this.windowMs - MAX_GAP_MS;
    let prev = null;
    let last = null;

    for (const p of this.history) {
      if (p.t < tStart || p.midi == null) {
        prev = null;
        continue;
      }
      const m = p.midi;
      const cents = Math.abs(m - Math.round(m)) * 100;
      const path = paths[cents <= 10 ? 'good' : cents <= 25 ? 'warn' : 'bad'];
      const px = x(p.t);
      const py = y(m);

      const connected = prev && p.t - prev.t < MAX_GAP_MS && Math.abs(m - prev.m) <= 1;
      if (connected) {
        path.moveTo(prev.x, prev.y);
        path.lineTo(px, py);
      } else {
        path.moveTo(px, py);   // isolated point: draw a dot via the round cap
        path.lineTo(px + 0.1, py);
      }
      prev = { t: p.t, m, x: px, y: py };
      last = prev;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(GUTTER, 0, w - GUTTER, h);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // LED look: a wide faint halo under a thin bright line.
    for (const [width, alpha] of [[7, 0.15], [2.5, 1]]) {
      ctx.lineWidth = width;
      ctx.globalAlpha = alpha;
      for (const key of ['bad', 'warn', 'good']) {
        ctx.strokeStyle = colors[key];
        ctx.stroke(paths[key]);
      }
    }
    ctx.globalAlpha = 1;
    // Glowing marker on the live sample.
    if (last && this.latest != null) {
      ctx.fillStyle = colors.good;
      ctx.shadowColor = colors.good;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawLabels(y, rowH, currentRow, first, last) {
    const { ctx, h, colors } = this;
    ctx.fillStyle = colors.gutter;
    ctx.fillRect(0, 0, GUTTER, h);
    ctx.fillStyle = colors.line;
    ctx.fillRect(GUTTER - 1, 0, 1, h);

    ctx.save();
    ctx.font = `8px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let m = first; m <= last; m++) {
      const active = m === currentRow;
      if (!active && !isC(m) && rowH < LABEL_MIN_ROW) continue;
      ctx.fillStyle = active ? colors.good : isC(m) ? colors.labelStrong : colors.label;
      ctx.shadowColor = colors.good;
      ctx.shadowBlur = active ? 8 : 0;
      ctx.fillText(noteName(m), GUTTER - 10, Math.round(y(m)) + 1);
    }
    ctx.restore();
  }
}

function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
