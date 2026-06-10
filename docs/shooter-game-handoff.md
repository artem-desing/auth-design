# "Easter Final" — login-background shooter: engineering handoff spec

**Audience:** the front-end engineer productionising this feature.
**Status:** a working reference prototype exists (see §16); this document is the
behavioural + visual contract so it can be re-implemented properly/optimised
without losing any detail. **Reflects the current prototype** (finite scored
rounds, card-aware spawning, the HIT/SCORE results box, Esc-to-exit).
**Stack context:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript
strict · Tailwind v4 with the WADS design system · pnpm · static export to GitHub
Pages. WADS overrides Tailwind's `--spacing` to **1px**, so `w-119` = 119px,
`gap-6` = 6px, `top-24` = 24px, etc.

> **Accessibility / reduced motion:** intentionally **not implemented** in this
> prototype — it's a decorative, hidden easter egg. There are no `aria-*`/`role`
> attributes, no screen-reader announcements, and `prefers-reduced-motion` is **not**
> honoured (the animation always runs). This is a deliberate scope choice for the
> prototype, not an oversight; re-introduce a11y if/when this becomes production UI.

---

## 1. Summary

A hidden, progressive easter egg layered onto the decorative animated
"detection-sweep" login background. The loop:

1. **Catch** — the field already shows rare red "anomalies"; clicking one
   neutralises it (it turns green, keeps its 8-bit form, dissolves) and a
   top-right counter ticks up.
2. **Gate ("insert coin")** — after **5** catches, the interaction "arms."
3. **Round (shoot)** — a retro pixel cannon appears at the bottom; the reds become
   a steady, shootable population; `←/→` move, `Space` fires, `Esc` quits. Bullets
   neutralise reds through the exact same green dissolve. The round is a **fixed
   100-attack wave**, scored as **accuracy** (the brag metric).
4. **Results** — when the wave is done, the field freezes the shooter, plays a
   **tiered round-end celebration** scaled to the accuracy grade (see
   `docs/shooter-game-celebration-handoff.md` — the dedicated spec for that layer),
   and shows the final HIT count + SCORE (accuracy %), with a **Try again** link
   once the ceremony settles.
5. **Reset** — `Esc` at any time during play quits the shooter back to the pristine
   decorative field; re-clicking the dots replays the gate from zero (a repeatable
   cycle).

The whole thing is an **opt-in easter egg**: invisible/disabled everywhere except
one dedicated route.

---

## 2. Scope & where it lives

| Concern | Decision |
|---|---|
| Routes with the game | **Only** `/login-background/game` (hub card titled "Easter final"). |
| Routes that must NOT change | `/login-background/final` (pure field), `/login-background/tune`, and the `shell-transition` login flow. |
| Gating mechanism | A boolean `game` prop on `LoginBackground`, **default `false`**. The shooter + gate run only when `game === true` **and** the component is interactive. |
| Texture requirement | The shooter runs **only on the default `halftone` texture** (which `/game` uses). The `clean` texture keeps only click-to-catch and has **no** shooter. |
| Card-aware spawning | `/game` passes the sign-in card's size via an `excludeCardSize` prop so threats spawn in the ring *around* the card, never behind it (see §5). |

The decorative field, ambient grey dots, and the sweep animation are **pre-existing
and unchanged**. This spec covers only the easter-egg layer on top.

---

## 3. Component model (recommended split)

The reference implementation splits cleanly; keep this boundary:

- **Engine** (framework-agnostic canvas module): owns everything that mutates per
  frame — the anomaly population, cannon, bullets, collision, the green dissolve,
  the round counters, and the single render loop. No React inside it. Exposes an
  imperative API.
- **React wrapper**: owns React-render state only — the score snapshot, the `game`
  prop, the derived `armed`/`roundOver` flags, the keyboard listeners, and the HUD
  (counter/results box + hints). Drives the engine through the imperative API;
  **never** puts per-frame state or callbacks through React render.

### Engine imperative API
```ts
// loop / sizing / options
start(): void                              // start (or resume) the rAF loop
stop(): void                               // stop the loop + detach listeners; keep last frame
setOptions(next: Partial<EngineOptions>): void
renderStatic(t?: number): void             // one static frame, no rAF (used by the `paused` prop)
resize(): void

// easter egg / game
catchAt(x: number, y: number): boolean     // click hit-test (canvas-local px); no-op while stopped
setMode(mode: 'idle' | 'armed'): void      // switch decorative ↔ shooter; does NOT reset the round
startRound(): void                         // begin a FRESH scored round (zero round counters + arm)
exitGame(): void                           // quit to the pristine gate (zero gate + round counters → idle)
setCannonDir(dir: number): void            // −1 / 0 / +1 ; no-op unless armed & running
setFiring(on: boolean): void               // Space down/up; cadence owned by the loop
onStats(cb: (s: GameStats) => void): void  // fires on every kill, every escape, and at round end
celebrate(score: number): void             // round-end ceremony replay hook — see shooter-game-celebration-handoff.md
setSound(on: boolean): void                // 8-bit SFX gate (default OFF) — see §9a
setExclusion(box: { width: number; height: number } | null): void // centered no-spawn card box
```

