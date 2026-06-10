/**
 * Framework-agnostic "detection sweep" canvas engine for the Wallarm auth
 * background. A slow scan line crosses the field; dots react as it passes; rare
 * orange events latch/bloom behind the sweep (the "caught" moment). Two textures
 * share this one engine, selected via `texture`.
 *
 * No framework imports — a thin React wrapper drives it, but it can equally be
 * mounted as a standalone injectable layer (Citadel Option 2).
 *
 * Easter egg: clicking a live anomaly "catches" it (green-square dissolve +
 * Press Start 2P verdict). On the `/login-background/game` route the wrapper
 * also flips the engine into `armed` mode after 5 catches — a Space-Invaders
 * style shooter where the same anomalies become a shootable population and a
 * pixel cannon (← → + Space) neutralises them through the very same kill path.
 */

import { sfx } from './sfx';

export type Texture = 'clean' | 'halftone';

export interface EngineOptions {
  texture: Texture;
  /** Grid cell size in px. Tighter = more pixel-y. */
  spacing: number;
  /** Seconds for one L→R sweep pass. */
  sweepPeriod: number;
  /** How far from the scan line (px) dots react. */
  bloomRadius: number;
  /** Minimum seconds between orange events. Higher = rarer. */
  anomalyInterval: number;
  /** Global opacity/strength multiplier (0–1). Keep low for production. */
  intensity: number;
  /**
   * Peak alpha a fully-bloomed (emphasized) dot reaches at the sweep line,
   * before `intensity`. Background dots keep their own low floor; this only
   * controls how strong the scanned dots get. Scaled by `intensity` like the
   * rest of the ambient field.
   */
  bloomAlpha: number;
  /** Halftone only: cap on a bloomed pixel's full edge length (px). */
  maxDotSize: number;
  /**
   * Sweep-line tilt in degrees. 0 = perfectly vertical. Positive leans the top
   * of the line to the right and the bottom to the left, so it reads at a slight
   * angle instead of perpendicular.
   */
  tilt: number;
  /**
   * Token-driven colors. These are CSS custom-property *names* resolved against
   * the canvas's computed style at runtime, so a dark theme is a pure token swap
   * with no engine change. Falls back to the prototype hexes if unresolved.
   */
  dotColorVar: string;
  accentColorVar: string;
  baseColorVar: string;
  /** CSS custom-property name for the clean texture's leading-edge scan line. */
  sweepColorVar: string;
  /** CSS custom-property name for the green "caught" confirm flash (easter egg). */
  caughtColorVar: string;
}

export const DEFAULTS: Record<
  Texture,
  Pick<EngineOptions, 'spacing' | 'bloomRadius' | 'maxDotSize'>
> = {
  clean: { spacing: 20, bloomRadius: 44, maxDotSize: 20 },
  halftone: { spacing: 16, bloomRadius: 80, maxDotSize: 20 },
};

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface Dot {
  x: number;
  y: number;
}

interface Latch {
  x: number;
  y: number;
  t0: number;
}

// A caught anomaly's fading "neutralised" state. It keeps its exact on-screen
// form — the halftone squares stay squares, a clean dot stays a dot — but
// recoloured green and dissolving out. No new shape: just red → green → gone.
interface CaughtCell {
  x: number;
  y: number;
  half: number;
  ao: number;
}
interface Caught {
  x: number;
  y: number;
  t0: number;
  // Halftone: the square cells frozen at catch time. Empty for the clean
  // texture, which draws a single round dot at (x, y) instead.
  cells: CaughtCell[];
  // Tiny terminal-style verdict drawn above the dissolving form.
  label: string;
}

// A live red anomaly. In idle mode there is at most one (today's behaviour); in
// armed mode a bounded population of these are the shooter's targets.
interface Anomaly {
  x: number;
  y: number;
  t0: number;
  life: number;
  caught: boolean;
}

// A player bullet rising up the field (armed mode only).
interface Bullet {
  x: number;
  y: number;
}

// Seconds a caught anomaly takes to dissolve. Slow + gentle, not a pop.
const CAUGHT_DUR = 1.4;

// Cluster radius (px) — the reach of an anomaly over the dot grid. Shared by the
// field draw, the catch freeze, and (loosely) the hit-tests.
const ANOMALY_R = 42;

// Geeky "you neutralised it" verdicts, one picked at random per catch.
const CAUGHT_LABELS = [
  'BLOCKED',
  'TERMINATED',
  'NEUTRALIZED',
  'QUARANTINED',
  'MITIGATED',
  'CONTAINED',
];

function pickLabel(): string {
  return CAUGHT_LABELS[(Math.random() * CAUGHT_LABELS.length) | 0];
}

// Chunky 8-bit pixel face for the verdict label. Declared via @font-face in
// globals.css and warmed by the React wrapper; falls back to monospace until
// the web font is ready.
const LABEL_FONT = "'Press Start 2P', ui-monospace, SFMono-Regular, Menlo, monospace";

// --- Shooter game (armed mode) tunables. All in canvas-px / seconds. ---------
// Difficulty is driven by target turnover (independent lifetimes refilling
// faster than they expire), not twitchy bullets. FIRE_CADENCE is the master
// fairness lever (raise to harden); raise ARMED_SPAWN to ease; lower TARGET_LIFE
// to harden. See docs/shooter-game-plan.md.
const MAX_TARGETS = 6; // concurrent red targets in armed mode
const ROUND_ATTACKS = 100; // attacks per round; spawning stops here, then the field drains and the round ends (~1 min)
const MAX_BULLETS = 24; // in-flight bullet cap
const BULLET_SPEED = 720; // px/s upward
const FIRE_CADENCE = 0.18; // s between shots while Space is held
const CANNON_SPEED = 420; // px/s lateral
const TARGET_LIFE = 4.0; // s armed-target lifetime (idle uses 2.4, as today)
const ARMED_SPAWN = 0.55; // s between armed spawns while under the cap
const HIT_R2 = 22 * 22; // bullet hit radius², compared with squared distance
const REVEAL_DELAY = 0.3; // s after spawn an armed target is shootable/visible even ahead of the sweep
const ARM_RISE = 0.45; // s the cannon takes to rise into place on arming
const FIRST_SPAWN_DELAY = 0.7; // s after arming before the first target appears
const CANNON_HALF_W = 16; // half the cannon base width
const CANNON_BASE_OFFSET = 26; // px from the bottom edge to the cannon base top
const CANNON_BARREL_Y = 40; // px from the bottom edge where bullets emit
const HUD_CLEAR_W = 120; // px reserved from the right edge for the top-right HUD counter
const HUD_CLEAR_H = 140; // px reserved from the top edge (counter card + controls hint)
// Game-mode spawn fairness. Keep armed/gate threats out of the regions the player
// can't fairly engage: under the centered sign-in card (an opaque card hides them
// there, so they age out as silent, score-tanking "escapes"), under the top-right
// HUD, and down in the cannon's own zone. Threats fill the full ring around the
// card instead (both sides + the full-width strips above and below it). Only
// active once the wrapper sets the card box via setExclusion (the /game route);
// /final and shell-transition keep their original full-field placement.
const CARD_CLEAR_PAD = 48; // px kept clear around the card so a target's bloom never tucks under its edge
const SPAWN_EDGE = 24; // px inset from the screen edges for game-mode spawns
const CANNON_CLEAR = 72; // px reserved at the bottom so targets stay above the cannon barrel (hittable)
const SPAWN_TRIES = 24; // reject-sampling attempts before the degenerate fallback

