'use client';

import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SegmentedControl, type Tone } from '@itsm/ui';
import { Popover } from '@itsm/ui/overlays';

/**
 * A small two-axis grid of choices, each cell tinted by its value: the
 * priority matrix (SPEC §6.1, B §3.4).
 *
 * The shape is the information — reading along a row shows what rising
 * urgency does to a priority — so it is a real grid rather than nine labelled
 * dropdowns, with the axes written out as a visible legend (title case) and
 * every cell saying its value in text as well as colour.
 *
 * Keyboard (a `role="grid"` with one tab stop):
 *   - arrows move between cells; Home/End go to the row's ends, and with
 *     Ctrl or ⌘ to the grid's first and last cells;
 *   - Enter, Space or a click opens the cell's choice (a `SegmentedControl`
 *     in `commit` mode: arrows move, Enter chooses) and focus comes back to
 *     the cell afterwards;
 *   - the option shortcuts (`1`–`4` for P1–P4) set the focused cell at once.
 *     They are grid-scoped: the app's hotkey layer ignores keys inside a
 *     `[role=grid]`, so nothing else hears them.
 *
 * Without `onChange` the grid is read-only: a plain table of the same cells,
 * nothing focusable, no popovers — what a view-only person sees.
 */

export interface HeatGridAxis {
  /** The axis in words, shown as the legend: "Impact". */
  readonly label: string;
  readonly values: readonly { readonly id: string; readonly label: string }[];
}

export interface HeatGridOption {
  readonly value: string;
  /** Short, on the chip: "P1". */
  readonly label: string;
  /** Under it: "Critical". */
  readonly description?: string;
  readonly tone: Tone;
  /** A single key that sets the focused cell: "1". */
  readonly shortcut?: string;
}

export interface HeatGridProps {
  /** Names the grid for assistive technology. */
  readonly label: string;
  readonly rows: HeatGridAxis;
  readonly columns: HeatGridAxis;
  readonly options: readonly HeatGridOption[];
  readonly value: (row: string, column: string) => string;
  /** Cells whose value differs from what is saved: drawn with a marker and said as "changed". */
  readonly changed?: (row: string, column: string) => boolean;
  /** Client only. Absent: read-only. */
  readonly onChange?: (row: string, column: string, value: string) => void;
  readonly className?: string;
}

interface Position {
  readonly row: number;
  readonly column: number;
}

