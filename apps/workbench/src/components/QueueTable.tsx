'use client';

import { useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import type { Ticket } from '@itsm/sdk';
import { Badge, Button, EmptyState, Table, type TableColumn } from '@itsm/ui';
import { ageOf, categoryIntent, priorityEmphasis, priorityIntent, stateLabel, typeLabel } from '../queue/presentation.js';

/**
 * The queue.
 *
 * `onRowActivate` is what makes this a workbench rather than a report: the
 * design system's `Table` switches to `role="grid"` when rows are activatable,
 * which turns two hundred rows into one tab stop with Up and Down between them.
 * Without it, reaching row forty by keyboard is forty tab presses, and an agent
 * working a queue by keyboard is the normal case, not the accessible edge case.
 *
 * A client component because activation is a client concern. The rows
 * themselves are rendered on the server and handed down, so the first paint
 * carries real data.
 */

export interface QueueTableProps {
  readonly tickets: readonly Ticket[];
  readonly caption: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
}

export function QueueTable({ tickets, caption, emptyTitle, emptyDescription }: QueueTableProps): ReactNode {
  const router = useRouter();

  const columns = useMemo<TableColumn<Ticket>[]>(
    () => [
      {
        key: 'number',
        header: 'Ticket',
        width: '9rem',
        cell: (ticket) => <span className="itsm-Queue__number">{ticket.number}</span>,
      },
      {
        key: 'title',
        header: 'Summary',
        cell: (ticket) => (
          <span>
            <span className="itsm-Queue__title">{ticket.title}</span>
            <span className="itsm-Queue__type">{typeLabel(ticket.type)}</span>
          </span>
        ),
      },
      {
        key: 'priority',
        header: 'Priority',
        width: '7rem',
        cell: (ticket) => (
          <Badge intent={priorityIntent(ticket.priority)} emphasis={priorityEmphasis(ticket.priority)} srPrefix="Priority">
            {ticket.priority}
          </Badge>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: '12rem',
        cell: (ticket) => (
          <Badge intent={categoryIntent(ticket.statusCategory)} srPrefix="Status">
            {stateLabel(ticket.status)}
          </Badge>
        ),
      },
      {
        key: 'age',
        header: 'Age',
        width: '7rem',
        align: 'end',
        // The exact instant is on the cell, so "3 d" is scannable and the
        // precise time is one hover or one screen-reader stop away.
        cell: (ticket) => <time dateTime={ticket.createdAt} title={ticket.createdAt}>{ageOf(ticket.createdAt)}</time>,
      },
    ],
    [],
  );

  if (tickets.length === 0) {
    return (
      <EmptyState
        tone="search"
        title={emptyTitle}
        description={emptyDescription}
        action={
          <Button variant="secondary" onClick={() => router.push('/queue')}>
            Show all open tickets
          </Button>
        }
      />
    );
  }

  return (
    <Table
      caption={caption}
      captionHidden
      columns={columns}
      rows={tickets}
      rowKey={(ticket) => ticket.id}
      onRowActivate={(ticket) => router.push(`/tickets/${ticket.number}`)}
    />
  );
}