// --- Round-end celebration ("happy ending") tunables. ------------------------
// Tier ladder (locked): <20 no ceremony · 20–34 contained · 35–59 fireworks +
// score print · 60–89 the same fireworks with MORE confetti · 90–99 blast-off ·
// 100 the secret AIRTIGHT storm. Design rules: celebrate in the field's own
// language (halftone squares, the grey/red/green rule, the sweep), every
// particle RENDERS snapped to the dot grid with chunky stepped fades (the 8-bit
// feel), rainbow color is reserved for the top tiers, and motion stays premium —
// ease-out drifts and dissolves, no shake/flash. The show plays its active
// timeline (CEL_DUR) and then SETTLES: digits + headline stay on stage until the
// player dismisses it (Esc → full exit, or Try-again → fresh round).
const CEL_DUR: Record<1 | 2 | 3 | 4, number> = { 1: 2.6, 2: 3.8, 3: 4.0, 4: 5.2 };
const CEL_LABEL_AT: Record<1 | 2 | 3 | 4, number> = { 1: 0.7, 2: 2.8, 3: 2.4, 4: 2.6 };
const CEL_SWEEP_START = 1.6; // s into the ceremony the score sweep-print begins
const CEL_SWEEP_DUR = 1.2; // s the sweep takes to cross the digit block
const CEL_LIFT_AT = 0.5; // s into blast-off the cannon starts to rise
const CEL_LIFT_DUR = 1.2; // s the liftoff takes (ease-in — a launch, not a pop)
const CEL_MAX_PARTICLES = 900; // hard cap so the 100% storm stays bounded
const CEL_RAIN_RATE = 360; // confetti pieces/s during the 100% storm window
// Retro arcade palette for the rainbow confetti — the celebration is the ONE
// deliberate exception to the grey/red/green rule and to token-driven color: a
// fixed 8-bit victory palette, used only at the top tiers.
const CEL_PAL: RGB[] = [
  { r: 251, g: 44, b: 54 }, // red
  { r: 239, g: 177, b: 0 }, // amber
  { r: 0, g: 166, b: 62 }, // green
  { r: 0, g: 184, b: 219 }, // cyan
  { r: 43, g: 127, b: 255 }, // blue
  { r: 173, g: 70, b: 255 }, // purple
  { r: 246, g: 51, b: 154 }, // pink
];
// 5×7 dot-matrix glyphs for the sweep-printed score (digits + %), one bit per
// grid dot — the score IS the halftone field, same visual language.
const CEL_GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '%': ['11000', '11001', '00010', '00100', '01000', '10011', '00011'],
};
const CEL_HEADLINES: Record<1 | 2 | 3 | 4, { main: string; sub: string }> = {
  1: { main: 'THREAT CONTAINED', sub: 'well done — share it with your mates' },
  2: { main: 'PERIMETER HELD', sub: 'you nailed it' },
  3: { main: 'ZERO BREACH', sub: 'you rock — worth a screenshot' },
  4: { main: 'AIRTIGHT — 100%', sub: 'flawless · the field salutes you' },
};

// A celebration particle (firework shard, thruster exhaust, or confetti). It
// moves continuously but RENDERS snapped to the dot grid — the 8-bit rule.
interface CelParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  half: number;
  c: RGB;
  grav: number;
  conf: boolean;
}
// A fireworks rocket: the cannon fires it toward a clear zone; it bursts there.
interface CelRocket {
  sx: number;
  tx: number;
  ty: number;
  t0: number;
  dur: number;
  x: number;
  y: number;
  done: boolean;
}
interface Celebration {
  tier: 1 | 2 | 3 | 4;
  t0: number;
  particles: CelParticle[];
  rockets: CelRocket[];
  pulses: { x: number; y: number; t0: number }[];
  // Sweep-printed score: dot index → 0..1 column fraction (reveal order).
  cells: Map<number, number> | null;
  cellsLeft: number;
  cellsWidth: number;
  burst1: boolean;
  burst2: boolean;
  // Fireworks-tier confetti drop size — the ONLY thing that differs between the
  // 35–59 and 60–89 bands (same show, more paper on top).
  confetti2Count: number;
  // The active timeline has finished; the end state (digits + headline) persists
  // on stage until the player dismisses it (Esc / Try-again / a new ceremony).
  settled: boolean;
}

function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) ** 3;
}
function easeInCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c;
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

interface Colors {
  dot: RGB;
  accent: RGB;
  base: string;
  sweep: RGB;
  caught: RGB;
}

// Prototype placeholders — used only if a token fails to resolve.
const FALLBACK_DOT: RGB = { r: 69, g: 85, b: 108 }; // slate-600 (WADS)
const FALLBACK_ACCENT: RGB = { r: 251, g: 44, b: 54 }; // red-500 (WADS)
const FALLBACK_SWEEP: RGB = { r: 15, g: 23, b: 43 }; // slate-950 (WADS)
const FALLBACK_CAUGHT: RGB = { r: 34, g: 197, b: 94 }; // green-500 (WADS)
const FALLBACK_BASE = '#f8fafc';

