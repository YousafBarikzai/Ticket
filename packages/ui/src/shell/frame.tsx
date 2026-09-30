'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useHotkey } from '../a11y/hotkeys.js';
import { useRegion } from '../a11y/regions.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { defaultMessages } from '../provider/messages.js';
import { cx } from '../web/cx.js';
import { ShellProvider, type PageInfo, type ShellContextValue } from './context.js';
import type { NavItem, NavModel, ShellBrand } from './nav.js';
import { ShortcutsDialogHost } from './shortcuts.js';
import { SkipLinks } from './SkipLinks.js';
import { SignOutForm, type UserMenuProps } from './UserMenu.js';

/**
 * What every variant of the application frame shares (SPEC §4.9): the props,
 * the landmark skeleton and skip links, the page information pages publish,
 * the one sign-out form, ⌘K and the shortcuts dialog.
 *
 * Its own module, apart from the variants, so a frame that draws only one
 * of them — the portal's `TopNavShell` — does not carry the other: the
 * sidebar, its rail and its navigation sheet are weight a top-nav page never
 * renders (SPEC §3.7).
 */

export interface AppShellFrameProps {
  /** `sidebar`: the admin console and the workbench. `topnav`: the portal. */
  readonly variant: 'sidebar' | 'topnav';
  readonly brand: ShellBrand;
  readonly nav: NavModel;
  /** Beside the brand in the sidebar header: the workbench's compose button. */
  readonly sidebarHeaderExtra?: ReactNode;
  /** The search trigger that opens the palette; ⌘K is bound when it is on. */
  readonly search?: { readonly placeholder: string; readonly shortcut?: 'mod+k' } | false;
  /** Client only: opens the command palette. */
  onOpenSearch(): void;
  /** The `NotificationCenter`. */
  readonly bell?: ReactNode;
  /** The `ConnectionStatus` slot: sidebar footer, portal top bar, compact top bar. */
  readonly status?: ReactNode;
  /** The workbench's availability pill, in the sidebar footer. */
  readonly footerExtra?: ReactNode;
  readonly user: UserMenuProps;
  /** `GlobalBanner`s, at the top of the content column. */
  readonly banner?: ReactNode;
  /** The portal's tab bar below 768 px (at most five). */
  readonly bottomTabs?: readonly NavItem[];
  /** The portal's *New request*, in the top bar at 768 px and up. */
  readonly topBarAction?: ReactNode;
  /** Extra skip links after "Skip to content" (the workbench's list, conversation, reply). */
  readonly skipLinks?: readonly { readonly label: string; readonly targetId: string }[];
  /** The `id` of `main`, the first skip link's target. Default `main-content`. */
  readonly mainId?: string;
  readonly className?: string;
  readonly children: ReactNode;
}


/** The one sign-out form on a framed page; every account menu in the frame submits it. */
export const SIGN_OUT_FORM_ID = 'itsm-signout';

/** ⌘K anywhere, including inside text fields (D14). Bound once for the frame's two search triggers. */
function SearchShortcut({ onOpen }: { readonly onOpen: () => void }): ReactNode {
  useHotkey({ keys: 'mod+k', handler: () => onOpen(), allowInFields: true, description: 'Search and commands', group: 'General' });
  return null;
}

function useShellValue(): [ShellContextValue, PageInfo | null] {
  const [page, setPage] = useState<PageInfo | null>(null);
  const value = useMemo<ShellContextValue>(
    () => ({
      signOutFormId: SIGN_OUT_FORM_ID,
      publishPage(info) {
        setPage(info);
        return () => setPage((current) => (current === info ? null : current));
      },
    }),
    [],
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
export type FrameVariantRenderer = (page: PageInfo | null, mainId: string) => ReactNode;

/**
 * The frame's root: landmarks in order (skip links first), the page
 * information context, then the variant's own parts, the hidden sign-out
 * form, ⌘K and the shortcuts dialog.
 */
export function FrameRoot({ props, frame }: { readonly props: AppShellFrameProps; readonly frame: FrameVariantRenderer }): ReactNode {
  const messages = useOptionalItsm()?.messages ?? defaultMessages;
  const [shell, page] = useShellValue();
  const mainId = props.mainId ?? 'main-content';
  const skip = [{ label: messages.skipToContent, targetId: mainId }, ...(props.skipLinks ?? [])];
  const searchOn = props.search !== undefined && props.search !== false;

  return (
    <ShellProvider value={shell}>
      <div
        className={cx('itsm-AppShell', props.className)}
        data-variant={props.variant}
        data-has-back={page?.back ? '' : undefined}
        data-title-in-view={page?.titleInView ? '' : undefined}
      >
        <SkipLinks links={skip} />
        {frame(page, mainId)}
        <SignOutForm id={SIGN_OUT_FORM_ID} action={props.user.signOut.action} />
        {searchOn ? <SearchShortcut onOpen={props.onOpenSearch} /> : null}
        <ShortcutsDialogHost />
      </div>
    </ShellProvider>
  );
}
