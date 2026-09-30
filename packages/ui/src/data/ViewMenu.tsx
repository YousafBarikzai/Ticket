'use client';

import type { ReactNode } from 'react';
import { Menu, type MenuItemSpec } from '../overlays/Menu.js';
import { useTheme } from '../theme/ThemeProvider.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';

export interface ViewMenuColumn {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly hideable: boolean;
}

export type Density = 'comfortable' | 'compact';

export interface ViewMenuProps {
  readonly sort?: {
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly value: string;
    onChange(value: string): void;
  };
  /** Offers Comfortable / Compact. */
  readonly density?: boolean;
  /**
   * The density shown as chosen, and what choosing one does — for a table
   * that keeps its own. Without them the menu reads and writes the person's
   * density preference, the same one the account menu sets.
   */
  readonly densityValue?: Density;
  readonly onDensityChange?: (density: Density) => void;
  readonly columns?: readonly ViewMenuColumn[];
  onColumnsChange?(columns: ViewMenuColumn[]): void;
  readonly extra?: readonly MenuItemSpec[];
  /** The trigger's words. Default "View". */
  readonly label?: string;
  readonly className?: string;
}

/** The menu's entries, in the order a person scans them: how it is ordered, how dense, what is shown. */
export function viewMenuItems({
  sort,
  density,
  densityValue,
  onDensityChange,
  columns,
  onColumnsChange,
  extra,
}: Omit<ViewMenuProps, 'label' | 'className'> & { readonly density?: boolean; readonly densityValue: Density; readonly onDensityChange: (density: Density) => void }): MenuItemSpec[] {
  const sections: MenuItemSpec[][] = [];
  if (sort && sort.options.length > 0) {
    sections.push([{ type: 'radio', id: 'sort', label: 'Sort by', value: sort.value, items: sort.options, onValueChange: sort.onChange }]);
  }
  if (density) {
    sections.push([
      {
        type: 'radio',
        id: 'density',
        label: 'Density',
        value: densityValue,
        items: [
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
        ],
        onValueChange: (value) => onDensityChange(value === 'compact' ? 'compact' : 'comfortable'),
      },
    ]);
  }
  const hideable = (columns ?? []).filter((column) => column.hideable);
  if (hideable.length > 0 && onColumnsChange) {
    sections.push([
      { type: 'label', label: 'Columns' },
      ...hideable.map<MenuItemSpec>((column) => ({
        type: 'checkbox',
        id: `column-${column.id}`,
        label: column.label,
        checked: column.visible,
        onCheckedChange: (checked: boolean) =>
          onColumnsChange((columns ?? []).map((candidate) => (candidate.id === column.id ? { ...candidate, visible: checked } : candidate))),
      })),
    ]);
  }
  if (extra && extra.length > 0) sections.push([...extra]);
  return sections.flatMap((section, index) => (index === 0 ? section : [{ type: 'separator' as const }, ...section]));
}

/**
 * One "View" menu for how a list looks — sort, density, columns, technical
 * keys — instead of a row of separate toolbar buttons (SPEC §4.7).
 *
 * Every entry says its state: the sort and density as radio groups ("Sort
 * by, group"), the columns as checkboxes. Choosing keeps the menu's promise
 * of Radix menus — typeahead, arrow keys, focus back on the trigger. With
 * nothing to offer it renders nothing, rather than a button that opens an
 * empty menu.
 */
export function ViewMenu({ sort, density, densityValue, onDensityChange, columns, onColumnsChange, extra, label = 'View', className }: ViewMenuProps): ReactNode {
  const { prefs, setPrefs } = useTheme();
  const items = viewMenuItems({
    ...(sort ? { sort } : {}),
    ...(density === undefined ? {} : { density }),
    densityValue: densityValue ?? prefs.density,
    onDensityChange: onDensityChange ?? ((next) => setPrefs({ density: next })),
    ...(columns ? { columns } : {}),
    ...(onColumnsChange ? { onColumnsChange } : {}),
    ...(extra ? { extra } : {}),
  });
  if (items.length === 0) return null;
  return (
    <Menu
      label={`${label} options`}
      align="end"
      items={items}
      className={cx('itsm-ViewMenu', className)}
      trigger={
        <Button className="itsm-ViewMenu__trigger" size="sm" variant="ghost" iconStart="sliders-horizontal" iconEnd="chevron-down">
          {label}
        </Button>
      }
    />
  );
}
