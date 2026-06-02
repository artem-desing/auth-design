'use client';

import { ThemeProvider } from '@wallarm-org/design-system/ThemeProvider';
import { useSyncExternalStore, type ReactNode } from 'react';

const noopSubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Detect whether we're running on the client. WADS `ThemeProvider` reads from
 * `localStorage` during render, which crashes SSR — so we defer mounting it
 * until hydration. `useSyncExternalStore` is the lint-safe way to flip from
 * server-snapshot (false) → client-snapshot (true) without setState-in-effect.
 */
function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, getClientSnapshot, getServerSnapshot);
}

export function Providers({ children }: { children: ReactNode }) {
  const isClient = useIsClient();

  if (!isClient) {
    return <>{children}</>;
  }

  return (
    <ThemeProvider defaultTheme="light" storageKey="auth-design-theme">
      {children}
    </ThemeProvider>
  );
}
