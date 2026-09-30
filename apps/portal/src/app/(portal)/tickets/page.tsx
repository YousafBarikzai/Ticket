import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { settle } from '../../../home/settle.js';
import { NewRequestButton } from '../../../requests/NewRequestButton.js';
import { itemOf, filterFor, PAGE_SIZE, queryOf, scopeOf } from '../../../requests/model.js';
import { RequestsBrowser } from '../../../requests/RequestsBrowser.js';
import { apiFor, currentMe, heldPermissions, requireSession } from '../../../server/session.js';
import '../../../requests/requests.css';

export const metadata: Metadata = { title: 'My requests' };
export const dynamic = 'force-dynamic';

type Params = Promise<Record<string, string | string[] | undefined>>;

/** How many "needs you" requests are counted before the badge says "99+". */
const COUNT_LIMIT = 100;

/**
 * My requests (SPEC §6.3 `/tickets`): everything this person has raised,
 * scoped — Open (default), Needs you (n), Resolved, All — and searchable,
 * with what needs them first. The heading and New request are always there,
 * whatever the list says; a list that failed to load says so rather than
 * "Nothing open".
 *
 * Three reads start together: the scope's first page, the needs-you count
 * for its segment, and the unread notifications that put a dot on a row.
 * The count and the dots are allowed to fail quietly; the list is not.
 */
export default async function MyRequestsPage({ searchParams }: { searchParams: Params }): Promise<ReactNode> {
  const session = await requireSession();
  const [me, params] = await Promise.all([currentMe(), searchParams]);
  const held = heldPermissions(me);
  const scope = scopeOf(params.show, params.all);
  const q = queryOf(params.q);
  const api = apiFor(session);

  const [list, needs, notifications] = await Promise.all([
    settle(api.myTickets({ ...filterFor(scope), ...(q ? { q } : {}), limit: PAGE_SIZE })),
    settle(api.myTickets({ ...filterFor('needs'), limit: COUNT_LIMIT })),
    held.has('notification.read') ? settle(api.notifications({ unread: true, limit: 100 })) : Promise.resolve(null),
  ]);

  const unread = notifications?.ok
    ? [...new Set(notifications.value.data.map((notification) => notification.ticketId).filter((id): id is string => typeof id === 'string'))]
    : [];

  return (
    <div className="app-Page app-Requests">
      <header className="app-Requests__header">
        <h1 className="app-Requests__title" tabIndex={-1}>
          My requests
        </h1>
        <NewRequestButton />
      </header>
      <RequestsBrowser
        scope={scope}
        q={q}
        needsCount={needs.ok ? { count: needs.value.data.length, capped: needs.value.nextCursor !== null } : null}
        initial={list.ok ? { rows: list.value.data.map(itemOf), nextCursor: list.value.nextCursor } : null}
        unread={unread}
      />
    </div>
  );
}
