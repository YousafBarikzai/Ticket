'use client';

import type { ReactElement, ReactNode, RefCallback } from 'react';
import type { MenuItemSpec } from '../overlays/Menu.js';
import { lazyModule, useIntentLoader, type IntentTriggerProps } from './lazy.js';

/** What a trigger drawn by `LazyMenuButton` receives: spread it all on the button. */
export type LazyTriggerProps = Partial<Omit<IntentTriggerProps, 'ref'>> & {
  readonly ref: RefCallback<HTMLButtonElement>;
  readonly 'aria-haspopup'?: 'menu';
  readonly 'aria-expanded'?: boolean;
};

/** The dropdown menu, from the overlays subpath, fetched the first time any frame menu is wanted. */
export const menuModule = lazyModule(() => import('../overlays/Menu.js'));

export interface LazyMenuButtonProps {
  readonly items: readonly MenuItemSpec[];
  /** Draws the button. It must spread the props it is given (they carry the ref and the handlers). */
  readonly renderTrigger: (props: LazyTriggerProps) => ReactElement<{ id?: string }>;
  readonly label?: string;
  readonly align?: 'start' | 'center' | 'end';
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  readonly width?: number;
  readonly className?: string;
}

/**
 * A button that opens a `Menu` — without the menu library in the first load.
 *
 * Until someone points at it, focuses it or presses it, it is a plain button
 * that says it has a menu (`aria-haspopup`, `aria-expanded="false"`); the
 * Radix menu arrives on that intent and takes over the same place, keeping
 * focus and honouring a press made while it was loading (`useIntentLoader`).
 * Used for the brand's app switcher, the page header's ⋯ and the breadcrumb
 * trail's collapsed middle.
 */
export function LazyMenuButton({ items, renderTrigger, label, align, side, width, className }: LazyMenuButtonProps): ReactNode {
  const loader = useIntentLoader(menuModule);
  if (!loader.loaded) {
    return renderTrigger({ ...loader.intentProps, 'aria-haspopup': 'menu', 'aria-expanded': false });
  }
  const { Menu } = loader.loaded;
  return (
    <Menu
      trigger={renderTrigger({ ref: loader.triggerRef })}
      items={items}
      open={loader.open}
      onOpenChange={loader.setOpen}
      {...(label ? { label } : {})}
      {...(align ? { align } : {})}
      {...(side ? { side } : {})}
      {...(width ? { width } : {})}
      {...(className ? { className } : {})}
    />
  );
}
