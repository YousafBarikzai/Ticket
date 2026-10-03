'use client';

import type { AreaModel } from '@itsm/contracts/areas';
import type { FormEvent, ReactElement, ReactNode } from 'react';
import { useStableId } from '../a11y/ids.js';
import { Icon } from '../icons/Icon.js';
import type { MenuItemSpec } from '../overlays/Menu.js';
import { formatBadgeCount } from '../format/format.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { Avatar } from '../web/Avatar.js';
import { cx } from '../web/cx.js';
import { useAreas } from './areas-context.js';
import { useShellContext } from './context.js';
import { lazyModule, useIdlePrefetch, useIntentLoader, type IntentTriggerProps } from './lazy.js';
import type { AppSwitcherItem } from './nav.js';
import { ShortcutsDialogHost } from './shortcuts.js';

export interface UserMenuSignOut {
  /** The POST endpoint, e.g. `/api/session/logout`. */
  readonly action: string;
  /** "Sign out" by default; "End demo" in a demo session (A2 §8). */
  readonly label?: string;
  /**
   * Client only: clears local data and confirms queued writes; resolving
   * false cancels. Runs for every submitter of the form — this menu, the demo
   * bar's End demo, a suspended-workspace screen — not only this menu.
   */
  beforeSubmit?(): Promise<boolean>;
}

/** The event the Demo group's "Reset demo data…" dispatches; the demo bar answers it with its own confirm. */
export const DEMO_RESET_REQUEST_EVENT = 'itsm:demo-reset-request';
/** The event the Demo group's "Demo details" dispatches; the demo bar answers it by opening its details. */
export const DEMO_DETAILS_REQUEST_EVENT = 'itsm:demo-details-request';

export interface UserMenuProps {
  readonly name: string;
  /** Line 2: the demo persona's title, else the organisation, else the workspace. */
  readonly detail?: string;
  readonly initials?: string;
  /** The app's own entries, after Switch area: Profile, Approvals, *Your access*, Availability. */
  readonly items?: readonly MenuItemSpec[];
  /** Appearance and Increase contrast. Default true. */
  readonly appearance?: boolean;
  readonly density?: boolean;
  /** "Keyboard shortcuts…". */
  readonly shortcuts?: boolean;
  /** "Help": the knowledge base, through `crossAreaHref` where it lives in another area. */
  readonly help?: { readonly href: string; readonly label?: string };
  readonly signOut: UserMenuSignOut;
  /** A count on the avatar, e.g. the portal's approvals. */
  readonly badge?: { readonly value: number; readonly label: string };
  /**
   * The person's areas: the menu opens with a Switch area group when there is
   * more than one (or in a demo), and a demo adds the Demo group and "End
   * demo". Inside a frame it defaults to the frame's model.
   */
  readonly areas?: AreaModel;
  /** Demo sessions: the event the Demo group's Reset dispatches. */
  readonly demo?: { readonly resetEvent: typeof DEMO_RESET_REQUEST_EVENT };
  /** @deprecated v2 (RV1): replaced by `areas`; ignored. Removed by the wave-3 integrator. */
  readonly switcher?: readonly AppSwitcherItem[];
  /** `avatar` (default): the avatar alone. `row`: avatar, name and detail, as the sidebar's foot shows it. */
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

/** The avatar's size in the top bar and the sidebar's user card (A2 §5.2.1, §5.3.5). */
const AVATAR_PX = 30;

/**
 * The account menu: who is signed in, the way to the other areas, the app's
 * own entries, appearance, contrast, density, keyboard shortcuts, help, in a
 * demo the Demo group, and *Sign out* — or *End demo* (v3 §3.7).
 *
 * It renders a plain avatar button, and the menu (Radix) is fetched when the
 * pointer arrives, the button takes focus or is pressed — so the portal's
 * first paint carries no menu library. The portal also prefetches it when the
 * browser is idle.
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
  const frameAreas = useAreas();
  const areas = props.areas ?? frameAreas ?? undefined;
  const ownFormId = useStableId('itsm-signout');
  const formId = shell?.signOutFormId ?? ownFormId;
  const loader = useIntentLoader(panelModule);
  useIdlePrefetch(panelModule, itsm?.app === 'portal');

  const badgeText = badge && badge.value > 0 ? formatBadgeCount(badge.value, false, itsm?.locale) : null;

  const trigger = (extra: TriggerProps): ReactElement => (
    <button type="button" className={cx('itsm-UserMenu', `itsm-UserMenu--${display}`, className)} {...extra}>
      <span className="itsm-UserMenu__avatar">
        <Avatar name={name} {...(initials ? { initials } : {})} size={AVATAR_PX} decorative />
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
        <Panel
          {...props}
          {...(areas ? { areas } : {})}
          trigger={trigger({ ref: loader.triggerRef })}
          open={loader.open}
          onOpenChange={loader.setOpen}
          formId={formId}
        />
      ) : (
        trigger({ ...loader.intentProps, 'aria-haspopup': 'menu', 'aria-expanded': false })
      )}
      {shell?.signOutFormId ? null : <SignOutForm id={formId} action={signOut.action} {...(signOut.beforeSubmit ? { beforeSubmit: () => signOut.beforeSubmit!() } : {})} />}
      {shell || shortcuts !== true ? null : <ShortcutsDialogHost bindKey={false} />}
    </>
  );
}

export interface SignOutFormProps {
  readonly id: string;
  readonly action: string;
  /** Asked before the form goes: clears local data, confirms queued writes; false keeps the person signed in. */
  readonly beforeSubmit?: () => Promise<boolean>;
}

/**
 * The hidden `POST` form every sign-out on the page submits. `AppShell`
 * renders one for the page; a lone `UserMenu` renders its own.
 *
 * The question before signing out belongs to the form, not to the menu item
 * (A2 §8): whatever submits it — the account menu, the demo bar's End demo
 * button (`form="itsm-signout"`), a suspended-workspace screen — the submit
 * listener holds the submission, awaits `beforeSubmit`, and then submits
 * with `form.submit()`, which does not fire `submit` again. Without script
 * the plain POST still signs out.
 */
export function SignOutForm({ id, action, beforeSubmit }: SignOutFormProps): ReactNode {
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    if (!beforeSubmit) return;
    event.preventDefault();
    const form = event.currentTarget;
    void beforeSubmit().then(
      (proceed) => {
        if (proceed) form.submit();
      },
      () => undefined,
    );
  };
  return <form id={id} method="post" action={action} hidden className="itsm-SignOutForm" onSubmit={onSubmit} />;
}
