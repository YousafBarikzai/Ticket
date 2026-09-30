'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Avatar, Banner, Icon, notify, type ActionSpec, type Problem } from '@itsm/ui';
import { DataTable, type ColumnSpec, type FilterSpec } from '@itsm/ui/data';
import { PageHeader } from '@itsm/ui/shell';
import { api } from '../../client/api.js';
import { useDrawer } from '../../client/useDrawer.js';
import { PersonCell } from '../PersonCell.js';
import { EventDrawer } from './EventDrawer.js';
import {
  actionOptions,
  actionLabel,
  auditCsv,
  csvFileName,
  cursorAt,
  isFiltered,
  pageHref,
  sequenceCheck,
  targetTypeOptions,
  type AuditChange,
  type AuditQuery,
  type AuditRowView,
} from './presentation.js';
import { useCursorStack } from './useCursorStack.js';

/** A chain break the nightly check reported (an open `audit.chain.broken` alert). */
export interface ChainBreak {
  readonly alertId: string;
  readonly seq: string | null;
  readonly createdAt: string;
  readonly createdLabel: string;
}

export interface AuditViewProps {
  readonly rows: readonly AuditRowView[];
  readonly query: AuditQuery;
  /** The seq the next (older) page starts before, or null on the last page. */
  readonly nextCursor: string | null;
  readonly problem?: Problem;
  /** The person the Person filter names, so its chip reads a name. */
  readonly actorOption?: { readonly value: string; readonly label: string };
  readonly canExport: boolean;
  /** Null when this person cannot read security alerts, so nothing is said about the chain. */
  readonly chain: readonly ChainBreak[] | null;
  /** The drawer's event on a hard load of `?open=event:<seq>`, with only its own before and after. */
  readonly initialEvent?: { readonly row: AuditRowView; readonly change: AuditChange };
  readonly workspace: string;
  /** Today where the reader is, for the export's file name. */
  readonly today: string;
}

const NOUN = { one: 'event', other: 'events' } as const;

/**
 * The audit log (SPEC §6.1 `/audit`, B §3.17, F32): every change in order,
 * newest first, a timeline grouped by day.
 *
 * Filters are the URL and are asked of the API (action — matched as a prefix
 * — person, target type, target id, when); the list pages *Older* / *Newer*
 * with a cursor stack (D13) because a log is read page by page, not appended
 * without end. A row opens its event (`?open=event:<seq>`): who, what, why,
 * the correlation id and a diff of before and after — fetched for that one
 * event only, never carried in the list.
 *
 * Without filters, a sequence check says what the page's numbers show; with
 * `security.alert.read`, the nightly chain check's verdict sits beside it.
 */