- `setMode`/`startRound`/`exitGame`/`setCannonDir`/`setFiring`/`onStats`/`setExclusion`
  are **imperative** — they must **not** feed the engine's option-diff signature
  (callbacks / rapidly-changing values there cause needless re-inits).
- `setMode` is **idempotent** (early-return if the mode is unchanged). In the
  current wrapper flow the `idle → armed` re-seed path inside `setMode` is dormant —
  first-arm and Try-again both go through `startRound` (which already arms + clears
  the field), so the arming effect's follow-up `setMode('armed')` hits the dedupe
  guard. `setMode('idle')` is what `exitGame` uses to return to decorative.
- Internally the engine has a third mode **`'over'`** (round finished — shooter
  frozen, field still breathing). The public `setMode` only takes `'idle' | 'armed'`;
  `'over'` is entered by the engine itself via `endRound()` and left via `startRound()`.

### State types
```ts
interface Anomaly { x: number; y: number; t0: number; life: number; caught: boolean }
interface Bullet  { x: number; y: number }
interface GameStats {
  kills: number;    // lifetime catches — drives the arming gate (caught >= 5); never decremented except by exitGame
  stopped: number;  // threats stopped THIS round (HIT; the accuracy numerator)
  escaped: number;  // threats that timed out unshot THIS round
  spawned: number;  // attacks that have appeared this round (caps the round at ROUND_ATTACKS)
  done: boolean;    // round complete — full wave spawned AND field cleared
}
// existing: Caught { x, y, t0, cells: CaughtCell[], label } ; CaughtCell { x, y, half, ao }
```

---

## 4. Behavioural flow (state machine)

Engine modes: **`idle`** (decorative field), **`armed`** (live shooter),
**`over`** (round finished, frozen). The "gate" is **not** an engine mode — it's
the React counter + card label while the engine is `idle` in game mode.

```
caught = 0 ─────────────────► IDLE field, counter hidden
  │ click a red anomaly (catchAt → neutralize → onStats)
  ▼
caught 1..4 ────────────────► IDLE field + GATE box  "n / 5 · INSERT COIN"
  │ caught reaches 5  → wrapper calls engine.startRound()
  ▼
ARMED ROUND ────────────────► cannon rises; keyboard attaches; 100-attack wave;
  │                            box = HIT (stopped/faced) · divider · SCORE (accuracy %)
  │ all 100 spawned AND field clear → engine.endRound()
  ▼
OVER (results) ─────────────► shooter frozen; the tiered CELEBRATION plays, then
  │                            settles (digits + headline persist); box shows final
  │                            HIT + SCORE; "Try again" BELOW the box once settled
  ├─ Try again → engine.startRound()  → back to ARMED (fresh round, score 0)
  └─ Esc (during play OR on the results/ceremony screen) → engine.exitGame() →
                                   IDLE, counter hidden, gate replays from 0
```

- The wrapper derives `armed = game && caught >= GATE_TARGET(5)` and
  `roundOver = armed && stats.done`. `caught` = `stats.kills` (the engine's lifetime
  total), fed only via `engine.onStats(s => setStats(s))` — the single count path.
- **First-arm vs re-entry:** a `hasStartedRoundRef` distinguishes the first arm and
  Try-again (→ `startRound`, fresh round) from a plain re-entry such as
  `roundOver → play` (→ `setMode('armed')`, keeps the round). `exitGame` resets the
  ref so the next gate-clear starts fresh.
- **No lives / no fail state.** The only "ending" is finishing the 100-attack wave
  (→ results) or quitting via `Esc`. Score never goes negative.

---

## 5. The anomaly population (targets)

The same red-anomaly concept serves both modes; only the spawner differs, and a
shared **fair-spawn placement** applies whenever a card exclusion is set (game mode).

### Idle (decorative)
- At most **one** anomaly alive at a time, re-rolled every `anomalyInterval`
  (**1.4 s**), `life = 2.4 s`.
- **Placement:** when **no** exclusion box is set (`/final`, `shell-transition`),
  the original full-field roll: `x = 30 + rand·(w−60)`, `y = 16 + rand·(h−32)` —
  preserve this exactly for `/final` parity. When an exclusion box **is** set (game
  mode, during the gate), placement goes through the fair-spawn `spawnRing` (below)
  so even gate dots aren't hidden behind the card.
