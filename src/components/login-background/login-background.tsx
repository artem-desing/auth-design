'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createSweepEngine,
  DEFAULTS,
  type EngineOptions,
  type GameStats,
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
  /** Force a single static frame instead of running the animation loop. */
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
  /**
   * Game mode only: the centered sign-in card's size (CSS px). When set, armed
   * and gate threats spawn in the ring *around* the card, never behind it — so a
   * threat can't hide under the opaque card and silently tank the accuracy grade.
   * Pass the card's rendered width/height; the engine recenters it on resize.
   */
  excludeCardSize?: { width: number; height: number };
  /**
   * Called once on mount with a tiny imperative API into the engine. Used by the
   * unlisted `/login-background/game/celebrate` route to replay the round-end
   * celebration tiers on demand (`api.celebrate(score)`). Leave unset elsewhere.
   */
  onEngineReady?: (api: { celebrate: (score: number) => void }) => void;
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
 * layer instead.
 */
export function LoginBackground(props: LoginBackgroundProps) {
  const interactive = props.interactive ?? true;
  const game = (props.game ?? false) && interactive;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SweepEngine | null>(null);
  // Latched once a round has started, so a re-entry (roundOver → play after
  // Try-again) resumes the armed loop via setMode instead of re-running the
  // first-arm startRound. Reset by Esc-exit so the next gate clear starts fresh.
  const hasStartedRoundRef = useRef(false);
  // Easter-egg tally, fed straight from the engine via onStats. `kills` is the
  // lifetime catch count (gate progress; stays high so the field stays armed);
  // the round* fields scope the current fixed-length round. Stays 0 (counter
  // hidden) until the first catch.
  const [stats, setStats] = useState<GameStats>({
    kills: 0,
    stopped: 0,
    escaped: 0,
    spawned: 0,
    done: false,
    celebrating: false,
  });
  const caught = stats.kills;
  const armed = game && caught >= GATE_TARGET;
  const roundOver = armed && stats.done;
  // Interception brag: of the threats faced this round, the share neutralised.
  // Climbs 0 → 100 as the round runs; at round end `faced` lands on ROUND_ATTACKS,
  // so accuracy is a comparable final grade out of the total.
  const faced = stats.stopped + stats.escaped;
  const accuracy = faced > 0 ? Math.round((stats.stopped / faced) * 100) : 100;

  // Latest values mirrored into refs so the mount-scoped effect and its media /
  // resize listeners always read current state without re-subscribing.
  const options = resolveOptions(props);
  const optionsRef = useRef(options);
  const pausedRef = useRef(props.paused);
  const interactiveRef = useRef(interactive);
  const gameRef = useRef(game);
  const excludeCardSizeRef = useRef(props.excludeCardSize);
  const onEngineReadyRef = useRef(props.onEngineReady);
  useEffect(() => {
    optionsRef.current = options;
    pausedRef.current = props.paused;
    interactiveRef.current = interactive;
    gameRef.current = game;
    excludeCardSizeRef.current = props.excludeCardSize;
    onEngineReadyRef.current = props.onEngineReady;
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

    // One count path: every kill (click OR bullet) and every escape flows through
    // the engine's running totals. The pointerdown handler below no longer increments.
    engine.onStats((s) => setStats(s));

    // Hand the engine the centered no-spawn card box up front (before the loop
    // starts), so threats never spawn behind the opaque card and the celebration
    // composes its score-print/labels around it. The card size is static per
    // route, so set once; the engine recenters it against the live canvas size
    // on every resize. (/final and shell-transition pass nothing — unchanged.)
    if (excludeCardSizeRef.current) {
      engine.setExclusion(excludeCardSizeRef.current);
    }

    // Hand the demo route its replay hook (a no-op everywhere else).
    onEngineReadyRef.current?.({ celebrate: (score) => engine.celebrate(score) });

    // Warm the pixel font used for catch verdicts so the first one isn't drawn
    // in a fallback face (canvas can't lazy-load web fonts the way the DOM does).
    if (interactiveRef.current && document.fonts) {
      document.fonts.load("9px 'Press Start 2P'").catch(() => {});
    }

    // Easter egg: catch a live anomaly under the pointer (count flows via onStats).
    const onPointerDown = interactiveRef.current
      ? (e: PointerEvent) => {
          const rect = canvas.getBoundingClientRect();
          engine.catchAt(e.clientX - rect.left, e.clientY - rect.top);
        }
      : null;
    if (onPointerDown) canvas.addEventListener('pointerdown', onPointerDown);

    // Start the loop, or hold a single static frame if the `paused` prop is set.
    if (pausedRef.current) {
      engine.stop();
      engine.renderStatic();
    } else {
      engine.start();
    }

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
    if (pausedRef.current) {
      engine.stop();
      engine.renderStatic();
    } else {
      engine.start();
    }
  }, [signature]);

  // Arming: flip the engine to the shooter at the gate, and own the keyboard
  // only while actually armed (so /final and shell-transition never capture keys).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !gameRef.current) return;

    // Mode control. startRound (first arm) zeroes the round; setMode resumes a
    // round already in progress (roundOver → play after Try-again) without
    // disturbing it. While the result is up the engine holds 'over' on its own —
    // don't override it back to idle/armed.
    if (!armed) {
      // Decorative idle only before a round has ever started — i.e. pre-gate, or
      // after an Esc-exit reset (which clears hasStartedRoundRef).
      if (!hasStartedRoundRef.current) engine.setMode('idle');
      return;
    }
    if (roundOver) {
      // Results / ceremony screen: the shooter is frozen and the gameplay keys
      // stay detached, but Esc still fully exits — it dismisses the (persistent)
      // celebration and resets the easter egg back to the decorative gate.
      const onResultsKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          engine.exitGame();
          hasStartedRoundRef.current = false;
          e.preventDefault();
        }
      };
      window.addEventListener('keydown', onResultsKeyDown);
      return () => window.removeEventListener('keydown', onResultsKeyDown);
    }
    if (!hasStartedRoundRef.current) {
      engine.startRound(); // first arm → a fresh 0 → ROUND_ATTACKS round
      hasStartedRoundRef.current = true;
    } else {
      engine.setMode('armed'); // resume the in-progress round (e.g. after Try-again)
    }

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
      } else if (e.key === 'Escape') {
        // Quit the shooter and reset to the pristine decorative gate: exitGame
        // zeroes the gate count (→ caught back to 0, so the HUD/hints clear and
        // re-clicking the dots replays the insert-coin flow), and we drop
        // hasStartedRoundRef so the 5th catch re-arms via a FRESH startRound
        // (not a setMode resume). The engine stat push flips `armed` false, so
        // this effect re-runs and detaches these keys.
        engine.exitGame();
        hasStartedRoundRef.current = false;
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
  }, [armed, roundOver]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={props.className ?? 'absolute inset-0 h-full w-full'}
        style={{ pointerEvents: interactive ? 'auto' : 'none', ...props.style }}
      />
      {interactive && caught > 0 && (
        // Top-right HUD. Non-game: the Figma "caught" counter. Game: `n / 5 ·
        // INSERT COIN` while gating, then the two-metric box (HIT count over a
        // divider over the SCORE accuracy %, Figma node 192:7999) once armed — with
        // a Try-again link just below the box when the round ends.
        <div
          className="pointer-events-none fixed top-24 right-24 z-[60] flex flex-col items-end gap-6"
          style={{ fontFamily: MONO_FONT }}
        >
          <div
            className={`flex flex-col items-center justify-center border border-[var(--color-border-primary)] bg-[var(--color-states-primary-hover)] ${
              // Armed (Figma node 192:7999): the two-metric box, HIT over SCORE.
              // Gate shares its width so arming only grows the box taller; the
              // non-game "caught" counter keeps its Figma 76×52.
              armed ? 'h-113 w-119' : game ? 'h-52 w-119' : 'h-52 w-76'
            }`}
            style={{ animation: 'hud-in 360ms cubic-bezier(0.4, 0, 0.2, 1)' }}
          >
            {/* Metric 1 — HIT (count) while armed; the gate / caught counter otherwise. */}
            <div className="flex flex-col items-center gap-4">
              <span
                // Gate ("insert coin"): re-key per catch so the pop replays — the
                // arcade beat. Armed: stable key + no pop, so the count ticks up
                // quietly in place instead of bouncing on every hit.
                key={armed ? 'count' : caught}
                className="font-bold tabular-nums text-[color:var(--color-text-success)]"
                style={{
                  fontSize: 16,
                  lineHeight: '20px',
                  animation: armed ? undefined : 'catch-pop 300ms ease-out',
                }}
              >
                {armed ? stats.stopped : caught}
                {game && !armed && (
                  <span style={{ opacity: 0.45 }}> / {GATE_TARGET}</span>
                )}
                {armed && <span style={{ opacity: 0.45 }}> / {faced}</span>}
              </span>
              <span
                className="uppercase text-[color:var(--color-text-secondary)]"
                style={{ fontSize: 12, lineHeight: '16px', fontFeatureSettings: '"liga" 0' }}
              >
                {game ? (armed ? 'hit' : 'insert coin') : 'caught'}
              </span>
            </div>
            {/* Metric 2 — SCORE (the accuracy %, calc unchanged). Armed only, under a
                full-width divider, styled to mirror the HIT pair (Figma 214:1263–66). */}
            {armed && (
              <>
                <div className="my-8 h-px w-full bg-[var(--color-border-primary)]" />
                <div className="flex flex-col items-center gap-4">
                  <span
                    className="font-bold tabular-nums text-[color:var(--color-text-success)]"
                    style={{ fontSize: 16, lineHeight: '20px' }}
                  >
                    {accuracy}%
                  </span>
                  <span
                    className="uppercase text-[color:var(--color-text-secondary)]"
                    style={{ fontSize: 12, lineHeight: '16px', fontFeatureSettings: '"liga" 0' }}
                  >
                    score
                  </span>
                </div>
              </>
            )}
          </div>
          {/* Try again — outside/below the box (Figma); caps + underline. Held
              back while the round-end ceremony plays (the celebration lands
              first, then the plain results state with the replay link). */}
          {roundOver && !stats.celebrating && (
            <button
              type="button"
              onClick={() => engineRef.current?.startRound()}
              className="pointer-events-auto cursor-pointer bg-transparent uppercase text-[color:var(--color-text-secondary)] underline underline-offset-4 hover:text-[color:var(--color-text-primary)]"
              style={{ fontSize: 10, lineHeight: '14px', fontFamily: MONO_FONT, border: 'none' }}
            >
              Try again
            </button>
          )}
          {armed && !roundOver && (
            <div
              className="text-[color:var(--color-text-secondary)]"
              style={{ fontSize: 10, lineHeight: '14px' }}
            >
              ← → move · space fire · esc to exit
            </div>
          )}
        </div>
      )}
      {game && caught > 0 && !armed && (
        // Gate hint — appears after the first catch, hidden once the shooter arms.
        <div
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
