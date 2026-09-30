import { useState, type ReactNode } from 'react';
import { vi } from 'vitest';
import { TestProvider, type TestProviderProps } from '../../provider/__tests__/support/provider.js';
import type { AppShellFrameProps } from '../../web/AppShell.js';
import type { NavModel } from '../nav.js';

/**
 * Test helpers for the frame: a viewport of a given width (a `matchMedia`
 * that answers `min-width`/`max-width` queries in rem the way the stylesheet
 * writes them), a location the test can move, and a nav model shaped like
 * the admin console's.
 */

const REM = 16;

function evaluate(query: string, width: number): boolean {
  const conditions = [...query.matchAll(/\((min|max)-width:\s*([\d.]+)(rem|px)\)/g)];
  if (conditions.length === 0) return false;
  return conditions.every(([, kind, value, unit]) => {
    const px = Number(value) * (unit === 'rem' ? REM : 1);
    return kind === 'min' ? width >= px : width <= px;
  });
}

/** Installs a `matchMedia` for a window `width` px wide (and sets `innerWidth`). */
export function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: evaluate(query, width),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

/** A location the test controls: `usePathname`/`useSearchParams` for the provider, and a way to move it. */
export function createLocation(initial = '/rules'): {
  readonly usePathname: () => string;
  readonly useSearchParams: () => URLSearchParams;
  go(href: string): void;
  Provider(props: { readonly children: ReactNode; readonly app?: TestProviderProps['app'] }): ReactNode;
} {
  let setters: ((href: string) => void)[] = [];
  let current = initial;
  const split = (href: string): [string, string] => {
    const at = href.indexOf('?');
    return at < 0 ? [href, ''] : [href.slice(0, at), href.slice(at + 1)];
  };
  function useHref(): string {
    const [href, setHref] = useState(current);
    if (!setters.includes(setHref)) setters.push(setHref);
    return href;
  }
  const usePathname = (): string => split(useHref())[0];
  const useSearchParams = (): URLSearchParams => new URLSearchParams(split(useHref())[1]);
  return {
    usePathname,
    useSearchParams,
    go(href) {
      current = href;
      for (const set of setters) set(href);
    },
    Provider({ children, app = 'admin' }) {
      setters = setters.filter(Boolean);
      return (
        <TestProvider app={app} usePathname={usePathname} useSearchParams={useSearchParams}>
          {children}
        </TestProvider>
      );
    },
  };
}

export const adminNav: NavModel = {
  label: 'Administration',
  sections: [
    { id: 'overview', items: [{ id: 'home', label: 'Command centre', href: '/', icon: 'home' }] },
    {
      id: 'desk',
      label: 'Service desk',
      items: [
        { id: 'tickets', label: 'Tickets', href: '/tickets', icon: 'ticket' },
        { id: 'sla', label: 'Service levels', href: '/sla', icon: 'sla' },
      ],
    },
    {
      id: 'automation',
      label: 'Automation',
      collapsible: true,
      items: [
        { id: 'rules', label: 'Rules', href: '/rules', icon: 'automation', badge: { value: 3, label: '3 drafts' } },
        { id: 'workflows', label: 'Workflows', href: '/workflows', icon: 'workflow', badge: { value: 140, tone: 'danger', label: 'failed runs' } },
      ],
    },
    {
      id: 'cmdb',
      label: 'CMDB',
      collapsible: true,
      defaultCollapsed: true,
      items: [
        { id: 'cis', label: 'Configuration items', href: '/cmdb', icon: 'cmdb' },
        { id: 'assets', label: 'Assets', href: '/cmdb/assets', icon: 'assets' },
      ],
    },
  ],
  footer: [{ id: 'settings', label: 'Settings', href: '/settings', icon: 'settings' }],
  pinned: { enabled: true },
  recent: { enabled: true },
};

export const portalNav: NavModel = {
  label: 'Help portal',
  sections: [
    {
      id: 'main',
      items: [
        { id: 'home', label: 'Home', href: '/', icon: 'home' },
        { id: 'requests', label: 'My requests', href: '/tickets', icon: 'ticket' },
        { id: 'services', label: 'Services', href: '/catalogue', icon: 'catalogue' },
        { id: 'knowledge', label: 'Knowledge', href: '/knowledge', icon: 'knowledge' },
      ],
    },
  ],
};

export function sidebarProps(overrides: Partial<AppShellFrameProps> = {}): AppShellFrameProps {
  return {
    variant: 'sidebar',
    brand: {
      name: 'Administration',
      tenant: 'Acme',
      href: '/',
      app: 'admin',
      switcher: [
        { app: 'admin', label: 'Administration', href: '/' },
        { app: 'workbench', label: 'Workbench', href: 'https://desk.example/inbox' },
      ],
    },
    nav: adminNav,
    search: { placeholder: 'Search or jump to…', shortcut: 'mod+k' },
    onOpenSearch: vi.fn(),
    user: { name: 'Ada Lovelace', detail: 'Acme', signOut: { action: '/api/session/logout' }, density: true, shortcuts: true },
    children: null,
    ...overrides,
  };
}

export function topnavProps(overrides: Partial<AppShellFrameProps> = {}): AppShellFrameProps {
  return {
    variant: 'topnav',
    brand: { name: 'Help', href: '/', app: 'portal' },
    nav: portalNav,
    search: { placeholder: 'Search help', shortcut: 'mod+k' },
    onOpenSearch: vi.fn(),
    user: { name: 'Ada Lovelace', detail: 'Acme', signOut: { action: '/api/session/logout' }, badge: { value: 2, label: '2 approvals waiting' } },
    bottomTabs: [
      { id: 'home', label: 'Home', href: '/', icon: 'home' },
      { id: 'requests', label: 'Requests', href: '/tickets', icon: 'ticket' },
      { id: 'services', label: 'Services', href: '/catalogue', icon: 'catalogue' },
      { id: 'knowledge', label: 'Knowledge', href: '/knowledge', icon: 'knowledge' },
      { id: 'me', label: 'Me', href: '/profile', icon: 'profile', badge: { value: 2, tone: 'accent', label: '2 approvals waiting' } },
    ],
    children: null,
    ...overrides,
  };
}
