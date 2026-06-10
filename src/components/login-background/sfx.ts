/**
 * 8-bit sound effects for the login-background shooter, synthesized with the
 * Web Audio API — no audio files, no deps, no bundle weight. Square waves and
 * filtered noise, the way the original hardware made them.
 *
 * Framework-agnostic (like the engine). The AudioContext is created lazily on
 * the first play call, which in the game always happens inside a user gesture
 * (a click or keydown), so browser autoplay policies never bite. Every call is
 * a no-op until then, and a no-op during SSR.
 *
 * Loudness: MASTER_VOLUME is deliberately whisper-quiet — this lives on a login
 * screen; the sounds should read as ticks, not arcade-hall blasts.
 */

const MASTER_VOLUME = 0.06;

let ac: AudioContext | null = null;
let master: GainNode | null = null;

function ctx(): AudioContext | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null;
  if (!ac) {
    ac = new window.AudioContext();
    master = ac.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}

// One enveloped oscillator: type + pitch glide f0→f1 over dur seconds.
function tone(
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  vol: number,
  delay = 0,
) {
  const a = ctx();
  if (!a || !master) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, f0), t0);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// A short burst of band-passed white noise sweeping f0→f1 (the "crunch" layer).
function hiss(dur: number, vol: number, f0: number, f1: number, delay = 0) {
  const a = ctx();
  if (!a || !master) return;
  const t0 = a.currentTime + delay;
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(Math.max(1, f0), t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  const gain = a.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export const sfx = {
  /** Bullet leaves the cannon — the classic square-wave laser drop. */
  pew() {
    tone('square', 980, 180, 0.08, 0.5);
  },
  /** Armed kill (bullet or click) — down-blip + a noise crunch. */
  zap() {
    tone('square', 320, 70, 0.06, 0.45);
    hiss(0.07, 0.3, 1400, 300);
  },
  /** Gate catch — the two-note rising coin chirp (INSERT COIN, literally). */
  coin() {
    tone('square', 988, 988, 0.08, 0.4);
    tone('square', 1319, 1319, 0.38, 0.4, 0.08);
  },
  /** Arming / fresh round — a quick rising square arpeggio. */
  powerup() {
    const notes = [392, 523, 659, 784];
    for (let i = 0; i < notes.length; i++) tone('square', notes[i], notes[i], 0.07, 0.4, i * 0.06);
  },
  /** Round-end ceremony begins — a tiny ascending fanfare. */
  fanfare() {
    const notes = [523, 659, 784];
    for (let i = 0; i < notes.length; i++) tone('square', notes[i], notes[i], 0.09, 0.4, i * 0.09);
    tone('square', 1046, 1046, 0.22, 0.4, 0.27);
  },
};
