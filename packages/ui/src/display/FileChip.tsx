import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface FileChipProps {
  readonly name: string;
  /** Bytes. */
  readonly size?: number;
  readonly mime?: string;
  readonly href?: string;
  /** `unavailable` reads "· preview soon" rather than looking broken (X-80). */
  readonly state?: 'ready' | 'scanning' | 'blocked' | 'unavailable';
  /** Client only: shows a remove button. A server component renders the chip without one. */
  readonly onRemove?: () => void;
  readonly className?: string;
}

/**
 * An attachment: icon, name, size and state. Server-safe when rendered
 * without `onRemove`.
 *
 * Stub (SPEC §4.6): renders the name, linked when there is an `href`; the
 * display package adds the rest.
 */
export function FileChip({ name, href, state = 'ready', className }: FileChipProps): ReactNode {
  return (
    <span className={cx('itsm-FileChip', className)} data-state={state}>
      {href ? <a href={href}>{name}</a> : name}
    </span>
  );
}
