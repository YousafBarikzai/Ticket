'use client';

import type { ReactNode } from 'react';
import type { EmptySpec, IconName, Tone } from '../types.js';
import { cx } from '../web/cx.js';

export interface ActivityActor {
  readonly name: string;
  readonly kind?: 'person' | 'system' | 'ai' | 'channel';
  readonly initials?: string;
}

/** One thing that happened: "Jo changed Status from New to In progress". */
export interface ActivityItem {
  readonly id: string;
  /** ISO 8601. */
  readonly at: string;
  readonly actor?: ActivityActor;
  readonly verb: string;
  readonly object?: { readonly label: string; readonly href?: string };
  readonly from?: string;
  readonly to?: string;
  readonly detail?: string;
  readonly channel?: string;
  readonly icon?: IconName;
  readonly tone?: Tone;
}

export interface ActivityFeedProps {
  readonly label: string;
  readonly items: readonly ActivityItem[];
  readonly groupBy?: 'day' | 'none';
  readonly max?: number;
  readonly viewAllHref?: string;
  readonly empty?: EmptySpec;
  /** Items that arrived since render, held behind "N new · Show" so the list never shifts under the reader. */
  readonly newCount?: number;
  /** Client only. */
  readonly onShowNew?: () => void;
  readonly className?: string;
}

/**
 * A feed of what happened, grouped by day under `h3`s.
 *
 * Stub (SPEC §4.6): renders the items as an ordered list; the display package
 * adds grouping, actors, times and the new-items bar.
 */
export function ActivityFeed({ label, items, className }: ActivityFeedProps): ReactNode {
  return (
    <ol aria-label={label} className={cx('itsm-ActivityFeed', className)}>
      {items.map((item) => (
        <li key={item.id}>
          {[item.actor?.name, item.verb, item.object?.label].filter(Boolean).join(' ')}
        </li>
      ))}
    </ol>
  );
}
