// @vitest-environment jsdom
import { AREA_ORDER, AREAS, PRODUCT_NAME } from '@itsm/contracts/areas';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { AppShell, type AppShellFrameProps } from '../../web/AppShell.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { areasFromV2Brand, COMPAT_AREA_TEXT, COMPAT_PRODUCT_NAME } from '../compat.js';
import type { AppSwitcherItem, NavModel, ShellBrand } from '../nav.js';
import { TopNavShell, type TopNavShellProps } from '../TopNavShell.js';
import type { UserMenuProps } from '../UserMenu.js';
import { setViewport } from './support.js';

/**
 * The compatibility window of RV1 (v3 §3.10): until the wave-3 integrator
 * removes the aliases, the frame accepts the v2 props the three shells pass
 * today — and draws a single-area lockup for them, with no Area card and no
 * Switch area group.
 *
 * The props below are those of `apps/workbench/src/components/DeskShell.tsx`
 * (brand, `sidebarHeaderExtra`), `apps/portal/src/components/PortalShell.tsx`
 * (brand with its switcher) and `apps/admin/src/components/AdminShell.tsx`
 * (brand with its switcher), as they are at the start of wave 2.
 *
 * In wave 3 this file's body becomes the guard that no v2 alias is left in
 * `apps/*\/src/**` or `packages/ui/src/**`.
 */

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

afterEach(() => {
  cleanupDocument();
  vi.unstubAllGlobals();
});

const switcher: readonly AppSwitcherItem[] = [
  { app: 'portal', label: 'Help', href: 'https://help.example/' },
  { app: 'workbench', label: 'Workbench', href: 'https://desk.example/inbox' },
  { app: 'admin', label: 'Administration', href: 'https://admin.example/' },
];

const nav: NavModel = { label: 'Main', sections: [{ id: 'main', items: [{ id: 'home', label: 'Home', href: '/', icon: 'home' }] }] };
const user: UserMenuProps = { name: 'Ada Lovelace', detail: 'Acme', signOut: { action: '/api/session/logout' } };

/** `DeskShell.tsx:314-316`. */
const deskBrand: ShellBrand = { name: 'Workbench', tenant: 'Acme', href: '/inbox', app: 'workbench', switcher };
/** `PortalShell.tsx:306`. */
const portalBrand: ShellBrand = { name: 'Help', tenant: 'Acme', href: '/', app: 'portal', switcher };
/** `AdminShell.tsx:206`. */
const adminBrand: ShellBrand = { name: 'Administration', tenant: 'Acme', href: '/', app: 'admin', switcher: [...switcher] };

function frame(node: ReactNode, app: 'portal' | 'workbench' | 'admin'): void {
  render(createElement(TestProvider, { app, usePathname: () => '/', children: node }));
}

