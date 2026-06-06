import Link from 'next/link';
import { Button } from '@wallarm-org/design-system/Button';
import { LoginBackground } from '@/components/login-background';

/**
 * "Final + game": the shipped detection-sweep field plus the hidden shooter.
 * Same frame as `/login-background/final`, but with `game` on — click the red
 * anomalies, catch 5 to arm a pixel cannon, then ←/→ + Space to blast them.
 * `/final` stays a pure field; the game lives only here.
 */
// Single source of truth for the sign-in card's size (CSS px). Shared by the
// engine's no-spawn box and the card element below, so the shooter's exclusion
// zone can never drift out of sync with the rendered card (a threat spawning
// behind the opaque card would silently tank the accuracy grade).
const CARD_W = 480;
const CARD_H = 640;

export default function LoginBackgroundGame() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[var(--login-bg-base)]">
      {/* Threats spawn in the ring around the card, never behind it — see CARD_W/H. */}
      <LoginBackground game excludeCardSize={{ width: CARD_W, height: CARD_H }} />

      {/* Empty card — stands in for the real login form. Click-transparent so
          gate-phase clicks still reach the field underneath. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="rounded-xl border border-[var(--color-border-primary)] bg-white p-32 shadow-xl"
          style={{ width: CARD_W, height: CARD_H }}
        />
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
