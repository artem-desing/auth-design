# "Easter Final" — login-background shooter: engineering handoff spec

**Audience:** the front-end engineer productionising this feature.
**Status:** a working reference prototype exists (see §15); this document is the
behavioural + visual contract so it can be re-implemented properly/optimised
without losing any detail.
**Stack context:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript
strict · Tailwind v4 with the WADS design system · pnpm · static export to GitHub
Pages. WADS overrides Tailwind's `--spacing` to **1px**, so `w-76` = 76px,
`gap-6` = 6px, `top-24` = 24px, etc.

---

## 1. Summary

A hidden, progressive easter egg layered onto the decorative animated
"detection-sweep" login background. Three stages:

1. **Catch** — the field already shows rare red "anomalies"; clicking one
   neutralises it (it turns green, keeps its 8-bit form, dissolves) and a
   top-right counter ticks up.
2. **Gate** — after **5** catches, the interaction "arms."
3. **Shoot** — a retro pixel cannon appears at the bottom; the red anomalies
   become a steady, shootable population; `←/→` move, `Space` fires; bullets
   neutralise reds through the exact same green dissolve. Endless score-chase,
   no game-over.

The whole thing is an **opt-in easter egg**: it must be invisible/disabled
everywhere except one dedicated route.

---

## 2. Scope & where it lives

| Concern | Decision |
|---|---|
| Routes with the game | **Only** `/login-background/game` (hub card titled "Easter final"). |
| Routes that must NOT change | `/login-background/final` (pure field), `/login-background/tune`, and the `shell-transition` login flow. |
| Gating mechanism | A boolean `game` prop on the `LoginBackground` component, **default `false`**. The shooter + gate only run when `game === true` **and** the component is interactive. |
| Texture requirement | The shooter runs **only on the default `halftone` texture** (which `/game` uses). The `clean` texture keeps only click-to-catch (a round ~20px-radius latch) and has **no** shooter. |
| Non-goals (Stage 3, explicitly out) | Persistent high-score ("RECORD"), escalating waves, sound, a louder "ARMED" celebration. Noted in §16. |

The decorative field, ambient grey dots, and the sweep animation are **pre-existing
and unchanged**. This spec covers only the easter-egg layer on top.

---

## 3. Component model (recommended split)

The reference implementation splits cleanly; keep this boundary:

- **Engine** (framework-agnostic canvas module): owns everything that mutates per
  frame — the anomaly population, cannon, bullets, collision, the green dissolve,
  and the single render loop. No React inside it. Exposes an imperative API.
- **React wrapper**: owns React-render state only — the catch count, the `game`
  prop, the derived `armed` flag, the keyboard listeners, and the HUD (counter
  card + hints). Drives the engine through the imperative API; **never** puts
  per-frame state or callbacks through React render.

### Engine imperative API
```ts
setMode(mode: 'idle' | 'armed'): void   // wrapper flips to 'armed' at 5 catches
setCannonDir(dir: number): void          // −1 / 0 / +1 ; no-op unless armed & running
setFiring(on: boolean): void             // Space down/up; cadence owned by the loop
onKill(cb: (total: number) => void): void// fired on EVERY kill (click or bullet)
catchAt(x: number, y: number): boolean   // click hit-test (canvas-local px)
// plus existing: start / stop / setOptions / renderStatic / resize
```
`onKill`, `setMode`, `setCannonDir`, `setFiring` are imperative — they must **not**
be options that feed the engine's option-diff signature (callbacks/rapidly-changing
values there cause needless re-inits).

`setMode` is **idempotent**: the wrapper's arming effect calls it on every run
(with `'armed'` or `'idle'`), so the engine must **early-return if the mode is
unchanged**, and **re-seed game state (arm timestamp, cannon centre = `w/2`, clear
bullets + targets) only on a real `idle → armed` transition**.

### State types
```ts
interface Anomaly { x: number; y: number; t0: number; life: number; caught: boolean }
interface Bullet  { x: number; y: number }
// existing: Caught { x, y, t0, cells: CaughtCell[], label: string }
//           CaughtCell { x, y, half, ao }
```

---

## 4. Behavioural flow (state machine)

