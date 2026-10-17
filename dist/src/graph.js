import { isC, isSharp, noteName } from './notes.js';

const GUTTER = 48;          // px reserved on the left for note labels
const HISTORY_MS = 31000;   // keep enough for the largest window option
const MAX_GAP_MS = 120;     // longer gaps between frames break the trace
const LABEL_MIN_ROW = 12;   // below this row height only C notes get labels
const RIGHT_PAD = 12;       // px between "now" and the right edge

/**
 * Scrolling pitch-over-time plot. Each horizontal line is one semitone; the
 * newest sample sits at the right edge and older ones scroll off to the left.
 */
export class PitchGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.history = [];
    this.low = 36;
    this.high = 84;
    this.windowMs = 10000;
    this.snap = false;
    this.t0 = performance.now();
    this.now = this.t0;

    this.readColors();
    this.resize();

    new ResizeObserver(() => {
      this.resize();
      this.render();
    }).observe(canvas);

    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      this.readColors();
      this.render();
    });
  }

  readColors() {
    const style = getComputedStyle(document.documentElement);
    const v = (name) => style.getPropertyValue(name).trim();
    this.colors = {
      bg: v('--plot-bg'),
      gutter: v('--plot-gutter'),
      band: v('--plot-band'),
      line: v('--plot-line'),
      lineStrong: v('--plot-line-strong'),
      label: v('--plot-label'),
      labelStrong: v('--text'),
      time: v('--plot-time'),
      accent: v('--accent'),
      good: v('--good'),
      warn: v('--warn'),
      bad: v('--bad'),
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
    const { ctx, w, h, colors, low, high } = this;
    if (!w || !h) return;

    const plotW = w - GUTTER;
    const rowH = h / (high - low + 1);
    const y = (m) => (high + 0.5 - m) * rowH;
    const pxPerMs = (plotW - RIGHT_PAD) / this.windowMs;
    const x = (t) => w - RIGHT_PAD - (this.now - t) * pxPerMs;
    const current = this.latest;
    const currentRow = current == null ? null : Math.round(current);

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    // Darker bands on sharps, piano-roll style.
    ctx.fillStyle = colors.band;
    for (let m = low; m <= high; m++) {
      if (!isSharp(m)) continue;
      ctx.fillRect(GUTTER, y(m) - rowH / 2, plotW, rowH);
    }

    this.drawTimeGrid(pxPerMs, x);

    // One line per semitone; C lines are emphasised as octave markers.
    ctx.lineWidth = 1;
    for (let m = low; m <= high; m++) {
      const py = Math.round(y(m)) + 0.5;
      ctx.strokeStyle = isC(m) ? colors.lineStrong : colors.line;
      ctx.beginPath();
      ctx.moveTo(GUTTER, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    this.drawTrace(x, y);
    this.drawLabels(y, rowH, currentRow);
  }

  drawTimeGrid(pxPerMs, x) {
    const { ctx, w, h, colors } = this;
    const pxPerSec = pxPerMs * 1000;
    const labelEvery = pxPerSec >= 60 ? 1 : pxPerSec >= 25 ? 2 : 5;
    const first = Math.ceil((this.now - this.windowMs - this.t0) / 1000);
    const last = Math.floor((this.now - this.t0) / 1000);

    ctx.font = '10px system-ui, sans-serif';
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
    const { ctx, w, h, colors, snap } = this;
    const paths = { good: new Path2D(), warn: new Path2D(), bad: new Path2D() };
    const tStart = this.now - this.windowMs - MAX_GAP_MS;
    let prev = null;
    let last = null;

    for (const p of this.history) {
      if (p.t < tStart || p.midi == null) {
        prev = null;
        continue;
      }
      const nearest = Math.round(p.midi);
      const m = snap ? nearest : p.midi;
      const cents = Math.abs(p.midi - nearest) * 100;
      const path = paths[cents <= 10 ? 'good' : cents <= 25 ? 'warn' : 'bad'];
      const px = x(p.t);
      const py = y(m);

      const connected = prev
        && p.t - prev.t < MAX_GAP_MS
        && (snap ? m === prev.m : Math.abs(m - prev.m) <= 1);
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
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const key of ['bad', 'warn', 'good']) {
      ctx.strokeStyle = colors[key];
      ctx.stroke(paths[key]);
    }
    // Marker on the live sample.
    if (last && this.latest != null) {
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawLabels(y, rowH, currentRow) {
    const { ctx, h, colors, low, high } = this;
    ctx.fillStyle = colors.gutter;
    ctx.fillRect(0, 0, GUTTER, h);

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let m = low; m <= high; m++) {
      const active = m === currentRow;
      if (!active && !isC(m) && rowH < LABEL_MIN_ROW) continue;
      ctx.font = `${active || isC(m) ? 600 : 400} 11px system-ui, sans-serif`;
      ctx.fillStyle = active ? colors.accent : isC(m) ? colors.labelStrong : colors.label;
      ctx.fillText(noteName(m), GUTTER - 8, y(m));
    }
  }
}

function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
