'use client';

import type { ReactNode } from 'react';
import type { MenuItemSpec } from '../overlays/Menu.js';
import { cx } from '../web/cx.js';

export interface UserMenuSignOut {
  /** The POST endpoint, e.g. `/api/session/logout`. */
  readonly action: string;
  readonly label?: string;
  /** Client only: clears local data and confirms queued writes; resolving false cancels. */
  beforeSubmit?(): Promise<boolean>;
}

export interface UserMenuProps {
  readonly name: string;
  readonly detail?: string;
  readonly initials?: string;
  readonly items?: readonly MenuItemSpec[];
  /** Appearance and Increase contrast. Default true. */
  readonly appearance?: boolean;
  readonly density?: boolean;
  /** "Keyboard shortcuts…". */
  readonly shortcuts?: boolean;
  readonly help?: { readonly href: string };
  readonly signOut: UserMenuSignOut;
  /** A count on the avatar, e.g. the portal's approvals. */
  readonly badge?: { readonly value: number; readonly label: string };
  readonly className?: string;
}

/**
 * The account menu: appearance, density, shortcuts, help, the app switcher and
 * Sign out. Renders a plain avatar button and loads the menu on intent, so the
 * portal's first paint carries no menu library.
 *
 * Stub (SPEC §4.9): renders the button; the shell package adds the menu and
 * the sign-out form.
 */
export function UserMenu({ name, className }: UserMenuProps): ReactNode {
  return (
    <button type="button" className={cx('itsm-UserMenu', className)} aria-haspopup="menu">
      {name}
    </button>
  );
}
