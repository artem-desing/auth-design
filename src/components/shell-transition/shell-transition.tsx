'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@wallarm-org/design-system/Button';
import { Input } from '@wallarm-org/design-system/Input';
import { Text } from '@wallarm-org/design-system/Text';
import { LoginBackground } from '@/components/login-background';
import { WallarmLogo } from './wallarm-logo';

/**
 * Lightweight reproduction of the Figma "Animation" page: the app's page
 * background (a white surface) morphs its bounding box as the app boots. The
 * white surface is a decorative overlay, not the real content container.
 *
 * Two flows share one morph engine:
 *   boot  — splash → app-shell content slot → chrome dissolves in.
 *   login — splash → centered login card → expands up into the app shell.
 *
 * Flow 1 (collapsed-rail boot) timing, lifted from the Figma prototype settings:
 *   splash → midstep : Smart Animate, gentle, 400ms   (the shrink)
 *   midstep → skeleton: dissolve, 500ms, after 250ms delay
 *   skeleton → loaded : dissolve, 500ms, after 400ms delay
 * Figma triggered the first step on click; we auto-play with a readable hold on
 * the splash, plus a Replay control. Expanded-rail boot reuses the same timing.
 * The login flow auto-morphs splash → card, then holds on the card indefinitely
 * until the user clicks "Sign in", which triggers the card → shell expand.
 */

type Phase = 'splash' | 'login' | 'midstep' | 'skeleton' | 'loaded';

const HEADER_H = 36;
const RAIL_W = { collapsed: 48, expanded: 184 } as const;
const SURFACE_RADIUS = 12;
const CARD_W = 480;
const CARD_H = 600;

// Two easing personalities, chosen by how the surface moves — not just by size.
//
// EMPHASIZED_DECEL (Material 3) is heavily front-loaded: its opening velocity is
// ~14× the average, so the element LUNGES then crawls to rest. That's perfect for
// the boot dock, a small single-corner inset where the lunge is imperceptible.
// But on the login flow — a LARGE surface reshaping in full view — that same
// front-load is exactly what reads as "bouncy / too intense": the eye tracks the
// edges rushing inward. So the login morphs instead use HERO_EASE, a gentle
// ease-in-out that leaves AND arrives at zero velocity (no lunge, no slam, low
// peak velocity) for a calm, premium settle.
const EMPHASIZED_DECEL = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
const HERO_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const SPLASH_HOLD = 3000;
const MORPH_MS = 400; // boot dock — small single-corner inset
const COLLAPSE_MS = 720; // splash → login card (large, auto): the calmest pass
const EXPAND_MS = 560; // login card → app shell (large, post-click): a touch quicker
const DISSOLVE_MS = 500;
const SKELETON_DELAY = 250;
const LOADED_DELAY = 400;

const SLATE_200 = 'var(--color-slate-200,#e2e8f0)';

const NAV_LABELS = ['Dashboards', 'Endpoints', 'Vulnerabilities', 'Threats'];

export interface ShellTransitionProps {
  rail?: 'collapsed' | 'expanded';
  flow?: 'boot' | 'login';
  /** Login flow only: render the detection-sweep field behind the login card. */
  sweep?: boolean;
}

