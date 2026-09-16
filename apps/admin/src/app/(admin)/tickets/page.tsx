import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Badge, EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { read } from '../../../server/read.js';
import { holds } from '../../../permissions.js';
import { Panel } from '../../../components/Panel.js';

export const metadata: Metadata = { title: 'Tickets' };
export const dynamic = 'force-dynamic';

/**
 * The API's own vocabulary, checked against `statusCategorySchema` rather than
 * assumed. It is `paused`, not `pending` — and an unrecognised category is not
 * refused, it simply matches nothing, so the wrong word here would have shown
 * an empty desk and called it accurate.
 */
const CATEGORIES = ['open', 'paused', 'resolved', 'closed'] as const;
type Category = (typeof CATEGORIES)[number];

function isCategory(value: string | undefined): value is Category {
  return CATEGORIES.includes(value as Category);
}

const INTENT: Record<string, 'danger' | 'warning' | 'success' | 'neutral'> = {
  p1: 'danger',
  p2: 'warning',
  p3: 'neutral',
  p4: 'neutral',
};

/**
 * Every ticket on the desk.
 *
 * Not a second workbench. The workbench answers "what is mine"; this answers
 * "what is on this desk at all", which is an administrator's question and one
 * no screen has ever answered — a ticket assigned to a team the administrator
 * is not in was invisible to them outside the database.
 *
 * Read-only on purpose, and the link out to the workbench is the point: an
 * administrator who wants to *change* a ticket should be doing it where the
 * timeline, the SLA panel and the reply box are, not in a grid on a
 * configuration screen.
 *
 * The status filter is a link, not a control. A server component filtering by
 * its own search parameters needs no JavaScript at all, and this page is read
 * far more often than it is filtered.
 */
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<ReactNode> {
  const { me, api } = await currentActor();

  if (!holds(me, 'ticket.read')) {
    return (
      <EmptyState
        tone="error"
        title="Your account cannot read this desk's tickets"
        description="It needs ticket.read. Ask an administrator."
      />
    );
  }

  const params = await searchParams;
  const category = isCategory(params.status) ? params.status : undefined;

  const page = await read(() =>
    api.observe.tickets({ statusCategory: category, limit: 50, sort: '-createdAt' }),
  );

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Tickets</h1>
        <p className="itsm-Admin__lede">
          Everything raised on this desk, newest first, across every team. Fifty at a time — this is a check on the
          shape of the workload, not a queue to work.
        </p>
      </header>

      <nav className="itsm-Filters" aria-label="Filter by status">
        <a className="itsm-Filters__item" aria-current={category === undefined ? 'page' : undefined} href="/tickets">
          Everything
        </a>
        {CATEGORIES.map((value) => (
          <a
            className="itsm-Filters__item"
            aria-current={category === value ? 'page' : undefined}
            href={`/tickets?status=${value}`}
            key={value}
          >
            {value[0]!.toUpperCase() + value.slice(1)}
          </a>
        ))}
      </nav>

      <Panel
        title={category ? `${category[0]!.toUpperCase()}${category.slice(1)} tickets` : 'All tickets'}
        result={page}
      >
        {(value) =>
          value.data.length === 0 ? (
            <EmptyState
              title="Nothing here"
              description={category ? `No tickets are ${category}.` : 'No tickets have been raised on this desk yet.'}
            />
          ) : (
            <>
              <Table
                caption="Tickets on this desk"
                columns={[
                  { key: 'number', header: 'Number', cell: (row) => <code>{row.number}</code> },
                  { key: 'title', header: 'Title', cell: (row) => row.title },
                  { key: 'type', header: 'Type', cell: (row) => row.type },
                  {
                    key: 'priority',
                    header: 'Priority',
                    cell: (row) => (
                      <Badge intent={INTENT[row.priority.toLowerCase()] ?? 'neutral'} srPrefix="Priority">
                        {row.priority}
                      </Badge>
                    ),
                  },
                  { key: 'status', header: 'Status', cell: (row) => row.status },
                  {
                    key: 'assignee',
                    header: 'Assigned',
                    cell: (row) => (row.assigneeId ? 'Yes' : 'Nobody'),
                  },
                  { key: 'raised', header: 'Raised', cell: (row) => new Date(row.createdAt).toLocaleDateString() },
                ]}
                rows={value.data}
                rowKey={(row) => row.id}
              />
              {value.nextCursor ? (
                <p className="itsm-Admin__note">
                  There are more than fifty. Narrow it with a status above, or work the queue in the workbench.
                </p>
              ) : null}
            </>
          )
        }
      </Panel>
    </div>
  );
}
