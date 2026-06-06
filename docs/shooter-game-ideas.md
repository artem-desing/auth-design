# Shooter game — design review & parked ideas

> Status: **parked / not built.** A backlog of engagement, challenge, geeky-flavor, and
> brag-mechanic ideas for the hidden login-background shooter, plus a stress-test of the
> current mechanics. Nothing here is implemented — it's a menu to pick from later.
>
> Produced 2026-06-06 via a multi-agent design review (map & stress-test → ideate across
> five lenses → adversarial pressure-test → synthesis). Mechanic findings were verified
> directly against `src/components/login-background/engine.ts` +
> `src/components/login-background/login-background.tsx`.
>
> Hard constraints every idea respects: **premium/gentle motion** (no bouncy/intense/overshoot),
> **hidden-easter-egg subtlety** (don't bloat a secret into a full game), **lightweight** (static
> export to GitHub Pages — no backend; `localStorage` / URL-hash are the only persistence options),
> a11y intentionally stripped. Goal: make the game more engaging, geeky/on-brand, challenging, and
> especially **brag-worthy** (coworkers comparing numbers).

---

## Stress-test of the current mechanics (verified against code)

**🔴 The cannon is optional — clicking scores during the armed round.** The pointer-catch
handler runs in every mode and a click routes through the same `recordKill` path as a bullet
(`recordKill` increments `roundKills` whenever `mode === 'armed'`, regardless of click vs. bullet;
`catchAt` / the `pointerdown` listener are never gated on `armed`). So a player can ignore
←/→/Space entirely and just **mouse-click targets** — which is strictly easier than the cannon
(instant, ~52px forgiving radius, no aiming, no bullet travel). The score-optimal strategy is to
not play the shooter at all. **This undermines the brag goal directly:** two people's "90%" aren't
comparable when one click-spammed and one aimed — the number measures mouse speed, not cannon skill.

**🟠 Accuracy clusters near the ceiling → weak spread.** Difficulty is flat (nothing escalates
across the 100 attacks), target life is a generous 4s, bullets are fast, movement is full-width,
and clicks bypass all of it. Engaged players pile up around ~85–100%, so the metric barely
separates skill — a stat where everyone scores ~90% isn't worth screenshotting.

**🟡 No stakes.** No lives, no fail state, no escalation — the 100-attack cap is the only
structure. Fine for a chill easter egg; just means the only tension is the final number.

## Current assessment

Mechanically clean and smooth — pleasant turnover-based difficulty, no jank. But **engagement is
flat**: a context-free `%` with no way to compare ("Was that Hard? Same wave as me?"). The single
biggest gap is **labeled, comparable scoring**.

---

## Suggestions (ranked)

Effort tags: **S** ≈ small, **M** ≈ medium, **L** ≈ large.

### Foundational decision — make armed scoring cannon-only · S
Surfaced by the stress-test, not the idea agents. Everything below only means something if the
score measures a consistent skill. Cheapest fix: `catchAt` no-ops while `armed`, so clicks still
arm the gate but the *round* is pure cannon. Without this, presets/seeds/grades all measure "who
clicked faster." **Highest-leverage change for bragging.** (Design call: dual input may be
intentional flavor — but for a comparable brag number, the round should be one skill.)

### Tier 1 — the brag engine (cohesive package; do together)
1. **Daily deterministic seed · M** — hash the date → everyone plays the *identical* 100-threat
   wave that day. Turns "87%" into a real head-to-head benchmark with zero backend (seed a small
   PRNG e.g. LCG, restore `Math.random` after the round). A leaderboard-in-a-box; re-seeds daily,
   zero maintenance. Show the seed/date on the results card so players know they're on the same wave.
2. **Difficulty presets — Lite / Normal / Hard · M** — three pre-round toggles, pure const swaps
   (spawn rate + life), e.g. Lite 0.70s/4.5s · Normal 0.55s/4.0s (current) · Hard 0.40s/3.5s.
   Results show `Hard · 87%` so scale is unambiguous. Also directly widens the score spread (fixes
   the clustering finding). Tune Lite so all 100 still spawn before timeout; tune the gaps so they
   feel earned, not punishing.
