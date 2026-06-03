import Link from 'next/link';

interface Variant {
  href: string;
  title: string;
  route: string;
  badge?: string;
  badgeTone?: 'success' | 'info';
  description: string;
}

interface Section {
  label: string;
  blurb: string;
  variants: Variant[];
}

const SECTIONS: Section[] = [
  {
    label: 'Login background',
    blurb:
      'An animated canvas that sweeps a detection line across a field of dots — the decorative background behind the sign-in card.',
    variants: [
      {
        href: '/login-background/final',
        title: 'Final animation',
        route: '/login-background/final',
        badge: 'Final',
        badgeTone: 'success',
        description:
          'Exactly what ships behind the login form — the detection-sweep field with the chosen defaults and an empty card. No controls.',
      },
      {
        href: '/login-background/tune',
        title: 'Animation with adjustments',
        route: '/login-background/tune',
        description:
          'The same field with the full tuning panel — texture, anomaly color, intensity, tilt and the rest — plus a light/dark preview switch.',
      },
    ],
  },
  {
    label: 'Shell transition',
    blurb:
      'A white “liquid page background” that morphs its bounding box as the app boots — splash → app shell, or splash → login card → shell.',
    variants: [
      {
        href: '/shell-transition/collapsed',
        title: 'App boot — collapsed rail',
        route: '/shell-transition/collapsed',
        description:
          'The page background shrinks from the full splash screen into the app-shell content slot, then the chrome dissolves in. Left rail is the 48px icon strip.',
      },
      {
        href: '/shell-transition/expanded',
        title: 'App boot — expanded rail',
        route: '/shell-transition/expanded',
        description:
          'Same boot morph and timing, docked against the wider 184px rail with labelled navigation.',
      },
      {
        href: '/shell-transition/login',
        title: 'Login → app shell',
        route: '/shell-transition/login',
        badge: 'Sweep toggle',
        badgeTone: 'info',
        description:
          'Splash shrinks to a centered login card, then expands up into the app shell. Toggle the detection-sweep background on or off to compare the transform alone vs. transform + sweep.',
      },
    ],
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-full max-w-7xl flex-col gap-32 px-24 py-48">
      <header className="flex flex-col gap-8">
        <p className="text-sm font-semibold tracking-wide text-[var(--color-text-tertiary)] uppercase">
          Wallarm — Auth flows
        </p>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
          Prototypes
        </h1>
        <p className="max-w-2xl text-[var(--color-text-secondary)]">
          Every auth-flow animation prototype in one place. Each card opens a live,
          auto-playing demo; use “← All prototypes” inside any view to come back here.
        </p>
      </header>

      <div className="grid items-start gap-32 lg:grid-cols-2">
        {SECTIONS.map((section) => (
          <section key={section.label} className="flex flex-col gap-12">
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold tracking-wide text-[var(--color-text-tertiary)] uppercase">
                {section.label}
              </p>
              <p className="text-sm text-[var(--color-text-secondary)]">{section.blurb}</p>
            </div>

            <div className="flex flex-col gap-12">
              {section.variants.map((v) => (
                <Link
                  key={v.href}
                  href={v.href}
                  className="group flex items-center justify-between gap-16 rounded-xl border border-[var(--color-border-primary)] bg-[var(--color-bg-surface-1)] px-24 py-20 transition-colors hover:bg-[var(--color-bg-light-primary)]"
                >
                  <div className="flex flex-col gap-6">
                    <div className="flex items-center gap-12">
                      <span className="text-lg font-semibold text-[var(--color-text-primary)]">
                        {v.title}
                      </span>
                      <code className="text-xs text-[var(--color-text-tertiary)]">{v.route}</code>
                      {v.badge && (
                        <span
                          className={`rounded-full px-8 py-2 text-xs font-medium ${
                            v.badgeTone === 'info'
                              ? 'bg-[var(--color-bg-light-info)] text-[var(--color-text-info)]'
                              : 'bg-[var(--color-bg-light-success)] text-[var(--color-text-success)]'
                          }`}
                        >
                          {v.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--color-text-secondary)]">{v.description}</p>
                  </div>
                  <span
                    aria-hidden
                    className="text-xl text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-2"
                  >
                    →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
