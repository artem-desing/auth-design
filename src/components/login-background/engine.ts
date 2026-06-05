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

function gridArr(w: number, h: number, sp: number): Dot[] {
  const a: Dot[] = [];
  // Clamp total cell count so a 4K viewport can't explode the loop.
  const cap = 20000;
  const safeSp = Math.max(sp, Math.sqrt((w * h) / cap));
  for (let y = safeSp / 2; y < h; y += safeSp)
    for (let x = safeSp / 2; x < w; x += safeSp) a.push({ x, y });
  return a;
}

function sweepX(t: number, w: number, period: number): number {
  return ((t % period) / period) * (w + 140) - 70;
}

export interface SweepEngine {
  /** Start (or resume) the rAF loop. No-op under reduced motion. */
  start(): void;
  /** Stop the loop and detach listeners; keeps the last frame on screen. */
  stop(): void;
  /** Apply new options live (used by the tuning playground / prop changes). */
  setOptions(next: Partial<EngineOptions>): void;
  /** Force a single static frame and never schedule rAF (reduced motion). */
  renderStatic(t?: number): void;
  /** Recompute DPR sizing + grid for the current container size. */
  resize(): void;
  /**
   * Easter egg: hit-test a click (canvas-local px) against live anomalies and
   * "catch" the one under the pointer. Returns true if something was caught.
   * No-op while paused/reduced-motion (nothing is animating to catch).
   */
  catchAt(x: number, y: number): boolean;
  /** Game: flip between the decorative `idle` field and the `armed` shooter. */
  setMode(mode: 'idle' | 'armed'): void;
  /** Game: cannon lateral intent (−1 left, 0 stop, +1 right). Armed mode only. */
  setCannonDir(dir: number): void;
  /** Game: Space pressed/released. Cadence is owned by the loop. Armed only. */
  setFiring(on: boolean): void;
  /** Register a callback fired on every kill (click or bullet) with the running total. */
  onKill(cb: (total: number) => void): void;
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
  let mode: 'idle' | 'armed' = 'idle';
  const bullets: Bullet[] = [];
  let cannonX = 0;
  let cannonDir = 0; // −1 | 0 | 1
  let firing = false;
  let lastFire = -Infinity;
  let armT = -Infinity; // arm-flourish start
  let onKillCb: ((total: number) => void) | null = null;
  let killTotal = 0;

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
    dots = gridArr(w, h, opts.spacing);
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

  // Bump the running kill total and notify the wrapper — the single count path
  // for clicks AND bullets (the wrapper's counter mirrors this total).
  function recordKill() {
    killTotal += 1;
    onKillCb?.(killTotal);
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

  // Spawn / prune the anomaly population once per frame (O(1) + a tiny filter).
  function spawnTick(t: number) {
    // Prune dead/caught in place — no per-frame array allocation, even on /final.
    if (anomalies.length) {
      let k = 0;
      for (let i = 0; i < anomalies.length; i++) {
        const a = anomalies[i];
        if (!a.caught && t - a.t0 <= a.life) anomalies[k++] = a;
      }
      anomalies.length = k;
    }
    if (mode === 'armed') {
      if (t - armT < FIRST_SPAWN_DELAY) return;
      if (anomalies.length < MAX_TARGETS && t - lastSpawn > ARMED_SPAWN) {
        lastSpawn = t;
        // Upper play-field. If the sample lands in the reserved top-right HUD box,
        // nudge x left out of it — deterministic, so a target is never hidden
        // under the counter even in the worst case.
        let x = (0.1 + Math.random() * 0.8) * w;
        const y = (0.1 + Math.random() * 0.45) * h;
        if (x > w - HUD_CLEAR_W && y < HUD_CLEAR_H) x = (0.1 + Math.random() * 0.6) * w;
        anomalies.push({ x, y, t0: t, life: TARGET_LIFE, caught: false });
      }
    } else if (t - lastSpawn > opts.anomalyInterval) {
      // Idle: exactly one anomaly, re-rolled on today's cadence/placement/life —
      // reproduces the original single-cluster feel (so /final is unchanged).
      lastSpawn = t;
      anomalies = [
        {
          x: 30 + Math.random() * Math.max(1, w - 60),
          y: 16 + Math.random() * Math.max(1, h - 32),
          t0: t,
          life: 2.4,
          caught: false,
        },
      ];
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

    for (const p of dots) {
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

      const val = Math.min(1, Math.max(amb + bloom, ao));
      if (val < 0.05) continue;

      const step = Math.round(val * 5);
      const half = Math.min(step * 1.05 + 0.5, halfCap);
      // Anomaly cells render at full alpha (ignore `intensity`); ambient cells
      // scale with it.
      context.fillStyle =
        ao > 0.06
          ? `rgba(${ac.r},${ac.g},${ac.b},${Math.min(1, 0.45 + ao)})`
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
  // ARM_RISE on arming (the gentle flourish; no flash/shake).
  function drawCannon(t: number) {
    const p = Math.min(1, Math.max(0, (t - armT) / ARM_RISE));
    const ease = 1 - (1 - p) * (1 - p); // easeOut
    const baseY = h - CANNON_BASE_OFFSET + (1 - ease) * 40;
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

  function frame(t: number) {
    const dt = Math.min(Math.max(0, t - lastFrameT), 0.05); // clamp: no tab-resume spike
    lastFrameT = t;
    lastT = t;
    context.fillStyle = colors.base;
    context.fillRect(0, 0, w, h);
    if (opts.texture === 'halftone') {
      spawnTick(t);
      if (mode === 'armed') stepGame(t, dt);
      drawHalftone(t);
      if (mode === 'armed') {
        drawCannon(t);
        drawBullets();
      }
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
    frame(t);
  }

  function setOptions(next: Partial<EngineOptions>) {
    const spacingChanged = next.spacing !== undefined && next.spacing !== opts.spacing;
    opts = { ...opts, ...next };
    if (spacingChanged) dots = gridArr(w, h, opts.spacing);
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
    bullets.length = 0;
    cannonDir = 0;
    firing = false;
    if (m === 'armed') {
      armT = lastT;
      lastFrameT = lastT; // avoid a dt spike on the first armed frame
      lastSpawn = lastT; // FIRST_SPAWN_DELAY measured from arming
      cannonX = w / 2;
      anomalies = []; // clear the idle anomaly; armed spawns a fresh population
    }
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

  function onKill(cb: (total: number) => void) {
    onKillCb = cb;
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
    setCannonDir,
    setFiring,
    onKill,
  };
}
