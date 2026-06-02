/**
 * Framework-agnostic "detection sweep" canvas engine for the Wallarm auth
 * background. A slow scan line crosses the field; dots react as it passes; rare
 * orange events latch/bloom behind the sweep (the "caught" moment). Two textures
 * share this one engine, selected via `texture`.
 *
 * No framework imports — a thin React wrapper drives it, but it can equally be
 * mounted as a standalone injectable layer (Citadel Option 2).
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

interface Colors {
  dot: RGB;
  accent: RGB;
  base: string;
  sweep: RGB;
}

// Prototype placeholders — used only if a token fails to resolve.
const FALLBACK_DOT: RGB = { r: 69, g: 85, b: 108 }; // slate-600 (WADS)
const FALLBACK_ACCENT: RGB = { r: 251, g: 44, b: 54 }; // red-500 (WADS)
const FALLBACK_SWEEP: RGB = { r: 15, g: 23, b: 43 }; // slate-950 (WADS)
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
  };

  // Per-texture state.
  let dots: Dot[] = [];
  let latched: Latch[] = [];
  let lastLatch = -Infinity;
  let aT = -Infinity;
  let ax = 0;
  let ay = 0;

  let rafId: number | null = null;
  let running = false;

  function resolveColors() {
    const cs = getComputedStyle(canvas);
    const dot = parseColor(cs.getPropertyValue(opts.dotColorVar));
    const accent = parseColor(cs.getPropertyValue(opts.accentColorVar));
    const base = cs.getPropertyValue(opts.baseColorVar).trim();
    const sweep = parseColor(cs.getPropertyValue(opts.sweepColorVar));
    colors = {
      dot: dot ?? FALLBACK_DOT,
      accent: accent ?? FALLBACK_ACCENT,
      base: base || FALLBACK_BASE,
      sweep: sweep ?? FALLBACK_SWEEP,
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

  function drawHalftone(t: number) {
    const { r, g, b } = colors.dot;
    const ac = colors.accent;
    const sx = sweepX(t, w, opts.sweepPeriod);
    const tanT = Math.tan((opts.tilt * Math.PI) / 180);
    const k = opts.intensity;
    const halfCap = opts.maxDotSize / 2;

    // Advance the single anomaly cluster, anchored behind the sweep.
    if (t - aT > opts.anomalyInterval) {
      aT = t;
      ax = 30 + Math.random() * Math.max(1, w - 60);
      ay = 16 + Math.random() * Math.max(1, h - 32);
    }
    const aEnv = Math.max(0, Math.sin(((t - aT) / 2.4) * Math.PI));

    for (const p of dots) {
      const sxAt = sx + (h / 2 - p.y) * tanT;
      const amb = 0.11 * (0.5 + 0.5 * Math.sin(p.x * 0.045 + p.y * 0.032 + t * 0.9));
      const d = Math.abs(p.x - sxAt);
      const bloom = d < opts.bloomRadius ? 0.62 * (1 - d / opts.bloomRadius) : 0;
      const ad = Math.hypot(p.x - ax, p.y - ay);
      const ao = ad < 42 && p.x < sxAt ? aEnv * (1 - ad / 42) : 0;
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

  function frame(t: number) {
    context.fillStyle = colors.base;
    context.fillRect(0, 0, w, h);
    if (opts.texture === 'halftone') drawHalftone(t);
    else drawClean(t);
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

  resize();

  return { start, stop, setOptions, renderStatic, resize };
}
