'use client';

import type { ReactNode, RefObject } from 'react';
import { cx } from '../web/cx.js';

export type SheetCloseReason = 'escape' | 'scrim' | 'close-button' | 'swipe';

export interface SheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean, reason?: SheetCloseReason) => void;
  /** `auto`: from the end edge at md and up, from the bottom below. */
  readonly side?: 'end' | 'start' | 'bottom' | 'auto';
  readonly size?: 'sm' | 'md' | 'lg' | 'full';
  readonly title: string;
  readonly description?: string;
  readonly headerMeta?: ReactNode;
  readonly headerActions?: ReactNode;
  /** Sticky and opaque. */
  readonly footer?: ReactNode;
  /**
   * `false` makes it an inspector: a dialog without `aria-modal`, no scrim and
   * no focus trap, closed by Escape, reachable with F6.
   */
  readonly modal?: boolean;
  /** Closing asks "Discard changes?". */
  readonly dirty?: boolean;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A panel from a screen edge: details, creation flows, the mobile navigation.
 * Opaque, never glass (D6).
 *
 * Stub (SPEC §4.3): renders its content while open; the overlays package
 * builds it on the Radix dialog primitive with the edge, bottom-sheet and
 * inspector variants.
 */
export function Sheet({ open, title, modal = true, footer, children, className }: SheetProps): ReactNode {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal={modal || undefined} aria-label={title} className={cx('itsm-Sheet', className)}>
      <h2 className="itsm-Sheet__title">{title}</h2>
      {children}
      {footer}
    </div>
  );
}
