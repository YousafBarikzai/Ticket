'use client';

import { useState, type ReactNode } from 'react';
import { cx } from './cx.js';
import { useStableId } from '../a11y/ids.js';
import { useRovingTabIndex } from '../a11y/roving-tabindex.js';
import { Count } from '../display/Count.js';
import { useOptionalItsm } from '../provider/ItsmProvider.js';

export interface TabItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly content: ReactNode;
  readonly disabled?: boolean;
  /**
   * How many things the panel holds, drawn as a small `Count` after the label
   * (accent on the selected tab) and spoken with it: "Register, 24". `null`
   * — not known yet — draws nothing, never a 0.
   */
  readonly count?: number | null;
  /** An alert badge or status pill (not a count: that is `count`); announced after the label. */
  readonly badge?: ReactNode;
}

export interface TabsProps {
  /** Names the tab list for screen readers, e.g. "Ticket detail sections". */
  readonly label: string;
  readonly items: readonly TabItem[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (id: string) => void;
  /**
   * `automatic` selects as the user arrows (APG default, right for cheap
   * panels); `manual` waits for Enter or Space, which is the honest choice when
   * a panel fetches data.
   */
  readonly activation?: 'automatic' | 'manual';
  /**
   * `underline` (default): page-level tabs over a hairline, the selected one
   * marked by an accent bar. `pill`: quiet rounded tabs, the selected one a
   * raised pill — for a short set of panels inside a card or a list (the
   * attention list's tabs). `segmented`: the tabs on a track with the
   * selected one raised, like a `SegmentedControl`.
   */
  readonly variant?: 'underline' | 'pill' | 'segmented';
  readonly className?: string;
}

/**
 * Tabs for switching panels in place. Sections that are separate pages are a
 * `TabNav` of links instead.
 *
 * The selected tab is marked in `text.primary` at weight 600 with the
 * accent bar (or the raised pill or segment) — never in link blue, which
 * would read as "go somewhere". Each label reserves the width of its bold
 * self, so the row does not shift when the selection moves.
 *
 * A tab's count is the shared `Count`, so it looks and is spoken like every
 * other count in the product: the digits are hidden from assistive
 * technology and the tab is named "Register, 24".
 */
export function Tabs({
  label,
  items,
  value,
  defaultValue,
  onChange,
  activation = 'automatic',
  variant = 'underline',
  className,
}: TabsProps): ReactNode {
  const baseId = useStableId('itsm-tabs');
  const locale = useOptionalItsm()?.locale;
  const [uncontrolled, setUncontrolled] = useState(() => defaultValue ?? items.find((item) => !item.disabled)?.id ?? '');
  const selectedId = value ?? uncontrolled;
  const selectedIndex = Math.max(
    items.findIndex((item) => item.id === selectedId),
    0,
  );

  const select = (index: number): void => {
    const item = items[index];
    if (!item || item.disabled) return;
    if (value === undefined) setUncontrolled(item.id);
    onChange?.(item.id);
  };

  const roving = useRovingTabIndex({
    count: items.length,
    orientation: 'horizontal',
    loop: true,
    defaultIndex: selectedIndex,
    isDisabled: (index) => items[index]?.disabled === true,
    onMove: activation === 'automatic' ? select : undefined,
  });

  const selected = items[selectedIndex];

  return (
    <div className={cx('itsm-Tabs', `itsm-Tabs--${variant}`, className)}>
      <div role="tablist" aria-label={label} aria-orientation="horizontal" className="itsm-Tabs__list">
        {items.map((item, index) => {
          const itemProps = roving.getItemProps(index);
          const isSelected = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              className="itsm-Tabs__tab"
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.id}`}
              disabled={item.disabled}
              tabIndex={itemProps.tabIndex}
              ref={itemProps.ref}
              onFocus={itemProps.onFocus}
              onKeyDown={(event) => {
                if (activation === 'manual' && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  select(index);
                  return;
                }
                itemProps.onKeyDown(event);
              }}
              onClick={() => {
                select(index);
                roving.setActiveIndex(index);
              }}
            >
              <span className="itsm-Tabs__label" data-text={typeof item.label === 'string' ? item.label : undefined}>
                {item.label}
              </span>
              {item.count === undefined || item.count === null ? null : (
                <Count value={item.count} size="sm" tone={isSelected ? 'accent' : 'neutral'} locale={locale} className="itsm-Tabs__count" />
              )}
              {item.badge}
            </button>
          );
        })}
      </div>
      {selected ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${selected.id}`}
          aria-labelledby={`${baseId}-tab-${selected.id}`}
          // The panel is focusable so that Tab from the tab list lands on the
          // content rather than skipping past it.
          tabIndex={0}
          className="itsm-Tabs__panel"
        >
          {selected.content}
        </div>
      ) : null}
    </div>
  );
}
