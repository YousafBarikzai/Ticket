import type { ReactNode } from 'react';
import { ApiError, type Page, type Ticket } from '@itsm/sdk';
import { Button, EmptyState, ProblemState } from '@itsm/ui';
import { formatCount } from '@itsm/ui/format';
import { PageHeader } from '@itsm/ui/shell';
import { DeskSkipLinks } from '../../../components/DeskShell.js';
import { QueueTable } from '../../../components/QueueTable.js';
import { problemOf } from '../../../inbox/presentation.js';
import { INBOX_REGIONS, clearedHref, deskTopics, inboxHref, type InboxView } from '../../../inbox/views.js';
import { apiFor, currentMe, requireSession } from '../../../server/session.js';

/**
 * The inbox list while the three-pane inbox is built (stub → WP23).
 *
 * Exists so `/queue` can redirect to the new URLs now: every view renders its
 * real list, with the view's own empty state, a filter summary with *Clear
 * filters*, and *Show more* for the next page. WP23 replaces it with the
 * `TicketList` and the detail pane; the view registry, the counts and the
 * URLs it reads stay.
 */

function filterSummary(view: InboxView): string | null {
  const parts = [
    view.filters.q ? `matching “${view.filters.q}”` : null,
    view.filters.status ? `status ${view.filters.status.replaceAll(',', ', ').replaceAll('_', ' ')}` : null,
    view.filters.priority ? `priority ${view.filters.priority.replaceAll(',', ', ')}` : null,
    view.filters.type ? `type ${view.filters.type.replaceAll(',', ', ')}` : null,
    view.filters.assignee ? (view.filters.assignee === 'none' ? 'unassigned' : view.filters.assignee === 'me' ? 'assigned to you' : 'assigned to one person') : null,
    view.filters.requester ? 'from one requester' : null,
    view.filters.team ? 'in one team' : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `Filtered: ${parts.join(' · ')}` : null;
}

export async function TransitionalInbox({ view }: { readonly view: InboxView }): Promise<ReactNode> {
  const session = await requireSession();
  const api = apiFor(session);
  const me = currentMe().catch(() => null);

  let page: Page<Ticket>;
  try {
    page = await api.tickets(view.filter);
  } catch (error) {
    const problem = problemOf(error);
    return (
      <>
        <PageHeader title={view.title} />
        {error instanceof ApiError && error.status === 403 ? (
          <EmptyState
            tone="forbidden"
            title="Your account can’t read tickets"
            description="Ask an administrator for the agent role."
          />
        ) : (
          <ProblemState problem={problem} context="tickets" secondaryAction={{ id: 'retry', label: 'Try again', href: inboxHref(view) }} />
        )}
      </>
    );
  }

  const person = await me;
  const summary = filterSummary(view);
  const caption = formatCount(page.data.length, page.nextCursor !== null, { one: 'ticket', other: 'tickets' });

  return (
    <>
      <PageHeader title={view.title} meta={page.data.length > 0 ? caption : undefined} />
      <DeskSkipLinks links={[{ label: 'Skip to ticket list', targetId: INBOX_REGIONS.list }]} />
      {summary ? (
        <p className="app-Inbox__filters">
          <span>{summary}</span>
          <Button href={clearedHref(view)} variant="ghost" size="sm">
            Clear filters
          </Button>
        </p>
      ) : null}
      <section id={INBOX_REGIONS.list} tabIndex={-1} aria-label={`Tickets, ${view.title}`} className="app-Inbox__list">
        {page.data.length === 0 ? (
          view.filtered ? (
            <EmptyState
              tone="search"
              title="No tickets match"
              description="Nothing in this view matches these filters."
              action={{ id: 'clear', label: 'Clear filters', href: clearedHref(view) }}
            />
          ) : (
            <EmptyState
              tone={view.empty.tone}
              title={view.empty.title}
              description={view.empty.description}
              {...(view.key === 'mine' ? { action: { id: 'unassigned', label: 'Pick up from Unassigned', href: '/inbox/unassigned' } } : {})}
            />
          )
        ) : (
          <QueueTable
            watch={[...(person?.actor.id ? [`user:${person.actor.id}`] : []), ...deskTopics(person?.teamIds ?? [])]}
            tickets={page.data}
            caption={`${view.title}, ${caption}`}
            emptyTitle={view.empty.title}
            emptyDescription={view.empty.description}
          />
        )}
      </section>
      {page.nextCursor ? (
        <p className="app-Inbox__more">
          <Button href={inboxHref(view, { cursor: page.nextCursor })} variant="secondary">
            Show more
          </Button>
        </p>
      ) : null}
    </>
  );
}
