import Link from 'next/link';
import { Button } from '@wallarm-org/design-system/Button';
import { LoginBackground } from '@/components/login-background';

/**
 * "Final + game": the shipped detection-sweep field plus the hidden shooter.
 * Same frame as `/login-background/final`, but with `game` on — click the red
 * anomalies, catch 5 to arm a pixel cannon, then ←/→ + Space to blast them.
 * `/final` stays a pure field; the game lives only here.
 */
export default function LoginBackgroundGame() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[var(--login-bg-base)]">
      <LoginBackground game />

      {/* Empty card — stands in for the real login form. Click-transparent here
          so gate-phase clicks reach the field underneath (you catch anomalies
          across the whole screen, including behind the card). */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-640 w-480 rounded-xl border border-[var(--color-border-primary)] bg-white p-32 shadow-xl" />
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
