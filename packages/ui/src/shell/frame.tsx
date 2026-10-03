'use client';

import type { AreaModel } from '@itsm/contracts/areas';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useHotkey } from '../a11y/hotkeys.js';
import { useRegion } from '../a11y/regions.js';
import type { MenuItemSpec } from '../overlays/Menu.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import { cx } from '../web/cx.js';
import { AreasProvider } from './areas-context.js';
import { frameAreas } from './compat.js';
import { ShellProvider, type PageInfo, type ShellContextValue } from './context.js';
import type { NavModel, ShellBrand, TabItem } from './nav.js';
import { ShortcutsDialogHost } from './shortcuts.js';
import { SkipLinks } from './SkipLinks.js';
import { SignOutForm, type UserMenuProps } from './UserMenu.js';

/**
 * What every variant of the application frame shares (v3 §3.10): the props,
 * the landmark skeleton and skip links, the system bar's slot, the page
 * information pages publish, the person's areas, the one sign-out form, ⌘K
 * and the shortcuts dialog.
 *
 * Its own module, apart from the variants, so a frame that draws only one
 * of them — the portal's `TopNavShell` — does not carry the other: the
 * sidebar, its rail, the sidebar's top bar and its navigation sheet are
 * weight a top-nav page never renders.
 */

export interface AppShellFrameProps {
  /** `sidebar`: Administration and the Service Desk. `topnav`: the Help Portal. */
  readonly variant: 'sidebar' | 'topnav';
  /**
   * The person's areas, built on the server (`currentAreas()`): the Area card,
   * the portal's switcher, the account menu's Switch area group, and
   * `useAreas()` for every cross-area link on the page. Optional only while
   * the applications move to the v3 props (RV1): without it the frame draws a
   * single-area lockup from the v2 `brand` (`areasFromV2Brand`).
   */
  readonly areas?: AreaModel;
  readonly brand: ShellBrand;
  readonly nav: NavModel;
  /** The demo bar (server-rendered), first after the skip links, across the whole width. */
  readonly systemBar?: ReactNode;
  /** Frame-level context chips in the sidebar frame's top bar, ahead of the page's: the live major incident. */
  readonly context?: ReactNode;
  /** The sidebar frame's Help menu (≥ 768 px): "Knowledge base · Help Portal", "Keyboard shortcuts…", in a demo the site. */
  readonly help?: { readonly items: readonly MenuItemSpec[] } | false;
  /** Under the Area card: the Service Desk's full-width "New ticket". */
  readonly sidebarAction?: ReactNode;
  /** @deprecated v2 (RV1): renamed `sidebarAction`. Removed by the wave-3 integrator. */
  readonly sidebarHeaderExtra?: ReactNode;
  /** The search trigger that opens the palette; ⌘K is bound when it is on. */
  readonly search?: { readonly placeholder: string; readonly shortcut?: 'mod+k' } | false;
  /** Client only: opens the command palette. */
  onOpenSearch(): void;
  /** The `NotificationCenter`. */
  readonly bell?: ReactNode;
  /** The `ConnectionStatus` slot: the sidebar's foot at 1024 px and up, the top bar below; the portal's top bar. */
  readonly status?: ReactNode;
  /** The sidebar foot's status row: the Service Desk's availability pill. */
  readonly footerExtra?: ReactNode;
  readonly user: UserMenuProps;
  /** `GlobalBanner`s, at the top of the content column. */
  readonly banner?: ReactNode;
  /** The phone tab bar below 768 px (at most five): the Help Portal's, and the Service Desk's with its Search and More actions. */
  readonly bottomTabs?: readonly TabItem[];
  /** In the top bar: the portal's *New request* (768 px and up), the Service Desk's compose icon (768–1023 px). */
  readonly topBarAction?: ReactNode;
  /** Extra skip links after "Skip to content" (the workbench's list, conversation, reply). */
  readonly skipLinks?: readonly { readonly label: string; readonly targetId: string }[];
  /** The `id` of `main`, the first skip link's target. Default `main-content`. */
  readonly mainId?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/** The one sign-out form on a framed page; every account menu in the frame, and the demo bar's End demo, submits it. */
export const SIGN_OUT_FORM_ID = 'itsm-signout';

/** Where the demo bar's swap notice is portalled: after `main`, so nothing with `role="status"` comes before it. */
export const SYSTEM_NOTICE_ID = 'itsm-system-notice';

/** ⌘K anywhere, including inside text fields (D14). Bound once for the frame's search triggers. */
function SearchShortcut({ onOpen }: { readonly onOpen: () => void }): ReactNode {
  useHotkey({ keys: 'mod+k', handler: () => onOpen(), allowInFields: true, description: 'Search and commands', group: 'General' });
  return null;
}

function useShellValue(variant: AppShellFrameProps['variant']): [ShellContextValue, PageInfo | null] {
  const [page, setPage] = useState<PageInfo | null>(null);
  const value = useMemo<ShellContextValue>(
    () => ({
      signOutFormId: SIGN_OUT_FORM_ID,
      variant,
      publishPage(info) {
        setPage(info);
        return () => setPage((current) => (current === info ? null : current));
      },
    }),
    [variant],
  );
  return [value, page];
}

/** The page column: the skip link's target and an F6 region. */
export function ShellMain({ id, children }: { readonly id: string; readonly children: ReactNode }): ReactNode {
  const ref = useRef<HTMLElement | null>(null);
  useRegion(ref);
  return (
    // tabIndex -1: the skip link and F6 move focus here, not just the viewport.
    <main ref={ref} id={id} tabIndex={-1} className="itsm-AppShell__page itsm-Region">
      {children}
    </main>
  );
}

/** Draws one variant's frame: its bars and navigation around `ShellMain`. */
export type FrameVariantRenderer = (page: PageInfo | null, mainId: string, areas: AreaModel) => ReactNode;

/**
 * The frame's root, in the order of v3 §3.10: skip links → the system bar →
 * the variant's frame → the system notice slot → the hidden sign-out form →
 * ⌘K → the shortcuts dialog host, all inside the areas and page-information
 * contexts.
 *
 * The system bar is a direct child of the root, which spans the window, so
 * its `position: sticky` holds for the whole page; it publishes its own
 * height (`--itsm-system-bar-h`, `SystemBar.styles.ts`) and every sticky bar
 * below sits under it.
 */
export function FrameRoot({ props, frame }: { readonly props: AppShellFrameProps; readonly frame: FrameVariantRenderer }): ReactNode {
  const itsm = useOptionalItsm();
  const messages = itsm?.messages ?? defaultMessages;
  const [shell, page] = useShellValue(props.variant);
  const fallbackApp = itsm?.app;
  const { areas: given, brand } = props;
  // Keyed on the brand's fields, not its identity: shells pass a new object on every render.
  const { href, workspace, name, tenant, app } = brand;
  const areas = useMemo(
    () => frameAreas({ ...(given ? { areas: given } : {}), brand: { href, workspace, name, tenant, app } }, fallbackApp),
    [given, href, workspace, name, tenant, app, fallbackApp],
  );
  const mainId = props.mainId ?? 'main-content';
  const skip = [{ label: messages.skipToContent, targetId: mainId }, ...(props.skipLinks ?? [])];
  const searchOn = props.search !== undefined && props.search !== false;
  const signOut = props.user.signOut;
  const beforeSubmit = signOut.beforeSubmit ? (): Promise<boolean> => signOut.beforeSubmit!() : undefined;

  return (
    <ShellProvider value={shell}>
      <AreasProvider value={areas}>
        <div
          className={cx('itsm-AppShell', props.className)}
          data-variant={props.variant}
          data-has-back={page?.back ? '' : undefined}
          data-system-bar={props.systemBar ? '' : undefined}
        >
          <SkipLinks links={skip} />
          {props.systemBar}
          {frame(page, mainId, areas)}
          <div id={SYSTEM_NOTICE_ID} className="itsm-AppShell__notice" />
          <SignOutForm id={SIGN_OUT_FORM_ID} action={props.user.signOut.action} {...(beforeSubmit ? { beforeSubmit } : {})} />
          {searchOn ? <SearchShortcut onOpen={props.onOpenSearch} /> : null}
          <ShortcutsDialogHost />
        </div>
      </AreasProvider>
    </ShellProvider>
  );
}
