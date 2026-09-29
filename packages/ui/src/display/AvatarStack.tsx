import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface AvatarStackPerson {
  readonly name: string;
  readonly initials?: string;
}

export interface AvatarStackProps {
  readonly people: readonly AvatarStackPerson[];
  /** Default 3; the rest become "+2". */
  readonly max?: number;
  readonly size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  readonly className?: string;
}

/**
 * Overlapping avatars with a "+2" overflow; every name is in the accessible
 * name, not only the ones drawn. Server-safe.
 *
 * Stub (SPEC §4.6): renders the names as text; the display package draws the
 * stack with `Avatar`.
 */
export function AvatarStack({ people, max = 3, size = 'sm', className }: AvatarStackProps): ReactNode {
  return (
    <span className={cx('itsm-AvatarStack', className)} data-size={size} data-max={max}>
      {people.map((person) => person.name).join(', ')}
    </span>
  );
}