- Envelope (brightness over life): `env = max(0, sin((t − t0)/life · π))`.
- Field reveal (idle): a dot is drawn red only where it is **behind the sweep**
  (`dot.x < sweepX(at dot.y)`) and within `ANOMALY_R` (**42px**) of the centre —
  the original per-dot sweep gate. Preserve it.

### Armed (the shootable population)
- Spawn a new target every `ARMED_SPAWN` (**0.55 s**) while
  `count < MAX_TARGETS` (**6**) **and** `roundSpawned < ROUND_ATTACKS` (**100**),
  with `life = TARGET_LIFE` (**4.0 s**). Each spawn increments `roundSpawned`.
- **First spawn** delayed `FIRST_SPAWN_DELAY` (**0.7 s**) after arming so the cannon
  visibly settles before threats appear.
- Once `roundSpawned` hits 100, **spawning stops**; the in-flight wave drains
  naturally (no unfair forced misses). The round ends (`endRound()`) when
  `roundSpawned >= 100 AND anomalies.length === 0`.
- Placement goes through `spawnRing` (card exclusion set on `/game`). When no
  exclusion is set (game prop on but no card — not the case on `/game`), it falls
  back to the legacy upper-band roll `x ∈ [0.10w,0.90w]`, `y ∈ [0.10h,0.45h]` with
  the HUD nudge.
- **Reveal/visibility relaxation:** a target reveals (and becomes shootable) once it
  is **behind the sweep OR older than `REVEAL_DELAY` (0.3 s)**, evaluated at the
  anomaly's own `y` (consistent with the hit-test). In armed mode the whole target
  shows at once (not the per-dot sweep gate).
- Prune any anomaly with `caught || t − t0 > life` **in place** every frame. While
  armed, an anomaly aged out unshot increments `roundEscaped` (the accuracy "miss").

### `spawnRing` — fair placement around the card (game mode)
Reject-sample a point that is on-screen, above the cannon, clear of the HUD, and
**outside the centered sign-in card** (so a threat's bloom never tucks under the
opaque card and ages out as an unfair, invisible "escape"). Threats fill the full
**ring** around the card: both sides + the full-width strips above and below it.

- Card box is **centered** and derived from the live `w,h` each spawn (so it
  recenters on resize): padded edges `cl = (w−exW)/2 − CARD_CLEAR_PAD`,
  `cr = (w+exW)/2 + CARD_CLEAR_PAD`, `ct = (h−exH)/2 − CARD_CLEAR_PAD`,
  `cb = (h+exH)/2 + CARD_CLEAR_PAD`, where `CARD_CLEAR_PAD = 48` (> `ANOMALY_R` 42,
  so a ~6px gap remains between bloom edge and card).
- Sample bounds: `x ∈ [SPAWN_EDGE(24), w − SPAWN_EDGE]`,
  `y ∈ [SPAWN_EDGE, h − CANNON_CLEAR(72)]` (the bottom reserve keeps targets above
  the cannon barrel, so bullets can reach them). Reject the sample if it's inside
  the padded card OR inside the top-right HUD box
  (`x > w − HUD_CLEAR_W(120) && y < HUD_CLEAR_H(140)`). Up to `SPAWN_TRIES (24)`
  attempts.
- **Fallback** (sampling came up empty): pick the **roomiest clear band** around the
  card (above / below / left / right, each clamped to the usable field) and return
  its centre — always outside both the card and the HUD. Only if every band is empty
  (card ≥ the whole field — never on supported desktop sizes) does it return
  top-centre. `setExclusion` clamps the box to the canvas so a misconfigured size
  can't blanket the field.

