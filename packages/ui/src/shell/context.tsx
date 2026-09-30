'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';

/**
 * What the frame shares with the pages drawn inside it.
 *
 * - The page's title and back link, published by `PageHeader`, so the
 *   compact top bar on a phone can read "‹ My requests · Printer jammed"
 *   without the layout (a server component that renders before the page)
 *   having to know either.
 * - The id of the one sign-out form, so every account menu on the page — the
 *   sidebar's and the compact bar's — submits the same form and the page
 *   never carries two elements with one id.
 */
export interface PageInfo {
  readonly title: string;
  readonly back?: { readonly href: string; readonly label: string };
  /** The page's own heading is on screen, so a compact bar need not repeat it (iOS's large title). */
  readonly titleInView?: boolean;
}

export interface ShellContextValue {
  readonly signOutFormId?: string;
  publishPage(page: PageInfo): () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ value, children }: { readonly value: ShellContextValue; readonly children: ReactNode }): ReactNode {
  return <ShellContext value={value}>{children}</ShellContext>;
}

export function useShellContext(): ShellContextValue | null {
  return useContext(ShellContext);
}

/**
 * Tells the frame what page it is showing, for as long as the caller is
 * mounted. The newest caller wins, and its cleanup restores nothing: the
 * page that replaces it publishes its own.
 */
export function usePublishPage(title: string, back?: { readonly href: string; readonly label: string }, titleInView?: boolean): void {
  const shell = useShellContext();
  const backHref = back?.href;
  const backLabel = back?.label;
  useEffect(() => {
    if (!shell) return;
    return shell.publishPage({
      title,
      ...(backHref && backLabel ? { back: { href: backHref, label: backLabel } } : {}),
      ...(titleInView === undefined ? {} : { titleInView }),
    });
  }, [shell, title, backHref, backLabel, titleInView]);
}
