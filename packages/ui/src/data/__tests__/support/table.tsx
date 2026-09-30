import { useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { vi } from 'vitest';
import { ItsmProvider, type ItsmRouter } from '../../../provider/ItsmProvider.js';
import type { LinkComponent } from '../../../types.js';
import type { ColumnSpec, FilterSpec } from '../../types.js';

/**
 * Fixtures for the data tests: a list of rules, their columns, and a provider
 * whose URL behaves as the app router's does — `useSearchParams` follows
 * `history.pushState`/`replaceState` and `router.replace`, so URL-backed
 * state can be read back after it is written.
 */

export interface Rule extends Record<string, unknown> {
  readonly key: string;
  readonly name: string;
  readonly status: 'draft' | 'live' | 'archived';
  readonly event: string;
  readonly runs: number;
  readonly updatedAt: string;
  readonly owner: { readonly id: string; readonly displayName: string } | null;
}

export const rules: readonly Rule[] = [
  { key: 'vip-requester', name: 'VIP requester', status: 'live', event: 'created', runs: 120, updatedAt: '2026-09-28T09:00:00Z', owner: { id: 'u-1', displayName: 'Ada Lovelace' } },
  { key: 'printer-jams', name: 'Printer jams', status: 'draft', event: 'created', runs: 4, updatedAt: '2026-09-20T09:00:00Z', owner: null },
  { key: 'after-hours', name: 'After hours', status: 'live', event: 'updated', runs: 56, updatedAt: '2026-09-29T09:00:00Z', owner: { id: 'u-2', displayName: 'Grace Hopper' } },
  { key: 'major-incident', name: 'Major incident', status: 'archived', event: 'updated', runs: 0, updatedAt: '2026-08-01T09:00:00Z', owner: null },
];

export const statusMap = {
  draft: { label: 'Draft', tone: 'neutral' as const },
  live: { label: 'Live', tone: 'success' as const },
  archived: { label: 'Archived', tone: 'neutral' as const },
};

export const ruleColumns: readonly ColumnSpec[] = [
  { id: 'name', header: 'Name', field: 'name', kind: 'title', href: '/rules/{key}', sortable: 'page' },
  { id: 'status', header: 'Status', field: 'status', kind: 'status', map: statusMap, srPrefix: 'Status', sortable: 'page' },
  { id: 'runs', header: 'Runs', field: 'runs', kind: 'number', sortable: 'page' },
  { id: 'owner', header: 'Owner', field: 'owner', kind: 'person', empty: 'Unassigned' },
];

export const statusFilter: FilterSpec = {
  id: 'status',
  label: 'Status',
  type: 'multiselect',
  pinned: true,
  options: [
    { value: 'draft', label: 'Draft' },
    { value: 'live', label: 'Live' },
    { value: 'archived', label: 'Archived' },
  ],
};

export const noun = { one: 'rule', other: 'rules' };

/* ----------------------------------------------------------------- the URL */

const listeners = new Set<() => void>();
let patched = false;

function notifyLocation(): void {
  for (const listener of listeners) listener();
}

/** Makes `history` writes observable, as Next's app router does. */
function patchHistory(): void {
  if (patched) return;
  patched = true;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      notifyLocation();
    };
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useLiveSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  return new URLSearchParams(search);
}

function useLivePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/');
}

/** Resets the page's URL between tests. */
export function resetLocation(path = '/rules'): void {
  patchHistory();
  window.history.replaceState(null, '', path);
}

export interface Navigation {
  readonly router: ItsmRouter & { replace: ReturnType<typeof vi.fn>; push: ReturnType<typeof vi.fn> };
  /** Hrefs followed through the app's link. */
  readonly followed: string[];
  readonly Link: LinkComponent;
}

export function navigation(): Navigation {
  patchHistory();
  const followed: string[] = [];
  const Link = recordingLink(followed);
  const router = {
    push: vi.fn((href: string) => {
      followed.push(href);
    }),
    replace: vi.fn((href: string) => {
      window.history.replaceState(null, '', href);
    }),
    back: vi.fn(),
    prefetch: vi.fn(),
  };
  return { router, followed, Link };
}

/** The app's link: it records where it would have gone instead of navigating (jsdom cannot). */
export function recordingLink(followed: string[]): LinkComponent {
  return function RecordingLink({ prefetch, replace, scroll, onClick, ...anchor }) {
    void [prefetch, replace, scroll];
    return (
      <a
        {...anchor}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          followed.push(anchor.href);
        }}
      />
    );
  };
}

export function UrlProvider({ nav, children, app = 'admin' }: { readonly nav: Navigation; readonly children: ReactNode; readonly app?: 'admin' | 'workbench' | 'portal' }): ReactElement {
  return (
    <ItsmProvider
      app={app}
      Link={nav.Link}
      router={nav.router}
      usePathname={useLivePathname}
      useSearchParams={useLiveSearchParams}
      locale="en-GB"
      timeZone="Europe/London"
    >
      {children}
    </ItsmProvider>
  );
}
