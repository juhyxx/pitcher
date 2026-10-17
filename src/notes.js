// '#' rather than '♯': the pixel font has no sharp sign.
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SHARPS = new Set([1, 3, 6, 8, 10]);

export const A4 = 440;

const pitchClass = (midi) => ((midi % 12) + 12) % 12;

export const freqToMidi = (freq) => 69 + 12 * Math.log2(freq / A4);
export const midiToFreq = (midi) => A4 * 2 ** ((midi - 69) / 12);

/** "C4", "F♯2", ... for an integer MIDI note number. */
export const noteName = (midi) => NAMES[pitchClass(midi)] + (Math.floor(midi / 12) - 1);

export const isSharp = (midi) => SHARPS.has(pitchClass(midi));
export const isC = (midi) => pitchClass(midi) === 0;
