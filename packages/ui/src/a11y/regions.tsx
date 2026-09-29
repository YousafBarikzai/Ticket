'use client';

import type { ReactNode } from 'react';

export interface RegionProps {
  readonly id: string;
  /** The landmark's accessible name, also what F6 announces on arrival. */
  readonly label: string;
  readonly as?: 'nav' | 'section' | 'article' | 'aside';
  readonly className?: string;
  readonly children: ReactNode;
}

/** The registry of F6 regions, for the provider and the panes that move focus between them. */
export interface Regions {
  /** Focuses the next registered region in document order, wrapping. */
  focusNext(): void;
  focusPrevious(): void;
}

/**
 * A landmark that F6 and Shift+F6 cycle through (X-65): the sidebar, the list
 * pane, the conversation, the inspector. `tabIndex={-1}` so it can take focus
 * without joining the tab order.
 *
 * Stub (SPEC §4.1): renders the landmark; the foundations package registers it.
 */
export function Region({ id, label, as: Tag = 'section', className, children }: RegionProps): ReactNode {
  return (
    <Tag id={id} aria-label={label} tabIndex={-1} className={className} data-itsm-region="">
      {children}
    </Tag>
  );
}

/** Stub (SPEC §4.1): moves focus nowhere yet. */
export function useRegions(): Regions {
  return noRegions;
}

const noRegions: Regions = { focusNext() {}, focusPrevious() {} };
