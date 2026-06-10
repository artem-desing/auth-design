'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@wallarm-org/design-system/Button';
import { LoginBackground } from '@/components/login-background';

/**
 * UNLISTED celebration demo — the replay deck for the shooter's round-end
 * ceremonies. Same field, same engine, same centered card as
 * `/login-background/game`; the four buttons call `engine.celebrate(score)`,
 * the exact path a real round ends through, so every tier can be replayed on
 * demand without grinding a 100-attack round (a flawless 100% run might take
 * fifty tries — this page takes one click). Deliberately NOT linked from the
 * hub: the top tiers are a secret the game keeps; this URL is for design
 * review and the engineering handoff.
 */
// Single source of truth for the sign-in card's size (CSS px) — mirrors the
// /game route so the celebration composes around the identical card geometry.
const CARD_W = 480;
const CARD_H = 640;

export default function CelebrationDemo() {
  const [api, setApi] = useState<{ celebrate: (score: number) => void } | null>(null);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[var(--login-bg-base)]">
      <LoginBackground
        excludeCardSize={{ width: CARD_W, height: CARD_H }}
        onEngineReady={setApi}
      />

      {/* Empty card — the same stand-in as /game, so placement (score print in
          the strip above, headline below) reads exactly as it will in the game. */}
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

      {/* The replay deck — one button per tier of the locked ladder. Parked in
          the bottom-left corner so it never sits on the cannon's center stage. */}
      <div className="absolute bottom-16 left-16 z-50 flex flex-wrap gap-8">
        <Button variant="outline" color="neutral" onClick={() => api?.celebrate(28)}>
          20–34 · Contained
        </Button>
        <Button variant="outline" color="neutral" onClick={() => api?.celebrate(45)}>
          35–59 · Fireworks
        </Button>
        <Button variant="outline" color="neutral" onClick={() => api?.celebrate(78)}>
          60–89 · Fireworks+
        </Button>
        <Button variant="outline" color="neutral" onClick={() => api?.celebrate(94)}>
          90–99 · Blast-off
        </Button>
        <Button variant="outline" color="neutral" onClick={() => api?.celebrate(100)}>
          100 · Airtight
        </Button>
      </div>
    </main>
  );
}
