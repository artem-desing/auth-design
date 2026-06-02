'use client';

import { useEffect, useRef } from 'react';
import {
  createSweepEngine,
  DEFAULTS,
  type EngineOptions,
  type SweepEngine,
  type Texture,
} from './engine';

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
  /** Force a single static frame (also auto-true under reduced motion). */
  paused?: boolean;
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
  };
}

/**
 * Decorative animated auth background. Renders only the field — the real login
 * form sits on top. Fills its nearest positioned ancestor by default; pass a
 * `className` (e.g. `fixed inset-0`) to mount it as a full-viewport injectable
 * layer instead. Never in tab order, never intercepts pointer events.
 */
export function LoginBackground(props: LoginBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SweepEngine | null>(null);

  // Latest values mirrored into refs so the mount-scoped effect and its media /
  // resize listeners always read current state without re-subscribing.
  const options = resolveOptions(props);
  const optionsRef = useRef(options);
  const pausedRef = useRef(props.paused);
  useEffect(() => {
    optionsRef.current = options;
    pausedRef.current = props.paused;
  });

  // A primitive signature that changes whenever any tunable changes — used as
  // the sole dependency for the live-update effect (avoids depending on a fresh
  // object identity every render).
  const signature = JSON.stringify({ ...options, paused: !!props.paused });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = createSweepEngine(canvas, optionsRef.current);
    engineRef.current = engine;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
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

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={props.className ?? 'absolute inset-0 h-full w-full'}
      style={{ pointerEvents: 'none', ...props.style }}
    />
  );
}