### Hittability (shared by click + bullet)
A target is hittable iff: not already caught, AND `env > 0.06` (this floor matches
the draw's red gate so a *visibly red* dot is never un-hittable), AND —
**armed:** centre behind the sweep (at `a.y`) OR age > `REVEAL_DELAY`;
**idle:** the cluster's leading edge is revealed (`a.x − ANOMALY_R < sweepX(a.y)`).

---

## 6. Catch & kill (the one shared path)

**Critical invariant:** click-kills and bullet-kills are **visually and numerically
identical**. Route both through a single `neutralize(anomaly)`:

1. Mark `anomaly.caught = true`.
2. Freeze its current on-screen squares into `cells: CaughtCell[]` — for each grid
   dot within `ANOMALY_R` of the centre, `ao = env · (1 − dist/ANOMALY_R)`, skip
   `ao < 0.06`, store `{ x, y, half, ao }` where `half = min(round(ao·5)·1.05 + 0.5,
   maxDotSize/2)`. (Same sizing the field uses → the green form == the red form.)
3. Push a `Caught { x, y, t0: now, cells, label: randomVerdict }`.
4. Call `recordKill()` — the single count path.

### `recordKill` & scoring counters
```
killTotal += 1                       // lifetime (gate progress)
if (mode === 'armed') roundKills += 1 // round "stopped" (HIT) — ONLY while armed
emitStats()                           // push GameStats to the wrapper
```
- **Gate clicks don't inflate the round:** the 5 gate catches happen in `idle`
  mode, so they bump `killTotal` only — `roundKills` starts counting at arm.
- **NOTE — clicks also score during the armed round.** The pointer-catch handler is
  attached whenever the component is interactive (not gated on `armed`), so during a
  round a click neutralises a target through the same `neutralize → recordKill` path
  and counts as a `roundKills` (HIT). This is the current behaviour (dual input).
  *Design note:* it means the accuracy metric isn't purely cannon-skill (a player
  can mouse-click targets). See `docs/shooter-game-ideas.md` for the cannon-only
  scoring option if the comparable-brag goal is pursued.

**Click:** `catchAt` finds the nearest **hittable** anomaly within a forgiving
**52px** radius and calls `neutralize`. Returns boolean; the wrapper does NOT itself
increment — counting flows only through `onStats` (avoids double-count). No-op while
the loop is stopped.

### The green dissolve (kill feedback)
- Duration `CAUGHT_DUR` = **1.4 s**. `p = (now − t0)/1.4`; `fade = 1 − p²`
  (lingers, then falls away — a slow dissolve, not a pop).
- Renders the **frozen square cells** recoloured to the caught-green token, alpha
  `min(1, 0.45 + cell.ao) · fade`. (Clean texture, not used by the game, draws a
  round green dot instead.)
- **Verdict label** above the form (§8.4).

---

## 7. The shooter

### Cannon
- A stacked-`fillRect` retro turret in the **grey dot token** (`--login-bg-dot`):
  base `32×8` (`x ± CANNON_HALF_W(16)`), mid `12×6`, barrel `4×6`, base top at
  `y = h − CANNON_BASE_OFFSET(26)`.
- Horizontal only: `cannonX += dir · CANNON_SPEED(420 px/s) · dt`, clamped to
  `[CANNON_HALF_W, w − CANNON_HALF_W]`. No acceleration ramp (deliberately gentle).
- Seeded to `w/2` on `startRound`/arm and re-clamped on resize. Drawn while `armed`
  **and** `over` (a frozen turret anchors the results screen).

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
  `dx² + dy² < HIT_R2 (22²=484)`; on hit, `break` (one bullet → one kill), consume
  the bullet, call `neutralize`. Re-check `hittable`/`caught` **per pair inside the
  loop** so a target killed earlier this frame can't be double-killed.
- Bullets compacted **in place** (write-index), no per-frame array allocation.

### Round & scoring
- The round is a fixed **`ROUND_ATTACKS` (100)** wave. `faced = stopped + escaped`;
  at round end `faced` lands on 100.
- **HIT** = `stopped` (`roundKills`). **SCORE** = accuracy =
  `faced > 0 ? round(stopped / faced · 100) : 100` (%). The HUD shows the live
  `stopped / faced` and accuracy as the round runs.
- `endRound()` (when `roundSpawned >= 100 && anomalies.length === 0`): set
  `mode = 'over'`, `roundDone = true`, clear bullets/firing/cannonDir, `emitStats`.
  The decorative field keeps breathing; the cannon freezes in place.
- `startRound()` (first arm + Try-again): zero `roundKills/Escaped/Spawned`,
  `roundDone = false`, `mode = 'armed'`, clear bullets + anomalies + in-flight green
  dissolves, re-seed `armT/lastFrameT/lastSpawn = now`, `cannonX = w/2`, `emitStats`.
- `exitGame()` (Esc): zero **`killTotal`** *and* the round counters, clear the field,
  `mode = 'idle'`, and reset `lastSpawn = -Infinity` so the first decorative dot
  appears promptly. Pushing `kills = 0` makes the wrapper's `caught` drop to 0 → the
  HUD hides and the gate is replayable from scratch.

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

The engine composes `rgba()` from these resolved tokens — that's the established
exception to "no hard-coded hex." Do **not** introduce new hex in DOM/JSX.

### 8.2 Fonts
- **Verdict labels** → **Press Start 2P** (8-bit arcade pixel font), declared via
  `@font-face` in `globals.css` (Google `fonts.gstatic.com` woff2, latin subset),
  warm-loaded on mount via `document.fonts.load(...)`. (Self-host if this leaves the
  prototype.)