export function HeatGrid({ label, rows, columns, options, value, changed, onChange, className }: HeatGridProps): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  const [focus, setFocus] = useState<Position>({ row: 0, column: 0 });
  const [open, setOpen] = useState<string | null>(null);
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const editable = onChange !== undefined;

  const optionFor = (raw: string): HeatGridOption | undefined => options.find((option) => option.value === raw);
  const keyOf = (row: number, column: number): string => `${row}:${column}`;

  const moveTo = useCallback((next: Position) => {
    setFocus(next);
    cells.current.get(`${next.row}:${next.column}`)?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, position: Position): void => {
    const lastRow = rows.values.length - 1;
    const lastColumn = columns.values.length - 1;
    const mod = event.ctrlKey || event.metaKey;
    let next: Position | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = { row: position.row, column: Math.min(lastColumn, position.column + 1) };
        break;
      case 'ArrowLeft':
        next = { row: position.row, column: Math.max(0, position.column - 1) };
        break;
      case 'ArrowDown':
        next = { row: Math.min(lastRow, position.row + 1), column: position.column };
        break;
      case 'ArrowUp':
        next = { row: Math.max(0, position.row - 1), column: position.column };
        break;
      case 'Home':
        next = mod ? { row: 0, column: 0 } : { row: position.row, column: 0 };
        break;
      case 'End':
        next = mod ? { row: lastRow, column: lastColumn } : { row: position.row, column: lastColumn };
        break;
      default: {
        if (mod || event.altKey) return;
        const shortcut = options.find((option) => option.shortcut === event.key);
        if (shortcut && onChange) {
          event.preventDefault();
          onChange(rows.values[position.row]!.id, columns.values[position.column]!.id, shortcut.value);
        }
        return;
      }
    }
    event.preventDefault();
    moveTo(next);
  };

  const shortcuts = options.flatMap((option) => (option.shortcut ? [option.shortcut] : []));
  const shortcutText = shortcuts.length > 1 ? `${shortcuts[0]} to ${shortcuts[shortcuts.length - 1]}` : shortcuts[0];

  const header = (
    <thead>
      <tr>
        <td className="app-HeatGrid__corner" />
        {columns.values.map((column) => (
          <th key={column.id} scope="col" className="app-HeatGrid__columnHead" {...(editable ? { role: 'columnheader' } : {})}>
            <span className="itsm-visually-hidden">{columns.label} </span>
            {column.label}
          </th>
        ))}
      </tr>
    </thead>
  );

  return (
    <div className={className ? `app-HeatGrid ${className}` : 'app-HeatGrid'}>
      <p className="app-HeatGrid__axis app-HeatGrid__axis--columns" aria-hidden="true">
        {columns.label}
      </p>
      <div className="app-HeatGrid__body">
        <p className="app-HeatGrid__axis app-HeatGrid__axis--rows" aria-hidden="true">
          {rows.label}
        </p>
        <table
          className="app-HeatGrid__table"
          {...(editable ? { role: 'grid', 'aria-describedby': hintId } : {})}
          aria-label={label}
        >
          {header}
          <tbody>
            {rows.values.map((row, rowIndex) => (
              <tr key={row.id}>
                <th scope="row" className="app-HeatGrid__rowHead" {...(editable ? { role: 'rowheader' } : {})}>
                  <span className="itsm-visually-hidden">{rows.label} </span>
                  {row.label}
                </th>
                {columns.values.map((column, columnIndex) => {
                  const raw = value(row.id, column.id);
                  const option = optionFor(raw);
                  const isChanged = changed?.(row.id, column.id) ?? false;
                  const chip = (
                    <>
                      <span className="app-HeatGrid__value">{option?.label ?? raw}</span>
                      {option?.description ? <span className="app-HeatGrid__description">{option.description}</span> : null}
                      {isChanged ? (
                        <span className="app-HeatGrid__changed">
                          <span aria-hidden="true">•</span>
                          <span className="itsm-visually-hidden">, changed</span>
                        </span>
                      ) : null}
                    </>
                  );
                  if (!editable) {
                    return (
                      <td key={column.id} className="app-HeatGrid__cell" data-tone={option?.tone ?? 'neutral'}>
                        <span className="app-HeatGrid__chip">{chip}</span>
                      </td>
                    );
                  }
                  const position = { row: rowIndex, column: columnIndex };
                  const cellKey = keyOf(rowIndex, columnIndex);
                  const focused = focus.row === rowIndex && focus.column === columnIndex;
                  const where = `${rows.label} ${row.label}, ${columns.label.toLowerCase()} ${column.label}`;
                  const trigger = (
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) cells.current.set(cellKey, node);
                        else cells.current.delete(cellKey);
                      }}
                      className="app-HeatGrid__chip app-HeatGrid__button"
                      tabIndex={focused ? 0 : -1}
                      aria-label={`${where}: ${option ? `${option.label}${option.description ? ` · ${option.description}` : ''}` : raw}${isChanged ? ', changed' : ''}`}
                      aria-haspopup="dialog"
                      onFocus={() => setFocus(position)}
                      onKeyDown={(event) => onKeyDown(event, position)}
                    >
                      {chip}
                    </button>
                  );
                  return (
                    <td key={column.id} role="gridcell" className="app-HeatGrid__cell" data-tone={option?.tone ?? 'neutral'} data-changed={isChanged ? '' : undefined}>
                      <Popover
                        trigger={trigger}
                        title={where}
                        width="sm"
                        open={open === cellKey}
                        onOpenChange={(next) => setOpen(next ? cellKey : null)}
                      >
                        <SegmentedControl
                          label={`Priority for ${where}`}
                          mode="commit"
                          fullWidth
                          value={raw}
                          options={options.map((entry) => ({ value: entry.value, label: entry.label }))}
                          onValueChange={(next) => {
                            onChange(row.id, column.id, next);
                            setOpen(null);
                          }}
                        />
                        <p className="app-HeatGrid__popoverHint">
                          {option?.description ? `Now ${option.label} · ${option.description}. ` : ''}Arrows move, Enter chooses.
                        </p>
                      </Popover>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable ? (
        <p id={hintId} className="app-HeatGrid__hint">
          Arrow keys move between cells; Enter changes one{shortcutText ? `, or type ${shortcutText} to set it directly` : ''}.
        </p>
      ) : null}
    </div>
  );
}
