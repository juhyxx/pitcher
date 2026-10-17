/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002).
 *
 * Returns a function that takes a Float32Array of `bufferSize` samples and
 * yields `{ frequency, clarity }`, or `null` when no periodic signal is found.
 */
export function createYinDetector({
  sampleRate,
  bufferSize,
  minFreq = 50,
  maxFreq = 1500,
  threshold = 0.15,
}) {
  const half = bufferSize >> 1;
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(half - 1, Math.ceil(sampleRate / minFreq));
  const d = new Float32Array(tauMax + 2);

  return function detect(buf) {
    // Difference function, only over the lags we care about.
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let sum = 0;
      for (let i = 0; i < half; i++) {
        const delta = buf[i] - buf[i + tau];
        sum += delta * delta;
      }
      d[tau] = sum;
    }

    // Cumulative mean normalized difference.
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      running += d[tau];
      d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }

    // First dip under the threshold, then walk down to its local minimum.
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < threshold) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return null;

    // Parabolic interpolation for sub-sample accuracy.
    const s0 = d[tau - 1];
    const s1 = d[tau];
    const s2 = d[tau + 1];
    const denom = s0 + s2 - 2 * s1;
    const shift = denom !== 0 ? Math.max(-1, Math.min(1, (s0 - s2) / (2 * denom))) : 0;

    return { frequency: sampleRate / (tau + shift), clarity: 1 - s1 };
  };
}