export function ShellTransition({
  rail = 'collapsed',
  flow = 'boot',
  sweep = false,
}: ShellTransitionProps) {
  const [phase, setPhase] = useState<Phase>('splash');
  const [reduceMotion, setReduceMotion] = useState(false);
  const timers = useRef<number[]>([]);
  const isLogin = flow === 'login';
  const railKind = isLogin ? 'expanded' : rail;
  const railW = RAIL_W[railKind];

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  }, []);

  // Login only: on "Sign in", the card surface does its hero morph up into the
  // docked slot, then chrome dissolves in (skeleton → loaded). Boot inlines its
  // own sequence in play(); this path is fired by the card's click handler.
  const expandIntoShell = useCallback(() => {
    clearTimers();
    setPhase('midstep');
    const at = (ms: number, p: Phase) =>
      timers.current.push(window.setTimeout(() => setPhase(p), ms));
    const tSkel = EXPAND_MS + SKELETON_DELAY;
    at(tSkel, 'skeleton');
    at(tSkel + DISSOLVE_MS + LOADED_DELAY, 'loaded');
  }, [clearTimers]);

  const play = useCallback(() => {
    clearTimers();
    setPhase('splash');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('loaded');
      return;
    }
    const at = (ms: number, p: Phase) =>
      timers.current.push(window.setTimeout(() => setPhase(p), ms));

    if (isLogin) {
      // Auto-morph splash → login card, then hold; the user clicks "Sign in"
      // to fire expandIntoShell. No automatic transition past the card.
      at(SPLASH_HOLD, 'login');
      return;
    }

    // Boot: splash → docked slot → chrome dissolves in, fully automatic.
    const tSkel = SPLASH_HOLD + MORPH_MS + SKELETON_DELAY;
    at(SPLASH_HOLD, 'midstep');
    at(tSkel, 'skeleton');
    at(tSkel + DISSOLVE_MS + LOADED_DELAY, 'loaded');
  }, [clearTimers, isLogin]);

  useEffect(() => {
    play();
    return clearTimers;
  }, [play, clearTimers]);

  // Reduced-motion users get the end state with no transitions at all (the spec
  // guidance is to disable motion, not just slow it down).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Gate every transition through this so reduced-motion drops them to `none`.
  const motionSafe = (spec: string) => (reduceMotion ? 'none' : spec);

  const isCard = phase === 'login';
  const docked = phase === 'midstep' || phase === 'skeleton' || phase === 'loaded';
  const chromeOn = phase === 'skeleton' || phase === 'loaded';

  // Surface geometry per phase, animated as a Smart-Animate-style bounding-box
  // morph (top/left/width/height/radius transition together).
  let geom: { top: string; left: string; width: string; height: string };
  if (isCard) {
    geom = {
      top: `calc(50% - ${CARD_H / 2}px)`,
      left: `calc(50% - ${CARD_W / 2}px)`,
      width: `${CARD_W}px`,
      height: `${CARD_H}px`,
    };
  } else if (docked) {
    geom = {
      top: `${HEADER_H}px`,
      left: `${railW}px`,
      width: `calc(100% - ${railW}px)`,
      height: `calc(100% - ${HEADER_H}px)`,
    };
  } else {
    geom = { top: '0px', left: '0px', width: '100%', height: '100%' };
  }

  // Login morphs ride the gentle HERO_EASE; the boot dock keeps the snappier
  // decelerate. Duration is per-move: the auto collapse is the calmest/longest,
  // the post-click expand a touch quicker, the small boot dock quicker still.
  const heroMorph = isCard || (isLogin && docked);
  const morphMs = isCard ? COLLAPSE_MS : isLogin && docked ? EXPAND_MS : MORPH_MS;
  const morphEase = heroMorph ? HERO_EASE : EMPHASIZED_DECEL;
  const geomT = `${morphMs}ms ${morphEase}`;

  // Visual trick on the collapse: instead of the border + shadow travelling with
  // the box (a fully-outlined card flying inward reads as fast/heavy), let them
  // fade in over the BACK half of the morph. The surface crosses the screen as a
  // soft, near-edgeless white shape and only "develops" its card definition as it
  // comes to rest — so it lands rather than arrives.
  const edgeT = isCard
    ? `${Math.round(morphMs * 0.55)}ms ${morphEase} ${Math.round(morphMs * 0.45)}ms`
    : geomT;

  const surfaceStyle: React.CSSProperties = {
    ...geom,
    borderRadius: isCard
      ? `${SURFACE_RADIUS}px`
      : docked
        ? `${SURFACE_RADIUS}px 0 0 0`
        : '0px',
    borderStyle: 'solid',
    borderColor: phase === 'splash' ? 'transparent' : SLATE_200,
    borderTopWidth: phase === 'splash' ? 0 : 1,
    borderLeftWidth: phase === 'splash' ? 0 : 1,
    borderRightWidth: isCard ? 1 : 0,
    borderBottomWidth: isCard ? 1 : 0,
    // Softer, more diffuse lift than before so the card settles rather than pops.
    boxShadow: isCard ? '0 30px 70px -32px rgba(2,6,23,0.22)' : 'none',
    transition: motionSafe(
      [
        `top ${geomT}`,
        `left ${geomT}`,
        `width ${geomT}`,
        `height ${geomT}`,
        `border-radius ${geomT}`,
        `border-color ${edgeT}`,
        `box-shadow ${edgeT}`,
      ].join(', '),
    ),
  };

  const expanded = railKind === 'expanded';

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--color-slate-50,#f8fafc)]">
      {/* Detection-sweep field — login flow only, behind the card. It belongs to
          the sign-in step alone: it fades in with the card and fades back out as
          the surface expands into the app shell (where it would be redundant). */}
      {isLogin && sweep && (
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            opacity: isCard ? 1 : 0,
            transition: motionSafe(`opacity ${morphMs}ms ${morphEase}`),
          }}
        >
          <LoginBackground texture="halftone" className="h-full w-full" interactive={false} />
        </div>
      )}

      {/* Header (top strip) — content fades in with the chrome dissolve. */}
      <header
        className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-12"
        style={{
          height: HEADER_H,
          opacity: chromeOn ? 1 : 0,
          transition: motionSafe(`opacity ${DISSOLVE_MS}ms ease-in-out`),
        }}
      >
        <WallarmLogo className="h-20 w-auto" />
        <div className="flex items-center gap-12 text-[var(--color-slate-500,#62748e)]">
          <div className="relative flex items-center">
            {/* loaded: search + tenant (defines layout) */}
            <div
              className="flex items-center gap-12"
              style={{
                opacity: phase === 'loaded' ? 1 : 0,
                transition: motionSafe(`opacity ${DISSOLVE_MS}ms ease-in-out`),
              }}
            >
              <div className="flex items-center gap-6 rounded-md border border-[var(--color-slate-200,#e2e8f0)] px-8 py-4">
                <Icon name="search" className="h-14 w-14" />
                <span className="text-[11px]">Search Wallarm</span>
                <span className="rounded border border-[var(--color-slate-200,#e2e8f0)] px-4 text-[10px]">
                  ⌘K
                </span>
              </div>
              <span className="h-16 w-px bg-[var(--color-slate-200,#e2e8f0)]" />
              <div className="flex items-center gap-4 text-[11px] text-[var(--color-slate-700,#314158)]">
                <span>Tenant Name</span>
                <span className="text-[var(--color-slate-400,#90a1b9)]">12345</span>
                <Icon name="chevronDown" className="h-12 w-12" />
              </div>
            </div>
            {/* skeleton: two placeholder bars, overlaid */}
            <div
              className="absolute inset-0 flex items-center justify-end gap-12"
              style={{
                opacity: phase === 'skeleton' ? 1 : 0,
                transition: motionSafe(`opacity ${DISSOLVE_MS}ms ease-in-out`),
              }}
            >
              <span className="h-20 w-156 rounded bg-[var(--color-slate-200,#e2e8f0)]" />
              <span className="h-20 w-156 rounded bg-[var(--color-slate-200,#e2e8f0)]" />
            </div>
          </div>
          <Icon name="bell" className="h-16 w-16" />
          <Icon name="help" className="h-16 w-16" />
        </div>
      </header>

      {/* Rail (left) — collapsed icon strip or expanded labelled nav. */}
      <aside
        className="absolute bottom-0 left-0 z-10 flex flex-col py-12 text-[var(--color-slate-500,#62748e)]"
        style={{
          top: HEADER_H,
          width: railW,
          paddingLeft: expanded ? 12 : 0,
          paddingRight: expanded ? 12 : 0,
          gap: 8,
          alignItems: expanded ? 'stretch' : 'center',
          opacity: chromeOn ? 1 : 0,
          transition: motionSafe(`opacity ${DISSOLVE_MS}ms ease-in-out`),
        }}
      >
        <RailItem icon="home" label="Home" expanded={expanded} active />
        <RailItem icon="history" label="Activity" expanded={expanded} />
        <span
          className="my-2 bg-[var(--color-slate-200,#e2e8f0)]"
          style={{ height: 1, width: expanded ? '100%' : 20 }}
        />

        {/* Nav section — loaded items cross-fade over skeleton placeholders. */}
        <div className="relative flex flex-col" style={{ gap: 8 }}>
          <div
            className="flex flex-col"
            style={{
              gap: 8,
              opacity: phase === 'loaded' ? 1 : 0,
              transition: motionSafe(`opacity ${DISSOLVE_MS}ms ease-in-out`),
            }}
          >
            {NAV_LABELS.map((label) => (
              <NavItem key={label} label={label} expanded={expanded} />
            ))}
          </div>
          <div
            className="absolute inset-0 flex flex-col"
            style={{
              gap: 8,
              opacity: phase === 'skeleton' ? 1 : 0,
              transition: motionSafe(`opacity ${DISSOLVE_MS}ms ease-in-out`),
            }}
          >
            {NAV_LABELS.map((label) => (
              <NavSkeleton key={label} expanded={expanded} />
            ))}
          </div>
        </div>

        <div className="mt-auto flex flex-col" style={{ gap: 8 }}>
          <RailItem icon="settings" label="Settings" expanded={expanded} />
          <RailItem icon="user" label="Account" expanded={expanded} />
        </div>
      </aside>

      {/* The morphing page background — decorative white surface. */}
      <div className="absolute z-20 overflow-clip bg-white" style={surfaceStyle} />

      {/* Splash content — centered logo + indeterminate progress. Leaves fast and
          first so the centered logo is gone before the card content arrives at
          its own (higher) position — no two-logos-at-once cross-fade. */}
      <div
        className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
        style={{
          opacity: phase === 'splash' ? 1 : 0,
          transition: motionSafe('opacity 180ms ease-out'),
        }}
      >
        <div className="flex flex-col items-center gap-12">
          <WallarmLogo className="h-20 w-auto" />
          <div className="h-2 w-118 overflow-hidden rounded-full bg-[var(--color-slate-200,#e2e8f0)]">
            <div
              className="h-full w-[40%] rounded-full bg-[var(--color-component-logo-ic,#fb2c36)]"
              style={{ animation: 'splash-progress 1.1s ease-in-out infinite' }}
            />
          </div>
        </div>
      </div>

      {/* Login card content — sits on the card surface during the login phase.
          Held back until the BACK of the collapse (delay ≈ 420ms) so it resolves
          just as the box lands — a plain gentle rise, no scale (scale-in is the
          most "pop"-prone). On the way out (card → shell) it fades fast so it
          doesn't fight the box. */}
      {isLogin && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          style={{
            opacity: isCard ? 1 : 0,
            transform: isCard ? 'translateY(0)' : 'translateY(8px)',
            pointerEvents: isCard ? 'auto' : 'none',
            transition: motionSafe(
              isCard
                ? `opacity 280ms ${HERO_EASE} 420ms, transform 300ms ${HERO_EASE} 420ms`
                : 'opacity 140ms ease-out, transform 140ms ease-out',
            ),
          }}
        >
          <LoginCard width={CARD_W} onSignIn={expandIntoShell} />
        </div>
      )}

      {/* Replay control — over the empty content area, clear of chrome. */}
      <div className="absolute bottom-16 left-1/2 z-40 -translate-x-1/2">
        <Button variant="outline" color="neutral" onClick={play}>
          ↻ Replay
        </Button>
      </div>
    </div>
  );
}