- **Counter/results box + hints** → **Geist Mono** (`'Geist Mono Variable'`).

### 8.3 The counter / results box (top-right HUD) — matches Figma node `192:7999`
- **Container:** `position: fixed; top: 24px; right: 24px`, a right-aligned column
  stack (`gap: 6px`), Geist-Mono font family, `pointer-events: none`. Appears only
  once `caught > 0`.
- **Box:** **sharp-cornered** rectangle, `border: 1px solid var(--color-border-primary)`,
  `background: var(--color-states-primary-hover)`, content centred, entrance via the
  `hud-in` keyframe (fade + slight slide). Size depends on state:
  - **non-game** ("caught" counter, e.g. `/final` if interactive): **76×52px**.
  - **gate** (`game`, not armed): **119×52px** (`h-52 w-119`).
  - **armed / results** (`game`, armed): **119×113px** (`h-113 w-119`) — shares the
    gate's width so arming only grows it *taller*.
- **A metric pair** = a big number + a small label, stacked, `gap: 4px`:
  - **Number:** Geist Mono **bold**, **16px / 20px**, `var(--color-text-success)`,
    tabular-nums.
  - **Label:** Geist Mono regular, **12px / 16px**, **uppercase**,
    `var(--color-text-secondary)`, `font-feature-settings: "liga" 0`.
- **States:**
  - **non-game:** one pair — number = `caught`, label = `CAUGHT`.
  - **gate:** one pair — number = `n` + a dimmed (`opacity 0.45`) ` / 5`, label =
    `INSERT COIN`.
  - **armed / results:** **two** pairs separated by a **1px full-width divider**
    (`h-px w-full`, `var(--color-border-primary)`, ~8px vertical margin):
    - top pair — number = `stopped` + dimmed ` / faced`, label = `HIT`;
    - bottom pair — number = `{accuracy}%`, label = `SCORE`.
- **Bounce:** the number replays a `catch-pop` scale pulse **only during the gate**
  (re-key the number node on each catch). While **armed** the number updates quietly
  in place — **no** pop (stable key, no animation), so the score isn't noisy mid-game.
- **Try again** (results only): a button **below / outside the box** (a sibling in
  the HUD column, ~6px under the box). Geist Mono **10px / 14px**, **uppercase**,
  underline (`underline-offset-4`), `var(--color-text-secondary)` → hover
  `var(--color-text-primary)`. `onClick` → `engine.startRound()`. **Held back while
  the round-end celebration's active show plays** (`stats.celebrating`); it appears
  as the ceremony settles. There is **no** separate "round complete" text line —
  the frozen field + the celebration + Try-again convey it.
- **Controls hint** (armed, not results): a line below the box —
  `← → move · space fire · esc exit · m sound on` (the trailing word reflects the
  live mute state, `on`/`off`) — Geist Mono **10px / 14px**,
  `var(--color-text-secondary)`. (Mutually exclusive with Try-again.)

### 8.4 Verdict label (on each kill, on-canvas)
- A random word from `['BLOCKED','TERMINATED','NEUTRALIZED','QUARANTINED',
  'MITIGATED','CONTAINED']`, **Press Start 2P 9px**, `textAlign: center` /
  `textBaseline: bottom`, at `x = round(c.x)`, `y = round(max(15, c.y − 26 − p·8))`
  — sits just above the form, drifts up `p·8` px over its life, never clips the top.
  Always full strength (ignores field `intensity`).
- Drawn as **two `fillText` calls** (a hard offset shadow, not `shadowBlur`):
  shadow `rgba(0,0,0, 0.3·fade)` at `(x+1, y+1)`, then caught-green at
  `min(1, fade·1.15)`. No blur — crisp pixels.

### 8.5 Bottom gate hint (`/game` only)
- Text: `Click the red anomalies — catch 5 to arm the cannon, then ← → move · space fire`.
- **Visibility:** shown only while `game && caught > 0 && !armed` (appears after the
  first catch, hides on arming, and stays hidden after an Esc reset since `caught`
  returns to 0). Fades in via `hud-in`.
- `position: fixed; bottom: 24px`, horizontally centred, `text-xs`,
  `var(--color-text-secondary)`, `pointer-events: none`.

### 8.6 Arming flourish (gentle / premium — no bounce, shake, flash, or sound)
- The cannon **rises** into place over `ARM_RISE` (**0.45 s**): vertical offset
  `(1 − ease)·40` with `ease = 1 − (1 − p)²` (ease-out), alpha `0 → 1`.
- First target delayed `FIRST_SPAWN_DELAY` (0.7 s) so the cannon settles first.
- The box relabels (gate `INSERT COIN` → armed `HIT` / `SCORE`) and grows taller.

---

