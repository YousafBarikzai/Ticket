import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { EmptyState, Table } from '@itsm/ui';
import { currentActor } from '../../../server/session.js';
import { read } from '../../../server/read.js';
import { holds } from '../../../permissions.js';
import { Panel } from '../../../components/Panel.js';

export const metadata: Metadata = { title: 'Audit' };
export const dynamic = 'force-dynamic';

/**
 * What has been done on this desk, and by whom.
 *
 * The audit log is the one record in the platform that is never edited and
 * never deleted, and until now it had no reader — which made it a record kept
 * for a regulator rather than one that helps anybody run the desk.
 *
 * `seq` is shown because it is the point: the sequence is contiguous per
 * tenant, so a gap is evidence of tampering in a way a timestamp is not. An
 * administrator who can see the numbers can check them.
 *
 * `before` and `after` are held on every row and are not shown. They are
 * arbitrarily large JSON documents, frequently containing the personal data
 * the change was about, and rendering them into a table would turn a list of
 * activity into a bulk disclosure. What each change *was* belongs on a screen
 * for one event, with the permission check that goes with it.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; cursor?: string }>;
}): Promise<ReactNode> {
  const { me, api } = await currentActor();

  if (!holds(me, 'audit.read')) {
    return (
      <EmptyState
        tone="error"
        title="Your account cannot read the audit log"
        description="It needs audit.read. That permission is deliberately narrow — the log records everybody."
      />
    );
  }

  const params = await searchParams;
  const action = params.action?.trim() || undefined;

  const events = await read(() => api.observe.auditEvents({ action, cursor: params.cursor, limit: 100 }));

  return (
    <div className="itsm-Admin">
      <header className="itsm-Admin__head">
        <h1>Audit</h1>
        <p className="itsm-Admin__lede">
          Every change this desk has recorded, newest first. Entries are written in the same transaction as the change
          itself, so there is no state the log missed.
        </p>
      </header>

      <form className="itsm-Filters" method="get" action="/audit">
        <label className="itsm-Filters__label" htmlFor="audit-action">
          Action
        </label>
        <input
          className="itsm-Input"
          id="audit-action"
          name="action"
          type="search"
          defaultValue={action ?? ''}
          placeholder="ticket.updated"
        />
        <button className="itsm-Button itsm-Button--secondary" type="submit">
          Filter
        </button>
      </form>

      <Panel
        title={action ? `Events matching “${action}”` : 'Recent events'}
        result={events}
        empty={action ? 'Nothing matches that action.' : 'Nothing has been recorded yet.'}
      >
        {(page) =>
          page.data.length === 0 ? (
            <EmptyState
              title={action ? 'Nothing matches that action' : 'Nothing recorded yet'}
              description={action ? 'Action names are exact, and look like ticket.updated.' : undefined}
            />
          ) : (
            <>
              <Table
                caption="Audit events"
                columns={[
                  { key: 'seq', header: '#', cell: (row) => row.seq, align: 'end' },
                  { key: 'when', header: 'When', cell: (row) => new Date(row.occurredAt).toLocaleString() },
                  { key: 'action', header: 'Action', cell: (row) => <code>{row.action}</code> },
                  {
                    key: 'actor',
                    header: 'Who',
                    cell: (row) => (row.actorType === 'system' ? 'The platform' : (row.actorId ?? row.actorType)),
                  },
                  { key: 'target', header: 'On', cell: (row) => `${row.targetType} ${row.targetId}` },
                  { key: 'reason', header: 'Reason', cell: (row) => row.reason ?? '—' },
                ]}
                rows={page.data}
                rowKey={(row) => row.id}
              />
              {page.nextCursor ? (
                <p className="itsm-Admin__note">
                  <a href={`/audit?${new URLSearchParams({ ...(action ? { action } : {}), cursor: page.nextCursor })}`}>
                    Older events
                  </a>
                </p>
              ) : null}
            </>
          )
        }
      </Panel>
    </div>
  );
}