3. **Letter grades S/A/B/C · S** — accuracy `%` → arcade grade. "I got an S" compares faster than a
   number and is screenshot-bait. Pure lookup table; render as a 4th HUD line or a gentle
   drift-up on round-end (reuse the existing easeOut fade). **Tune thresholds to the *actual*
   spread** after the cannon-only + difficulty fixes (else grades become participation trophies);
   a tighter set like S≥90 / A≥75 / B≥55 is a starting point.
4. **Copyable result one-liner · S** — at round end, a "Copy result" button →
   `Daily Hard · A · 87% · 87/100` to the clipboard (`navigator.clipboard`, textarea fallback,
   brief no-bounce toast). Removes the screenshot friction for Slack bragging. (Clipboard API needs
   HTTPS or localhost.)

### Tier 2 — on-brand WAF flavor (strongest pure-engagement adds)
5. **False-positive mechanic · M** — ~20–25% of spawns are *benign/legit traffic* (distinct hue +
   faint border + `LEGIT` label) you must **not** shoot; a false positive hurts the score
   (e.g. `accuracy = stopped_hostile / (stopped_hostile + escaped_hostile + falsePositives·2)`).
   The most on-theme idea by far — turns "shoot everything" into *threat triage*, exactly what a
   WAF does, and adds a real per-target decision. "94%, zero false positives" is a genuine flex.
   Clarity is the risk: gate hint ("Avoid false positives") + clearly distinct visuals so benign ≠ dead.
6. **Threat-type labels · S** — name anomalies (SQLi, XSS, CSRF, DDoS, Bot, CVE-…, ReconScan) via a
   `type` field rolled at spawn; draw a 2–3 char mono label on the target or only on the caught
   verdict. Near-zero cost, big flavor: "blocked 14 DDoS, 6 SQLi" is a knowledge-flex. Pairs with #5.

### Tier 3 — gentle polish
7. **Cannon heat meter · S** — a thin ~2px bar that color-lerps grey → pale-yellow → amber as you
   fire continuously, cools when idle, **no mechanical penalty** (purely visual pacing feedback).
   Stays within the motion bar (smooth lerp, no bounce/shake). Keep the palette muted so "heat"
   doesn't read as "alarm/danger."

---

## Skip (considered, not worth it)

- **Session-only streak counter** — resets on reload → not comparable; busywork without persistence.
- **Cannon-only / click-only mode toggle** — fold the cannon-only into *scoring* instead; a toggle
  dilutes the cannon fantasy and a hybrid mode makes cohorts non-comparable anyway.
- **Silent / auto-escalating spawn rate** — invisible variance reads as unfair; contradicts the
  "difficulty from turnover, not escalation" design and gives no brag signal.
- **Hidden combos / precision windows / evasive spawning** — invisible mechanics break score
  comparability and add cognitive load with no visible payoff.
- **Ammo scarcity / reload** — punishing, off-model vs. the turnover design, hard to tune.
- **Threat rarity tiers (1-hit / 2-hit / chasing)** — comparability + state-mutation complexity;
  pairs poorly with seeded waves unless tier distribution is also seeded.
- **Threat-feed ticker / terminal report endgame** — visual noise during play; the report only pays
  off if threat-type data exists first. Defer.

Common thread: hidden or punishing mechanics add confusion and **break the comparability that
bragging needs.**

---

## Verdict

Doing nothing is fine — it's a pleasant hidden toy. But the stated goal (coworkers comparing
numbers) is currently undercut by two things: the **click-bypass makes the number dishonest**, and
the **flat difficulty makes it un-spread**. The highest-value, lowest-effort move is the pair
**cannon-only scoring + daily seed** — that alone makes "today's wave, 87%" a *real, comparable*
flex. Layer **grades + copy** for legibility/shareability, and the **false-positive mechanic** is
the one idea worth pushing for pure on-brand fun/depth. Everything else is optional polish.

Suggested first slice if/when picked up: **cannon-only scoring + daily seed + letter grade** (small,
high-leverage, makes the brag real).
