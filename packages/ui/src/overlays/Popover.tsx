'use client';

import type { ReactElement, ReactNode } from 'react';

export interface PopoverProps {
  readonly trigger: ReactElement;
  /** Makes the popover a dialog labelled by this title. */
  readonly title?: string;
  readonly children: ReactNode;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly align?: 'start' | 'center' | 'end';
  readonly width?: 'sm' | 'md' | 'lg' | number;
  readonly modal?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string;
}

/**
 * Anchored, non-menu content: a filter's options, the *View only* explanation.
 *
 * Stub (SPEC §4.3): renders the trigger alone; the overlays package builds it
 * on the Radix popover primitive.
 */
export function Popover({ trigger }: PopoverProps): ReactNode {
  return trigger;
}
