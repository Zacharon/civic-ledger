'use client';

import {
  createContext,
  type ReactNode,
  type TransitionStartFunction,
  use,
  useTransition,
} from 'react';

interface ExploreTransition {
  isPending: boolean;
  startTransition: TransitionStartFunction;
}

const Context = createContext<ExploreTransition | null>(null);

/**
 * Shares one transition between the controls (which change the URL) and the results
 * (which dim while the server re-renders), so the previous table stays readable.
 */
export function ExploreTransitionProvider({ children }: { children: ReactNode }) {
  const [isPending, startTransition] = useTransition();
  return <Context value={{ isPending, startTransition }}>{children}</Context>;
}

export function useExploreTransition(): ExploreTransition {
  const value = use(Context);
  if (!value) throw new Error('useExploreTransition needs ExploreTransitionProvider');
  return value;
}

export function PendingRegion({ children }: { children: ReactNode }) {
  const { isPending } = useExploreTransition();
  return (
    <div
      aria-busy={isPending}
      className={`transition-opacity duration-150 ${isPending ? 'opacity-55' : 'opacity-100'}`}
    >
      {children}
    </div>
  );
}
