'use client';

import { useId, type ReactElement, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { MenuContent, MenuGroup, MenuHeading, MenuItem, MenuPortal, MenuRoot, MenuSeparator, MenuTrigger, dropdownMenuKit, type MenuItemSpec } from '../overlays/Menu.js';
import { MenuItems } from '../overlays/menu-items.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import type { Prefs } from '../theme/prefs.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { Avatar } from '../web/Avatar.js';
import { SWITCH_AREA_LABEL } from './AreaList.js';
import { AreaHomeRow, AreaMenuRows } from './AreaMenuPanel.js';
import { setShortcutsDialogOpen } from './shortcuts.js';
import { DEMO_DETAILS_REQUEST_EVENT, DEMO_RESET_REQUEST_EVENT, type UserMenuProps } from './UserMenu.js';

export interface UserMenuPanelProps extends UserMenuProps {
  readonly trigger: ReactElement;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The hidden form *Sign out* submits. */
  readonly formId: string;
}

/** The identity heading's avatar (A2 §8). */
const IDENTITY_AVATAR_PX = 36;

function dispatch(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}

/**
 * The account menu's body, loaded on intent by `UserMenu` (this module is
 * where the Radix menu comes in), in the order of v3 §3.7:
 *
 * 1. who is signed in — and, in a demo, a "Demo" tag;
 * 2. **Switch area**, first, whenever there is somewhere to switch to: the
 *    same rows as the area menu (phones and the portal reach the other
 *    areas here too);
 * 3. the app's own entries (Profile, Approvals, *Your access*, Availability);
 * 4. the person's preferences, which act at once: *Appearance*, *Increase
 *    contrast* (ticked while the device asks for more contrast, until the
 *    person chooses) and *Density* in the sidebar apps;
 * 5. *Keyboard shortcuts…* and *Help*;
 * 6. in a demo, the Demo group: *Reset demo data…* and *Demo details*, which
 *    the demo bar answers (`itsm:demo-reset-request`,
 *    `itsm:demo-details-request`), and "IT Service Management home";
 * 7. *Sign out*, or *End demo*, a submit button for the frame's one form.
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
  areas,
  demo,
}: UserMenuPanelProps): ReactNode {
  const itsm = useOptionalItsm();
  const { prefs, setPrefs, resolvedTheme } = useTheme();
  const areasId = useId();
  const demoId = useId();
  const contrastOn = prefs.contrast === 'more' || (prefs.contrast === 'system' && resolvedTheme.startsWith('high-contrast'));
  const singleKeys = itsm?.features.singleKeyShortcuts ?? true;
  const inDemo = areas?.demo === true;
  const context = { kit: dropdownMenuKit, Link: itsm?.Link ?? null };

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
  if (help) entries.push({ id: 'help', label: help.label ?? 'Help', icon: 'help', href: help.href });
  while (entries.length > 0 && entries[entries.length - 1]?.type === 'separator') entries.pop();

  const demoEntries: MenuItemSpec[] = inDemo
    ? [
        { id: 'demo-reset', label: 'Reset demo data…', icon: 'history', onSelect: () => dispatch(demo?.resetEvent ?? DEMO_RESET_REQUEST_EVENT) },
        { id: 'demo-details', label: 'Demo details', icon: 'info', onSelect: () => dispatch(DEMO_DETAILS_REQUEST_EVENT) },
      ]
    : [];
  const signOutLabel = signOut.label ?? (inDemo ? 'End demo' : 'Sign out');

  return (
    <MenuRoot modal={false} open={open} onOpenChange={onOpenChange}>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuPortal>
        <MenuContent align="end" side="bottom" aria-label="Account" className="itsm-UserMenu__content">
          <MenuHeading className="itsm-UserMenu__identity">
            <Avatar name={name} {...(initials ? { initials } : {})} size={IDENTITY_AVATAR_PX} decorative />
            <span className="itsm-UserMenu__identityText">
              <span className="itsm-UserMenu__identityName">
                {name}
                {inDemo ? <span className="itsm-UserMenu__demoTag">Demo</span> : null}
              </span>
              {detail ? <span className="itsm-UserMenu__identityDetail">{detail}</span> : null}
            </span>
          </MenuHeading>
          <MenuSeparator />
          {areas?.visible ? (
            <>
              <MenuGroup className="itsm-Menu__group itsm-UserMenu__areas" aria-labelledby={areasId}>
                <MenuHeading className="itsm-Menu__heading" id={areasId}>
                  {SWITCH_AREA_LABEL}
                </MenuHeading>
                <AreaMenuRows model={areas} />
              </MenuGroup>
              <MenuSeparator />
            </>
          ) : null}
          <MenuItems items={entries} context={context} />
          {inDemo && areas ? (
            <>
              {entries.length > 0 ? <MenuSeparator /> : null}
              <MenuGroup className="itsm-Menu__group" aria-labelledby={demoId}>
                <MenuHeading className="itsm-Menu__heading" id={demoId}>
                  Demo
                </MenuHeading>
                <MenuItems items={demoEntries} context={context} />
                <AreaHomeRow model={areas} />
              </MenuGroup>
            </>
          ) : null}
          {entries.length > 0 || inDemo ? <MenuSeparator /> : null}
          <MenuItem asChild className="itsm-UserMenu__signOut" textValue={signOutLabel}>
            <button type="submit" form={formId}>
              <span className="itsm-Menu__leading" aria-hidden="true">
                <Icon name="log-out" size="sm" />
              </span>
              <span className="itsm-Menu__text">
                <span className="itsm-Menu__itemLabel">{signOutLabel}</span>
              </span>
            </button>
          </MenuItem>
        </MenuContent>
      </MenuPortal>
    </MenuRoot>
  );
}
