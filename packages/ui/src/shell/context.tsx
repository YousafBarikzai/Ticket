'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';

/**
 * What the frame shares with the pages drawn inside it.
 *
 * - The page's title, purpose, context chips and way back, published by
 *   `PageHeader`, so the top bar can show them although the layout (a server
 *   component that renders before the page) knows none of them. The nav
 *   model gives the bar its title in the server HTML; what a page publishes
 *   wins once it is hydrated (A2 §5.2.3).
 * - The frame's variant, so `PageHeader` knows whether the bar is already
 *   showing its title (the sidebar frame) and its `<h1>` can step back to a
 *   visually hidden focus target.
 * - The id of the one sign-out form, so every account menu on the page — the
 *   sidebar's and the top bar's — submits the same form and the page never
 *   carries two elements with one id.
 */
export interface PageInfo {
  readonly title: string;
  readonly back?: { readonly href: string; readonly label: string };
  /** The line under the bar's title. No full stop. */
  readonly purpose?: string;
  /** Chips with context the page itself does not show (never "As at", never the SLA figure: X-M4). */
  readonly context?: ReactNode;
  /**
   * `page` (default): the bar shows this page's title. `section`: a record
   * page — the bar shows "‹ {section}" back to its list and the record's
   * `<h1>` stays visible in the page.
   */
  readonly barTitle?: 'page' | 'section';
}

export interface ShellContextValue {
  readonly signOutFormId?: string;
  /** The frame's variant; absent outside a frame. */
  readonly variant?: 'sidebar' | 'topnav';
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
export function usePublishPage(page: PageInfo): void {
  const shell = useShellContext();
  const { title, purpose, barTitle, context } = page;
  const backHref = page.back?.href;
  const backLabel = page.back?.label;
  useEffect(() => {
    if (!shell) return;
    return shell.publishPage({
      title,
      ...(backHref && backLabel ? { back: { href: backHref, label: backLabel } } : {}),
      ...(purpose ? { purpose } : {}),
      ...(context !== undefined && context !== null && context !== false ? { context } : {}),
      ...(barTitle ? { barTitle } : {}),
    });
  }, [shell, title, backHref, backLabel, purpose, barTitle, context]);
}
