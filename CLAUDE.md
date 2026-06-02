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
- **Surface tokens stack invisibly in light mode.** `surface-1/2/3/4` are all white in light theme.
  For hover-on-surface use `--color-bg-light-primary` (slate-50), not another surface token.
- **Icon set has gaps.** WADS 0.29.2 ships ~189 icons but the barrel exports fewer; common ones
  (User, Sun, Bug, Eye) may be missing/unbarreled. Inline a custom SVG when one's absent.
- **`Text` defaults to `whitespace-pre-wrap`** — pass `truncate` or `style={{whiteSpace:'nowrap'}}`
  when it sits inside a nowrap parent.
- **`<button>` centers text** — add `text-left` to any button wrapping `<Text grow>`.

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
