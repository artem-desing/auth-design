const PLANNED_FLOWS = [
  'Sign in',
  'Sign up',
  'Single sign-on (SSO)',
  'Multi-factor authentication (MFA)',
  'Password reset',
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-24 px-24 py-48">
      <div className="flex flex-col gap-8">
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
          Auth Flows Prototype
        </h1>
        <p className="text-[var(--color-text-secondary)]">
          Clickable prototype for exploring Wallarm authentication UI flows. Built
          on WADS — scaffold only, screens to come.
        </p>
      </div>

      <div className="flex flex-col gap-12">
        <p className="text-sm font-medium text-[var(--color-text-secondary)]">
          Planned flows
        </p>
        <ul className="flex flex-col gap-8">
          {PLANNED_FLOWS.map((flow) => (
            <li
              key={flow}
              className="rounded-lg border border-[var(--color-border-primary)] bg-[var(--color-bg-surface-1)] px-16 py-12 text-[var(--color-text-primary)]"
            >
              {flow}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