## 9. Controls / input

- Listeners on **`window`** (the route is full-screen).
- **Attach the game keyboard only when `game && armed && !roundOver`.** Detach
  otherwise (the effect early-returns during the gate and on non-game routes — so
  `/final` / `shell-transition` never capture keys). On the **results/ceremony
  screen** (`roundOver`) an **Esc-only** keydown listener attaches instead, so Esc
  fully exits from there too (it dismisses the persistent celebration + resets the
  gate); arrows/Space stay detached while frozen.
- `ArrowLeft`/`ArrowRight` → set a `{left,right}` held-state, derive
  `dir = (right?1:0) − (left?1:0)` (both-held cancels). `Space` (`' '`/`'Spacebar'`)
  → `setFiring(true)`; ignore `e.repeat`. `Escape` → `engine.exitGame()` +
  reset `hasStartedRoundRef` (quit to the gate). `m`/`M` → toggle the sound gate
  (React state → `engine.setSound`, see §9a). Keyup reverses arrows/space.
- `e.preventDefault()` for `ArrowLeft`/`ArrowRight`/`Space`/`Escape` (stop page
  scroll; never hijack other keys). `M` does NOT preventDefault.
- **Cleanup** removes both listeners **and** clears engine input
  (`setFiring(false)`, `setCannonDir(0)`). `stop()` also rests with no held input.
- **Click-to-catch** (`pointerdown`) stays attached whenever interactive (works in
  every mode, incl. during the armed round — see §6 NOTE).

### 9a. Sound — synthesized 8-bit SFX (`sfx.ts`)

All sounds are **synthesized with the Web Audio API** — square waves + band-passed
noise, the way the original hardware made them. **No audio files, no deps, no bundle
weight.** Module: `src/components/login-background/sfx.ts` (framework-agnostic, like
the engine).

| Event (engine hook) | Sound | Recipe |
|---|---|---|
| Bullet emitted (`stepGame`) | **pew** | square 980→180 Hz glide, 80 ms |
| Armed kill — bullet or click (`recordKill`) | **zap** | square 320→70 Hz 60 ms + band-passed noise burst (1400→300 Hz, 70 ms) |
| Idle/gate catch (`recordKill`) | **coin** | two square notes: B5 (988 Hz) 80 ms → E6 (1319 Hz) 380 ms — the INSERT COIN chirp |
| Arm / fresh round (`startRound`) | **power-up** | rising square arpeggio G4·C5·E5·G5 (392/523/659/784 Hz), 60 ms steps |
| Ceremony starts, tier ≥ 1 (`startCelebration` — real round-ends AND demoed) | **fanfare** | C5·E5·G5 90 ms steps + C6 (1046 Hz) 220 ms |

- **Loudness:** `MASTER_VOLUME = 0.06` — deliberately whisper-quiet (this lives on a
  login screen; sounds read as ticks, not arcade blasts). Per-sound gains sit under
  that master. Sounds are all ≤ ~0.5 s; nothing sustained.
- **Gating (the important part):** the engine's `soundOn` flag defaults **false** —
  `/final`, `/tune`, and `shell-transition` never create an `AudioContext`, let alone
  play a sound. The wrapper enables it only where the easter egg lives:
  `soundCapable = game || !!onEngineReady` (the `/game` route and the celebration
  demo). React state `soundOn` (default **true**) ANDs with that and is pushed via
  `engine.setSound(...)` in a small effect.
- **Mute:** `M` toggles while armed AND on the results/ceremony screen (the fanfare
  plays there); the controls hint shows the live state. Known nuance (accepted):
  gate-phase coin chirps play before the keyboard attaches, so muting is only
  reachable once armed.
- **Autoplay safety:** the `AudioContext` is created lazily inside the first play
  call, which is always downstream of a user gesture (the game can't make a sound
  before the player clicks/keys); a suspended context is `resume()`d defensively.
  SSR-safe (`typeof window` guard; nothing runs at import time).

---

## 10. Timing & difficulty — tunables (single source, top of engine)

Difficulty comes from **target turnover** (independent 4 s lifetimes refilling every
0.55 s), not twitchy bullets or a stingy hitbox. The round is currently **flat** —
spawn rate / life / cap / speed are constant for all 100 attacks (no escalation).
Master lever: `FIRE_CADENCE` (raise to harden); raise `ARMED_SPAWN` to ease; lower
`TARGET_LIFE` to harden. All named constants — keep them together and labelled.

