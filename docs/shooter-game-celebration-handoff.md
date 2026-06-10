# Round-end celebration ("happy ending") — engineering handoff spec

**Audience:** the front-end engineer productionising the login-background shooter.
**Status:** implemented in the reference prototype; this document is the behavioural +
visual contract for the celebration layer. It **amends** `docs/shooter-game-handoff.md`
(the base game spec) — where the two disagree, this newer document wins; where a number
is ambiguous in prose, the constant in `engine.ts` is authoritative.
**Stack context:** same as the base spec (Next.js 16 · React 19 · TS strict · Tailwind v4
+ WADS, 1px `--spacing` · pnpm · static export). Accessibility / reduced-motion remain
**intentionally absent** (see the base spec's status note).

---

## 1. Summary

When a 100-attack round ends, a **tiered ceremony** plays on the field, scaled to the
final accuracy grade — then **settles into a persistent end state** (the printed score +
headline stay on stage) until the player dismisses it. The design language is the game's
own: halftone squares, the grey/red/green colour rule, the detection sweep, Press Start 2P.
Three rules govern everything:

1. **Grid-aligned 8-bit:** every particle (confetti, firework shards, thruster exhaust,
   rocket slugs) moves continuously but **renders snapped to the dot grid**, with
   quarter-stepped alpha fades — quantized like a DOS-era sprite, never smooth.
2. **The sweep prints the score:** the headline payoff. The final score renders as giant
   5×7 dot-matrix digits mapped onto the live dot grid, revealed column-by-column by a
   ceremonial sweep — the game's detection move becomes the scoreboard.
3. **Premium motion:** ease-out drifts and dissolves everywhere; the blast-off is an
   ease-in launch. No shake, no flash, no overshoot.

A dedicated **unlisted demo route** can replay every tier on demand through the exact
same code path the real round ends through (§8).

---

## 2. The tier ladder (locked)

Tier derives from the final accuracy (`tierForScore` in `engine.ts`):

| Score | Tier | Headline · subline | The show |
|---|---|---|---|
| < 20 | 0 | — | **Nothing.** Plain results immediately (deliberate). |
| 20–34 | 1 | `THREAT CONTAINED` · "well done — share it with your mates" | A radial green **all-clear bloom** ripples through the dots from bottom-center. |
| 35–59 | 2 | `PERIMETER HELD` · "you nailed it" | The cannon fires **3 firework rockets** into the clear zones around the card → green/grey bursts; **score print**; **32** confetti. |
| 60–89 | 2 | same | **The identical show with more confetti (56)** — `confetti2Count` is the ONLY difference between the two bands. |
| 90–99 | 3 | `ZERO BREACH` · "you rock — worth a screenshot" | **Blast-off:** full-field wave → the cannon lifts off on a pixel thruster (ease-in, passes behind the card, stays gone until the next round) → score print; two confetti volleys (**60** at 1.7s + **40** at 2.6s). |
| 100 | 4 | `AIRTIGHT — 100%` · "flawless · the field salutes you" | **The secret storm** (never hinted anywhere): blast-off + **80**-piece opening burst + dense confetti **rain** (`CEL_RAIN_RATE` 360/s for e ∈ 2.0–4.6) + a **rainbow wave** rolling through the field itself (e ∈ 3.0–4.6). |

Confetti escalation across tiers is deliberate (each step visibly more than the one
below). Rainbow colour is reserved for tiers 3–4; tier 3 gets it only in its confetti,
tier 4 also in the field wave.

---

## 3. Lifecycle: active show → settled → dismissed

- `endRound()` computes the grade (`faced > 0 ? round(stopped/faced·100) : 100`) and
  calls `startCelebration(score)` **before** `emitStats()`. Tier 0 sets no ceremony.
- The **active show** runs for `CEL_DUR[tier]` seconds — 2.6 / 3.8 / 4.0 / 5.2 for tiers
  1/2/3/4. While active, `GameStats.celebrating === true` and the wrapper **hides
  Try-again**.
- At `CEL_DUR` the ceremony **settles** (`cel.settled = true`, one `emitStats`):
  `celebrating` flips false → Try-again fades in — but the stage does **not** clear. The
  printed digits stay green, the headline stays up, leftover confetti drains naturally.
- **Dismissal** (the only ways the stage clears):
  - **Try-again** → `startRound()` (fresh round; clears `cel` + `cannonAway`).
  - **Esc** → `exitGame()` (full reset to the decorative gate). The wrapper attaches an
    **Esc-only keydown on the results/ceremony screen** (the `roundOver` branch of the
    arming effect returns its own cleanup), so Esc works during the active show AND the
    settled state — not just during play.
  - On the demo route, pressing another tier button replaces the ceremony.
- A real `setMode` transition, `startRound`, and `exitGame` all clear `cel` and
  `cannonAway` — a ceremony can never leak across modes or rounds.

### Engine API additions
```ts
celebrate(score: number): void  // public replay hook — the demo route's only entry.
// Guards: halftone texture + running loop only; score <20 plays nothing.
// On the idle field it re-seeds armT so the cannon rises in to perform.
// endRound() drives the same startCelebration path with the real grade.
```
`GameStats` gained `celebrating: boolean` — true only during the ACTIVE show (false once
settled, so Try-again gating follows it directly).

The wrapper gained an `onEngineReady?: (api: { celebrate(score) }) => void` prop —
called once on mount; the demo route's only hook. Leave unset elsewhere.

---

## 4. The score print (sweep-printed digits)

- Glyphs: 5×7 dot-matrix bitmaps (`CEL_GLYPHS`, digits `0–9` + `%`), one bit per **grid
  dot**. The string is `` `${round(score)}%` ``; block width = `(len·6 − 1) · gridSp`
  columns (5 per glyph + 1 gap), height = `7 · gridSp`.
- **Grid addressing:** `gridArr` now returns `{ dots, cols, sp }`; the engine keeps
  `gridCols`/`gridSp` fresh on resize + spacing changes. A glyph cell maps to dot index
  `idx = (startRow + row) · gridCols + (startCol + gc)` with bounds guards (col within
  `[0, gridCols)`, row ≥ 0, `idx < dots.length`). NOTE: `gridSp` can exceed the
  configured spacing on very large viewports (the 20 000-dot cap) — all math uses the
  actual `gridSp`, never the option value.
- **Placement ladder** (computed against the live `w,h` + the card exclusion box):
  1. **Strip above the centered card** when `cardTop ≥ blockH + 8`, vertically centered
     in the strip. The margin is deliberately slim: at 1440×900 the strip above the
     640px card is exactly **130px** vs a **112px** block (spacing 16) — a fatter margin
     wrongly rejects the strip on the most common laptop class.
  2. Else the **left gutter**, vertically centered, when `cardLeft ≥ blockW + 32`
     (1366×768 lands here).
  3. Else **skip the print** — the ceremony plays without it.
  Without an exclusion box (demo always passes one; defensive default), the block sits
  at `topY = max(gridSp, 0.16h)`, horizontally centered.
- **Reveal:** each glyph column has `rel = gc / totCols`; its dots bloom at
  `revealT = cel.t0 + CEL_SWEEP_START(1.6) + rel · CEL_SWEEP_DUR(1.2)` with a 0.35s
  ease-out pop to full caught-green, and **stay lit** through the settled state. A soft
  grey sweep column (gaussian σ≈30px, boost 0.3) crosses the block left→right during
  the reveal window — the ceremonial scan line.

---

## 5. Field effects (drawn inside the existing 20k-dot pass)

All loop-invariants are hoisted into a pre-pass; when `cel === null` the added per-dot
cost is ~one branch (the `/final` hot path is unchanged — see §9).

| Effect | Tier | Window | Math |
|---|---|---|---|
| All-clear wave | 1 | e < 2.4 | radius `easeOut(min(e/1.5,1)) · hypot(w/2,h) · 0.9`, gaussian band 2σ²=4608 (σ=48px), strength `0.95·(1−clamp((e−1.4)/1))`, origin `(w/2, h−30)` |
| Blast-off wave | 3–4 | e < 1.6 | radius `easeOut(min(e/0.9,1)) · hypot(w/2,h)`, 2σ²=5408 (σ=52px), strength `0.9·(1−clamp((e−0.8)/0.8))` |
| Burst pulses | 2 | 0.6s each | radius `easeOut(pe/0.6)·70`, 2σ²=1152 (σ=24px), strength `0.9·(1−pe/0.6)` — one per firework burst |
| Sweep column | 2–4 | reveal window | grey boost `exp(−dx²/1800)·0.3` |
| Rainbow wave | 4 | 3.0 < e < 4.6 | `q = sin(((e−3)/1.6)·π)·0.5`; palette index `floor(x·0.03 + y·0.02 + e·3) mod 7` — a plasma-style hue drift across the field |

Per-dot composition: the effects produce `celG` (colour mix toward a target) +
`celBoost` (size/alpha lift) + `celCol` (caught-green by default; the rainbow overrides;
digits force caught-green). A live red anomaly still wins the pixel. Celebration dots
render at **full strength** (ignore `intensity`), alpha `min(1, 0.15 + effVal·0.85)`
where `effVal = min(1, val + celBoost)` also drives the square sizing. The ambient/dim
early-`continue` is `val < 0.05 && celBoost < 0.02` — reduces exactly to the original
`val < 0.05` when no ceremony runs.

---

## 6. Particles & overlay drawing

- **One particle type** (`CelParticle`): position/velocity in continuous px, but
  **rendered at** `snap(v) = gridSp/2 + round((v − gridSp/2)/gridSp) · gridSp` on both
  axes — squares only ever appear on grid cells. Alpha is quarter-stepped:
  `ceil(a·4)/4`. Hard cap `CEL_MAX_PARTICLES = 900` (spawn calls bail beyond it).
- **Confetti** (`conf: true`): born at a random grid column, `y = −8 − rand·spread`,
  `vx ∈ ±15`, `vy ∈ 110–240` px/s, no drag/gravity (steady 8-bit fall), half 4px,
  colour from `CEL_PAL` — a fixed 7-colour retro palette (red/amber/green/cyan/blue/
  purple/pink). `CEL_PAL` is the **one deliberate exception** to token-driven colour,
  and rainbow paper is exclusive to tiers 3–4 (tier 2's drop uses the same palette —
  the escalation is in volume). Culled below `h + 12` or at `life 7s`.
- **Firework shards** (16 per burst): random direction, speed 80–200 px/s, drag
  `e^(−2.5·dt)`, gravity +30 px/s², life 0.9–1.3s, half 4px, **70% caught-green / 30%
  dot-grey** (theme tokens — bursts stay on-theme).
- **Rockets** (tier 2, three): launch from `(cannonX, h−40)` staggered 0.4s, fly an
  ease-out arc over 0.6s to targets in the clear zones — left gutter center and right
  gutter center at `0.42h`, plus top strip at `(w/2, max(40, cardTop·0.45))` — clamped
  to `[SPAWN_EDGE, w−SPAWN_EDGE]`. While flying: an 8×8 snapped slug + 1 trail
  particle/frame (grey, life 0.3s, half 3). At the apex: burst + field pulse.
- **Thruster exhaust** (tiers 3–4): while `0 < rise < 1`, 3 particles/frame at
  `(cannonX ± 5, h − 22 − rise·(h+120))`, downward `vy 80–160`, life 0.45s, half 3,
  50/50 green/grey.
- **Cannon liftoff:** `lift = easeIn(clamp01((t − cel.t0 − CEL_LIFT_AT(0.5)) /
  CEL_LIFT_DUR(1.2))) · (h + 120)` subtracted from the cannon's baseY; skip drawing
  below `baseY < −40`. `cannonAway` latches once `e > 1.7` and keeps the cannon gone
  (even after the ceremony is dismissed-by-Try-again it's re-seeded by `startRound`).
  On the demo's idle field the cannon **rises in** (`armT` re-seed) to perform.
- **Headline:** Press Start 2P **13px** (the verdicts' face, `LABEL_FONT`), caught-green
  with the same hard 1px black offset shadow as the verdicts; subline Geist Mono **11px**
  dot-grey at 0.85 alpha, 24px below. Centered at
  `y = cardBottom + (h − CANNON_CLEAR − cardBottom) · 0.45` — the strip below the card.
  Fades in at `CEL_LABEL_AT[tier]` (0.7 / 2.8 / 2.4 / 2.6 s) with a 10px ease-out rise
  over 0.5s; stays through the settled state.

Draw order per frame: field (with celebration dot effects) → cannon → bullets (armed
only) → celebration overlay (rockets, particles, headline) → green dissolves.

---

## 7. Wiring & state safety

- `frame()` runs `stepCelebration(t, dt)` before `drawHalftone`; the cannon draws when
  `armed || over || cel` (the demo's idle field has no cannon unless performing).
- **Tab-hide / pause safety:** the existing skip-time advance now also moves `cel.t0`,
  every rocket `t0`, and every pulse `t0` by the skipped interval. Particle ages are
  dt-integrated and digit reveal times derive from `cel.t0`, so nothing fast-forwards,
  expires, or mass-dumps after a resume. `renderStatic` remains save/restore-safe.
- **Scoring is read-only:** the ceremony consumes the grade; it never touches
  `killTotal` / round counters. The demo's `celebrate()` emits stats with `kills = 0`,
  which keeps the HUD hidden there (`caught === 0`) and `roundOver` false.
- Idle spawns are suppressed while a ceremony plays (`!cel`) so the demo's stage stays
  clean; `/final` never has a `cel`, so its idle behaviour is untouched.
- The wrapper's exclusion guard is now **size-only** (`excludeCardSize` present → set),
  so the demo gets card-aware geometry without `game`. `/final` and `shell-transition`
  pass nothing — unchanged.

---

## 8. The demo route (the replay deck)

`/login-background/game/celebrate` — **UNLISTED** (no hub card; the top tiers are a
secret the game keeps). Purpose: replay any tier on demand for design review and QA —
a flawless 100% run might take fifty real rounds; this takes one click.

- `'use client'`; renders `<LoginBackground excludeCardSize={{480, 640}}
  onEngineReady={setApi} />` + the same centered card mock as `/game` (local
  `CARD_W/CARD_H` consts, kept in sync with the rendered card).
- Five WADS outline buttons, bottom-**left** (the bottom-center stage belongs to the
  cannon): `20–34 · Contained` → `celebrate(28)`, `35–59 · Fireworks` → `45`,
  `60–89 · Fireworks+` → `78`, `90–99 · Blast-off` → `94`, `100 · Airtight` → `100`.
- No `game` prop → no gate/HUD/keyboard; click-to-catch still works (harmless).
  Ceremonies persist until another button replaces them.

---

## 9. Performance requirements

- Still **one** rAF loop; the ceremony adds zero work when `cel === null` beyond one
  branch in the dot pass (all wave/sweep/rainbow params are hoisted to a pre-pass).
- Particles are bounded (`CEL_MAX_PARTICLES` 900), advanced and culled **in place**;
  pulses pruned in place. The only per-frame allocations while a ceremony runs are the
  fill-style strings and the (tiny) snap closure — confined to ceremony frames.
- The digit `Map.get(i)` lookup runs per dot only while a ceremony with a score print
  is live; sub-millisecond at 20k dots.
- The 100% storm at full rain stays well under the particle cap (~360/s spawn vs ~2–4s
  fall time, capped at 900).

---

## 10. Acceptance criteria (verifiable checklist)

- [ ] Finish a round at each band (or use the demo): <20 → plain results, no ceremony;
      20–34 → bloom + headline; 35–59 → fireworks + score print + 32 confetti;
      60–89 → identical + 56 confetti; 90–99 → blast-off + 60/40 volleys;
      100 → storm + rainbow field wave.
- [ ] The score digits are revealed left→right by a visible sweep column, are made of
      grid dots (snap with the field), and **stay green** after the show settles.
- [ ] Every particle lands on grid cells (no smooth sub-pixel motion on screen) and
      fades in visible steps.
- [ ] The headline uses the verdicts' pixel font, the subline mono; both persist until
      dismissal. No word "flex" anywhere.
- [ ] Try-again appears only after the active show settles; clicking it starts a fresh
      round with the cannon back.
- [ ] **Esc works on the results/ceremony screen** (active or settled) and fully resets
      to the decorative gate; Esc during play still works as before.
- [ ] After a blast-off, the cannon does NOT pop back under the results; it returns on
      the next round.
- [ ] Background the tab mid-ceremony, return: the show resumes where it was (no
      fast-forward, no vanished ceremony).
- [ ] At 1440×900 and 1920×1080 the score prints in the strip ABOVE the card; at
      1366×768 it prints in the left gutter; tiny viewports skip it gracefully.
- [ ] `/final`, `/tune`, and `shell-transition` are visually + behaviourally unchanged.
- [ ] The demo route replays all five bands repeatedly; switching tiers mid-show is
      clean (cannon returns for non-blast-off tiers).
- [ ] `pnpm exec tsc --noEmit`, `pnpm exec eslint`, `pnpm build` pass; the
      `/login-background/game/celebrate` route exports.

### Verification note
Same constraint as the base spec (§14a there): the engine is rAF-driven, so a hidden/
headless tab freezes everything — verify via tsc/eslint/build, code review of the
ceremony paths, and **manual play in a real foregrounded browser**. The demo route
exists precisely to make that manual pass a one-click affair per tier.

---

## 11. Reference implementation

- `src/components/login-background/engine.ts` — everything under the
  "Round-end celebration" banner: tunables (`CEL_*`), `tierForScore`,
  `buildScoreCells`, `startCelebration`, `celConfetti`, `celBurst`,
  `stepCelebration`, `drawCelebration`, the public `celebrate`, the drawHalftone
  celebration pre-pass + per-dot block, the `drawCannon` liftoff, the skip-time
  additions, and the `cel`/`cannonAway` lifecycle in
  `setMode`/`startRound`/`exitGame`/`endRound`.
- `src/components/login-background/login-background.tsx` — `onEngineReady` prop,
  `GameStats.celebrating` gating on Try-again, the Esc-only results-screen listener,
  the size-only exclusion guard.
- `src/app/login-background/game/celebrate/page.tsx` — the unlisted demo route.
- `docs/shooter-game-handoff.md` — the base game spec this document amends.

This spec and the prototype agree; where prose is ambiguous, `engine.ts` is
authoritative.
