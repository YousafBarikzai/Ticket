import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface DisclosureProps {
  readonly summary: ReactNode;
  readonly defaultOpen?: boolean;
  /** Remembers open or closed on this device — a client enhancement; the element works without it. */
  readonly persistKey?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Progressive disclosure on the native `<details>` element, which opens and
 * closes with no JavaScript and is found by in-page search. Server-safe.
 *
 * Stub (SPEC §4.6): the bare element; the display package styles and animates it.
 */
export function Disclosure({ summary, defaultOpen = false, children, className }: DisclosureProps): ReactNode {
  return (
    <details className={cx('itsm-Disclosure', className)} open={defaultOpen || undefined}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