| Const | Value | Meaning |
|---|---|---|
| `GATE_TARGET` | 5 | catches to arm |
| `ROUND_ATTACKS` | 100 | attacks per round; spawning stops here, then the field drains and the round ends |
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
| `CARD_CLEAR_PAD` | 48 px | clearance around the sign-in card (game-mode spawns) |
| `SPAWN_EDGE` | 24 px | screen-edge inset for game-mode spawns |
| `CANNON_CLEAR` | 72 px | bottom reserve so targets stay above the barrel (hittable) |
| `SPAWN_TRIES` | 24 | reject-sampling attempts before the band fallback |
| dt clamp | 0.05 s | per-frame delta cap |
| `anomalyInterval` (idle) | 1.4 s | original single-anomaly cadence |
| `MASTER_VOLUME` (sfx.ts) | 0.06 | SFX master gain — whisper-quiet by design (§9a) |

Field/animation params (unchanged, for reference): halftone spacing 16,
`sweepPeriod` 12.5 s, `tilt` 16°, `bloomRadius` 80, `intensity` 0.9,
`bloomAlpha` 0.2, `maxDotSize` 20. Card on `/game`: **480 × 640px**, centred
(passed verbatim as `excludeCardSize`).

---

## 11. Performance requirements ("browser stuff")

- **One** `requestAnimationFrame` loop. All game sim folds into the existing
  `frame(t)` behind a `mode === 'armed'` (and `texture === 'halftone'`) guard.
- The hot path stays the existing `O(dots)` field pass (dot grid hard-capped at
  **20000** cells). The per-dot anomaly contribution is a `max` over the live
  population **with an axis pre-reject** (`abs(dx) > R || abs(dy) > R → continue`)
  before any `hypot`/`sin` — so cost is ~`O(dots)`, not `O(dots × targets)`.
- `spawnRing` runs at most `SPAWN_TRIES (24)` cheap comparisons per spawn, and only
  every `ARMED_SPAWN` (0.55 s) — negligible.
- **Bounded** pools (`MAX_TARGETS`, `MAX_BULLETS`). **No per-frame allocation** in
  the dot loop. Bullets compacted in place; anomalies pruned in place.
- **dt** (`now − lastFrameT`) is **clamped to 0.05 s**. On a paused loop resume
  (tab-hidden or the `paused` prop) the first frame would see a huge gap, so the
  engine advances **every time marker** (`anomalies/caught/latched .t0`, `armT`,
  `lastSpawn`, `lastLatch`) by the skipped interval (`rawDt − dt`) — so nothing ages,
  spawns, or (mid-round) mass-escapes across the gap. `renderStatic` saves/restores
  the clock so its fixed-phase draw doesn't corrupt the gap math.
- **DPR** clamped to ≤ 2 in `resize`.
- Loop pauses on `document.hidden` (cancel rAF) and on the `paused` prop; resumes on
  visibility.
- **Idle pays ~nothing:** a single boolean skips the whole game block, so `/final`
  performance is unchanged.

---

## 12. Edge cases

- **Resize mid-game:** re-clamp `cannonX`; the card-exclusion box recenters from the
  live `w,h` each spawn; off-bounds targets simply expire.
- **Theme flip mid-game:** colours re-resolve (observe `data-theme`/`class` on
  `<html>`); cannon/bullets/targets read resolved tokens each frame → track light/dark.
- **Tab background/resume:** rAF pause + the skip-time advance (§11) cover it — no
  cannon fling, no bullet tunnelling, no mass-escape of the on-field wave.
- **Esc mid-round:** `exitGame` returns to the pristine gate; clicking replays it.
- **Round drain:** spawning stops at 100; remaining targets age out or are shot; the
  round ends only when the field is clear (no forced unfair misses).
- **HUD overlap:** the spawn-exclusion box keeps targets clear of the counter; the
  card exclusion keeps them clear of the sign-in card.

---

## 13. Non-functional constraints

- TypeScript **strict** — no `any`, no `@ts-ignore`, no `// eslint-disable`.
- **WADS tokens** for colour/spacing/type — no hard-coded hex in DOM (engine
  `rgba()` from *resolved tokens* is the established exception).
- WADS components imported per-path (no barrel imports); theme imported once in
  `globals.css`.
- `pnpm` only; files kebab-case; functional components + hooks.
- Static export (`output: export`, `basePath` `/auth-design` in prod only).
- Accessibility / reduced-motion: **intentionally absent** (see the note at the top).

---

## 14. Acceptance criteria (verifiable checklist)

- [ ] `/login-background/final` is **visually + behaviourally unchanged** (single
      roaming anomaly, original cadence/placement; plain `CAUGHT` counter; **no**
      keyboard listeners; no card-exclusion).
- [ ] `/login-background/game` shows the same field; the bottom hint appears only
      after the first catch and hides on arming.
- [ ] Counter hidden at 0; shows `n / 5 · INSERT COIN` during the gate (number
      bounces on each catch).