The engine has exactly two modes: **`idle`** (default; today's decorative field)
and **`armed`** (the shooter). The "gate" is **not** an engine mode — it's purely
the React counter + card label while `idle`.

```
caught = 0 ───────────────► IDLE field, counter hidden
  │ click a red anomaly
  ▼
caught 1..4 ──────────────► IDLE field + GATE counter "n / 5 · TO ARM"
  │ caught reaches 5
  ▼
ARM (one-shot) ───────────► engine.setMode('armed'); cannon rises; keyboard attaches
  ▼
caught ≥ 5 ───────────────► ARMED shooter; counter = SCORE; endless
```

- The count (`caught`) is the **single source of truth** for gate progress **and**
  score. It is driven only by `engine.onKill(total => setCount(total))`.
- Clicking still works after arming (additive — mouse and keyboard coexist).
- There is **no** game-over, no lives, no reset. Score only climbs.
- "ARM" is a transition, not a one-shot guarded by React: the wrapper's effect may
  call `setMode` repeatedly (it also re-runs on a reduced-motion change); the engine
  itself dedupes (see §3). `armed` is derived (`game && caught ≥ 5`), so once you've
  hit 5 it stays true — disarming is only ever driven by reduced-motion, and is
  **non-destructive** (see §12).

---

## 5. The anomaly population (targets)

The same red-anomaly concept serves both modes; only the spawner differs.

### Idle (must reproduce the original field exactly — `/final` parity)
- At most **one** anomaly alive at a time.
- Re-rolled every `anomalyInterval` (**1.4 s**) at `x = 30 + rand·(w−60)`,
  `y = 16 + rand·(h−32)`, `life = 2.4 s`.
- Envelope (brightness over life): `env = max(0, sin((t − t0)/life · π))`.
- Reveal in the field: a dot is drawn red only where it is **behind the sweep**
  (`dot.x < sweepX(at dot.y)`) and within `ANOMALY_R` (**42px**) of the anomaly
  centre. This per-dot sweep gate is the original behaviour — preserve it.

### Armed (the shootable population)
- Spawn a new target every `ARMED_SPAWN` (**0.55 s**) while
  `count < MAX_TARGETS` (**6**), with `life = TARGET_LIFE` (**4.0 s**).
- Placement: upper play-field, `x ∈ [0.10w, 0.90w]`, `y ∈ [0.10h, 0.55h]`.
- **HUD exclusion:** if the sample lands in the reserved top-right box
  (`x > w − HUD_CLEAR_W(120)` and `y < HUD_CLEAR_H(140)`), deterministically
  nudge `x` left into `[0.10w, 0.70w]` so a target is never hidden under the
  counter. (Must be deterministic — no "retry up to N then give up" that can
  still land in-zone.)
- **Reveal/visibility relaxation:** a target reveals (and becomes shootable) once
  it is **behind the sweep OR older than `REVEAL_DELAY` (0.3 s)**, so the field
  stays reliably populated regardless of sweep phase. In armed mode the whole
  target shows at once (not the per-dot sweep gate) — evaluate "behind the sweep"
  at the **anomaly's own y** (`sweepX at a.y`), consistent with the hit-test.
- **First spawn** is delayed `FIRST_SPAWN_DELAY` (**0.7 s**) after arming so the
  cannon visibly settles before threats appear.
- Prune any anomaly with `caught || t − t0 > life` **in place** every frame
  (no array reallocation — see §11).

### Hittability (shared by click + bullet)
A target is hittable iff:
- not already caught, AND
- `env > 0.06` (this floor matches the draw's red gate so a *visibly red* dot is
  never un-hittable — "looks shootable = is shootable"), AND
- **armed:** centre behind the sweep (at `a.y`) OR age > `REVEAL_DELAY`;
  **idle:** the cluster's leading edge is revealed (`a.x − ANOMALY_R < sweepX(a.y)`),
  so a click registers as soon as the red you can see appears.

---

## 6. Catch & kill (the one shared path)

**Critical invariant:** click-kills and bullet-kills must be **visually and
numerically identical**. Route both through a single `neutralize(anomaly)`:

1. Mark `anomaly.caught = true`.
2. Freeze its current on-screen squares into `cells: CaughtCell[]` — for each grid
   dot within `ANOMALY_R` of the centre, `ao = env · (1 − dist/ANOMALY_R)`, skip
   `ao < 0.06`, store `{ x, y, half, ao }` where `half = min(round(ao·5)·1.05 + 0.5,
   maxDotSize/2)`. (This is the same sizing the field uses, so the green form == the
   red form.)
3. Push a `Caught { x, y, t0: now, cells, label: randomVerdict }`.
4. Bump the running kill total and fire the `onKill` callback (the single count path).

**Click:** `catchAt` finds the nearest **hittable** anomaly within a forgiving
**52px** radius and calls `neutralize`. Returns boolean but the wrapper does NOT
itself increment — counting flows only through `onKill` (avoids double-count).

### The green dissolve (kill feedback)
- Duration `CAUGHT_DUR` = **1.4 s**. Progress `p = (now − t0)/1.4`; `fade = 1 − p²`
  (lingers, then falls away — a slow dissolve, not a pop).
- Renders the **frozen square cells** recoloured to the caught-green token, alpha
  `min(1, 0.45 + cell.ao) · fade`. (Clean texture, if ever used, draws a round
  green dot instead — not relevant to the game, which is the `halftone` texture.)
- **Verdict label** above the form (see §8.4).

---

## 7. The shooter

### Cannon
- A stacked-`fillRect` retro turret in the **grey dot token** (`--login-bg-dot`):
  base `32×8` (`x ± CANNON_HALF_W(16)`), mid `12×6`, barrel `4×6`, with the base
  top at `y = h − CANNON_BASE_OFFSET(26)`.
- Horizontal only: `cannonX += dir · CANNON_SPEED(420 px/s) · dt`, clamped to
  `[CANNON_HALF_W, w − CANNON_HALF_W]`. No acceleration ramp (deliberately gentle).
- Seeded to `w/2` on arm and re-clamped on resize.

### Bullets
- Blocky pixel slug `fillRect(x − 2, y − 7, 4, 14)`, **grey** (`--login-bg-dot`,
  same as the cannon — "grey = your hardware, red = threat, green = neutralised").
  No glow.
- Emit from `{ x: cannonX, y: h − CANNON_BARREL_Y(40) }`, travel up
  `y −= BULLET_SPEED(720 px/s) · dt`. Culled at `y < −14`.
- **Fire model:** auto-fire while `firing && now − lastFire ≥ FIRE_CADENCE(0.18s)
  && bullets.length < MAX_BULLETS(24)`. On the `Space` press edge, reset `lastFire`
  so a **tap = exactly one shot** and a **hold = auto-repeat at the cadence** —
  never depend on OS key-repeat.

### Collision
- Per bullet, test against live anomalies with **squared distance**
  `dx² + dy² < HIT_R2 (22²=484)`; on hit, `break` (one bullet → one kill),
  consume the bullet, call `neutralize`. Re-check `hittable`/`caught` **per pair
  inside the loop** so a target killed by an earlier bullet this frame can't be
  double-killed (do not hoist this out of the loop).
- Bullets are compacted **in place** (write-index), no per-frame array allocation.

### Scoring
- Score == the kill counter (the same number shown top-right). Endless.

---

## 8. Visual & style spec

### 8.1 Colour tokens (theme-aware; light / dark)
All colours come from dedicated `--login-bg-*` tokens defined in `globals.css` in
terms of WADS palette tokens (so light/dark is a pure token swap). The engine
resolves them at runtime via `getComputedStyle`, with hard-coded RGB fallbacks.

| Role | Token | Light | Dark |
|---|---|---|---|
| Field dots / **cannon** / **bullets** | `--login-bg-dot` | slate-600 | slate-400 |
| Threat (red anomaly) | `--login-bg-accent` | red-500 | red-200 |
| Neutralised (green dissolve + verdict) | `--login-bg-caught` | green-500 | green-300 |
| Base fill | `--login-bg-base` | slate-50 | slate-950 |

The engine composes `rgba()` strings from these resolved tokens — that's expected
and fine. Do **not** introduce new hard-coded hex in DOM/JSX; use WADS tokens.

### 8.2 Fonts
- **Verdict labels** → **Press Start 2P** (8-bit arcade pixel font), declared via
  `@font-face` in `globals.css` (Google `fonts.gstatic.com` woff2, latin subset),
  warm-loaded on mount via `document.fonts.load(...)`. (Self-host if this leaves
  prototype.)
- **Counter card + hints** → **Geist Mono** (`'Geist Mono Variable'`, from
  `non.geist/mono`).

### 8.3 Counter card (top-right HUD) — matches Figma node `192:7958`
- **Container:** `position: fixed; top: 24px; right: 24px`, a column stack
  (`gap: 6px`, right-aligned), Geist-Mono font family on the group, `aria-hidden`,
  `pointer-events: none`.
- **Card:** **sharp-cornered** (no radius) rectangle, **76×52px**,
  `border: 1px solid var(--color-border-primary)` (slate-300),
  `background: var(--color-states-primary-hover)` (slate-500 @ 8%), centred column.
- **Number line:** Geist Mono **bold**, **16px / 20px**, colour
  `var(--color-text-success)` (green-600).
- **Label line:** Geist Mono regular, **12px / 16px**, **uppercase**, colour
  `var(--color-text-secondary)` (slate-500), `font-feature-settings: "liga" 0`.
- **Entrance:** `hud-in` keyframe (fade + slight slide). The number replays a
  `catch-pop` scale pulse on each increment (re-key the node on count change).
- **Three states:**
  - **non-game** (e.g. `/final` if ever interactive): number = count, label = `CAUGHT`.
  - **gate** (`game`, count 1–4): number = `n` + a dimmed (`opacity 0.45`) ` / 5`,
    label = `TO ARM`.
  - **armed** (`game`, count ≥ 5): number = score, label = `SCORE`, plus a controls
    hint line **below** the card: `← → move · space fire` — Geist Mono, **10px /
    14px**, colour `var(--color-text-secondary)`.
- The whole HUD only appears once `count > 0` (hidden at zero).

### 8.4 Verdict label (on each kill, on-canvas)
- A random word from `['BLOCKED','TERMINATED','NEUTRALIZED','QUARANTINED',
  'MITIGATED','CONTAINED']`, **Press Start 2P 9px**, `textAlign: center` /
  `textBaseline: bottom`, at `x = round(c.x)`, `y = round(max(15, c.y − 26 − p·8))`
  — so it sits just above the form, drifts up `p·8` px over its life, and never
  clips the top edge. Always full strength (ignores the field `intensity`).
- Drawn as **two `fillText` calls** (a hard offset shadow, *not* a canvas
  `shadowBlur`): first the shadow `rgba(0,0,0, 0.3·fade)` at `(x+1, y+1)`, then the
  caught-green at `min(1, fade·1.15)` alpha. No blur — keeps the pixels crisp.

### 8.5 Bottom gate hint (`/game` only)
- Text: `Click the red anomalies — catch 5 to arm the cannon, then ← → move · space fire`.
- **Visibility:** appears **after the first catch** and stays through the gate;
  **hidden once armed** (i.e. shown only while `game && count > 0 && !armed`).
  Fades in via `hud-in`.
- `position: fixed; bottom: 24px`, horizontally centred, `text-xs`, colour
  `var(--color-text-secondary)`, `aria-hidden`, `pointer-events: none`.

### 8.6 Arming flourish (gentle / premium — no bounce, shake, flash, or sound)
- The cannon **rises** into place over `ARM_RISE` (**0.45 s**): vertical offset
  `(1 − ease)·40` with `ease = 1 − (1 − p)²` (ease-out), alpha `0 → 1`.
- First target delayed `FIRST_SPAWN_DELAY` (0.7 s) so the cannon settles first.
- The counter card relabels (`TO ARM → SCORE`) with the `catch-pop` pulse.

---

## 9. Controls / input

- Listeners on **`window`** (the canvas is `aria-hidden`/non-focusable; the route
  is full-screen).
- **Attach only when `game && armed && !reduced-motion`.** Detach otherwise.
  Reduced-motion must be tracked as live state so a mid-session OS toggle
  re-evaluates (detaches the keyboard / disarms).
- `ArrowLeft`/`ArrowRight` → set a `{left,right}` held-state, derive
  `dir = (right?1:0) − (left?1:0)` (both-held cancels). `Space` (`' '`/`'Spacebar'`)
  → `setFiring(true)`; ignore `e.repeat` (loop owns cadence). Keyup reverses.
- `e.preventDefault()` **only** for `ArrowLeft`/`ArrowRight`/`Space` (stop page
  scroll / space-scroll; never hijack other keys).
- **Cleanup** removes both listeners **and** clears engine input
  (`setFiring(false)`, `setCannonDir(0)`) so a key released after unmount/disarm
  can't stick. The engine's `stop()` should also rest with no held input.
- **Click-to-catch** (`pointerdown`) stays attached whenever interactive and
  remains active after arming.

---

## 10. Timing & difficulty — tunables (single source, top of engine)

Difficulty comes from **target turnover** (independent 4 s lifetimes refilling
every 0.55 s), not twitchy bullets or a stingy hitbox. Master lever:
`FIRE_CADENCE` (raise to harden); raise `ARMED_SPAWN` to ease; lower `TARGET_LIFE`
to harden. All are named constants — keep them together and labelled.

| Const | Value | Meaning |
|---|---|---|
| `GATE_TARGET` | 5 | catches to arm |
| `MAX_TARGETS` | 6 | concurrent red targets (armed) |
| `MAX_BULLETS` | 24 | in-flight bullet cap |
| `BULLET_SPEED` | 720 px/s | bullet rise speed |
| `FIRE_CADENCE` | 0.18 s | min interval between held shots (~5.5/s) |
| `CANNON_SPEED` | 420 px/s | cannon lateral speed |
| `TARGET_LIFE` | 4.0 s | armed target lifetime (idle = 2.4 s) |
| `ARMED_SPAWN` | 0.55 s | spawn interval while under cap |
| `HIT_R2` | 22² (484) | bullet hit radius² |
| click radius | 52 px | forgiving mouse catch |
| `REVEAL_DELAY` | 0.3 s | armed target shootable even ahead of sweep |
| `ARM_RISE` | 0.45 s | cannon rise duration |
| `FIRST_SPAWN_DELAY` | 0.7 s | post-arm delay before first target |
| `ANOMALY_R` | 42 px | cluster radius |
| `CAUGHT_DUR` | 1.4 s | green dissolve duration |
| `CANNON_HALF_W` | 16 px | half cannon base width |
| `CANNON_BASE_OFFSET` | 26 px | base top from bottom edge |
| `CANNON_BARREL_Y` | 40 px | bullet emit height from bottom |
| `HUD_CLEAR_W` / `HUD_CLEAR_H` | 120 / 140 px | top-right spawn-exclusion box |
| dt clamp | 0.05 s | per-frame delta cap |
| `anomalyInterval` (idle) | 1.4 s | original single-anomaly cadence |

Field/animation params (unchanged, for reference): halftone spacing 16,
`sweepPeriod` 12.5 s, `tilt` 16°, `bloomRadius` 80, `intensity` 0.9,
`bloomAlpha` 0.2, `maxDotSize` 20.

---

## 11. Performance requirements ("browser stuff")

- **One** `requestAnimationFrame` loop. All game sim folds into the existing
  `frame(t)` behind a `mode === 'armed'` (and `texture === 'halftone'`) guard.
- The hot path stays the existing `O(dots)` field pass (dot grid is hard-capped at
  **20000** cells). The per-dot anomaly contribution is a `max` over the live
  population **with an axis pre-reject** (`abs(dx) > R || abs(dy) > R → continue`)
  **before** any `hypot`/`sin` — so cost is ~`O(dots)`, never `O(dots × targets)`.
- **Bounded** pools (`MAX_TARGETS`, `MAX_BULLETS`). **No per-frame allocation** in
  the dot loop. Bullets compacted in place; anomalies pruned in place.
- **dt** (`now − lastFrameT`) is **clamped to 0.05 s** and re-seeded on arm — a
  tab-resume or first armed frame must not fling the cannon or tunnel bullets.
- **DPR** clamped to ≤ 2 in `resize`.
- Loop pauses on `document.hidden` (cancel rAF) and resumes on visibility.
- **Idle pays ~nothing:** a single boolean skips the whole game block, so
  `/final` performance is unchanged.

---

## 12. Accessibility & reduced motion

- The canvas + HUD are **`aria-hidden`** decorative chrome, never in tab order —
  this is an easter egg, not essential UI.
- `prefers-reduced-motion: reduce` → **no game**: the engine stays in a single
  static frame (no rAF), no keyboard is attached, and the gate can't progress.
  The route degrades to the static decorative field. Honour live changes.
- Disarming on a mid-session reduced-motion toggle is **non-destructive**: the
  count/score (`caught` / the engine's kill total) is preserved. Because `armed`
  is derived from `caught ≥ 5`, flipping motion back **on** re-arms — a fresh
  cannon + arming flourish with bullets/targets cleared, but the **score intact**.
  It resumes the armed state; it does not reset progress.

---

## 13. Edge cases

- **Resize mid-game:** re-clamp `cannonX`; off-bounds targets simply expire.
- **Theme flip mid-game:** colours are re-resolved (observe `data-theme`/`class`
  on `<html>`); cannon/bullets/targets read the resolved tokens each frame, so they
  track light/dark live.
- **Tab background/resume:** rAF pause + the dt clamp cover it.
- **Reduced-motion toggled mid-armed-session:** must detach the keyboard and disarm.
- **HUD overlap:** the spawn-exclusion box keeps targets clear of the counter.

---

## 14. Non-functional constraints

- TypeScript **strict** — no `any`, no `@ts-ignore`, no `// eslint-disable`.
- **WADS tokens** for colour/spacing/type — no hard-coded hex in DOM (engine
  `rgba()` composition from *resolved tokens* is the established exception).
- WADS components imported per-path (no barrel imports); theme imported once in
  `globals.css`.
- `pnpm` only; files kebab-case; functional components + hooks.
- Static export (`output: export`, `basePath` `/auth-design` in prod only).

---

## 15. Acceptance criteria (verifiable checklist)

- [ ] `/login-background/final` is **visually + behaviourally unchanged** (single
      roaming anomaly, original cadence/placement; counter is the plain `CAUGHT`
      Figma card; **no** keyboard listeners attach).
- [ ] `/login-background/game` shows the same field; the bottom hint appears only
      after the first catch and hides on arming.
- [ ] Counter hidden at 0; shows `n / 5 · TO ARM` during the gate; `SCORE` + controls
      hint when armed.
- [ ] Catching 5 by click arms the cannon (rise flourish; first target ~0.7 s later).
- [ ] `←/→` move (clamped, both-held cancels); `Space` tap = 1 shot, hold = repeat.
- [ ] A bullet hit and a click produce an **identical** green dissolve + verdict and
      **increment the score once** (no double-count).
- [ ] Bullets and cannon are **grey**; threats red; neutralised green.
- [ ] `Space`/arrows never scroll the page; other keys unaffected.
- [ ] Reduced-motion → static field, no game, no key capture (incl. live toggle).
- [ ] No frame-rate regression on `/final`; armed mode holds 60fps on a laptop.
- [ ] `pnpm exec tsc --noEmit`, `pnpm exec eslint`, and `pnpm build` all pass; the
      `/game` route exports.

## 15a. Verification note (important)

Live gameplay is **hard to drive in a headless/background browser**: a hidden tab
freezes `requestAnimationFrame` and throttles `setTimeout`, so the cannon won't
move and catches can't fire in an automated/preview context. Verify via
`tsc`/`eslint`/`build`, **structural DOM + computed-style checks** (e.g. clone the
counter markup and assert tokens/labels), and code review of the spawn / collision
/ dt / `neutralize` / gate paths — not by scripting motion. Manual play in a real,
foregrounded browser is the final feel check.

---

## 16. Stage 3 (future, out of current scope)

- Persistent **`RECORD`** high score (e.g. `localStorage`) — the original
  "chasing records" idea.
- Escalating **waves** / difficulty ramp.
- A louder **"ARMED"** moment (still tasteful — the app's motion bar is
  gentle/premium, research-grounded; avoid bounce/shake/flash).

---

## 17. Reference implementation (source of truth for exact numbers)

The working prototype:
- `src/components/login-background/engine.ts` — the canvas engine (all game logic,
  the tunable consts block, `neutralize`, spawner, collision, draw).
- `src/components/login-background/login-background.tsx` — the React wrapper
  (`game` prop, `onKill` wiring, arming effect + keyboard, counter card + hints).
- `src/app/login-background/game/page.tsx` — the route.
- `src/app/page.tsx` — the hub card ("Easter final").
- `src/app/globals.css` — `--login-bg-*` tokens, `@font-face` (Press Start 2P),
  `hud-in` / `catch-pop` keyframes.
- `docs/shooter-game-plan.md` — the original implementation plan (architecture rationale).

This spec and that prototype agree; where a number is ambiguous in prose, the
constant in `engine.ts` is authoritative.
