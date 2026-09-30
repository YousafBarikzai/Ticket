'use client';

import type { ReactNode } from 'react';
import { DataTable, type ColumnSpec } from '@itsm/ui/data';
import { Sheet } from '@itsm/ui/overlays';
import { useDrawer } from '../../client/useDrawer.js';
import { MetricExplorer, type ExplorerMetric } from './MetricExplorer.js';

/** One metric as the table shows it: serialisable, written by the server page. */
export interface MetricTableRow extends ExplorerMetric {
  readonly [field: string]: unknown;
  readonly measures: string;
  readonly unitLabel: string;
  readonly origin: 'builtin' | 'custom';
}

const COLUMNS: readonly ColumnSpec[] = [
  { id: 'name', header: 'Metric', field: 'name', kind: 'title', secondaryField: 'description', truncate: 2, width: '2fr', minWidth: 240 },
  { id: 'measures', header: 'Measures', field: 'measures', kind: 'text', hideBelow: 'md', width: '2fr' },
  { id: 'unit', header: 'Unit', field: 'unitLabel', kind: 'text', hideBelow: 'lg', width: '1fr' },
  {
    id: 'origin',
    header: 'Origin',
    field: 'origin',
    kind: 'badge',
    width: '1fr',
    map: { builtin: { label: 'Built in', tone: 'neutral' }, custom: { label: 'This desk', tone: 'info' } },
  },
  { id: 'key', header: 'Key', field: 'key', kind: 'mono', technical: true, hideBelow: 'lg', width: '1fr' },
];

/**
 * Insights › Metrics: everything this desk can measure (SPEC §6.1). A row
 * opens the metric explorer in a drawer (`?open=metric:<key>`), so a link to
 * one metric's live chart can be pasted to a colleague.
 */
export function MetricsTable({
  rows,
  dimensions,
}: {
  readonly rows: readonly MetricTableRow[];
  /** The dimensions each fact can be broken down by, keyed by fact. */
  readonly dimensions: Readonly<Record<string, readonly string[]>>;
}): ReactNode {
  const drawer = useDrawer('metric');
  const open = drawer.key ? rows.find((row) => row.key === drawer.key) : undefined;

  return (
    <>
      <DataTable
        caption="Metrics"
        captionHidden
        columns={COLUMNS}
        rows={rows}
        rowKey="key"
        urlKey=""
        search={{ placeholder: 'Search metrics', mode: 'client', shortcut: '/' }}
        filters={[
          {
            id: 'origin',
            label: 'Origin',
            type: 'select',
            options: [
              { value: 'builtin', label: 'Built in' },
              { value: 'custom', label: 'This desk' },
            ],
          },
        ]}
        activate={{ kind: 'drawer', openKind: 'metric', keyField: 'key' }}
        onActivate={(row) => drawer.open(row.key)}
        {...(drawer.key ? { currentKeys: [drawer.key] } : {})}
        countNoun={{ one: 'metric', other: 'metrics' }}
        empty={{ title: 'No metrics', description: 'The built-in metrics appear here once the analytics module is running.' }}
        noResults={{ title: 'No metrics match', description: 'Try another word, or clear the filter.' }}
      />
      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="lg"
        title={open?.name ?? 'Metric'}
        {...(open?.description ? { description: open.description } : {})}
      >
        {open ? (
          <MetricExplorer key={open.key} metric={open} dimensions={dimensions[open.fact] ?? []} />
        ) : drawer.key ? (
          <p className="app-Explorer__missing">That metric no longer exists. It may have been deleted since the link was shared.</p>
        ) : null}
      </Sheet>
    </>
  );
}
