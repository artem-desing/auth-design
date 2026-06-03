import { ShellTransition } from '@/components/shell-transition';
import { BackLink } from '../back-link';

/**
 * Flow 2: app boot with an expanded (184px) rail — same morph and timing as the
 * collapsed flow, docked against the wider labelled navigation.
 */
export default function ExpandedBootPage() {
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <ShellTransition rail="expanded" />
      <BackLink />
    </main>
  );
}
