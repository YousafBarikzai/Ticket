'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useId, type ComponentPropsWithRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import type { IconName } from '../types.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { cx } from '../web/cx.js';
import { MenuItems, type MenuKit } from './menu-items.js';

/**
 * One entry in a menu, as data. Items with `href` navigate; items with
 * `onSelect` act; a `disabledReason` is shown, not hidden in a tooltip. An
 * item may carry a third line (`detail`) and say it is the current one
 * (`current`), as the area switcher's rows do (A2 §5.3.2).
 */
export type MenuItemSpec =
  | {
      type?: 'item';
      id: string;
      label: string;
      icon?: IconName;
      shortcut?: string;
      description?: string;
      /**
       * A third line under the description — the area menu's persona line,
       * "You'll continue as Emma Clarke, Finance Manager". Part of the item's
       * description for assistive technology.
       */
      detail?: string;
      /**
       * The item is where the person already is: a trailing check in the
       * accent and `aria-current="true"` (the area menu's current area).
       */
      current?: boolean;
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
  /** The element that opens it — usually an `IconButton` or `Button`. It must forward its ref and spread props. */
  readonly trigger: ReactElement<{ id?: string }>;
  readonly items: readonly MenuItemSpec[];
  /** The menu's name when the trigger's is not the right one ("More actions for INC-000123"). */
  readonly label?: string;
  readonly align?: 'start' | 'center' | 'end';
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  /** Pixels. Otherwise it fits its widest item, between 220 and 360 px. */
  readonly width?: number;
  /** Where focus goes on close: the trigger, or the row the menu was opened from (X-63). */
  readonly onCloseFocus?: 'trigger' | RefObject<HTMLElement | null>;
  /**
   * Controlled open state, for a menu opened from somewhere other than its
   * trigger — a row's `.` shortcut opening its ⋯ menu. Uncontrolled otherwise.
   */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string;
}

/** The dropdown-menu parts, for the shared item renderer. */
export const dropdownMenuKit: MenuKit = {
  Item: DropdownMenu.Item,
  CheckboxItem: DropdownMenu.CheckboxItem,
  RadioGroup: DropdownMenu.RadioGroup,
  RadioItem: DropdownMenu.RadioItem,
  ItemIndicator: DropdownMenu.ItemIndicator,
  Label: DropdownMenu.Label,
  Separator: DropdownMenu.Separator,
  Group: DropdownMenu.Group,
  Sub: DropdownMenu.Sub,
  SubTrigger: DropdownMenu.SubTrigger,
  SubContent: DropdownMenu.SubContent,
  Portal: DropdownMenu.Portal,
};

/**
 * A menu of actions on the popover material, on the Radix dropdown menu:
 * arrow keys, Home/End, typeahead (type the first letters of an item),
 * submenus with pointer grace, collision-aware placement, and Escape that
 * closes this menu and nothing under it.
 *
 * `material.popover` (glass at ≥ 0.96 alpha, solid where transparency is
 * reduced), radius `xl`, 6 px padding, 32 px items in `callout`; the
 * highlighted item is `surface.selected` with `text.primary`, plus an inset
 * focus ring when the keyboard moved there. It scales in from the trigger
 * over `fast` and never overshoots.
 *
 * Focus goes back to the trigger on close, or to `onCloseFocus` — the row a
 * ⋯ menu or a `.` shortcut was opened from.
 *
 * Not modal: a menu does not hide the page from assistive technology or lock
 * its scrolling (a pressed item elsewhere, Tab, or Escape closes it). A modal
 * Radix menu would mark the page `aria-hidden` around focusable controls for
 * the few seconds it is open, which is exactly what the audit forbids.
 */
export function Menu({ trigger, items, label, align = 'start', side = 'bottom', width, onCloseFocus = 'trigger', open, onOpenChange, className }: MenuProps): ReactNode {
  const Link = useOptionalItsm()?.Link ?? null;
  const generatedId = useId();
  // The trigger's own id wins when it has one (Radix merges the child's props
  // over its own), so the menu is labelled by whichever id the button ends up with.
  const triggerId = trigger.props.id ?? `${generatedId}-trigger`;

  return (
    <DropdownMenu.Root modal={false} {...(open === undefined ? {} : { open })} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild id={triggerId}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent
          align={align}
          side={side}
          aria-label={label}
          aria-labelledby={label ? undefined : triggerId}
          data-itsm-opener={triggerId}
          className={className}
          style={width ? { inlineSize: width } : undefined}
          onCloseAutoFocus={(event) => {
            if (onCloseFocus === 'trigger') return;
            event.preventDefault();
            onCloseFocus.current?.focus();
          }}
        >
          <MenuItems items={items} context={{ kit: dropdownMenuKit, Link }} />
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* -------------------------------------------------------------------------
 * Styled parts, for a menu composed by hand (a header row, a custom item)
 * that should still look and behave like every other menu.
 * ---------------------------------------------------------------------- */

/** The menu surface, with the design system's offsets, collision padding and looping. */
export function MenuContent({ className, sideOffset = 6, collisionPadding = 8, loop = true, ...props }: ComponentPropsWithRef<typeof DropdownMenu.Content>): ReactNode {
  return <DropdownMenu.Content {...props} sideOffset={sideOffset} collisionPadding={collisionPadding} loop={loop} className={cx('itsm-Menu__content', className)} />;
}

/** A plain menu item row. */
export function MenuItem({ className, ...props }: ComponentPropsWithRef<typeof DropdownMenu.Item>): ReactNode {
  return <DropdownMenu.Item {...props} className={cx('itsm-Menu__item', className)} />;
}

/** A hairline between groups. */
export function MenuSeparator({ className, ...props }: ComponentPropsWithRef<typeof DropdownMenu.Separator>): ReactNode {
  return <DropdownMenu.Separator {...props} className={cx('itsm-Menu__separator', className)} />;
}

/** A group heading, in sentence case `subheadline`. */
export function MenuHeading({ className, ...props }: ComponentPropsWithRef<typeof DropdownMenu.Label>): ReactNode {
  return <DropdownMenu.Label {...props} className={cx('itsm-Menu__heading', className)} />;
}

export const MenuRoot = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuPortal = DropdownMenu.Portal;
export const MenuGroup = DropdownMenu.Group;
