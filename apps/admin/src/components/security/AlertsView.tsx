'use client';

import { useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { DescriptionList, EmptyState, Icon, RelativeTime, StatusPill, useItsm, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec, type FilterSpec } from '@itsm/ui/data';
import { Sheet } from '@itsm/ui/overlays';
import { PageHeader, type TabNavItem } from '@itsm/ui/shell';
import { useDrawer } from '../../client/useDrawer.js';
import { SEVERITIES, SEVERITY_LOOK, type AlertDetail, type Severity } from './presentation.js';

/** An alert as the page shows it: worded on the server, people named, details as a grid. */
export interface AlertRowView extends Record<string, unknown> {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly details: readonly AlertDetail[];
  /** For a chain break: the audit log page with the broken event open, when this person may read it. */
  readonly auditHref?: string;
}

export interface AlertsViewProps {
  readonly tabs: readonly TabNavItem[];
  readonly rows: readonly AlertRowView[];
  /** "2 high · 5 medium in the last 7 days". */
  readonly summary: string;
  readonly problem?: Problem;
}

const NOUN = { one: 'alert', other: 'alerts' } as const;

/**
 * Security › Alerts (SPEC §6.1 `/security`, B §3.15): what the audit
 * pipeline has noticed — repeated failed sign-ins, an administrator role
 * granted, an infected attachment held back, a broken audit chain — most
 * severe first, each as a sentence rather than a type and a blob of JSON. A
 * row opens its details (`?open=alert:<id>`). There is no *Acknowledge*: the
 * API has none, and a button that only hid an alert here would be worse.
 */
export function AlertsView({ tabs, rows, summary, problem }: AlertsViewProps): ReactNode {
  const router = useRouter();
  const { Link } = useItsm();
  const drawer = useDrawer('alert');
  const open = drawer.key ? rows.find((row) => row.id === drawer.key) : undefined;

  const columns = useMemo<ColumnSpec[]>(
    () => [
      {
        id: 'severity',
        header: 'Severity',
        field: 'severity',
        kind: 'status',
        srPrefix: 'Severity',
        map: Object.fromEntries(SEVERITIES.map((severity) => [severity, { label: SEVERITY_LOOK[severity].label, tone: SEVERITY_LOOK[severity].tone, icon: SEVERITY_LOOK[severity].icon }])),
        width: 124,
        minWidth: 116,
        cardRole: 'badge',
      },
      { id: 'title', header: 'Alert', field: 'title', kind: 'title', secondaryField: 'summary', minWidth: 260, width: '4fr', truncate: 2 },
      { id: 'when', header: 'Raised', field: 'createdAt', kind: 'relative', sortable: 'page', width: 128, minWidth: 116, cardRole: 'meta' },
    ],
    [],
  );

  const filters = useMemo<FilterSpec[]>(
    () => [
      {
        id: 'severity',
        label: 'Severity',
        type: 'multiselect',
        pinned: true,
        options: SEVERITIES.map((severity) => ({ value: severity, label: SEVERITY_LOOK[severity].label, tone: SEVERITY_LOOK[severity].tone })),
      },
    ],
    [],
  );

  const look = open ? SEVERITY_LOOK[open.severity] : undefined;

  return (
    <div className="app-Page app-Security">
      <PageHeader title="Security" tabs={tabs} />
      {problem || rows.length === 0 ? null : (
        <p className="app-Security__summary">
          <Icon name="security" size="sm" className="app-Security__summaryIcon" />
          <span>{summary}</span>
        </p>
      )}
      <h2 className="itsm-visually-hidden">Open alerts</h2>
      {rows.length === 0 && !problem ? (
        <EmptyState
          tone="success"
          title="No open alerts"
          description="Nothing has looked wrong. The audit pipeline keeps watching for repeated failed sign-ins, new administrators and unsafe attachments."
        />
      ) : (
        <DataTable<AlertRowView>
          caption="Security alerts"
          captionHidden
          columns={columns}
          rows={rows}
          rowKey="id"
          urlKey=""
          search={{ placeholder: 'Search alerts', mode: 'client', shortcut: '/' }}
          filters={filters}
          activate={{ kind: 'drawer', openKind: 'alert', keyField: 'id' }}
          onActivate={(row) => drawer.open(row.id)}
          {...(open ? { currentKeys: [open.id] } : {})}
          countNoun={NOUN}
          {...(problem ? { problem, onRetry: () => router.refresh() } : {})}
          noResults={{ title: 'No alerts match', description: 'Try another severity, or clear the search.' }}
        />
      )}

      <Sheet
        open={drawer.key !== null}
        onOpenChange={(next) => {
          if (!next) drawer.close();
        }}
        size="md"
        title={open?.title ?? 'Alert'}
        {...(open ? { description: open.summary } : {})}
        {...(open && look ? { headerMeta: <StatusPill size="sm" tone={look.tone} icon={look.icon} label={look.label} srPrefix="Severity" /> } : {})}
      >
        {drawer.key !== null && !open ? (
          <EmptyState
            size="sm"
            title="That alert isn’t open any more"
            description="Only open alerts are listed. It may have been closed since the link was made."
            action={{ id: 'close', label: 'Close', variant: 'secondary' }}
            onAction={() => drawer.close()}
          />
        ) : open ? (
          <div className="app-SecurityAlert">
            <DescriptionList
              layout="inline"
              dense
              items={[
                { id: 'raised', label: 'Raised', value: <RelativeTime date={open.createdAt} mode="absolute" absoluteStyle="datetime" /> },
                ...open.details.map((detail) => ({
                  id: `detail-${detail.id}`,
                  label: detail.label,
                  value: detail.mono ? <code className="app-SecurityAlert__mono">{detail.value}</code> : detail.value,
                })),
              ]}
            />
            {open.auditHref ? (
              <p className="app-SecurityAlert__next">
                <Link href={open.auditHref} className="app-Security__link">
                  Show the event in the audit log
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
