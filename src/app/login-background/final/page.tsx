import Link from 'next/link';
import { Button } from '@wallarm-org/design-system/Button';
import { LoginBackground } from '@/components/login-background';

/**
 * The final view: exactly what ships behind the real login form — the animated
 * detection-sweep field with the shipped defaults, an empty card standing in for
 * the form, and no tuning controls. Follows the system theme automatically via
 * the theme-aware --login-bg-* tokens.
 */
export default function LoginBackgroundFinal() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[var(--login-bg-base)]">
      <LoginBackground />

      {/* Empty card — stands in for the real login form. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="pointer-events-auto h-640 w-480 rounded-xl border border-[var(--color-border-primary)] bg-white p-32 shadow-xl" />
      </div>

      {/* Back to the prototypes hub. */}
      <div className="absolute left-16 top-16 z-50">
        <Link href="/">
          <Button variant="outline" color="neutral">
            ← All prototypes
          </Button>
        </Link>
      </div>
    </main>
  );
}
