'use client';

import type { ReactNode, Ref } from 'react';
import { useHotkey } from '../a11y/hotkeys.js';
import { ariaKeyShortcuts } from '../a11y/keys.js';
import { Icon } from '../icons/Icon.js';
import { cx } from '../web/cx.js';
import { Kbd } from '../web/Kbd.js';

export interface SearchTriggerProps {
  /** What it searches, shown as the label: "Search or jump to…". Also its accessible name. */
  readonly placeholder: string;
  /** Shows the key caps and announces the shortcut. */
  readonly shortcut?: 'mod+k';
  /** Client only: opens the command palette. */
  readonly onOpen: () => void;
  /**
   * Binds the shortcut to `onOpen` (default true when `shortcut` is set).
   * `AppShell` binds ⌘K once itself and draws two triggers, so it passes false.
   */
  readonly bindShortcut?: boolean;
  /** `field` (default): an icon, the label and the key caps, collapsing to the icon below 1024 px. `icon`: the icon alone. */
  readonly display?: 'field' | 'icon';
  readonly className?: string;
  readonly ref?: Ref<HTMLButtonElement>;
}

/**
 * Looks like a search field and is a button that opens the palette — honest
 * about what happens when it is pressed (it opens a dialog, so it says
 * `aria-haspopup="dialog"`), and never a text input that turns into
 * something else when typed in.
 *
 * On the opaque v3 top bars it is a 34 px field on `surface.raisedAlt` with
 * a `border.subtle` edge, the label in `text.muted` and the key caps at the
 * end (v3 §2.14). Below 1024 px it is the magnifier alone, with the label
 * kept as its accessible name; the top bar also narrows it by the width of
 * its column.
 *
 * ⌘K works inside text fields too (D14), which is why the binding asks for
 * `allowInFields`.
 */
export function SearchTrigger({ placeholder, shortcut, onOpen, bindShortcut, display = 'field', className, ref }: SearchTriggerProps): ReactNode {
  useHotkey({
    keys: shortcut ?? 'mod+k',
    handler: () => onOpen(),
    allowInFields: true,
    description: 'Search and commands',
    group: 'General',
    enabled: shortcut !== undefined && bindShortcut !== false,
  });

  return (
    <button
      ref={ref}
      type="button"
      className={cx('itsm-SearchTrigger', display === 'icon' && 'itsm-SearchTrigger--icon', className)}
      aria-haspopup="dialog"
      aria-keyshortcuts={shortcut ? ariaKeyShortcuts(shortcut) : undefined}
      onClick={onOpen}
    >
      <Icon name="search" size="sm" className="itsm-SearchTrigger__icon" />
      <span className="itsm-SearchTrigger__label">{placeholder}</span>
      {shortcut ? <Kbd keys={shortcut} size="sm" className="itsm-SearchTrigger__keys" aria-hidden /> : null}
    </button>
  );
}
