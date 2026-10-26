// Finding the beat of a music clip, for cutting to the music: the loudness
// envelope's rises (onsets), the tempo that best explains them (autocorrelation,
// 70–180 BPM), then a beat grid lined up with the strongest onsets.
import { waveform } from './media.js';

const RATE = 100; // envelope samples per second (the waveform's resolution)

// Beats of `peaks` (0..1 per 1/100 s) between from and to (seconds): { bpm, beats: [s] }.
export function findBeats(peaks, from = 0, to = peaks.length / RATE) {
  const a = Math.max(0, Math.floor(from * RATE)), b = Math.min(peaks.length, Math.ceil(to * RATE));
  const n = b - a;
  if (n < RATE * 2) return { bpm: 0, beats: [] };
  // onset strength: how much the (smoothed, log) loudness rises
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.log1p(40 * (peaks[a + i] || 0));
  const flux = new Float32Array(n);
  for (let i = 2; i < n; i++) flux[i] = Math.max(0, env[i] - (env[i - 1] + env[i - 2]) / 2);
  // tempo: the lag (in samples) where the onsets repeat best
  const minLag = Math.round((60 / 180) * RATE), maxLag = Math.round((60 / 70) * RATE);
  let bestLag = 0, bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sc = 0;
    for (let i = lag; i < n; i++) sc += flux[i] * flux[i - lag];
    // a mild preference for tempos near 120 BPM, which most music is close to
    sc *= 1 - 0.25 * Math.abs(Math.log2((60 * RATE) / lag / 120));
    if (sc > bestScore) { bestScore = sc; bestLag = lag; }
  }
  if (!bestLag || bestScore <= 0) return { bpm: 0, beats: [] };
  // the beat length to a hundredth of a sample, and where the grid starts, by how much
  // onset strength the grid lands on (a whole-sample length drifts over a long song)
  let period = bestLag, bestPhase = 0, gridScore = -1;
  for (let lag = bestLag - 1; lag <= bestLag + 1; lag += 0.02) {
    for (let ph = 0; ph < lag; ph++) {
      let sc = 0;
      for (let x = ph; x < n; x += lag) { const i = Math.round(x); sc += flux[i] + 0.5 * ((flux[i - 1] || 0) + (flux[i + 1] || 0)); }
      if (sc > gridScore) { gridScore = sc; period = lag; bestPhase = ph; }
    }
  }
  const beats = [];
  for (let x = bestPhase; x < n; x += period) {
    // nudge each beat onto the strongest onset within 40 ms
    const i = Math.round(x);
    let k = i, v = flux[i] || 0;
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) if (flux[j] > v) { v = flux[j]; k = j; }
    beats.push((a + k) / RATE);
  }
  return { bpm: Math.round((600 * RATE) / period) / 10, beats };
}

// The beats of a music clip, in timeline time.
export async function clipBeats(p, c) {
  const asset = p.assets[c.asset];
  const peaks = asset && (await waveform(asset));
  if (!peaks) return { bpm: 0, beats: [] };
  const from = c.in, to = c.in + c.dur * c.speed;
  const r = findBeats(peaks, from, to);
  return { bpm: Math.round(r.bpm * c.speed), beats: r.beats.map((s) => c.start + (s - c.in) / c.speed).filter((t) => t >= c.start && t <= c.start + c.dur) };
}
