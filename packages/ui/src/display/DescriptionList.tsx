import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

export interface DescriptionItem {
  readonly id: string;
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: string;
}

export interface DescriptionListProps {
  readonly items: readonly DescriptionItem[];
  readonly layout?: 'stacked' | 'inline' | 'grid';
  readonly dense?: boolean;
  readonly className?: string;
}

/**
 * Label and value pairs — a ticket's properties, a rule's summary — as a real
 * `<dl>`. Server-safe.
 *
 * Stub (SPEC §4.6): renders the list; the display package lays it out.
 */
export function DescriptionList({ items, layout = 'stacked', dense = false, className }: DescriptionListProps): ReactNode {
  return (
    <dl className={cx('itsm-DescriptionList', className)} data-layout={layout} data-dense={dense || undefined}>
      {items.map((item) => (
        <div key={item.id}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
