'use client';

import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Button, notify } from '@itsm/ui';
import type { MenuItemSpec } from '@itsm/ui/overlays';
import { exportTable } from './csv.js';

/** The menu library, fetched the first time somebody presses Export (v2 pattern, `ViewOnly`). */
const Menu = lazy(() => import('@itsm/ui/overlays').then((module) => ({ default: module.Menu })));

export interface ExportMenuProps {
  /**
   * "Download CSV": the table inside `selector` (a `RegisterCard`'s is
   * `[data-export-table]`), written as `filename`; `caption` says what goes
   * out ("Exports the 50 rows shown").
   */
  readonly csv?: { readonly selector: string; readonly filename: string; readonly caption: string };
  /** "Print or save as PDF": the browser's own print, with the page's print stylesheet. */
  readonly print?: boolean;
  /** "Schedule as a report": where Insights › Reports opens; given only to someone with `analytics.manage`. */
  readonly report?: string;
  /** The button's words; "Export". */
  readonly label?: string;
}

/** The menu's items, in the order A7 §2.3 gives them; `onCsv` and `onPrint` do the work. */
export function exportItems(props: ExportMenuProps, actions: { readonly onCsv: () => void; readonly onPrint: () => void }): MenuItemSpec[] {
  const items: MenuItemSpec[] = [];
  if (props.csv) items.push({ id: 'csv', label: 'Download CSV', icon: 'download', description: props.csv.caption, onSelect: actions.onCsv });
  if (props.print) items.push({ id: 'print', label: 'Print or save as PDF', icon: 'file', onSelect: actions.onPrint });
  if (props.report) items.push({ id: 'report', label: 'Schedule as a report', icon: 'calendar', href: props.report });
  return items;
}

/**
 * Downloads the table `csv` names, and says what happened: how many rows went
 * out, or — when the table is not on the page (an empty register) — that
 * there was nothing to export, rather than handing over an empty file.
 */
export function downloadTableCsv(csv: NonNullable<ExportMenuProps['csv']>): number | null {
  const rows = exportTable(csv.selector, csv.filename);
  if (rows === null) notify('Nothing to export', { tone: 'info', description: 'There are no rows on this page.' });
  else notify(`Exported ${rows} ${rows === 1 ? 'row' : 'rows'}`, { tone: 'success' });
  return rows;
}

/**
 * "Export ▾" in a page's toolbar (G2, A7 §2.3): download the rows on screen as
 * CSV, print the page (or save it as a PDF), schedule it as a report.
 *
 * Until it is pressed it is a plain button that says it has a menu; the menu
 * arrives on that press and opens in the same place, so the menu library is
 * never part of a page's first load.
 */
export function ExportMenu(props: ExportMenuProps): ReactNode {
  const { label = 'Export' } = props;
  const [wanted, setWanted] = useState(false);
  const [open, setOpen] = useState(false);
  const items = exportItems(props, {
    onCsv: () => {
      if (props.csv) downloadTableCsv(props.csv);
    },
    onPrint: () => window.print(),
  });
  if (items.length === 0) return null;

  const trigger = (
    <Button
      variant="secondary"
      size="sm"
      iconStart="download"
      iconEnd="chevron-down"
      aria-haspopup="menu"
      {...(wanted
        ? {}
        : {
            'aria-expanded': false,
            onClick: () => {
              setWanted(true);
              setOpen(true);
            },
          })}
    >
      {label}
    </Button>
  );
  if (!wanted) return trigger;
  return (
    <Suspense fallback={trigger}>
      <Menu trigger={trigger} items={items} align="end" open={open} onOpenChange={setOpen} label={label} />
    </Suspense>
  );
}
