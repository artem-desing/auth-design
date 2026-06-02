import Link from 'next/link';

interface Variant {
  href: string;
  title: string;
  route: string;
  badge?: string;
  description: string;
}

const VARIANTS: Variant[] = [
  {
    href: '/login-background/final',
    title: 'Final animation',
    route: '/final',
    badge: 'Final',
    description:
      'Exactly what ships behind the login form — the animated detection-sweep field with the chosen defaults and an empty card. No controls.',
  },
  {
    href: '/login-background/tune',
    title: 'Animation with adjustments',
    route: '/tune',
    description:
      'The same field with the full tuning panel — texture, anomaly color, intensity, tilt and the rest — plus a light/dark preview switch.',
  },
];

export default function LoginBackgroundPicker() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-24 px-24 py-48">
      <div className="flex flex-col gap-8">
        <p className="text-sm font-semibold tracking-wide text-[var(--color-text-tertiary)] uppercase">
          Wallarm — Login background
        </p>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
          Pick a variant
        </h1>
        <p className="text-[var(--color-text-secondary)]">
          Both cards render the same animated detection-sweep field. The final view
          is the clean, ship-ready frame; the adjustments view exposes every knob so
          the look can be tuned. Use “← All variants” inside either view to come back here.
        </p>
      </div>

      <div className="flex flex-col gap-16">
        {VARIANTS.map((v) => (
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
                  <span className="rounded-full bg-[var(--color-bg-light-success)] px-8 py-2 text-xs font-medium text-[var(--color-text-success)]">
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
    </main>
  );
}
