'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createSweepEngine,
  DEFAULTS,
  type EngineOptions,
  type SweepEngine,
  type Texture,
} from './engine';

const MONO_FONT = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export interface LoginBackgroundProps {
  /** Variant A (`clean`) vs Variant B (`halftone`). The single texture switch. */
  texture?: Texture;
  /** Grid cell size in px. Defaults: 20. */
  spacing?: number;
  /** Seconds for one L→R sweep pass. */
  sweepPeriod?: number;
  /** How far from the scan line (px) dots react. Defaults: 44 (clean) / 80 (halftone). */
  bloomRadius?: number;
  /** Minimum seconds between orange events. Higher = rarer. */
  anomalyInterval?: number;
  /**
   * Global opacity/strength multiplier (0–1). Default is deliberately low so the
   * field reads as atmosphere — production should keep this near-subliminal.
   */
  intensity?: number;
  /** Peak alpha of fully-bloomed (emphasized) dots, before intensity. */
  bloomAlpha?: number;
  /** Halftone only: cap on a bloomed pixel's full edge length (px). */
  maxDotSize?: number;
  /** Sweep-line tilt in degrees (0 = vertical; positive leans the top right). */
  tilt?: number;
  /** CSS custom-property name for the dot color. */
  dotColorVar?: string;
  /** CSS custom-property name for the "caught" accent. */
  accentColorVar?: string;
  /** CSS custom-property name for the base fill. */
  baseColorVar?: string;
  /** CSS custom-property name for the clean leading-edge scan line. */
  sweepColorVar?: string;
  /** CSS custom-property name for the green "caught" confirm flash. */
  caughtColorVar?: string;
  /** Force a single static frame (also auto-true under reduced motion). */
  paused?: boolean;
  /**
   * Easter egg: clicking a live anomaly "catches" it (green pop) and reveals a
   * top-right counter. Defaults on; set false to keep the field purely
   * decorative and non-interactive (e.g. behind a form that owns the clicks).
   */
  interactive?: boolean;
  /**
   * Easter egg level 2: after 5 catches, arm a retro Space-Invaders shooter
   * (pixel cannon, ←/→ + Space). Default false — only the dedicated
   * `/login-background/game` route turns this on; `/final` stays a pure field.
   */
  game?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

function resolveOptions(props: LoginBackgroundProps): EngineOptions {
  const texture = props.texture ?? 'halftone';
  const d = DEFAULTS[texture];
  return {
    texture,
    spacing: props.spacing ?? d.spacing,
    sweepPeriod: props.sweepPeriod ?? 12.5,
    bloomRadius: props.bloomRadius ?? d.bloomRadius,
    anomalyInterval: props.anomalyInterval ?? 1.4,
    intensity: props.intensity ?? 0.9,
    bloomAlpha: props.bloomAlpha ?? 0.2,
    maxDotSize: props.maxDotSize ?? d.maxDotSize,
    tilt: props.tilt ?? 16,
    dotColorVar: props.dotColorVar ?? '--login-bg-dot',
    accentColorVar: props.accentColorVar ?? '--login-bg-accent',
    baseColorVar: props.baseColorVar ?? '--login-bg-base',
    sweepColorVar: props.sweepColorVar ?? '--login-bg-sweep',
    caughtColorVar: props.caughtColorVar ?? '--login-bg-caught',
  };
}

const GATE_TARGET = 5; // catches required to arm the shooter

/**
 * Decorative animated auth background. Renders only the field — the real login
 * form sits on top. Fills its nearest positioned ancestor by default; pass a
 * `className` (e.g. `fixed inset-0`) to mount it as a full-viewport injectable
 * layer instead. Never in tab order.
 */
export function LoginBackground(props: LoginBackgroundProps) {
  const interactive = props.interactive ?? true;
  const game = (props.game ?? false) && interactive;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SweepEngine | null>(null);
  // Easter-egg tally — doubles as the gate progress and the game score. Stays at
  // 0 (counter hidden) until the first catch. Fed straight from the engine's
  // running total via onKill, so clicks and bullets count through one path.
  const [caught, setCaught] = useState(0);
  // Tracked as state (not read imperatively) so the arming effect re-runs and
  // detaches the keyboard if the OS reduced-motion preference flips mid-session.
  const [reducedMotion, setReducedMotion] = useState(false);
  const armed = game && caught >= GATE_TARGET;

  // Latest values mirrored into refs so the mount-scoped effect and its media /
  // resize listeners always read current state without re-subscribing.
  const options = resolveOptions(props);
  const optionsRef = useRef(options);
  const pausedRef = useRef(props.paused);
  const interactiveRef = useRef(interactive);
  const gameRef = useRef(game);
  useEffect(() => {
    optionsRef.current = options;
    pausedRef.current = props.paused;
    interactiveRef.current = interactive;
    gameRef.current = game;
  });

  // A primitive signature that changes whenever any tunable changes — used as
  // the sole dependency for the live-update effect (avoids depending on a fresh
  // object identity every render). `game`/`interactive` are NOT tunables: they
  // are imperative concerns handled below, never in the signature.
  const signature = JSON.stringify({ ...options, paused: !!props.paused });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = createSweepEngine(canvas, optionsRef.current);
    engineRef.current = engine;

    // One count path: every kill (click OR bullet) flows through the engine's
    // running total. The pointerdown handler below no longer increments.
    engine.onKill((total) => setCaught(total));

    // Warm the pixel font used for catch verdicts so the first one isn't drawn
    // in a fallback face (canvas can't lazy-load web fonts the way the DOM does).
    if (interactiveRef.current && document.fonts) {
      document.fonts.load("9px 'Press Start 2P'").catch(() => {});
    }

    // Easter egg: catch a live anomaly under the pointer (count flows via onKill).
    const onPointerDown = interactiveRef.current
      ? (e: PointerEvent) => {
          const rect = canvas.getBoundingClientRect();
          engine.catchAt(e.clientX - rect.left, e.clientY - rect.top);
        }
      : null;
    if (onPointerDown) canvas.addEventListener('pointerdown', onPointerDown);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      setReducedMotion(reduced.matches);
      if (reduced.matches || pausedRef.current) {
        engine.stop();
        engine.renderStatic();
      } else {
        engine.start();
      }
    };
    apply();
    reduced.addEventListener('change', apply);

    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => engine.resize());
    });
    ro.observe(canvas);

    // Re-resolve token colors when the app flips theme (data-theme / class on
    // <html>), so the field follows light↔dark live without a remount.
    const themeObserver = new MutationObserver(() => engine.setOptions({}));
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });

    return () => {
      reduced.removeEventListener('change', apply);
      if (onPointerDown) canvas.removeEventListener('pointerdown', onPointerDown);
      ro.disconnect();
      themeObserver.disconnect();
      cancelAnimationFrame(frame);
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setOptions(optionsRef.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches || pausedRef.current) {
      engine.stop();
      engine.renderStatic();
    } else {
      engine.start();
    }
  }, [signature]);

  // Arming: flip the engine to the shooter at the gate, and own the keyboard
  // only while actually armed (so /final and shell-transition never capture
  // keys). Skipped entirely under reduced motion — the route degrades to the
  // static decorative field.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !gameRef.current) return;
    const live = armed && !reducedMotion;
    engine.setMode(live ? 'armed' : 'idle');
    if (!live) return;

    const keys = { left: false, right: false };
    const applyDir = () => engine.setCannonDir((keys.right ? 1 : 0) - (keys.left ? 1 : 0));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        keys.left = true;
        applyDir();
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        keys.right = true;
        applyDir();
        e.preventDefault();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        if (!e.repeat) engine.setFiring(true); // loop owns cadence, not OS repeat
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        keys.left = false;
        applyDir();
      } else if (e.key === 'ArrowRight') {
        keys.right = false;
        applyDir();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        engine.setFiring(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      engine.setFiring(false);
      engine.setCannonDir(0);
    };
  }, [armed, reducedMotion]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={props.className ?? 'absolute inset-0 h-full w-full'}
        style={{ pointerEvents: interactive ? 'auto' : 'none', ...props.style }}
      />
      {interactive && caught > 0 && (
        // Top-right HUD. Non-game: the Figma "caught" counter (node 192:7958).
        // Game: the same card, relabelled — `n / 5` + `TO ARM` while gating,
        // then the score + a controls hint once armed.
        <div
          aria-hidden="true"
          className="pointer-events-none fixed top-24 right-24 z-[60] flex flex-col items-end gap-6"
          style={{ fontFamily: MONO_FONT }}
        >
          <div
            className="flex h-52 w-76 flex-col items-center justify-center border border-[var(--color-border-primary)] bg-[var(--color-states-primary-hover)]"
            style={{ animation: 'hud-in 360ms cubic-bezier(0.4, 0, 0.2, 1)' }}
          >
            <span
              key={caught}
              className="font-bold tabular-nums text-[color:var(--color-text-success)]"
              style={{ fontSize: 16, lineHeight: '20px', animation: 'catch-pop 300ms ease-out' }}
            >
              {caught}
              {game && !armed && (
                <span style={{ opacity: 0.45 }}> / {GATE_TARGET}</span>
              )}
            </span>
            <span
              className="uppercase text-[color:var(--color-text-secondary)]"
              style={{ fontSize: 12, lineHeight: '16px', fontFeatureSettings: '"liga" 0' }}
            >
              {game ? (armed ? 'score' : 'to arm') : 'caught'}
            </span>
          </div>
          {armed && (
            <div
              className="text-[color:var(--color-text-secondary)]"
              style={{ fontSize: 10, lineHeight: '14px' }}
            >
              ← → move · space fire
            </div>
          )}
        </div>
      )}
      {game && caught > 0 && !armed && (
        // Gate hint — appears after the first catch, hidden once the shooter arms.
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center"
          style={{ animation: 'hud-in 360ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        >
          <p className="text-xs text-[color:var(--color-text-secondary)]">
            Click the red anomalies — catch 5 to arm the cannon, then ← → move · space fire
          </p>
        </div>
      )}
    </>
  );
}
