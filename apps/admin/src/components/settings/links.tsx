'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * The pages a Settings view may link to — those this person can open and
 * that exist, decided on the server — so a row never offers "Change on AI
 * triage" to someone that page would refuse.
 */
const Reachable = createContext<ReadonlySet<string>>(new Set());

export function ReachableLinks({ hrefs, children }: { readonly hrefs: readonly string[]; readonly children: ReactNode }): ReactNode {
  return <Reachable.Provider value={new Set(hrefs)}>{children}</Reachable.Provider>;
}

export function useReachable(href: string | undefined): string | undefined {
  const hrefs = useContext(Reachable);
  return href !== undefined && hrefs.has(href) ? href : undefined;
}
