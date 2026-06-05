# Retro shooter on the login background — implementation plan

> Easter-egg progression: the click-to-catch egg unlocks a Space-Invaders-style
> shooter after the user catches 5 anomalies. Lives only on a new
> `/login-background/game` route (a "Final + game" hub card), behind a new `game`
> prop on `LoginBackground`. `/login-background/final` stays byte-for-byte
> unchanged; `shell-transition` keeps `interactive={false}`, so no game runs there.

Synthesized from a 3-lens design panel (perf-first, simplicity-first, fidelity-first):
perf strategy = frozen target cells + bounded pools + one rAF loop, no `O(dots×targets)`;
state machine = engine knows only `idle`/`armed`, the 5-catch gate stays a React concern,
imperative setters never touch the JSON signature; controls/difficulty/8-bit look from fidelity.

## Architecture & engine-vs-wrapper split

**Engine (`engine.ts`)** owns everything that mutates per frame (React never re-renders during gameplay):
- `mode: 'idle' | 'armed'` (default `idle` = today's exact behaviour). `armed` swaps the single
  cluster for a bounded population spawner + cannon + bullets.
- The anomaly **population** (replaces scalar `ax/ay/aT/aCaught`), cannon x, bullet array, fire
  cadence state, arm-flourish timestamp, a per-frame `dt`, collision, and the shared kill path.
- Imperative setters only — no React in the loop.

**Wrapper (`login-background.tsx`)** owns only React-render state:
- New `game?: boolean` prop (mirrored to a `gameRef`, **not** in `resolveOptions`/signature).
- The existing `caught` count, reused as **both** gate progress and score.
- Derived `armed = game && caught >= 5`; an effect flips the engine to `armed` once and
  attaches/detaches keyboard listeners.
- The counter-card UI (progress `n / 5` while gating, score once armed).

The engine knows `idle`/`armed` but **not** `gate`: gate renders identically to idle, so it stays
a pure React counter/label concern. Two-state engine.

## State model (engine additions)

```ts
interface Anomaly { x: number; y: number; t0: number; life: number; caught: boolean }
interface Bullet  { x: number; y: number }
```
New closure vars: `mode`, `anomalies[]`, `lastSpawn`, `bullets[]`, `cannonX`, `cannonDir`,
`firing`, `lastFire`, `armT`, `lastFrameT`, `onKillCb`, `killTotal`. Keep `caught[]`, `drawCaught`,
`CAUGHT_DUR`, `CAUGHT_LABELS`, `pickLabel`, `LABEL_FONT` as-is. The clean texture path
(`latched[]`, `drawClean`) is untouched (clean is never the game texture).

## New engine API

```ts
setMode(mode: 'idle' | 'armed'): void;   // wrapper flips to 'armed' at 5 catches
setCannonDir(dir: number): void;         // -1 / 0 / +1 (held arrows)
setFiring(on: boolean): void;            // Space down/up; cadence owned by the loop
onKill(cb: (total: number) => void): void; // imperative — stays out of the JSON signature
```
`catchAt(x,y)` keeps its signature/boolean. `setCannonDir`/`setFiring` no-op unless
`mode === 'armed' && running`. `setMode('armed')` seeds `armT`, re-seeds `lastFrameT`, centres the
cannon, clears bullets, resets the population. `resize` re-clamps `cannonX`.

## Target-population retune (idle untouched, armed shootable)

`drawHalftone` keeps its exact per-dot loop; the anomaly contribution becomes a `max` over the live
`anomalies` array (axis pre-reject before `hypot`). Ambient + bloom terms are byte-for-byte unchanged.

- **IDLE**: keep at most **one** anomaly, today's `anomalyInterval` cadence + placement + `life 2.4`,
  per-dot sweep gate (`p.x < sxAt`). Reproduces `/final` exactly.
- **ARMED**: spawn every `ARMED_SPAWN` (0.55s) while `anomalies.length < MAX_TARGETS` (6); upper
  play-field placement `x∈[0.10w,0.90w]`, `y∈[0.10h,0.55h]`, with a top-right HUD exclusion zone.
  A target becomes shootable/visible once it's behind the sweep **or** older than `REVEAL_DELAY`
  (0.3s), so the field stays populated regardless of sweep phase.

Per-frame prune of `caught || age > life`.

## Bullets, collision, shared kill path

- **Bullet**: a chunky pixel slug `fillRect(x-2, y-7, 4, 14)` in the caught-green token. No blur.
- **Cannon**: stacked `fillRect`s (base/mid/barrel) in the dot colour; rises into place on arm.
- **Motion (dt-based)**: `cannonX += dir * CANNON_SPEED * dt`; `b.y -= BULLET_SPEED * dt`. Auto-fire
  while `firing && t - lastFire >= FIRE_CADENCE && bullets.length < MAX_BULLETS`. Tap = 1 shot
  (lastFire reset on press), hold = auto-repeat — neither depends on OS key-repeat.
- **Collision**: bullets × anomalies squared-distance `< HIT_R2` (22²); `break` on hit (one bullet,
  one kill); in-place bullet compaction (no per-frame allocation).
- **Shared `neutralize(a)`**: the one place that freezes the green-dissolve cells, pushes the `Caught`
  entry, bumps `killTotal`, and fires `onKillCb`. Click **and** bullet both route through it, so a
  click-kill and a shot-kill are visually identical. `catchAt` finds the nearest hittable anomaly
  within 52px and calls `neutralize`.

## Arming transition + counter card

Three phases keyed off `caught`:
- **GATE** (`game && caught < 5`): engine `idle`; clicks catch. Card shows `n / 5` over `TO ARM`.
- **ARM** (`caught` hits 5): `useEffect([armed])` → `setMode('armed')` once; card relabels to `SCORE`;
  a one-line controls hint (`← → move · space fire`) fades in.
- **ARMED**: steady population; bullets + clicks both kill via the shared path; endless score-chase,
  no game-over/lives.

**Flourish (gentle/premium — no bounce/shake/flash):** cannon rises from below over ~0.45s (easeOut,
alpha 0→1); first target spawn delayed ~0.7s so the cannon settles first; card plays `catch-pop`. No sound.

## dt handling (new)

At the top of `frame(t)`: `const dt = Math.min(t - lastFrameT, 0.05); lastFrameT = t;`. The 50ms clamp is
load-bearing — prevents a tab-resume / first-armed-frame spike from flinging the cannon or tunnelling
bullets past targets. Seeded in `setMode('armed')`; the clamp covers visibility resume.

## Input / keyboard lifecycle (wrapper)

`window` listeners, attached **only** when `game && armed && !reducedMotion`:
- keydown ArrowLeft/Right → `setCannonDir`; both-held cancels via a `{left,right}` ref. Space → `setFiring(true)`
  (ignore `e.repeat`). `preventDefault` **only** for arrows/Space (no page scroll, no key hijack).
- keyup → recompute dir / `setFiring(false)`.
- Cleanup removes both listeners and calls `setFiring(false)` + `setCannonDir(0)` so a key can't stick.
Click-to-catch stays active after arming (additive). Never attach when `game` is false or under reduced motion.

## Difficulty defaults — "hard but fair"

Difficulty comes from **target turnover** (independent 4s lifetimes refilling every 0.55s), not twitchy
bullets or a stingy hitbox. Master lever: `FIRE_CADENCE` (raise to harden); raise `ARMED_SPAWN` to ease;
lower `TARGET_LIFE` to harden. All named consts at the top of the game block.

| Param | Const | Default |
|---|---|---|
| Bullet speed | `BULLET_SPEED` | 560 px/s |
| Fire cadence (hold) | `FIRE_CADENCE` | 0.18 s (~5.5/s) |
| Cannon move speed | `CANNON_SPEED` | 420 px/s |
| Target lifetime | `TARGET_LIFE` | 4.0 s |
| Armed spawn interval | `ARMED_SPAWN` | 0.55 s |
| Max targets | `MAX_TARGETS` | 6 |
| Max bullets | `MAX_BULLETS` | 24 |
| Bullet hit radius | `HIT_R2` | 22² px |
| Click hit radius | (unchanged) | 52 px |
| Sim dt clamp | (cap) | 0.05 s |
| First spawn delay | (post-arm) | ~0.7 s |

## Perf budget

Single rAF loop preserved; all new sim folds into `frame(t)` behind `mode === 'armed'`. Hot path stays
the unchanged `O(dots)` field pass (capped at 20000 cells). New per-frame: spawn O(1); expire ≤6;
cannon O(1); bullets ≤24; collision ≤144 squared-dist (axis pre-rejected); per-dot anomaly loop ≤6
(idle ≤1 → identical to today). Bounded arrays; in-place bullet compaction; `cells[]` computed once at
kill; `dt` clamped; `document.hidden` cancels rAF. Idle skips the whole game block → `/final` pays nothing.

## Reduced motion & edge cases

- **Reduced motion**: wrapper never arms / never attaches keyboard; engine stays in `renderStatic`. Route
  degrades to the static decorative field.
- **Theme flip**: cannon/bullets/targets read `colors.*` each frame → track light/dark live.
- **Resize**: `resize` re-clamps `cannonX`; off-bounds targets expire.
- **HUD overlap**: spawn exclusion zone keeps targets out from under the top-right counter.

## Verification (accounts for the document.hidden preview gotcha)

The headless preview tab runs `document.hidden` → rAF frozen, setTimeout throttled, so live gameplay
can't be auto-driven. Lean on: `tsc --noEmit` (strict), `pnpm build` (the new route must export),
eslint, **structural DOM checks** (clone markup + computed styles: `/final` unchanged + no keyboard
listeners; `/game` mounts `<LoginBackground game/>`; card shows `n / 5`+`TO ARM` gating, `SCORE` armed),
and an adversarial code review of the spawn/collision/gate/dt branches + the shared `neutralize`.

## Top risks

1. **Shared kill-path drift** — funnel the cell-freeze + score through ONE `neutralize`, or click/shot
   kills diverge. Highest-drift area.
2. **Idle regression on `/final`** — the idle spawner must reproduce today's one-cluster cadence/placement/
   envelope exactly.
3. **Double-counting** — exactly one count path (`onKill`); pointerdown must stop incrementing.
4. **dt spike** — clamp to 50ms + re-seed `lastFrameT` or the first armed frame / tab-resume flings the cannon.
5. **Verification can't see motion** — lean on tsc/build/eslint/structural checks/review, never on watching it move.
6. **Keyboard scope leak** — attach only when `game && armed && !reduced`; `preventDefault` only arrows/Space; clear input on cleanup.

## File-by-file

- `engine.ts` — game consts, `Anomaly`/`Bullet`, population spawner (idle=1 / armed=pool), generalised
  `drawHalftone` anomaly term, `dt`, `neutralize`, `stepGame`/`drawCannon`/`drawBullets`, refactored
  `catchAt`, new API (`setMode`/`setCannonDir`/`setFiring`/`onKill`), `cannonX` re-clamp in `resize`.
- `login-background.tsx` — `game?` prop + `gameRef`; register `onKill(total => setCaught(total))`;
  pointerdown stops incrementing; arming effect + window keyboard; counter card gate/score branch.
- `src/app/login-background/game/page.tsx` — NEW; clone of `final`, renders `<LoginBackground game />` + hint.
- `src/app/page.tsx` — add the "Final + game" variant to the Login-background section.
- `final/page.tsx`, `globals.css` — UNCHANGED (game defaults false; cannon/bullets reuse existing tokens + keyframes).

## Build order

1. Engine: consts + interfaces → 2. state → 3. `neutralize` → 4. mode-aware spawner →
5. generalised `drawHalftone` term → 6. `dt` → 7. game sim + render → 8. API + `resize` clamp →
9. wrapper prop + `onKill` wiring → 10. arming effect + keyboard → 11. counter card →
12. new route → 13. hub card → 14. verify (tsc, build, eslint, structural, review).