function LoginCard({ width, onSignIn }: { width: number; onSignIn: () => void }) {
  return (
    <div
      className="flex flex-col gap-20 px-32 py-36"
      style={{ width, maxWidth: '100%' }}
    >
      <div className="flex flex-col gap-12">
        <label className="flex flex-col gap-6">
          <Text size="sm" weight="medium" color="secondary">
            Email
          </Text>
          <Input type="email" placeholder="you@company.com" defaultValue="" />
        </label>
        <label className="flex flex-col gap-6">
          <Text size="sm" weight="medium" color="secondary">
            Password
          </Text>
          <Input type="password" placeholder="••••••••" defaultValue="" />
        </label>
      </div>
      <Button
        variant="primary"
        color="brand"
        size="large"
        fullWidth
        onClick={onSignIn}
      >
        Sign in
      </Button>
      <Text size="sm" color="tertiary-alt" align="center">
        Use SSO instead
      </Text>
    </div>
  );
}

function RailItem({
  icon,
  label,
  expanded,
  active,
}: {
  icon: keyof typeof ICON_PATHS;
  label: string;
  expanded: boolean;
  active?: boolean;
}) {
  const tone = active ? 'text-[var(--color-slate-900,#0f172b)]' : '';
  if (!expanded) {
    return <Icon name={icon} className={`h-16 w-16 ${tone}`} />;
  }
  return (
    <div
      className={`flex items-center gap-8 rounded-md px-8 py-4 text-[12px] ${
        active ? 'bg-[var(--color-slate-100,#f1f5f9)]' : ''
      } ${tone}`}
    >
      <Icon name={icon} className="h-16 w-16 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function NavItem({ label, expanded }: { label: string; expanded: boolean }) {
  if (!expanded) {
    return (
      <span className="h-16 w-16 rounded-full border border-[var(--color-slate-300,#cad5e2)]" />
    );
  }
  return (
    <div className="flex items-center gap-8 px-8 py-4 text-[12px]">
      <span className="h-16 w-16 shrink-0 rounded-full border border-[var(--color-slate-300,#cad5e2)]" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function NavSkeleton({ expanded }: { expanded: boolean }) {
  if (!expanded) {
    return <span className="h-16 w-16 rounded-md bg-[var(--color-slate-200,#e2e8f0)]" />;
  }
  return (
    <div className="flex items-center gap-8 px-8 py-4">
      <span className="h-16 w-16 shrink-0 rounded-md bg-[var(--color-slate-200,#e2e8f0)]" />
      <span className="h-12 w-88 rounded bg-[var(--color-slate-200,#e2e8f0)]" />
    </div>
  );
}

const ICON_PATHS = {
  home: 'M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.5Z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v3.5h3.5M12 7v5l3 2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  user: 'M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  chevronDown: 'm6 9 6 6 6-6',
} as const;

function Icon({
  name,
  className,
}: {
  name: keyof typeof ICON_PATHS;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
