'use client';

import type { ReactElement, ReactNode } from 'react';
import { useStableId } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import type { MenuItemSpec } from '../overlays/Menu.js';
import { formatBadgeCount } from '../format/format.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { Avatar } from '../web/Avatar.js';
import { cx } from '../web/cx.js';
import { useShellContext } from './context.js';
import { lazyModule, useIdlePrefetch, useIntentLoader, type IntentTriggerProps } from './lazy.js';
import type { AppSwitcherItem } from './nav.js';
import { ShortcutsDialogHost } from './shortcuts.js';

export interface UserMenuSignOut {
  /** The POST endpoint, e.g. `/api/session/logout`. */
  readonly action: string;
  readonly label?: string;
  /** Client only: clears local data and confirms queued writes; resolving false cancels. */
  beforeSubmit?(): Promise<boolean>;
}

export interface UserMenuProps {
  readonly name: string;
  /** The organisation or role, under the name. */
  readonly detail?: string;
  readonly initials?: string;
  /** The app's own entries, first: Profile, Approvals, *Your access*. */
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
  /** The other apps this person can use (same tab). Shown in this menu where the frame has no brand menu — the portal. */
  readonly switcher?: readonly AppSwitcherItem[];
  /** `avatar` (default): the avatar alone. `row`: avatar, name and detail, as the sidebar's footer shows it. */
  readonly display?: 'avatar' | 'row';
  readonly className?: string;
}

/** The menu itself, fetched on intent: it is built on the Radix menu the portal's first load does not carry. */
const panelModule = lazyModule(() => import('./UserMenuPanel.js'));

type TriggerProps = Partial<Omit<IntentTriggerProps, 'ref'>> & {
  readonly ref: IntentTriggerProps['ref'];
  readonly 'aria-haspopup'?: 'menu';
  readonly 'aria-expanded'?: boolean;
};

/**
 * The account menu: who is signed in, appearance, contrast, density,
 * keyboard shortcuts, help, the app switcher, and *Sign out*.
 *
 * It renders a plain avatar button, and the menu (Radix) is fetched when the
 * pointer arrives, the button takes focus or is pressed — so the portal's
 * first paint carries no menu library (SPEC §3.7). The portal also prefetches
 * it when the browser is idle.
 *
 * *Sign out* is a real form submission, never a link: a `<button
 * type="submit" form="…">` inside the menu names a hidden `POST` form that
 * lives outside the menu's portal — so it survives the menu closing, and no
 * prefetcher can ever sign anyone out by following a URL. Inside `AppShell`
 * every account menu on the page shares the frame's one form.
 */
export function UserMenu(props: UserMenuProps): ReactNode {
  const { name, detail, initials, badge, signOut, shortcuts, display = 'avatar', className } = props;
  const itsm = useOptionalItsm();
  const shell = useShellContext();
  const ownFormId = useStableId('itsm-signout');
  const formId = shell?.signOutFormId ?? ownFormId;
  const loader = useIntentLoader(panelModule);
  useIdlePrefetch(panelModule, itsm?.app === 'portal');

  const badgeText = badge && badge.value > 0 ? formatBadgeCount(badge.value, false, itsm?.locale) : null;

  const trigger = (extra: TriggerProps): ReactElement => (
    <button type="button" className={cx('itsm-UserMenu', `itsm-UserMenu--${display}`, className)} {...extra}>
      <span className="itsm-UserMenu__avatar">
        <Avatar name={name} {...(initials ? { initials } : {})} size="md" decorative />
        {badgeText ? (
          <span className="itsm-UserMenu__badge" aria-hidden="true">
            {badgeText}
          </span>
        ) : null}
      </span>
      <span className="itsm-UserMenu__text">
        <span className="itsm-UserMenu__name">{name}</span>
        {detail ? (
          <span className="itsm-UserMenu__detail">
            <span className="itsm-visually-hidden">, </span>
            {detail}
          </span>
        ) : null}
        {badge && badgeText ? <span className="itsm-visually-hidden">, {badge.label}</span> : null}
      </span>
      {display === 'row' ? <Icon name="chevrons-up-down" size="sm" className="itsm-UserMenu__chevron" /> : null}
    </button>
  );

  const Panel = loader.loaded?.UserMenuPanel;

  return (
    <>
      {Panel ? (
        <Panel {...props} trigger={trigger({ ref: loader.triggerRef })} open={loader.open} onOpenChange={loader.setOpen} formId={formId} />
      ) : (
        trigger({ ...loader.intentProps, 'aria-haspopup': 'menu', 'aria-expanded': false })
      )}
      {shell?.signOutFormId ? null : <SignOutForm id={formId} action={signOut.action} />}
      {shell || shortcuts !== true ? null : <ShortcutsDialogHost bindKey={false} />}
    </>
  );
}

/**
 * The hidden `POST` form the account menu's *Sign out* submits. `AppShell`
 * renders one for the page; a lone `UserMenu` renders its own.
 */
export function SignOutForm({ id, action }: { readonly id: string; readonly action: string }): ReactNode {
  return <form id={id} method="post" action={action} hidden className="itsm-SignOutForm" />;
}