function parseColor(value: string): RGB | null {
  const v = value.trim();
  if (!v) return null;
  if (v[0] === '#') {
    let hex = v.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6) return null;
    const n = parseInt(hex, 16);
    if (Number.isNaN(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const m = v.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}

function gridArr(w: number, h: number, sp: number): { dots: Dot[]; cols: number; sp: number } {
  const a: Dot[] = [];
  // Clamp total cell count so a 4K viewport can't explode the loop.
  const cap = 20000;
  const safeSp = Math.max(sp, Math.sqrt((w * h) / cap));
  // Row-major with a known column count, so the celebration can address dots by
  // (row, col) when it maps the score glyphs onto the grid.
  let cols = 0;
  for (let x = safeSp / 2; x < w; x += safeSp) cols += 1;
  for (let y = safeSp / 2; y < h; y += safeSp)
    for (let x = safeSp / 2; x < w; x += safeSp) a.push({ x, y });
  return { dots: a, cols, sp: safeSp };
}

function sweepX(t: number, w: number, period: number): number {
  return ((t % period) / period) * (w + 140) - 70;
}

/**
 * Snapshot pushed to the wrapper on every score change. `kills` is the lifetime
 * catch count (drives the arming gate); the `round*` fields scope the current
 * fixed-length round (the comparable accuracy grade is `stopped / ROUND_ATTACKS`).
 */
export interface GameStats {
  /** Lifetime catches — pre-arm gate progress; stays high so the field stays armed. */
  kills: number;
  /** Threats stopped this round (the score / accuracy numerator). */
  stopped: number;
  /** Threats that slipped past this round (timed out unshot). */
  escaped: number;
  /** Threats that have appeared this round (round ends at ROUND_ATTACKS). */
  spawned: number;
  /** Round complete — the full wave has spawned and the field has cleared. */
  done: boolean;
  /**
   * A round-end ceremony's ACTIVE show is playing — the wrapper holds Try-again
   * until it settles. After settling, the end state (digits + headline) persists
   * on stage until Esc / Try-again dismisses it, with celebrating back to false.
   */
  celebrating: boolean;
}

export interface SweepEngine {
  /** Start (or resume) the rAF loop. */
  start(): void;
  /** Stop the loop and detach listeners; keeps the last frame on screen. */
  stop(): void;
  /** Apply new options live (used by the tuning playground / prop changes). */
  setOptions(next: Partial<EngineOptions>): void;
  /** Force a single static frame and never schedule rAF (used by the paused prop). */
  renderStatic(t?: number): void;
  /** Recompute DPR sizing + grid for the current container size. */
  resize(): void;
  /**
   * Easter egg: hit-test a click (canvas-local px) against live anomalies and
   * "catch" the one under the pointer. Returns true if something was caught.
   * No-op while paused/stopped (nothing is animating to catch).
   */
  catchAt(x: number, y: number): boolean;
  /**
   * Game: switch the shooter mode — `idle` is the decorative field, `armed`
   * the live shooter. Does NOT reset the round (use startRound for that), so a
   * pause + resume keeps the round in progress.
   */
  setMode(mode: 'idle' | 'armed'): void;
  /** Game: begin a fresh scored round (zero the round counters + arm). First arm + Try-again. */
  startRound(): void;
  /**
   * Game: quit the shooter and return to the pristine decorative field — zeroes
   * the gate (lifetime catches) AND the round counters and clears the field, so
   * re-clicking the dots replays the insert-coin gate from scratch and re-arms on
   * the 5th catch. (Esc-to-exit. Distinct from startRound, which arms a fresh
   * round, and setMode, which preserves counts.)
   */
  exitGame(): void;
  /** Game: cannon lateral intent (−1 left, 0 stop, +1 right). Armed mode only. */
  setCannonDir(dir: number): void;
  /** Game: Space pressed/released. Cadence is owned by the loop. Armed only. */
  setFiring(on: boolean): void;
  /**
   * Register a callback fired whenever the round state changes: on every kill
   * (click or bullet), whenever a threat escapes, and at round end. Reports the
   * snapshot so the HUD can show stopped / faced + accuracy and the result.
   */
  onStats(cb: (stats: GameStats) => void): void;
  /**
   * Play the round-end celebration for an arbitrary score (0–100) — the demo
   * route's replay hook. endRound() drives the exact same path with the real
   * grade, so a demoed tier is always faithful to the real ending. Halftone
   * only (the game's texture); scores under 20 play nothing by design.
   */
  celebrate(score: number): void;
  /**
   * Enable/disable the synthesized 8-bit SFX (pew/zap/coin/power-up/fanfare).
   * Default OFF — only the game and celebration-demo routes turn it on, so the
   * plain decorative field never makes a sound.
   */
  setSound(on: boolean): void;
  /**
   * Game: set a centered no-spawn box (CSS px) — the sign-in card — so armed and
   * gate threats never spawn behind it (unhittable → unfair escapes). Pass null
   * to clear it (the default: the field spawns across its whole upper band as
   * before). Recomputed against the live canvas size each spawn, so it recenters
   * automatically on resize.
   */
  setExclusion(box: { width: number; height: number } | null): void;
}

export function createSweepEngine(
  canvas: HTMLCanvasElement,
  options: EngineOptions,
): SweepEngine {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const context = ctx;

  let opts = { ...options };
  let w = 0;
  let h = 0;
  let colors: Colors = {
    dot: FALLBACK_DOT,
    accent: FALLBACK_ACCENT,
    base: FALLBACK_BASE,
    sweep: FALLBACK_SWEEP,
    caught: FALLBACK_CAUGHT,
  };

  // Per-texture state.
  let dots: Dot[] = [];
  let gridCols = 0; // dots per row — lets the celebration address the grid by (row, col)
  let gridSp = 16; // actual grid pitch after the density cap (resize keeps it fresh)
  let latched: Latch[] = [];
  let lastLatch = -Infinity;

  // Anomaly population (replaces the old single ax/ay/aT/aCaught cluster). Idle
  // keeps ≤1; armed keeps up to MAX_TARGETS.
  let anomalies: Anomaly[] = [];
  let lastSpawn = -Infinity;

  // Easter-egg / game state.
  let caught: Caught[] = []; // green dissolves in flight
  let lastT = 0; // latest frame time (s) — so a click between frames can timestamp
  let lastFrameT = 0; // previous frame time (s) — for dt
  let mode: 'idle' | 'armed' | 'over' = 'idle';
  const bullets: Bullet[] = [];
  let cannonX = 0;
  let cannonDir = 0; // −1 | 0 | 1
  let firing = false;
  let lastFire = -Infinity;
  let armT = -Infinity; // arm-flourish start
  let onStatsCb: ((stats: GameStats) => void) | null = null;
  let killTotal = 0; // lifetime catches — drives the arming gate; never reset (keeps armed across rounds)
  // Per-round score, zeroed by startRound on every (re)arm. The round is a fixed
  // ROUND_ATTACKS wave, so accuracy is a comparable final grade out of the total.
  let roundKills = 0; // stopped this round
  let roundEscaped = 0; // slipped past this round (timed out unshot)
  let roundSpawned = 0; // attacks that have appeared this round (caps the round)
  let roundDone = false; // round complete — wave fully spawned and field cleared
  // Game-mode no-spawn box (the centered sign-in card), CSS px, or null. Set by
  // the wrapper on the /game route; keeps threats from spawning behind the card.
  let exclusion: { w: number; h: number } | null = null;
  // Round-end celebration in flight (null = none). cannonAway latches after a
  // blast-off so the launched cannon doesn't pop back under the results screen.
  let cel: Celebration | null = null;
  let cannonAway = false;
  // 8-bit SFX gate. Default OFF so /final, /tune and shell-transition stay a
  // silent login field; the wrapper enables it on the game + celebration-demo
  // routes (and the player can mute with M).
  let soundOn = false;

  let rafId: number | null = null;
  let running = false;

  function resolveColors() {
    const cs = getComputedStyle(canvas);
    const dot = parseColor(cs.getPropertyValue(opts.dotColorVar));
    const accent = parseColor(cs.getPropertyValue(opts.accentColorVar));
    const base = cs.getPropertyValue(opts.baseColorVar).trim();
    const sweep = parseColor(cs.getPropertyValue(opts.sweepColorVar));
    const caughtC = parseColor(cs.getPropertyValue(opts.caughtColorVar));
    colors = {
      dot: dot ?? FALLBACK_DOT,
      accent: accent ?? FALLBACK_ACCENT,
      base: base || FALLBACK_BASE,
      sweep: sweep ?? FALLBACK_SWEEP,
      caught: caughtC ?? FALLBACK_CAUGHT,
    };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    ({ dots, cols: gridCols, sp: gridSp } = gridArr(w, h, opts.spacing));
    // Seed / re-clamp the cannon into the new bounds.
    cannonX = cannonX === 0 ? w / 2 : Math.max(CANNON_HALF_W, Math.min(w - CANNON_HALF_W, cannonX));
    resolveColors();
    if (!running) renderStatic();
  }

  function drawClean(t: number) {
    const { r, g, b } = colors.dot;
    const sx = sweepX(t, w, opts.sweepPeriod);
    const tanT = Math.tan((opts.tilt * Math.PI) / 180);
    const sweepAt = (y: number) => sx + (h / 2 - y) * tanT;
    const k = opts.intensity;
    for (const d of dots) {
      const dist = Math.abs(d.x - sweepAt(d.y));
      const inBloom = dist < opts.bloomRadius;
      const a = inBloom
        ? 0.13 + (opts.bloomAlpha - 0.13) * (1 - dist / opts.bloomRadius)
        : 0.13;
      context.fillStyle = `rgba(${r},${g},${b},${a * k})`;
      context.beginPath();
      context.arc(d.x, d.y, inBloom ? 1.5 : 1, 0, 6.283);
      context.fill();
    }

    // No visible scan line in the clean variant — the sweep reads purely through
    // the dots blooming as it passes (and the orange "caught" latches below).

    // Latch: at most one orange event per interval, behind the sweep.
    if (t - lastLatch > opts.anomalyInterval && Math.random() < 0.05 && dots.length) {
      const cand = dots[(Math.random() * dots.length) | 0];
      if (cand.x < sweepAt(cand.y) - 8) {
        lastLatch = t;
        latched.push({ x: cand.x, y: cand.y, t0: t });
      }
    }
    latched = latched.filter((l) => t - l.t0 < 3.2);
    // The "caught" signal ignores `intensity` — it must always read at full
    // strength even when the ambient field is dimmed near-subliminal.
    const ac = colors.accent;
    for (const l of latched) {
      const a = Math.max(0, 1 - (t - l.t0) / 3.2);
      context.fillStyle = `rgba(${ac.r},${ac.g},${ac.b},${0.95 * a})`;
      context.shadowColor = `rgb(${ac.r},${ac.g},${ac.b})`;
      context.shadowBlur = 7 * a;
      context.beginPath();
      context.arc(l.x, l.y, 2.4, 0, 6.283);
      context.fill();
      context.shadowBlur = 0;
    }
  }

  // Anomaly envelope: a gentle sin bloom over its lifetime (0 → 1 → 0).
  function envOf(a: Anomaly, t: number): number {
    return Math.max(0, Math.sin(((t - a.t0) / a.life) * Math.PI));
  }

  // Sweep x-position at a given y (accounts for tilt).
  function sweepAtY(t: number, y: number): number {
    return sweepX(t, w, opts.sweepPeriod) + (h / 2 - y) * Math.tan((opts.tilt * Math.PI) / 180);
  }

  // Can this anomaly currently be caught/shot? Idle = today's rule (behind the
  // sweep + a real envelope). Armed relaxes to "behind the sweep OR aged past
  // REVEAL_DELAY" so the field stays reliably shootable through the sweep cycle.
  function hittable(a: Anomaly): boolean {
    if (a.caught) return false;
    // Floor matches drawHalftone's red gate (ao > 0.06) so "looks shootable" and
    // "is shootable" coincide — no faintly-red-but-dead dots.
    if (envOf(a, lastT) <= 0.06) return false;
    const sc = sweepAtY(lastT, a.y);
    // Armed: the whole target is shootable once its centre is behind the sweep or
    // it has aged in. Idle: clickable as soon as the cluster's leading edge is
    // revealed (matches the per-dot `p.x < sxAt` reveal in the draw).
    return mode === 'armed'
      ? a.x < sc || lastT - a.t0 > REVEAL_DELAY
      : a.x - ANOMALY_R < sc;
  }

  // Push the running totals to the wrapper — fired on kills and on escapes, so
  // the HUD's stopped / faced ratio + accuracy always reflect the latest state.
  function emitStats() {
    onStatsCb?.({
      kills: killTotal,
      stopped: roundKills,
      escaped: roundEscaped,
      spawned: roundSpawned,
      done: roundDone,
      celebrating: !!cel && !cel.settled,
    });
  }

  // Bump the kill totals and notify the wrapper — the single count path for
  // clicks AND bullets. killTotal is lifetime (gate); roundKills only counts
  // while armed, so the 5 gate clicks never inflate the round's accuracy grade.
  function recordKill() {
    killTotal += 1;
    if (mode === 'armed') roundKills += 1;
    // Armed kill = zap; idle/gate catch = the INSERT COIN chirp.
    if (soundOn) {
      if (mode === 'armed') sfx.zap();
      else sfx.coin();
    }
    emitStats();
  }

  // The ONE kill path — click and bullet both route through it, so a click-kill
  // and a shot-kill are visually identical (same frozen green-square dissolve +
  // verdict) and scored identically.
  function neutralize(a: Anomaly) {
    a.caught = true;
    const halfCap = opts.maxDotSize / 2;
    const env = envOf(a, lastT);
    const cells: CaughtCell[] = [];
    for (const pt of dots) {
      const ad = Math.hypot(pt.x - a.x, pt.y - a.y);
      if (ad >= ANOMALY_R) continue;
      const ao = env * (1 - ad / ANOMALY_R);
      if (ao < 0.06) continue;
      const step = Math.round(ao * 5);
      const half = Math.min(step * 1.05 + 0.5, halfCap);
      cells.push({ x: pt.x, y: pt.y, half, ao });
    }
    caught.push({ x: a.x, y: a.y, t0: lastT, cells, label: pickLabel() });
    recordKill();
  }

  // Reject-sample a fair spawn point for game mode: on-screen (small edge inset),
  // above the cannon's barrel (so bullets can reach it), clear of the top-right
  // HUD box, and — the fairness fix — outside the centered sign-in card grown by
  // CARD_CLEAR_PAD (so a target's bloom never tucks under the opaque card and ages
  // out as an unhittable "escape"). Threats land in the full ring around the card:
  // both sides plus the full-width strips above and below it. Computed from the
  // live size, so it recenters on resize. If reject-sampling comes up empty it
  // falls back to the roomiest clear band's center (still a fair point); only when
  // the card covers the whole field — never on supported desktop sizes, and no
  // fair point can exist — does it settle for top-center. Called only when
  // `exclusion` is set.
  function spawnRing(): { x: number; y: number } {
    const ex = exclusion;
    const cl = ex ? (w - ex.w) / 2 - CARD_CLEAR_PAD : 0; // padded card edges
    const cr = ex ? (w + ex.w) / 2 + CARD_CLEAR_PAD : 0;
    const ct = ex ? (h - ex.h) / 2 - CARD_CLEAR_PAD : 0;
    const cb = ex ? (h + ex.h) / 2 + CARD_CLEAR_PAD : 0;
    const xMin = SPAWN_EDGE;
    const yMin = SPAWN_EDGE;
    const xMax = w - SPAWN_EDGE;
    const yMax = h - CANNON_CLEAR; // keep targets above the cannon barrel (hittable)
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const x = xMin + Math.random() * Math.max(1, xMax - xMin);
      const y = yMin + Math.random() * Math.max(1, yMax - yMin);
      if (ex && x > cl && x < cr && y > ct && y < cb) continue; // under the card
      if (x > w - HUD_CLEAR_W && y < HUD_CLEAR_H) continue; // under the HUD counter
      return { x, y };
    }
    // Reject-sampling came up empty (card + HUD cover most of the field). Drop into
    // the roomiest clear band around the card — a band's center is always outside
    // both the card and the top-right HUD, so a target is never stranded *under*
    // the opaque card (the exact unfair case this fix prevents). Only if every band
    // is empty (card larger than the whole field — never on supported sizes) do we
    // settle for top-center, where no fair point exists anyway.
    const bands = [
      { gap: Math.min(ct, yMax) - yMin, x: w / 2, y: (yMin + Math.min(ct, yMax)) / 2 }, // above card
      { gap: yMax - Math.max(cb, yMin), x: w / 2, y: (Math.max(cb, yMin) + yMax) / 2 }, // below card
      { gap: Math.min(cl, xMax) - xMin, x: (xMin + Math.min(cl, xMax)) / 2, y: h / 2 }, // left of card
      { gap: xMax - Math.max(cr, xMin), x: (Math.max(cr, xMin) + xMax) / 2, y: h / 2 }, // right of card
    ];
    let best = bands[0];
    for (const b of bands) if (b.gap > best.gap) best = b;
    return best.gap > 0 ? { x: best.x, y: best.y } : { x: w / 2, y: yMin };
  }

  // Spawn / prune the anomaly population once per frame (O(1) + a tiny filter).
  function spawnTick(t: number) {
    // Prune dead/caught in place — no per-frame array allocation, even on /final.
    if (anomalies.length) {
      let k = 0;
      let escapedThisTick = 0;
      for (let i = 0; i < anomalies.length; i++) {
        const a = anomalies[i];
        if (!a.caught && t - a.t0 <= a.life) {
          anomalies[k++] = a;
        } else if (mode === 'armed' && !a.caught) {
          // Aged out unshot while armed — a threat that slipped past (the
          // accuracy "missed"). Caught ones already scored via recordKill.
          escapedThisTick += 1;
        }
      }
      anomalies.length = k;
      if (escapedThisTick) {
        roundEscaped += escapedThisTick;
        emitStats();
      }
    }
    if (mode === 'armed') {
      if (t - armT < FIRST_SPAWN_DELAY) return;
      // Stop spawning once the round's attack quota is met; the in-flight wave
      // drains on its own and frame() ends the round when the field is clear.
      if (
        roundSpawned < ROUND_ATTACKS &&
        anomalies.length < MAX_TARGETS &&
        t - lastSpawn > ARMED_SPAWN
      ) {
        lastSpawn = t;
        // Placement: in game mode (card box set) fill the fair ring around the
        // card; otherwise today's upper play-field with the HUD nudge (a target
        // is never hidden under the counter even in the worst case).
        let x: number;
        let y: number;
        if (exclusion) {
          ({ x, y } = spawnRing());
        } else {
          x = (0.1 + Math.random() * 0.8) * w;
          y = (0.1 + Math.random() * 0.45) * h;
          if (x > w - HUD_CLEAR_W && y < HUD_CLEAR_H) x = (0.1 + Math.random() * 0.6) * w;
        }
        anomalies.push({ x, y, t0: t, life: TARGET_LIFE, caught: false });
        roundSpawned += 1;
      }
    } else if (mode === 'idle' && !cel && t - lastSpawn > opts.anomalyInterval) {
      // Idle: exactly one anomaly, re-rolled on today's cadence/life. Placement
      // mirrors armed — the fair ring in game mode (so gate dots aren't hidden
      // under the card either), today's full-field roll otherwise (so /final and
      // shell-transition stay byte-for-byte unchanged). Suppressed while a demoed
      // celebration plays over the idle field — the ceremony owns the stage.
      lastSpawn = t;
      let x: number;
      let y: number;
      if (exclusion) {
        ({ x, y } = spawnRing());
      } else {
        x = 30 + Math.random() * Math.max(1, w - 60);
        y = 16 + Math.random() * Math.max(1, h - 32);
      }
      anomalies = [{ x, y, t0: t, life: 2.4, caught: false }];
    }
  }

  function drawHalftone(t: number) {
    const { r, g, b } = colors.dot;
    const ac = colors.accent;
    const sx = sweepX(t, w, opts.sweepPeriod);
    const tanT = Math.tan((opts.tilt * Math.PI) / 180);
    const k = opts.intensity;
    const halfCap = opts.maxDotSize / 2;
    const armed = mode === 'armed';

    // Celebration pre-pass: hoist everything loop-invariant out of the dot loop
    // so the ceremony costs ~nothing per dot when inactive (cel === null).
    const c = cel;
    const ce = c ? t - c.t0 : 0;
    const celOriginY = h - 30;
    const celMaxR = Math.hypot(w / 2, h);
    const wave1 = !!c && c.tier === 1 && ce < 2.4;
    const wave3 = !!c && c.tier >= 3 && ce < 1.6;
    const rainbow = !!c && c.tier === 4 && ce > 3.0 && ce < 4.6;
    const w1R = wave1 ? easeOutCubic(Math.min(ce / 1.5, 1)) * celMaxR * 0.9 : 0;
    const w1S = wave1 ? 0.95 * (1 - clamp01((ce - 1.4) / 1.0)) : 0;
    const w3R = wave3 ? easeOutCubic(Math.min(ce / 0.9, 1)) * celMaxR : 0;
    const w3S = wave3 ? 0.9 * (1 - clamp01((ce - 0.8) / 0.8)) : 0;
    const rainQ = rainbow ? Math.sin(((ce - 3.0) / 1.6) * Math.PI) * 0.5 : 0;
    // The ceremonial sweep that prints the score: a soft grey column crossing
    // the digit block left→right while the digits bloom in behind it.
    const sweepLine =
      c && c.cells && ce >= CEL_SWEEP_START - 0.1 && ce <= CEL_SWEEP_START + CEL_SWEEP_DUR + 0.2
        ? c.cellsLeft + clamp01((ce - CEL_SWEEP_START) / CEL_SWEEP_DUR) * c.cellsWidth
        : -1;

    for (let i = 0; i < dots.length; i++) {
      const p = dots[i];
      const sxAt = sx + (h / 2 - p.y) * tanT;
      const amb = 0.11 * (0.5 + 0.5 * Math.sin(p.x * 0.045 + p.y * 0.032 + t * 0.9));
      const dd = Math.abs(p.x - sxAt);
      const bloom = dd < opts.bloomRadius ? 0.62 * (1 - dd / opts.bloomRadius) : 0;

      // Anomaly contribution: max over the live population (≤1 idle, ≤6 armed),
      // with a cheap axis pre-reject before the per-anomaly work.
      let ao = 0;
      for (const a of anomalies) {
        if (a.caught) continue;
        if (Math.abs(p.x - a.x) > ANOMALY_R || Math.abs(p.y - a.y) > ANOMALY_R) continue;
        if (armed) {
          // Whole target reveals once its centre is behind the sweep (evaluated
          // at the anomaly's own y, matching hittable) OR it has aged in.
          if (!(a.x < sweepAtY(t, a.y) || t - a.t0 > REVEAL_DELAY)) continue;
        } else if (p.x >= sxAt) {
          // Idle: today's per-dot sweep gate.
          continue;
        }
        const env = Math.max(0, Math.sin(((t - a.t0) / a.life) * Math.PI));
        if (env <= 0) continue;
        const ad = Math.hypot(p.x - a.x, p.y - a.y);
        if (ad < ANOMALY_R) {
          const v = env * (1 - ad / ANOMALY_R);
          if (v > ao) ao = v;
        }
      }

      // Celebration contribution: waves/pulses/rainbow tint the dot toward a
      // target colour; the sweep-printed digits override to full green. Reads at
      // full strength (ignores `intensity`), like the anomaly/caught signals.
      let celG = 0;
      let celBoost = 0;
      let celCol = colors.caught;
      if (c) {
        if (wave1 || wave3) {
          const dist = Math.hypot(p.x - w / 2, p.y - celOriginY);
          if (wave1) {
            const v = Math.exp(-((dist - w1R) ** 2) / 4608) * w1S;
            if (v > celG) celG = v;
            if (v > celBoost) celBoost = v;
          }
          if (wave3) {
            const v = Math.exp(-((dist - w3R) ** 2) / 5408) * w3S;
            if (v > celG) celG = v;
            if (v > celBoost) celBoost = v;
          }
        }
        for (const pu of c.pulses) {
          const pe = t - pu.t0;
          if (pe < 0 || pe >= 0.6) continue;
          const pr = easeOutCubic(pe / 0.6) * 70;
          const pd = Math.hypot(p.x - pu.x, p.y - pu.y);
          const v = Math.exp(-((pd - pr) ** 2) / 1152) * 0.9 * (1 - pe / 0.6);
          if (v > celG) celG = v;
          if (v > celBoost) celBoost = v;
        }
        if (sweepLine >= 0) {
          const dx = p.x - sweepLine;
          const v = Math.exp(-(dx * dx) / 1800) * 0.3;
          if (v > celBoost) celBoost = v;
        }
        if (rainQ > celG) {
          celG = rainQ;
          celCol = CEL_PAL[((Math.floor(p.x * 0.03 + p.y * 0.02 + ce * 3) % 7) + 7) % 7];
        }
        if (c.cells) {
          const rel = c.cells.get(i);
          if (rel !== undefined) {
            const revealT = c.t0 + CEL_SWEEP_START + rel * CEL_SWEEP_DUR;
            const cp = easeOutCubic(clamp01((t - revealT) / 0.35));
            if (cp > celG) {
              celG = cp;
              celCol = colors.caught;
            }
            if (cp * 0.9 > celBoost) celBoost = cp * 0.9;
          }
        }
      }

      const val = Math.min(1, Math.max(amb + bloom, ao));
      if (val < 0.05 && celBoost < 0.02) continue;

      const effVal = Math.min(1, val + celBoost);
      const step = Math.round(effVal * 5);
      const half = Math.min(step * 1.05 + 0.5, halfCap);
      // Anomaly cells render at full alpha (ignore `intensity`); celebration
      // cells mix the dot colour toward the target and also read full-strength;
      // ambient cells scale with intensity as before.
      context.fillStyle =
        ao > 0.06
          ? `rgba(${ac.r},${ac.g},${ac.b},${Math.min(1, 0.45 + ao)})`
          : celG > 0.04 || celBoost > 0.1
            ? `rgba(${Math.round(r + (celCol.r - r) * celG)},${Math.round(
                g + (celCol.g - g) * celG,
              )},${Math.round(b + (celCol.b - b) * celG)},${Math.min(1, 0.15 + effVal * 0.85)})`
            : `rgba(${r},${g},${b},${(0.12 + val * (opts.bloomAlpha - 0.12)) * k})`;
      context.fillRect(p.x - half, p.y - half, half * 2, half * 2);
    }
  }

  // Game sim: advance cannon, fire on cadence, move bullets, collide. Armed only.
  function stepGame(t: number, dt: number) {
    cannonX += cannonDir * CANNON_SPEED * dt;
    cannonX = Math.max(CANNON_HALF_W, Math.min(w - CANNON_HALF_W, cannonX));

    if (firing && t - lastFire >= FIRE_CADENCE && bullets.length < MAX_BULLETS) {
      bullets.push({ x: cannonX, y: h - CANNON_BARREL_Y });
      lastFire = t;
      if (soundOn) sfx.pew();
    }

    // Move + collide + compact in place (no per-frame allocation at hold-fire).
    let n = 0;
    for (let i = 0; i < bullets.length; i++) {
      const bu = bullets[i];
      bu.y -= BULLET_SPEED * dt;
      if (bu.y < -14) continue; // off the top — drop
      let hit = false;
      for (const a of anomalies) {
        if (!hittable(a)) continue;
        const dx = bu.x - a.x;
        const dy = bu.y - a.y;
        if (dx * dx + dy * dy < HIT_R2) {
          neutralize(a);
          hit = true;
          break;
        }
      }
      if (hit) continue; // bullet consumed
      bullets[n++] = bu;
    }
    bullets.length = n;
  }

  // Pixel cannon — stacked retro turret in the dot colour, rising into place over
  // ARM_RISE on arming (the gentle flourish; no flash/shake). During a blast-off
  // celebration it launches up and off the screen (ease-in — a launch, not a
  // pop) and stays gone until the next round; popping back under the results
  // after lifting off would be absurd.
  function drawCannon(t: number) {
    if (cannonAway && !cel) return;
    const p = Math.min(1, Math.max(0, (t - armT) / ARM_RISE));
    const ease = 1 - (1 - p) * (1 - p); // easeOut
    const lift =
      cel && cel.tier >= 3
        ? easeInCubic(clamp01((t - cel.t0 - CEL_LIFT_AT) / CEL_LIFT_DUR)) * (h + 120)
        : cannonAway
          ? h + 120
          : 0;
    const baseY = h - CANNON_BASE_OFFSET + (1 - ease) * 40 - lift;
    if (baseY < -40) return;
    const { r, g, b } = colors.dot;
    context.fillStyle = `rgba(${r},${g},${b},${ease})`;
    const x = Math.round(cannonX);
    context.fillRect(x - CANNON_HALF_W, baseY, CANNON_HALF_W * 2, 8); // base
    context.fillRect(x - 6, baseY - 6, 12, 6); // mid
    context.fillRect(x - 2, baseY - 12, 4, 6); // barrel
  }

  // Blocky bullets in the dot/cannon grey (gray = your hardware; red = threat;
  // green = neutralised). Crisp, no glow. Theme-aware via --login-bg-dot.
  function drawBullets() {
    const { r, g, b } = colors.dot;
    context.fillStyle = `rgb(${r},${g},${b})`;
    for (const bu of bullets) context.fillRect(Math.round(bu.x) - 2, bu.y - 7, 4, 14);
  }

  // Easter egg: a caught anomaly keeps its exact form but recoloured green and
  // dissolving — the halftone squares stay squares, a clean dot stays a dot.
  // Always full strength (ignores `intensity`), drawn last so it sits above the
  // field. `fade` lingers then drops, so green reads as a slow dissolve.
  function drawCaught(t: number) {
    if (!caught.length) return;
    caught = caught.filter((c) => t - c.t0 < CAUGHT_DUR);
    const g = colors.caught;
    for (const c of caught) {
      const p = (t - c.t0) / CAUGHT_DUR; // 0 → 1
      const fade = 1 - p * p; // linger, then fall away
      if (c.cells.length) {
        // Halftone: redraw the frozen squares, green and fading. Same pixels.
        for (const cell of c.cells) {
          context.fillStyle = `rgba(${g.r},${g.g},${g.b},${Math.min(1, 0.45 + cell.ao) * fade})`;
          context.fillRect(cell.x - cell.half, cell.y - cell.half, cell.half * 2, cell.half * 2);
        }
      } else {
        // Clean: the latch is a round dot — keep that form, green and fading.
        context.fillStyle = `rgba(${g.r},${g.g},${g.b},${0.95 * fade})`;
        context.shadowColor = `rgb(${g.r},${g.g},${g.b})`;
        context.shadowBlur = 7 * fade;
        context.beginPath();
        context.arc(c.x, c.y, 2.4, 0, 6.283);
        context.fill();
        context.shadowBlur = 0;
      }

      // Crisp pixel-font verdict above the form, drifting up a touch as it fades.
      // A hard 1px drop shadow (no blur) keeps it legible and on-theme 8-bit.
      const cx = Math.round(c.x);
      const ly = Math.round(Math.max(15, c.y - 26 - p * 8));
      context.font = `9px ${LABEL_FONT}`;
      context.textAlign = 'center';
      context.textBaseline = 'bottom';
      context.fillStyle = `rgba(0,0,0,${0.3 * fade})`;
      context.fillText(c.label, cx + 1, ly + 1);
      context.fillStyle = `rgba(${g.r},${g.g},${g.b},${Math.min(1, fade * 1.15)})`;
      context.fillText(c.label, cx, ly);
    }
  }

  // --- Round-end celebration --------------------------------------------------

  // <20 plays nothing (plain results); the ladder above 20 is the locked design.
  function tierForScore(score: number): 0 | 1 | 2 | 3 | 4 {
    if (score >= 100) return 4;
    if (score >= 90) return 3;
    if (score >= 35) return 2;
    if (score >= 20) return 1;
    return 0;
  }

  // Map the final score onto the dot grid as giant 5×7 dot-matrix digits, placed
  // in the clear strip ABOVE the centered sign-in card (falling back to the left
  // gutter, then to skipping the print entirely, on viewports where it can't
  // fit). The sweep then reveals it column by column — the game's own detection
  // move becomes the scoreboard.
  function buildScoreCells(
    score: number,
  ): { cells: Map<number, number>; left: number; width: number } | null {
    const str = `${Math.round(score)}%`;
    const totCols = str.length * 6 - 1;
    const blockW = totCols * gridSp;
    const blockH = 7 * gridSp;
    let centerX = w / 2;
    let topY: number;
    if (exclusion) {
      const cardTop = (h - exclusion.h) / 2;
      const cardLeft = (w - exclusion.w) / 2;
      // Margin is deliberately slim (8px): at 1440×900 — the common laptop case —
      // the strip above the 640px card is exactly 130px and the digit block is
      // 112px; a fatter margin would wrongly reject the strip there and bump the
      // score into the left-gutter fallback.
      if (cardTop >= blockH + 8) {
        topY = (cardTop - blockH) / 2;
      } else if (cardLeft >= blockW + 32) {
        centerX = cardLeft / 2;
        topY = (h - blockH) / 2;
      } else {
        return null; // nowhere fair to print — the ceremony plays without it
      }
    } else {
      topY = Math.max(gridSp, h * 0.16);
    }
    const startCol = Math.round(centerX / gridSp - totCols / 2);
    const startRow = Math.max(0, Math.round(topY / gridSp));
    const cells = new Map<number, number>();
    for (let gi = 0; gi < str.length; gi++) {
      const glyph = CEL_GLYPHS[str[gi]];
      if (!glyph) continue;
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row].charAt(col) !== '1') continue;
          const gc = gi * 6 + col;
          const cc = startCol + gc;
          const rr = startRow + row;
          if (cc < 0 || cc >= gridCols || rr < 0) continue;
          const idx = rr * gridCols + cc;
          if (idx < dots.length) cells.set(idx, gc / totCols);
        }
      }
    }
    return { cells, left: startCol * gridSp + gridSp / 2, width: totCols * gridSp };
  }

  // Arm a ceremony for the given score. Tier 0 (<20) is deliberately silent.
  function startCelebration(score: number) {
    cannonAway = false;
    const tier = tierForScore(score);
    if (tier === 0) {
      cel = null;
      return;
    }
    const built = tier >= 2 ? buildScoreCells(score) : null;
    const rockets: CelRocket[] = [];
    if (tier === 2) {
      // The cannon fires three celebration rounds into the clear zones around
      // the card (both gutters + the top strip) — never behind the card.
      const cardLeft = exclusion ? (w - exclusion.w) / 2 : w * 0.3;
      const cardRight = exclusion ? (w + exclusion.w) / 2 : w * 0.7;
      const cardTop = exclusion ? (h - exclusion.h) / 2 : h * 0.4;
      const targets = [
        { x: cardLeft / 2, y: h * 0.42 },
        { x: (cardRight + w) / 2, y: h * 0.42 },
        { x: w / 2, y: Math.max(40, cardTop * 0.45) },
      ];
      for (let i = 0; i < targets.length; i++) {
        rockets.push({
          sx: cannonX,
          x: cannonX,
          y: h - CANNON_BARREL_Y,
          tx: Math.max(SPAWN_EDGE, Math.min(w - SPAWN_EDGE, targets[i].x + (Math.random() * 30 - 15))),
          ty: targets[i].y + Math.random() * 24,
          t0: lastT + i * 0.4,
          dur: 0.6,
          done: false,
        });
      }
    }
    cel = {
      tier,
      t0: lastT,
      particles: [],
      rockets,
      pulses: [],
      cells: built ? built.cells : null,
      cellsLeft: built ? built.left : 0,
      cellsWidth: built ? built.width : 0,
      burst1: false,
      burst2: false,
      // 60–89 is the same fireworks show as 35–59, just with more confetti.
      confetti2Count: tier === 2 && score >= 60 ? 56 : 32,
      settled: false,
    };
    if (soundOn) sfx.fanfare(); // covers real round-ends AND demoed ceremonies
  }

  // Rainbow confetti raining from the top, every piece born on a grid column.
  function celConfetti(count: number, ySpread: number) {
    if (!cel) return;
    for (let i = 0; i < count; i++) {
      if (cel.particles.length >= CEL_MAX_PARTICLES) return;
      cel.particles.push({
        x: Math.floor(Math.random() * Math.max(1, gridCols)) * gridSp + gridSp / 2,
        y: -8 - Math.random() * ySpread,
        vx: Math.random() * 30 - 15,
        vy: 110 + Math.random() * 130,
        life: 7,
        age: 0,
        half: 4,
        c: CEL_PAL[(Math.random() * CEL_PAL.length) | 0],
        grav: 0,
        conf: true,
      });
    }
  }

  // A firework burst: a ring of square shards (on-theme green/grey) plus a small
  // bloom pulse rolled through the dot field underneath.
  function celBurst(x: number, y: number) {
    if (!cel) return;
    for (let i = 0; i < 16; i++) {
      if (cel.particles.length >= CEL_MAX_PARTICLES) break;
      const ang = Math.random() * 6.283;
      const sp = 80 + Math.random() * 120;
      cel.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 0.9 + Math.random() * 0.4,
        age: 0,
        half: 4,
        c: Math.random() < 0.7 ? colors.caught : colors.dot,
        grav: 30,
        conf: false,
      });
    }
    cel.pulses.push({ x, y, t0: lastT });
  }

  // Advance the ceremony: rockets, the confetti ladder, particle motion, the
  // blast-off latch, and the end-of-ceremony handoff back to the results state.
  function stepCelebration(t: number, dt: number) {
    const c = cel;
    if (!c) return;
    const e = t - c.t0;
    if (!c.settled && e > CEL_DUR[c.tier]) {
      // The active show is over, but the stage doesn't clear: digits + headline
      // persist until the player dismisses them (Esc / Try-again / new ceremony).
      // celebrating flips false here, so the wrapper reveals Try-again now.
      c.settled = true;
      emitStats();
    }
    if (c.tier >= 3 && !cannonAway && e > CEL_LIFT_AT + CEL_LIFT_DUR) {
      cannonAway = true; // launched — gone until the next round/reset
    }
    // Thruster exhaust while the cannon rises.
    if (c.tier >= 3) {
      const rise = easeInCubic(clamp01((e - CEL_LIFT_AT) / CEL_LIFT_DUR));
      if (rise > 0 && rise < 1) {
        for (let i = 0; i < 3; i++) {
          if (c.particles.length >= CEL_MAX_PARTICLES) break;
          c.particles.push({
            x: cannonX + (Math.random() * 10 - 5),
            y: h - 22 - rise * (h + 120),
            vx: Math.random() * 40 - 20,
            vy: 80 + Math.random() * 80,
            life: 0.45,
            age: 0,
            half: 3,
            c: Math.random() < 0.5 ? colors.caught : colors.dot,
            grav: 0,
            conf: false,
          });
        }
      }
    }
    // Confetti ladder (escalation is deliberate): fireworks gets a drop slightly
    // above blast-off's original single burst; blast-off gets two volleys; the
    // 100% storm is an opening burst plus dense rain.
    if (c.tier === 2 && !c.burst1 && e > 1.6) {
      c.burst1 = true;
      celConfetti(c.confetti2Count, 160);
    }
    if (c.tier === 3 && !c.burst1 && e > 1.7) {
      c.burst1 = true;
      celConfetti(60, 200);
    }
    if (c.tier === 3 && !c.burst2 && e > 2.6) {
      c.burst2 = true;
      celConfetti(40, 120);
    }
    if (c.tier === 4 && !c.burst1 && e > 1.7) {
      c.burst1 = true;
      celConfetti(80, 200);
    }
    if (c.tier === 4 && e > 2.0 && e < 4.6) celConfetti(Math.round(CEL_RAIN_RATE * dt), 10);
    // Fireworks rockets — fly on an ease-out arc, burst at the apex.
    for (const rk of c.rockets) {
      if (t < rk.t0) continue;
      const p = clamp01((t - rk.t0) / rk.dur);
      const pe = easeOutCubic(p);
      rk.x = rk.sx + (rk.tx - rk.sx) * pe;
      rk.y = h - CANNON_BARREL_Y + (rk.ty - (h - CANNON_BARREL_Y)) * pe;
      if (p < 1) {
        if (c.particles.length < CEL_MAX_PARTICLES) {
          c.particles.push({
            x: rk.x,
            y: rk.y + 10,
            vx: 0,
            vy: 50,
            life: 0.3,
            age: 0,
            half: 3,
            c: colors.dot,
            grav: 0,
            conf: false,
          });
        }
      } else if (!rk.done) {
        rk.done = true;
        celBurst(rk.x, rk.y);
      }
    }
    // Advance + cull particles in place (no per-frame array allocation).
    let n = 0;
    for (let i = 0; i < c.particles.length; i++) {
      const pt = c.particles[i];
      pt.age += dt;
      if (pt.age >= pt.life || pt.y > h + 12) continue;
      if (!pt.conf) {
        const drag = Math.exp(-2.5 * dt);
        pt.vx *= drag;
        pt.vy = pt.vy * drag + pt.grav * dt;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      c.particles[n++] = pt;
    }
    c.particles.length = n;
    // Prune expired bloom pulses (≤3 ever live — tier 2's bursts).
    let m = 0;
    for (let i = 0; i < c.pulses.length; i++) {
      if (t - c.pulses[i].t0 < 0.6) c.pulses[m++] = c.pulses[i];
    }
    c.pulses.length = m;
  }

  // Draw the ceremony's moving pieces above the field: rockets and particles
  // (all RENDERED snapped to the dot grid with chunky quarter-stepped fades —
  // the 8-bit rule), then the Press Start 2P headline below the card.
  function drawCelebration(t: number) {
    const c = cel;
    if (!c) return;
    const e = t - c.t0;
    const snap = (v: number) => gridSp / 2 + Math.round((v - gridSp / 2) / gridSp) * gridSp;
    const dC = colors.dot;
    for (const rk of c.rockets) {
      if (t < rk.t0 || rk.done) continue;
      context.fillStyle = `rgba(${dC.r},${dC.g},${dC.b},0.95)`;
      context.fillRect(snap(rk.x) - 4, snap(rk.y) - 4, 8, 8);
    }
    for (const pt of c.particles) {
      const al = Math.ceil((pt.conf ? 0.95 : (1 - pt.age / pt.life) * 0.9) * 4) / 4;
      context.fillStyle = `rgba(${pt.c.r},${pt.c.g},${pt.c.b},${al})`;
      context.fillRect(snap(pt.x) - pt.half, snap(pt.y) - pt.half, pt.half * 2, pt.half * 2);
    }
    // Headline + subline in the strip below the card, fading in with a gentle
    // 10px ease-out rise (no pop). Headline shares the verdicts' pixel face.
    const la = clamp01((e - CEL_LABEL_AT[c.tier]) / 0.5);
    if (la > 0) {
      const ease = easeOutCubic(la);
      const head = CEL_HEADLINES[c.tier];
      const cardBottom = exclusion ? (h + exclusion.h) / 2 : h * 0.62;
      const ly = Math.round(cardBottom + (h - CANNON_CLEAR - cardBottom) * 0.45 + (1 - ease) * 10);
      const gC = colors.caught;
      context.textAlign = 'center';
      context.textBaseline = 'alphabetic';
      context.font = `13px ${LABEL_FONT}`;
      context.fillStyle = `rgba(0,0,0,${0.3 * ease})`;
      context.fillText(head.main, Math.round(w / 2) + 1, ly + 1);
      context.fillStyle = `rgba(${gC.r},${gC.g},${gC.b},${ease})`;
      context.fillText(head.main, Math.round(w / 2), ly);
      context.font = "11px 'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillStyle = `rgba(${dC.r},${dC.g},${dC.b},${0.85 * ease})`;
      context.fillText(head.sub, Math.round(w / 2), ly + 24);
    }
  }

  function frame(t: number) {
    const rawDt = t - lastFrameT;
    const dt = Math.min(Math.max(0, rawDt), 0.05); // clamp: no tab-resume spike
    // A paused loop (tab hidden, or the paused prop) leaves rAF time
    // running, so the first resumed frame sees a large gap. Advance every
    // time-relative marker by the skipped time — the same clamp dt applies to
    // motion, extended to absolute timestamps — so nothing ages, spawns, or
    // (mid-round) mass-escapes across the gap. No-op in steady state (skip = 0).
    const skip = rawDt - dt;
    if (skip > 0 && lastFrameT > 0) {
      for (const a of anomalies) a.t0 += skip;
      for (const c of caught) c.t0 += skip;
      for (const l of latched) l.t0 += skip;
      armT += skip;
      lastSpawn += skip;
      lastLatch += skip;
      if (cel) {
        // The ceremony's clocks are absolute too — advance them across the gap
        // or a resumed tab would instantly fast-forward/expire the celebration.
        cel.t0 += skip;
        for (const rk of cel.rockets) rk.t0 += skip;
        for (const pu of cel.pulses) pu.t0 += skip;
      }
    }
    lastFrameT = t;
    lastT = t;
    context.fillStyle = colors.base;
    context.fillRect(0, 0, w, h);
    if (opts.texture === 'halftone') {
      spawnTick(t);
      if (mode === 'armed') {
        stepGame(t, dt);
        // End the round once the full quota has spawned AND the field is clear,
        // so the final wave isn't a pile of unfair forced misses.
        if (roundSpawned >= ROUND_ATTACKS && anomalies.length === 0) endRound();
      }
      if (cel) stepCelebration(t, dt);
      drawHalftone(t);
      if (mode === 'armed' || mode === 'over' || cel) {
        // Cannon: live shooter, the frozen anchor under the result, or the demo
        // ceremony's performer (it rises in to fire the celebration).
        drawCannon(t);
        if (mode === 'armed') drawBullets();
      }
      if (cel) drawCelebration(t);
    } else {
      drawClean(t);
    }
    drawCaught(t);
  }

  function tick(ts: number) {
    if (!running) return;
    frame(ts / 1000);
    rafId = requestAnimationFrame(tick);
  }

  function onVisibility() {
    if (document.hidden) {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    } else if (running && rafId === null) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function start() {
    if (running) return;
    running = true;
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    // Rest with no held input, so a later restart never auto-fires/auto-moves
    // from a key that was down when we stopped.
    cannonDir = 0;
    firing = false;
    document.removeEventListener('visibilitychange', onVisibility);
  }

  function renderStatic(t = 1.4) {
    // One-off draw at a fixed phase — must not advance the running clock, or a
    // later resume would mis-measure the pause gap (see frame's skip handling).
    const savedFrameT = lastFrameT;
    const savedT = lastT;
    frame(t);
    lastFrameT = savedFrameT;
    lastT = savedT;
  }

  function setOptions(next: Partial<EngineOptions>) {
    const spacingChanged = next.spacing !== undefined && next.spacing !== opts.spacing;
    opts = { ...opts, ...next };
    if (spacingChanged) ({ dots, cols: gridCols, sp: gridSp } = gridArr(w, h, opts.spacing));
    resolveColors();
    if (!running) renderStatic();
  }

  // Easter egg hit-test: did the user click a live anomaly? Finds the nearest
  // hittable one within a forgiving click radius and routes it through the shared
  // kill path. Returns true on a hit (clicks stay additive after arming).
  function catchAt(cx: number, cy: number): boolean {
    if (!running) return false;

    if (opts.texture === 'halftone') {
      let best: Anomaly | null = null;
      let bestD = 52; // forgiving mouse radius
      for (const a of anomalies) {
        if (!hittable(a)) continue;
        const d = Math.hypot(cx - a.x, cy - a.y);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      if (best) {
        neutralize(best);
        return true;
      }
      return false;
    }

    // clean: catch the nearest live latched dot within a forgiving radius (the
    // dots themselves are ~2.4px, so the hitbox is generous).
    let best = -1;
    let bestD = 20;
    for (let i = 0; i < latched.length; i++) {
      const d = Math.hypot(cx - latched[i].x, cy - latched[i].y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      const l = latched[best];
      latched.splice(best, 1);
      // Clean's latch is a Latch, not an Anomaly, so it can't reuse neutralize();
      // it mirrors the same scoring tail via the shared recordKill() helper.
      caught.push({ x: l.x, y: l.y, t0: lastT, cells: [], label: pickLabel() });
      recordKill();
      return true;
    }
    return false;
  }

  function setMode(m: 'idle' | 'armed') {
    if (mode === m) return;
    mode = m;
    cel = null; // a real mode change always cancels any running ceremony
    cannonAway = false;
    bullets.length = 0;
    cannonDir = 0;
    firing = false;
    if (m === 'armed') {
      // Re-seed timing/cannon for a genuine idle→armed transition. NOTE: in the
      // current wrapper flow this is dormant — first arm and Try-again both go
      // through startRound (which already sets mode='armed' and clears the field),
      // so the arming effect's follow-up setMode('armed') hits the dedupe guard
      // above. It deliberately leaves anomalies + round counters untouched, so even
      // if it ever ran on a resume it wouldn't drop live targets (which would break
      // `faced` reaching ROUND_ATTACKS).
      armT = lastT;
      lastFrameT = lastT; // avoid a dt spike on the armed frame
      lastSpawn = lastT; // re-measure the spawn cadence
      cannonX = w / 2;
    }
  }

  // Begin a fresh scored round: zero the per-round counters and (re)arm. Called
  // on the first arm (gate cleared) and on the Try-again restart — NOT on a plain
  // resume (setMode), which keeps the round's counters intact.
  function startRound() {
    roundKills = 0;
    roundEscaped = 0;
    roundSpawned = 0;
    roundDone = false;
    mode = 'armed';
    cel = null; // a fresh round cancels any ceremony still on stage
    cannonAway = false;
    bullets.length = 0;
    cannonDir = 0;
    firing = false;
    armT = lastT;
    lastFrameT = lastT;
    lastSpawn = lastT;
    cannonX = w / 2;
    anomalies = [];
    caught = []; // drop any in-flight green dissolves from the prior round
    if (soundOn) sfx.powerup(); // the arming flourish, audible edition
    emitStats();
  }

  // Round over: freeze the shooter (no sim, no input, no bullets) while the
  // decorative field keeps breathing, and play the tiered ceremony off the final
  // grade. The wrapper reveals Try-again once the ceremony lands (celebrating
  // flips false); startRound() returns to play.
  function endRound() {
    mode = 'over';
    roundDone = true;
    bullets.length = 0;
    cannonDir = 0;
    firing = false;
    const faced = roundKills + roundEscaped;
    startCelebration(faced > 0 ? Math.round((roundKills / faced) * 100) : 100);
    emitStats();
  }

  // Quit the shooter back to the pristine decorative field: zero the gate
  // (killTotal) and the round counters, drop the cannon/bullets/targets/dissolves,
  // and go idle — so the insert-coin gate can be played again from scratch
  // (re-clicking dots counts 0 → GATE; the wrapper re-arms via startRound on the
  // 5th). emitStats pushes killTotal=0 so the wrapper's gate/HUD reset with it.
  function exitGame() {
    killTotal = 0;
    roundKills = 0;
    roundEscaped = 0;
    roundSpawned = 0;
    roundDone = false;
    mode = 'idle';
    cel = null;
    cannonAway = false;
    bullets.length = 0;
    cannonDir = 0;
    firing = false;
    anomalies = [];
    caught = []; // drop any in-flight green dissolves
    // Reset the idle spawn clock to its mount-time sentinel so the first decorative
    // gate dot appears on the next frame (not up to anomalyInterval later, which it
    // would if the last armed spawn was recent) — the gate is clickable immediately.
    lastSpawn = -Infinity;
    emitStats();
  }

  function setCannonDir(dir: number) {
    if (mode !== 'armed' || !running) return;
    cannonDir = dir < 0 ? -1 : dir > 0 ? 1 : 0;
  }

  function setFiring(on: boolean) {
    if (mode !== 'armed' || !running) return;
    if (on && !firing) lastFire = -Infinity; // fire immediately on press (tap = 1 shot)
    firing = on;
  }

  function onStats(cb: (stats: GameStats) => void) {
    onStatsCb = cb;
  }

  // Public replay hook: play the ceremony for an arbitrary score — the demo
  // route's buttons. Game rounds drive the same startCelebration path from
  // endRound(), so a demoed tier is always faithful to the real ending. On the
  // idle field the cannon rises in (re-seeding armT) to perform the show.
  function celebrate(score: number) {
    if (opts.texture !== 'halftone' || !running) return;
    if (mode === 'idle') armT = lastT;
    startCelebration(score);
    emitStats();
  }

  function setSound(on: boolean) {
    soundOn = on;
  }

  // Set/clear the centered no-spawn card box (game mode). Only the size is stored;
  // spawnRing centers + pads it against the live w/h, so it tracks resizes. Clamped
  // to non-negative and to the canvas — a card can't sensibly be larger than the
  // field, and this keeps a misconfigured size from blanketing the whole spawn area.
  function setExclusion(box: { width: number; height: number } | null) {
    exclusion = box
      ? { w: Math.min(Math.max(0, box.width), w), h: Math.min(Math.max(0, box.height), h) }
      : null;
  }

  resize();

  return {
    start,
    stop,
    setOptions,
    renderStatic,
    resize,
    catchAt,
    setMode,
    startRound,
    exitGame,
    setCannonDir,
    setFiring,
    onStats,
    celebrate,
    setSound,
    setExclusion,
  };
}