describe('the v2 frame props (RV1)', () => {
  it('still typecheck', () => {
    expectTypeOf<{ variant: 'sidebar'; brand: typeof deskBrand; nav: NavModel; sidebarHeaderExtra: ReactNode; onOpenSearch: () => void; user: UserMenuProps; children: ReactNode }>().toMatchTypeOf<AppShellFrameProps>();
    expectTypeOf<{ brand: typeof portalBrand; nav: NavModel; onOpenSearch: () => void; user: UserMenuProps; children: ReactNode }>().toMatchTypeOf<TopNavShellProps>();
    expectTypeOf<{ variant: 'sidebar'; brand: typeof adminBrand; nav: NavModel; onOpenSearch: () => void; user: UserMenuProps; children: ReactNode }>().toMatchTypeOf<AppShellFrameProps>();
    expectTypeOf<UserMenuProps['switcher']>().toEqualTypeOf<readonly AppSwitcherItem[] | undefined>();
    expectTypeOf<AppShellFrameProps['areas']>().not.toBeNever();
  });

  it('draws the Service Desk’s v2 props as a lockup without an Area card, the compose button as the sidebar action', () => {
    setViewport(1440);
    const props: AppShellFrameProps = {
      variant: 'sidebar',
      brand: deskBrand,
      nav,
      sidebarHeaderExtra: createElement('button', { type: 'button' }, 'New ticket'),
      search: { placeholder: 'Search', shortcut: 'mod+k' },
      onOpenSearch: vi.fn(),
      user,
      children: createElement('h1', { tabIndex: -1 }, 'Inbox'),
    };
    frame(createElement(AppShell, props), 'workbench');
    const lockup = document.querySelector('.itsm-Sidebar .itsm-AreaSwitcher')!;
    expect(lockup.getAttribute('data-display')).toBe('lockup');
    expect(lockup.textContent).toContain('Workbench');
    expect(document.querySelector('button.itsm-AreaSwitcher')).toBeNull();
    expect(document.querySelector('.itsm-Sidebar__workspace')?.textContent).toBe('Acme');
    expect(document.querySelector('.itsm-Sidebar__action')?.textContent).toBe('New ticket');
    // Landmarks keep their v2 names.
    expect(document.querySelector('nav[aria-label="Main"]')).not.toBeNull();
  });

  it('draws the Help Portal’s v2 props as a lockup beside the mark, with the tab bar named as before', () => {
    setViewport(390);
    const props: TopNavShellProps = {
      brand: portalBrand,
      nav,
      onOpenSearch: vi.fn(),
      user,
      bottomTabs: [{ id: 'home', label: 'Home', href: '/', icon: 'home' }],
      children: createElement('h1', { tabIndex: -1 }, 'Home'),
    };
    frame(createElement(TopNavShell, props), 'portal');
    expect(document.querySelector('.itsm-TopBar .itsm-AreaSwitcher')?.getAttribute('data-display')).toBe('lockup');
    expect(document.querySelector('.itsm-TopBar .itsm-AreaSwitcher')?.textContent).toContain('Help');
    expect(document.querySelector('button.itsm-AreaSwitcher')).toBeNull();
    expect(document.querySelector('nav[aria-label="Main"]')).not.toBeNull();
    expect(document.querySelector('nav[aria-label="Tab bar"]')).not.toBeNull();
  });

  it('draws Administration’s v2 props as a lockup, and the account menu without a Switch area group', async () => {
    setViewport(1440);
    const props: AppShellFrameProps = { variant: 'sidebar', brand: adminBrand, nav, onOpenSearch: vi.fn(), user, children: null };
    frame(createElement(AppShell, props), 'admin');
    expect(document.querySelector('.itsm-Sidebar .itsm-AreaSwitcher')?.getAttribute('data-display')).toBe('lockup');
    expect(document.querySelector('.itsm-AppTopBar button.itsm-AppTopBar__area')).toBeNull();
    const model = areasFromV2Brand(adminBrand);
    expect(model.visible).toBe(false);
    expect(model.areas).toHaveLength(1);
  });
});

describe('areasFromV2Brand', () => {
  it('gives a single-area, never-visible, never-demo model named by brand.name', () => {
    expect(areasFromV2Brand(deskBrand)).toEqual({
      product: 'IT Service Management',
      current: 'workbench',
      workspace: 'Acme',
      demo: false,
      visible: false,
      areas: [{ id: 'workbench', name: 'Workbench', description: 'Work tickets, queues and SLAs', icon: 'inbox', href: '/inbox', origin: null, current: true }],
    });
  });

  it('falls back to the provider’s app and the area’s own name for a brand without them', () => {
    const model = areasFromV2Brand({ href: '/', workspace: 'Acme' }, 'admin');
    expect(model.current).toBe('admin');
    expect(model.areas[0]?.name).toBe('Administration');
  });

  it('copies the product name and each area’s words exactly as @itsm/contracts/areas has them', () => {
    expect(COMPAT_PRODUCT_NAME).toBe(PRODUCT_NAME);
    for (const id of AREA_ORDER) {
      expect(COMPAT_AREA_TEXT[id]).toEqual({ name: AREAS[id].name, description: AREAS[id].description, icon: AREAS[id].icon });
    }
  });
});
