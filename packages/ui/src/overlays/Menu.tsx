'use client';

import type { ReactElement, ReactNode, RefObject } from 'react';
import type { IconName } from '../types.js';

/**
 * One entry in a menu, as data. Items with `href` navigate; items with
 * `onSelect` act; a `disabledReason` is shown, not hidden in a tooltip.
 */
export type MenuItemSpec =
  | {
      type?: 'item';
      id: string;
      label: string;
      icon?: IconName;
      shortcut?: string;
      description?: string;
      href?: string;
      tone?: 'default' | 'danger';
      disabled?: boolean;
      disabledReason?: string;
      onSelect?(): void;
    }
  | { type: 'separator' }
  | { type: 'label'; label: string }
  | { type: 'submenu'; id: string; label: string; icon?: IconName; items: readonly MenuItemSpec[] }
  | { type: 'checkbox'; id: string; label: string; checked: boolean; onCheckedChange(checked: boolean): void }
  | {
      type: 'radio';
      id: string;
      label: string;
      value: string;
      items: readonly { value: string; label: string }[];
      onValueChange(value: string): void;
    };

export interface MenuProps {
  /** The element that opens it — usually an `IconButton` or `Button`. */
  readonly trigger: ReactElement;
  readonly items: readonly MenuItemSpec[];
  readonly label?: string;
  readonly align?: 'start' | 'center' | 'end';
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  readonly width?: number;
  /** Where focus goes on close: the trigger, or the row the menu was opened from (X-63). */
  readonly onCloseFocus?: 'trigger' | RefObject<HTMLElement | null>;
  readonly className?: string;
}

/**
 * A menu of actions on a popover material, with typeahead.
 *
 * Stub (SPEC §4.3): renders the trigger alone; the overlays package builds the
 * menu on the Radix dropdown primitive.
 */
export function Menu({ trigger }: MenuProps): ReactNode {
  return trigger;
}
