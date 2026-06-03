import Link from 'next/link';

/** "← All prototypes" pill, parked bottom-left over the animation, clear of chrome. */
export function BackLink() {
  return (
    <Link
      href="/"
      className="absolute bottom-16 left-16 z-50 rounded-md border border-[var(--color-border-primary)] bg-[var(--color-bg-surface-1)]/90 px-12 py-6 text-sm text-[var(--color-text-secondary)] backdrop-blur transition-colors hover:bg-[var(--color-bg-light-primary)]"
    >
      ← All prototypes
    </Link>
  );
}
