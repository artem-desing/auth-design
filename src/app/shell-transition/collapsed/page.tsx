import { ShellTransition } from '@/components/shell-transition';
import { BackLink } from '../back-link';

/**
 * Flow 1: app boot with a collapsed (48px) rail — splash → content slot →
 * skeleton → loaded. Auto-plays on load; Replay re-runs it.
 */
export default function CollapsedBootPage() {
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <ShellTransition rail="collapsed" />
      <BackLink />
    </main>
  );
}
