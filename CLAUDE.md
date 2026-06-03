@AGENTS.md

# Auth Flows Prototype — Claude Code operating manual

## Project at a glance

Clickable Next.js prototype for exploring Wallarm authentication UI flows (sign in,
sign up, SSO, MFA, password reset). Sibling to the `global-navigation-prototype` —
same stack and WADS chassis, different surface. Discussion artifact, not production.

Owner: Artem Miskevich (Head of Design, `amiskevich@wallarm.com`).

## Stack

- Next.js 16 (App Router) + Turbopack
- React 19 + TypeScript strict
- Tailwind CSS v4 (tokens come from WADS — do not redefine)
- `@wallarm-org/design-system@0.29.2` (WADS) plus peers: `tw-animate-css`, `non.geist`, `@internationalized/date`
- `pnpm` only — never npm or yarn
- Deploys as a static export to GitHub Pages (`output: export`, basePath `/auth-design`)

## WADS imports

Each component from its own path. NO barrel imports:

```ts
import { Button } from '@wallarm-org/design-system/Button';
import { TextField } from '@wallarm-org/design-system/TextField';
import { Eye, Search } from '@wallarm-org/design-system/icons';
```

Theme is imported once in `src/app/globals.css`. Don't duplicate token imports elsewhere.
Build auth chrome from WADS primitives, not raw Tailwind utility classes. Stay on stable
WADS (no `-rc`) unless Artem confirms.

## WADS gotchas (carried over from the nav prototype — these cost real time)

- **Spacing is 1px-based.** WADS overrides Tailwind's `--spacing` to 1px, so every spacing
  utility means N **px**, not 4×N. Use `w-80` (not `w-20`), `gap-4` (not `gap-1`), `px-16` for 16px.
- **`max-w-<number>` rides the 1px spacing scale too** — `max-w-160` is **160px**, not a wide
  container, which silently crushes page layouts into a thin strip (bit us twice). For page/content
  width use the rem-based named scale (`max-w-2xl`, `max-w-3xl`, …), which the `--spacing` override
  doesn't touch. Same caution applies to `min-w-*` / `w-*` when you mean a container, not a fixed px box.
- **Surface tokens stack invisibly in light mode.** `surface-1/2/3/4` are all white in light theme.
  For hover-on-surface use `--color-bg-light-primary` (slate-50), not another surface token.
- **Icon set has gaps.** WADS 0.29.2 ships ~189 icons but the barrel exports fewer; common ones
  (User, Sun, Bug, Eye) may be missing/unbarreled. Inline a custom SVG when one's absent.
- **`Text` defaults to `whitespace-pre-wrap`** — pass `truncate` or `style={{whiteSpace:'nowrap'}}`
  when it sits inside a nowrap parent.
- **`<button>` centers text** — add `text-left` to any button wrapping `<Text grow>`.

## Surfaces built so far

### Login background (`src/components/login-background/` + `src/app/login-background/`)

Decorative animated "detection sweep" field for the auth screen — a canvas engine that
sweeps a (tilted) line L→R; ground dots bloom as it passes and rare anomalies latch in an
accent color (the "caught" moment). Two textures: `clean` (plain dots, **no visible scan
line** — the sweep reads only through dot bloom) and `halftone` (8-bit, variable dot size).

- `engine.ts` — framework-agnostic canvas engine. DPR-aware, single rAF loop, runtime
  CSS-var color resolution, `prefers-reduced-motion` freeze, visibility pause. `DEFAULTS`
  per texture (halftone baked at spacing 16 / bloomRadius 80 / maxDotSize 20).
- `login-background.tsx` — React wrapper. Resolves prop defaults, mirrors live tunables via
  a JSON signature, re-resolves colors on theme flip via a `MutationObserver` on `<html>`.
  Renders only the field (`aria-hidden`, never in tab order, no pointer events).
- Colors come from **dedicated theme-aware tokens** in `globals.css` (`--login-bg-base`/
  `-dot`/`-accent`/`-sweep`), each defined in terms of WADS palette tokens so the field tracks
  light/dark automatically. `getComputedStyle().getPropertyValue()` resolves `var()` chains to
  a final hex, so the engine reads them cleanly. (`--login-bg-sweep` is currently unused since
  the clean scan line was removed — dormant, kept for now.)

Routes (the prototype's Storybook substitute):
- `/login-background` — picker "super page" (two cards, mirrors nav prototype's "Pick a variant").
- `/login-background/final` — clean ship-ready frame: animation + empty card, no controls,
  follows system theme via the shipped component defaults.
- `/login-background/tune` — full tuning panel (texture, accent, sliders, tilt, light/dark
  preview switch). Each variant view has a "← All variants" link back to the picker.

## Deployment

- **Live:** https://artem-desing.github.io/auth-design/ — repo `artem-desing/auth-design` (public).
- `.github/workflows/deploy-pages.yml` builds the static export and deploys on **push to `main`**
  (Pages source = GitHub Actions). The local branch is `main`; pushing redeploys.
- Pushing the source tree to this external public repo is gated by the auto-mode safety
  classifier — Artem ran the initial `gh repo create … --push` himself (or grant a `Bash(git push:*)`
  allow-rule). Don't expect the push to go through silently.
- Workflow actions still pin Node 20 (GitHub deprecation: forced to Node 24 on 2026-06-16) — bump
  action versions when convenient.

## Conventions

- TypeScript strict — no `any`, no `@ts-ignore`, no `// eslint-disable`
- File naming kebab-case; components PascalCase; functional components + hooks only
- WADS theme variables for color/spacing/typography — no hardcoded hex
- Mock data only — no real API integration, no real auth

## What not to do

- Don't commit secrets, real credentials, or real customer data
- Don't add a second package manager (pnpm only)
- Don't update WADS to a `-rc` version without Artem's confirmation
- Don't auto-commit or push — leave changes in the working tree unless Artem asks
