'use client';

import * as RadixContextMenu from '@radix-ui/react-context-menu';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { useOptionalItsm } from '../provider/ItsmProvider.js';
import { cx } from '../web/cx.js';
import type { MenuItemSpec } from './Menu.js';
import { useMediaQuery } from './media.js';
import { MenuItems, type MenuKit } from './menu-items.js';

export interface ContextMenuProps {
  readonly items: readonly MenuItemSpec[];
  /** The region that opens it on right-click, long-press or the ContextMenu key. It must forward its ref and spread props. */
  readonly children: ReactElement;
  /**
   * Off on touch screens, where a long-press belongs to the platform (on iOS
   * a link's long-press is its preview). Defaults to true when the child is a
   * link, false otherwise (X-95).
   */
  readonly disabledOnCoarse?: boolean;
  /** The menu's name, e.g. "Actions for INC-000123". */
  readonly label?: string;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string;
}

/**
 * The context-menu parts. The two Radix menu packages are the same menu
 * under two names, so their parts are interchangeable for the renderer; the
 * cast only renames them.
 */
const contextMenuKit = {
  Item: RadixContextMenu.Item,
  CheckboxItem: RadixContextMenu.CheckboxItem,
  RadioGroup: RadixContextMenu.RadioGroup,
  RadioItem: RadixContextMenu.RadioItem,
  ItemIndicator: RadixContextMenu.ItemIndicator,
  Label: RadixContextMenu.Label,
  Separator: RadixContextMenu.Separator,
  Group: RadixContextMenu.Group,
  Sub: RadixContextMenu.Sub,
  SubTrigger: RadixContextMenu.SubTrigger,
  SubContent: RadixContextMenu.SubContent,
  Portal: RadixContextMenu.Portal,
} as unknown as MenuKit;

/** Touch as the primary pointer. False on the server and until the first effect, so the markup never depends on the device. */
const COARSE_POINTER = '(pointer: coarse)';

function isLink(element: ReactNode): boolean {
  if (!isValidElement<{ href?: unknown }>(element)) return false;
  return element.type === 'a' || typeof element.props.href === 'string';
}

/**
 * The right-click menu, on the Radix context menu. It always mirrors a
 * visible ⋯ button (SPEC §4.3): a hidden gesture is never the only way to an
 * action, so the items here are the same `MenuItemSpec[]` the button's `Menu`
 * shows, and keyboard users reach them through that button (or a row's `.`).
 *
 * Opens at the pointer; everything else — typeahead, submenus, Escape as the
 * top layer, the look — is `Menu`'s.
 */
export function ContextMenu({ items, children, disabledOnCoarse, label, onOpenChange, className }: ContextMenuProps): ReactNode {
  const Link = useOptionalItsm()?.Link ?? null;
  const coarse = useMediaQuery(COARSE_POINTER);
  const offOnTouch = disabledOnCoarse ?? isLink(children);

  return (
    <RadixContextMenu.Root modal={false} onOpenChange={onOpenChange}>
      <RadixContextMenu.Trigger asChild disabled={offOnTouch && coarse}>
        {children}
      </RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content className={cx('itsm-Menu__content', 'itsm-ContextMenu', className)} aria-label={label} collisionPadding={8} loop>
          <MenuItems items={items} context={{ kit: contextMenuKit, Link }} />
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}
