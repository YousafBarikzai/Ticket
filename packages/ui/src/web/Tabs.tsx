'use client';

import { useState, type ReactNode } from 'react';
import { cx } from './cx.js';
import { useStableId } from '../a11y/ids.js';
import { useRovingTabIndex } from '../a11y/roving-tabindex.js';

export interface TabItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly content: ReactNode;
  readonly disabled?: boolean;
  /** A count or status pill; announced after the label. */
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
  readonly className?: string;
}

export function Tabs({ label, items, value, defaultValue, onChange, activation = 'automatic', className }: TabsProps): ReactNode {
  const baseId = useStableId('itsm-tabs');
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
    <div className={cx('itsm-Tabs', className)}>
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
              {item.label}
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