- [ ] Catching **5** by click arms a fresh round (cannon rise flourish; first target
      ~0.7 s later); the box grows to the two-metric HIT / SCORE layout with a divider;
      the number **stops bouncing** while armed.
- [ ] `←/→` move (clamped, both-held cancels); `Space` tap = 1 shot, hold = repeat.
- [ ] A bullet hit and a click produce an **identical** green dissolve + verdict and
      count once.
- [ ] Threats spawn in the ring **around** the centred card — never behind it; never
      under the top-right counter; never below the cannon barrel.
- [ ] The round is exactly **100 attacks**: spawning stops at 100, the wave drains,
      then the box shows the final HIT + accuracy SCORE with **Try again** below it
      (no "round complete" text line). Try again replays a fresh round (score 0).
- [ ] `Esc` during play quits to the decorative field (counter hidden); re-clicking
      the dots replays the gate from 0 and re-arms at 5.
- [ ] Bullets and cannon are **grey**; threats red; neutralised green.
- [ ] **Sound (§9a):** gate catches chirp the coin; arming plays the power-up; each
      shot pews; each kill zaps; the round-end ceremony opens with the fanfare. `M`
      mutes/unmutes (armed + results screens) and the hint reflects the state.
- [ ] `/final`, `/tune`, and `shell-transition` are **completely silent** — no
      `AudioContext` is ever created there.
- [ ] `Space`/arrows/`Esc` never scroll the page; other keys unaffected.
- [ ] `pnpm exec tsc --noEmit`, `pnpm exec eslint`, and `pnpm build` all pass; the
      `/game` route exports.

### 14a. Verification note (important)

Live gameplay is **hard to drive in a headless/background browser**: a hidden tab
freezes `requestAnimationFrame` and throttles `setTimeout`, so the cannon won't move
and catches can't fire in an automated/preview context. Verify via
`tsc`/`eslint`/`build`, **structural DOM + computed-style checks**, and code review
of the spawn / collision / dt / `neutralize` / round / gate paths — not by scripting
motion. Manual play in a real, foregrounded browser is the final feel check.

---

## 15. Backlog & known design notes (out of current scope)

- **Full design-review backlog →** `docs/shooter-game-ideas.md` — ranked ideas to
  make it more engaging / brag-worthy: difficulty presets (Lite/Normal/Hard), a daily
  deterministic seed (identical wave for fair comparison), S/A/B/C letter grades, a
  copyable Slack result line, a false-positive (benign-traffic) mechanic, threat-type
  labels (SQLi/XSS/DDoS), a cosmetic cannon heat meter. None are implemented.
- **Known stress-test finding:** the armed round's cannon is *bypassable* — clicking
  scores (§6 NOTE), so accuracy isn't purely cannon-skill. The ideas doc proposes
  cannon-only scoring + a seed if a comparable brag metric is wanted.
- **Persistence:** scoring is **session-only** (no `localStorage`/backend) by design;
  a persistent RECORD high score is a candidate (ideas doc).
- Any "louder ARMED" celebration must stay within the gentle/premium motion bar
  (no bounce/shake/flash).

---

## 16. Reference implementation (source of truth for exact numbers)

The working prototype (all changes currently uncommitted in the working tree at the
time of writing):
- `src/components/login-background/engine.ts` — the canvas engine (all game logic,
  the tunable consts block, `neutralize`, `spawnRing`, collision, draw, the round
  state machine `startRound`/`endRound`/`exitGame`, `onStats`, `setExclusion`).
- `src/components/login-background/login-background.tsx` — the React wrapper
  (`game` + `excludeCardSize` props, `onStats` wiring, arming effect + keyboard +
  Esc + the M sound toggle, the counter/results box + hints).
- `src/components/login-background/sfx.ts` — the synthesized 8-bit SFX module
  (§9a): Web Audio square waves + noise, `MASTER_VOLUME`, the five sounds.
- `src/app/login-background/game/page.tsx` — the route (card size consts +
  `excludeCardSize`).
- `src/app/login-background/game/celebrate/page.tsx` — the UNLISTED celebration
  replay deck (five tier buttons through `engine.celebrate`); spec in
  `docs/shooter-game-celebration-handoff.md`.
- `src/app/page.tsx` — the hub card ("Easter final").
- `src/app/globals.css` — `--login-bg-*` tokens, `@font-face` (Press Start 2P),
  `hud-in` / `catch-pop` keyframes.
- `docs/shooter-game-plan.md` — the original implementation plan (architecture).
- `docs/shooter-game-ideas.md` — the parked design-review backlog (§15).

This spec and that prototype agree; where a number is ambiguous in prose, the
constant in `engine.ts` is authoritative.