export function AuditView(props: AuditViewProps): ReactNode {
  const { rows, query, nextCursor, canExport, chain } = props;
  const router = useRouter();
  const pathname = usePathname() || '/audit';
  const drawer = useDrawer('event');
  const cursor = query.cursor ?? null;
  const { newer } = useCursorStack(query, cursor);
  const filtered = isFiltered(query);
  const [changes, setChanges] = useState<ReadonlyMap<string, AuditChange>>(() =>
    props.initialEvent ? new Map([[props.initialEvent.change.seq, props.initialEvent.change]]) : new Map(),
  );

  // A cursor left in the address by a filter change belongs to the old list:
  // the server ignored it, so the address stops claiming it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('cursor') && query.cursor === undefined) {
      params.delete('cursor');
      const text = params.toString();
      window.history.replaceState(null, '', text ? `${window.location.pathname}?${text}` : window.location.pathname);
    }
  }, [query.cursor]);

  const open = drawer.key ? (rows.find((row) => row.seq === drawer.key) ?? (props.initialEvent?.row.seq === drawer.key ? props.initialEvent.row : undefined)) : undefined;

  const check = useMemo(() => (filtered ? null : sequenceCheck(rows.map((row) => row.seq))), [filtered, rows]);

  const columns = useMemo<ColumnSpec[]>(
    () => [
      { id: 'time', header: 'Time', field: 'timeLabel', width: 76, minWidth: 64, cardRole: 'meta' },
      { id: 'who', header: 'Who', field: 'actorName', minWidth: 170, width: '1fr', cardRole: 'subtitle' },
      { id: 'what', header: 'What happened', field: 'sentence', kind: 'title', minWidth: 240, width: '3fr', truncate: 2 },
      { id: 'action', header: 'Action', field: 'action', kind: 'mono', technical: true, minWidth: 180, hideBelow: 'lg' },
      { id: 'seq', header: 'Number', field: 'seq', align: 'end', width: 92, minWidth: 84, cardRole: 'badge' },
    ],
    [],
  );

  const filters = useMemo<FilterSpec[]>(
    () => [
      {
        id: 'action',
        label: 'Action',
        type: 'select',
        mode: 'server',
        pinned: true,
        options: [...(query.action ? [{ value: query.action, label: actionLabel(query.action) }] : []), ...actionOptions('')],
        // Known actions and prefixes, and whatever is typed — the API matches it as a prefix.
        loadOptions: async (typed) => actionOptions(typed),
      },
      {
        id: 'actor',
        label: 'Person',
        type: 'person',
        mode: 'server',
        pinned: true,
        options: props.actorOption ? [props.actorOption] : [],
        loadOptions: async (typed, signal) => {
          const found = await api.tenant.users({ q: typed || undefined, limit: 20 });
          if (signal.aborted) return [];
          return found.map((person) => ({ value: person.id, label: person.displayName || person.email }));
        },
      },
      { id: 'when', label: 'When', type: 'dateRange', mode: 'server', pinned: true },
      { id: 'targetType', label: 'Target type', type: 'select', mode: 'server', options: targetTypeOptions() },
      { id: 'targetId', label: 'Target id', type: 'text', mode: 'server' },
    ],
    [props.actorOption, query.action],
  );

  const exportPage = (): void => {
    const csv = auditCsv(rows);
    const name = csvFileName(props.workspace, props.today, rows[0]?.seq);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`Exported ${rows.length} ${rows.length === 1 ? 'event' : 'events'}`, { tone: 'success', description: `${name} — without before and after, which stay in the log.` });
  };

  const secondaryActions: ActionSpec[] =
    canExport && rows.length > 0 ? [{ id: 'export', label: 'Export page', icon: 'download', variant: 'secondary' }] : [];

  const olderHref = nextCursor ? pageHref(pathname, query, nextCursor) : undefined;
  const newerHref = newer === undefined ? undefined : pageHref(pathname, query, newer);
  const firstHref = cursor ? pageHref(pathname, query, null) : undefined;

  const loadChange = async (seq: string): Promise<AuditChange | null> => {
    const known = changes.get(seq);
    if (known) return known;
    // `seq < cursor` with a page of one is exactly this event.
    const page = await api.observe.auditEvents({ cursor: cursorAt(seq), limit: 1 });
    const event = page.data[0];
    if (!event || String(event.seq) !== seq) return null;
    const change: AuditChange = { seq, before: event.before ?? null, after: event.after ?? null };
    setChanges((current) => new Map(current).set(seq, change));
    return change;
  };

  const breaks = chain ?? [];

  return (
    <div className="app-Page app-Audit">
      <PageHeader
        title="Audit log"
        {...(rows.length === 0 && !filtered && !cursor && !props.problem ? { subtitle: 'Every change, in order. Nothing here can be edited or deleted.' } : {})}
        {...(secondaryActions.length > 0 ? { secondaryActions } : {})}
        onAction={(id) => {
          if (id === 'export') exportPage();
        }}
      />

      {breaks.map((entry) => (
        <Banner
          key={entry.alertId}
          tone="danger"
          title={entry.seq ? `The audit chain is broken at #${entry.seq}` : 'The audit chain is broken'}
          {...(entry.seq
            ? { action: { id: `chain-${entry.alertId}`, label: 'Show that event', href: `${pageHref(pathname, {}, cursorAt(entry.seq))}&open=event:${entry.seq}`, variant: 'secondary' as const } }
            : {})}
        >
          The nightly check found an event whose fingerprint doesn’t follow the one before it ({entry.createdLabel}). Events can’t be
          changed through the product, so treat this as a security incident.
        </Banner>
      ))}

      {check ? (
        <p className="app-Audit__check" data-state={check.state}>
          <Icon name={check.state === 'ok' ? 'circle-check' : 'triangle-alert'} size="sm" className="app-Audit__checkIcon" />
          <span>
            <span className="app-Audit__checkText">{check.text}</span>
            {chain !== null && breaks.length === 0 ? <span className="app-Audit__checkText"> · No break reported by the nightly chain check</span> : null}
            <span className="app-Audit__checkHint">
              Numbers are shared by every workspace on the platform, so gaps between them are expected. Each event also carries the
              fingerprint of the one before it, which is checked every night.
            </span>
          </span>
        </p>
      ) : null}

      <h2 className="itsm-visually-hidden">Events</h2>
      <DataTable<AuditRowView>
        caption="Audit events"
        captionHidden
        columns={columns}
        rows={rows}
        rowKey="seq"
        urlKey=""
        search={false}
        filters={filters}
        groupBy={{ field: 'day', label: (row) => row.dayLabel }}
        pagination={{ mode: 'olderNewer', ...(olderHref ? { olderHref } : {}), ...(newerHref ? { newerHref } : {}), ...(firstHref ? { firstHref } : {}) }}
        dataComplete={nextCursor === null && cursor === null}
        activate={{ kind: 'drawer', openKind: 'event', keyField: 'seq' }}
        onActivate={(row) => drawer.open(row.seq)}
        {...(open ? { currentKeys: [open.seq] } : {})}
        countNoun={NOUN}
        cardBelow={640}
        cells={{
          time: (row) => (
            <time className="app-Audit__time" dateTime={row.occurredAt}>
              {row.timeLabel}
            </time>
          ),
          who: (row) =>
            row.actorId ? (
              <PersonCell person={{ id: row.actorId, name: row.actorKnown ? row.actorName : null }} size="xs" />
            ) : (
              <span className="app-Audit__system">
                <Avatar name={row.actorName} kind="system" size="xs" decorative />
                <span>{row.actorName}</span>
              </span>
            ),
          what: (row) => (
            <span className="app-Audit__sentence">
              {row.target ? (
                <>
                  {row.opening}{' '}
                  <strong className="app-Audit__target" data-technical={row.target.technical ? '' : undefined}>
                    {row.target.label}
                  </strong>
                </>
              ) : (
                row.sentence
              )}
              {row.reason ? <span className="app-Audit__reason">“{row.reason}”</span> : null}
            </span>
          ),
          seq: (row) => <span className="app-Audit__seq">#{row.seq}</span>,
        }}
        {...(props.problem ? { problem: props.problem, onRetry: () => router.refresh() } : {})}
        empty={
          filtered
            ? {
                title: 'No events match',
                description: 'Try a wider range of days, or fewer filters.',
                icon: 'search',
                action: { id: 'clear', label: 'Clear filters', href: pathname, variant: 'secondary' },
              }
            : cursor
              ? { title: 'No older events', description: 'This is the start of the log.', icon: 'audit', action: { id: 'newest', label: 'Back to the newest', href: pathname, variant: 'secondary' } }
              : { title: 'Nothing recorded yet', description: 'Every change made on this desk is recorded here, in order, from the moment it happens.', icon: 'audit' }
        }
      />

      <EventDrawer
        seq={drawer.key}
        row={open}
        load={loadChange}
        initial={props.initialEvent?.change}
        onClose={() => drawer.close()}
      />
    </div>
  );
}
