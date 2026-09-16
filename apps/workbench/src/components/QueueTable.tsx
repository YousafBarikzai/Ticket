'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Ticket } from '@itsm/sdk';
import { Badge, Button, EmptyState, Table, type TableColumn } from '@itsm/ui';
import { useChangeStream } from '../client/useChangeStream.js';
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
 *
 * It also watches for change (ADR-0015). A queue that only updates when the
 * person looking at it does something is a queue that is wrong most of the
 * time — during an incident, confidently so. The stream carries a nudge and
 * this asks the server to render again; nothing here decides what changed,
 * which is what keeps one screen's idea of a queue from drifting from the
 * filter that produced it.
 *
 * Refreshing is announced rather than done silently. Rows that rearrange under
 * somebody's cursor with no explanation are how a person loses their place and
 * their trust in the screen at the same time, so `aria-live` says it happened
 * and the count in the caption is what changes.
 */

export interface QueueTableProps {
  readonly tickets: readonly Ticket[];
  readonly caption: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  /**
   * Topics this view depends on — `group:<id>` for each of the person's teams,
   * and their own `user:<id>`. Empty means no stream, which is what a test and
   * a server render both want.
   */
  readonly watch?: readonly string[];
}

/** Long enough that a burst of changes is one refresh, short enough to feel live. */
const SETTLE_MS = 1_000;

export function QueueTable({ tickets, caption, emptyTitle, emptyDescription, watch = [] }: QueueTableProps): ReactNode {
  const router = useRouter();
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Coalesced. A bulk update, a rule that touches twenty tickets, or an import
  // all arrive as twenty notices in a second, and twenty `router.refresh()`
  // calls is twenty renders of the same answer.
  const refresh = (): void => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      setRefreshedAt(new Date().toLocaleTimeString());
      router.refresh();
    }, SETTLE_MS);
  };

  useChangeStream({
    topics: watch,
    enabled: watch.length > 0,
    onNotice: (change) => {
      if (change.entity === 'ticket') refresh();
    },
    // A gap in the stream is a gap in the queue: refetch rather than assume
    // nothing happened while the connection was down.
    onReconnect: refresh,
  });

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
    <>
      <Table
        caption={caption}
        captionHidden
        columns={columns}
        rows={tickets}
        rowKey={(ticket) => ticket.id}
        onRowActivate={(ticket) => router.push(`/tickets/${ticket.number}`)}
      />
      {/*
        Polite rather than assertive: a queue updating is worth knowing about
        and never worth interrupting what somebody is reading. Always in the
        tree so the region exists before it has anything to say — a live region
        added at the moment of its first message is a message most screen
        readers never announce.
      */}
      <p className="itsm-Queue__refreshed" role="status" aria-live="polite">
        {refreshedAt ? `Queue updated at ${refreshedAt}.` : ''}
      </p>
    </>
  );
}
