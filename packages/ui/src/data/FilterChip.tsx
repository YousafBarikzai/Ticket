'use client';

import { useRef, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { Popover } from '../overlays/Popover.js';
import { cx } from '../web/cx.js';

export interface FilterChipProps {
  readonly label: string;
  /** The current choice in words: "Open, Paused". */
  readonly valueLabel?: string;
  readonly active: boolean;
  /** Client only. The chip's ×. */
  readonly onClear?: () => void;
  /** The popover content: a checkbox list, a date range. */
  readonly children: ReactNode;
  /** Controlled open state — `FilterBar` opens a chip the moment it is added from "+ Filter". */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** The popover's width: `sm` (280 px, default) or `md` (360 px) for a date range. */
  readonly width?: 'sm' | 'md';
  readonly className?: string;
}

/**
 * "Status: Open, Paused ×" — a filter as a capsule that opens its own
 * options.
 *
 * Two sibling buttons in one capsule, never one inside the other (X-62): the
 * chip itself opens a popover (a labelled dialog, "Status"), and the × clears
 * the filter. An inactive chip is a quiet grey capsule reading just "Status"
 * with a chevron; an active one takes the accent tint and names its value, so
 * every filter in force is visible at a glance — none hides in the URL.
 */
export function FilterChip({ label, valueLabel, active, onClear, children, open, onOpenChange, width = 'sm', className }: FilterChipProps): ReactNode {
  const shown = active && valueLabel ? valueLabel : undefined;
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <span className={cx('itsm-FilterChip', className)} data-active={active ? '' : undefined}>
      <Popover
        title={label}
        width={width}
        align="start"
        {...(open === undefined ? {} : { open })}
        {...(onOpenChange ? { onOpenChange } : {})}
        trigger={
          <button type="button" ref={trigger} className="itsm-FilterChip__trigger">
            <span className="itsm-FilterChip__label">
              {label}
              {shown ? <span className="itsm-FilterChip__separator">: </span> : null}
            </span>
            {shown ? <span className="itsm-FilterChip__value">{shown}</span> : null}
            <Icon name="chevron-down" size="xs" className="itsm-FilterChip__chevron" />
          </button>
        }
      >
        {children}
      </Popover>
      {active && onClear ? (
        <button
          type="button"
          className="itsm-FilterChip__clear"
          aria-label={`Clear ${label} filter`}
          onClick={() => {
            onClear();
            // The × goes with the value; focus stays on the chip rather than
            // falling to the page. A chip that went too (an unpinned filter)
            // leaves it to the filter bar.
            setTimeout(() => {
              if (trigger.current?.isConnected) trigger.current.focus();
            }, 0);
          }}
        >
          <Icon name="x" size="xs" />
        </button>
      ) : null}
    </span>
  );
}
