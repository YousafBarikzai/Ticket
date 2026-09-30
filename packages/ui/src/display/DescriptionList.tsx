import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../web/cx.js';

export interface DescriptionItem {
  readonly id: string;
  readonly label: string;
  /** Empty (`null`, `undefined`, `''`) shows "—", spoken as "Not set". */
  readonly value: ReactNode;
  /** A line under the value: where it came from, what it means. */
  readonly hint?: string;
}

export interface DescriptionListProps extends Omit<HTMLAttributes<HTMLDListElement>, 'children'> {
  readonly items: readonly DescriptionItem[];
  /**
   * `stacked` (default): label above value. `inline`: label and value side by
   * side in rows divided by hairlines, the inspector's layout — it stacks by
   * itself when its container is narrower than 24 rem. `grid`: stacked pairs
   * in as many columns as fit.
   */
  readonly layout?: 'stacked' | 'inline' | 'grid';
  /** Tighter spacing and `callout` values, for inspectors and drawers. */
  readonly dense?: boolean;
  /** What an empty value says to a screen reader. "Not set" by default. */
  readonly emptyLabel?: string;
  readonly className?: string;
  readonly ref?: Ref<HTMLDListElement>;
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === false || (typeof value === 'string' && value.trim() === '');
}

/**
 * Label and value pairs — a ticket's properties, a rule's summary — as a real
 * `<dl>`, so a screen reader announces each value with its term. Server-safe.
 *
 * Each pair is wrapped in a `<div>` (valid inside `<dl>`), which is what lets
 * the layouts treat a pair as one item. An empty value shows an em dash
 * rather than a blank, with "Not set" for a screen reader, so "nothing" is
 * never mistaken for "not loaded".
 */
export function DescriptionList({
  items,
  layout = 'stacked',
  dense = false,
  emptyLabel = 'Not set',
  className,
  ref,
  ...rest
}: DescriptionListProps): ReactNode {
  return (
    <dl {...rest} ref={ref} className={cx('itsm-DescriptionList', className)} data-layout={layout} data-dense={dense ? '' : undefined}>
      {items.map((item) => (
        <div key={item.id} className="itsm-DescriptionList__item">
          <dt className="itsm-DescriptionList__label">{item.label}</dt>
          <dd className="itsm-DescriptionList__value">
            {isEmpty(item.value) ? (
              <>
                <span className="itsm-DescriptionList__empty" aria-hidden="true">
                  —
                </span>
                <span className="itsm-visually-hidden">{emptyLabel}</span>
              </>
            ) : (
              item.value
            )}
            {item.hint ? <span className="itsm-DescriptionList__hint">{item.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
