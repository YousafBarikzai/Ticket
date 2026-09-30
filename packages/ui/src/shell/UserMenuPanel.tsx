'use client';

import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { MenuContent, MenuHeading, MenuItem, MenuPortal, MenuRoot, MenuSeparator, MenuTrigger, dropdownMenuKit, type MenuItemSpec } from '../overlays/Menu.js';
import { MenuItems } from '../overlays/menu-items.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { Prefs } from '../theme/prefs.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { Avatar } from '../web/Avatar.js';
import { appIcon } from './app-icons.js';
import { setShortcutsDialogOpen } from './shortcuts.js';
import type { UserMenuProps } from './UserMenu.js';

export interface UserMenuPanelProps extends UserMenuProps {
  readonly trigger: ReactElement;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The hidden form *Sign out* submits. */
  readonly formId: string;
}

/**
 * The account menu's body, loaded on intent by `UserMenu` (this module is
 * where the Radix menu comes in).
 *
 * The preferences are the person's own and act at once: *Appearance*
 * (Automatic · Light · Dark), *Increase contrast* (ticked while the device
 * asks for more contrast, until the person chooses), and *Density* in the
 * sidebar apps. Theme changes cross-fade where motion is allowed
 * (`ThemeProvider`).
 */
export function UserMenuPanel({
  trigger,
  open,
  onOpenChange,
  formId,
  name,
  detail,
  initials,
  items,
  appearance = true,
  density = false,
  shortcuts = false,
  help,
  signOut,
  switcher,
}: UserMenuPanelProps): ReactNode {
  const itsm = useOptionalItsm();
  const { prefs, setPrefs, resolvedTheme } = useTheme();
  const contrastOn = prefs.contrast === 'more' || (prefs.contrast === 'system' && resolvedTheme.startsWith('high-contrast'));
  const singleKeys = itsm?.features.singleKeyShortcuts ?? true;

  const entries: MenuItemSpec[] = [];
  if (items && items.length > 0) entries.push(...items, { type: 'separator' });
  if (appearance) {
    entries.push(
      {
        type: 'radio',
        id: 'appearance',
        label: 'Appearance',
        value: prefs.appearance,
        items: [
          { value: 'system', label: 'Automatic' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
        onValueChange: (value) => setPrefs({ appearance: value as Prefs['appearance'] }),
      },
      { type: 'checkbox', id: 'contrast', label: 'Increase contrast', checked: contrastOn, onCheckedChange: (checked) => setPrefs({ contrast: checked ? 'more' : 'standard' }) },
    );
  }
  if (density) {
    entries.push({
      type: 'radio',
      id: 'density',
      label: 'Density',
      value: prefs.density,
      items: [
        { value: 'comfortable', label: 'Comfortable' },
        { value: 'compact', label: 'Compact' },
      ],
      onValueChange: (value) => setPrefs({ density: value as Prefs['density'] }),
    });
  }
  if (appearance || density) entries.push({ type: 'separator' });
  if (shortcuts) {
    entries.push({
      id: 'shortcuts',
      label: 'Keyboard shortcuts…',
      icon: 'keyboard',
      ...(singleKeys ? { shortcut: '?' } : {}),
      // The frame mounts the page's one dialog host; a lone menu mounts its own.
      onSelect: () => setShortcutsDialogOpen(true),
    });
  }
  if (help) entries.push({ id: 'help', label: 'Help', icon: 'help', href: help.href });
  const others = (switcher ?? []).filter((entry) => entry.app !== itsm?.app);
  if (others.length > 0) {
    if (entries.length > 0 && entries[entries.length - 1]?.type !== 'separator') entries.push({ type: 'separator' });
    entries.push({ type: 'label', label: 'Switch to' });
    for (const entry of others) entries.push({ id: `app-${entry.app}`, label: entry.label, icon: appIcon(entry.app), href: entry.href });
  }
  while (entries.length > 0 && entries[entries.length - 1]?.type === 'separator') entries.pop();

  const onSignOut = (event: MouseEvent<HTMLButtonElement>): void => {
    if (!signOut.beforeSubmit) return;
    // Ask first (queued items, local data); the native submission waits for the answer.
    event.preventDefault();
    onOpenChange(false);
    const ask = signOut.beforeSubmit;
    void ask().then(
      (proceed) => {
        const form = document.getElementById(formId);
        if (proceed && form instanceof HTMLFormElement) form.requestSubmit();
      },
      () => undefined,
    );
  };

  return (
    <MenuRoot modal={false} open={open} onOpenChange={onOpenChange}>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuPortal>
        <MenuContent align="end" side="bottom" aria-label="Account" className="itsm-UserMenu__content">
          <MenuHeading className="itsm-UserMenu__identity">
            <Avatar name={name} {...(initials ? { initials } : {})} size="md" decorative />
            <span className="itsm-UserMenu__identityText">
              <span className="itsm-UserMenu__identityName">{name}</span>
              {detail ? <span className="itsm-UserMenu__identityDetail">{detail}</span> : null}
            </span>
          </MenuHeading>
          <MenuSeparator />
          <MenuItems items={entries} context={{ kit: dropdownMenuKit, Link: itsm?.Link ?? null }} />
          {entries.length > 0 ? <MenuSeparator /> : null}
          <MenuItem asChild className="itsm-UserMenu__signOut" textValue={signOut.label ?? 'Sign out'}>
            <button type="submit" form={formId} onClick={onSignOut}>
              <span className="itsm-Menu__leading" aria-hidden="true">
                <Icon name="log-out" size="sm" />
              </span>
              <span className="itsm-Menu__text">
                <span className="itsm-Menu__itemLabel">{signOut.label ?? 'Sign out'}</span>
              </span>
            </button>
          </MenuItem>
        </MenuContent>
      </MenuPortal>
    </MenuRoot>
  );
}
