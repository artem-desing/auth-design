'use client';

import { useState } from 'react';
import { Button } from '@wallarm-org/design-system/Button';
import { ShellTransition } from '@/components/shell-transition';
import { BackLink } from '../back-link';

/**
 * Flow 3: login → app shell. Splash shrinks to a centered login card, then
 * expands up into the app shell (expanded rail). The sweep toggle switches the
 * detection-sweep field behind the card on/off — re-keying ShellTransition so
 * the animation replays and the difference is visible immediately.
 */
export default function LoginFlowPage() {
  const [sweep, setSweep] = useState(true);

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <ShellTransition key={sweep ? 'sweep' : 'plain'} flow="login" sweep={sweep} />

      <div className="absolute top-48 left-1/2 z-50 flex -translate-x-1/2 items-center gap-8 rounded-md border border-[var(--color-border-primary)] bg-[var(--color-bg-surface-1)]/90 px-12 py-8 shadow-sm backdrop-blur">
        <span className="text-sm text-[var(--color-text-secondary)]">Sweep background</span>
        <div className="flex items-center gap-4">
          <Button
            size="small"
            variant={sweep ? 'ghost' : 'primary'}
            color={sweep ? 'neutral' : 'brand'}
            onClick={() => setSweep(false)}
          >
            Off
          </Button>
          <Button
            size="small"
            variant={sweep ? 'primary' : 'ghost'}
            color={sweep ? 'brand' : 'neutral'}
            onClick={() => setSweep(true)}
          >
            On
          </Button>
        </div>
      </div>

      <BackLink />
    </main>
  );
}
