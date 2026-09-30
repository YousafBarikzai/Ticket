import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ApprovalRequest } from '@itsm/sdk';
import { Button, RelativeTime } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { LiveRefresh } from '../../../../client/live.js';
import { settle } from '../../../../home/settle.js';
import { Conversation } from '../../../../requests/Conversation.js';
import { MarkSeen } from '../../../../requests/MarkSeen.js';
import {
  approvalLine,
  conversationOf,
  heroFor,
  slaSentence,
  stepsFor,
  taskProgress,
} from '../../../../requests/model.js';
import { RequestDetails } from '../../../../requests/RequestDetails.js';
import { RequestHero } from '../../../../requests/RequestHero.js';
import { RetryBanner } from '../../../../requests/RetryBanner.js';
import { readTicket } from '../../../../requests/server.js';
import { apiFor, currentMe, heldPermissions, loginHref, requireSession } from '../../../../server/session.js';
import { typeLabel } from '../../../../tickets/presentation.js';
import '../../../../requests/requests.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const read = await readTicket(id);
  return { title: read.ok ? read.ticket.title : id };
}

/**
 * One request, as the person who raised it follows it (SPEC §6.3
 * `/tickets/[id]`, X-35): the reference and when it was raised, its title,
 * then **one card** that says where it is and what they can do about it,
 * then the conversation and the composer, then the details folded away.
 *
 * Reads start together: the request itself (lensed, `GET /tickets/:id`), its
 * timeline — read for public comments and task states only, never events or
 * their payloads — its service-level timers (best effort), and who is
 * reading. A request waiting for approval also asks how far the approval
 * has got. A request opened by its id (a notification) moves to its number.
 *
 * Nothing on this page reads a priority or an impact.
 */
export default async function RequestPage({ params, searchParams }: { params: Params; searchParams: Search }): Promise<ReactNode> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const session = await requireSession();
  const api = apiFor(session);
  const [me, read, timeline] = await Promise.all([currentMe(), readTicket(id), settle(api.timeline(id))]);
  const held = heldPermissions(me);

  if (!read.ok) {
    if (read.status === 404) notFound();
    if (read.status === 401) redirect(await loginHref());
    return (
      <div className="app-Page app-Page--reading app-Request">
        <Button variant="ghost" size="sm" iconStart="chevron-left" href="/tickets" className="app-Request__back">
          My requests
        </Button>
        <h1 className="app-Request__title" tabIndex={-1}>
          {/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? 'Your request' : id}
        </h1>
        <RetryBanner what="this request" />
      </div>
    );
  }

  const ticket = read.ticket;
  // Opened by its id (a notification, an old link): the number is the address people share.
  if (id !== ticket.number) {
    const fixed = typeof query.fixed === 'string' ? `?fixed=${encodeURIComponent(query.fixed)}` : '';
    redirect(`/tickets/${encodeURIComponent(ticket.number)}${fixed}`);
  }

  const status = ticket.status;
  const now = new Date();
  const { locale, timeZone } = me;
  const readerId = me.actor.id;
  const [sla, approvals] = await Promise.all([
    held.has('sla.read') ? settle(api.slaTimers(ticket.id)) : Promise.resolve(null),
    status === 'pending_approval' && held.has('approval.read') ? settle(api.approvals({ ticketId: ticket.id })) : Promise.resolve(null),
  ]);

  const hero = heroFor(status);
  const canMove = held.has('ticket.transition');
  const canReply = held.has('ticket.comment.public');
  const day = (at: string | null): string | null => (at ? formatDateTime(at, { locale, timeZone, style: 'monthDay' }) : null);
  const entries = timeline.ok ? timeline.value.entries : null;
  const approval: ApprovalRequest | undefined = approvals?.ok ? approvals.value.data[0] : undefined;
  const conversation = conversationOf(ticket, entries, readerId);

  // The card asks for something (Reply, Is it fixed?): the composer rests as one line under it.
  const heroAsks = (hero.primary === 'reply' && canReply) || (hero.primary === 'confirm' && canMove);
  const composer = hero.finished || !canReply ? 'hidden' : heroAsks ? 'collapsed' : 'open';

  return (
    <div className="app-Page app-Page--reading app-Request">
      <LiveRefresh entity="ticket" id={ticket.id} />
      {held.has('notification.read') ? <MarkSeen ticketId={ticket.id} messages={conversation.length} /> : null}
      <Button variant="ghost" size="sm" iconStart="chevron-left" href="/tickets" className="app-Request__back">
        My requests
      </Button>
      <header className="app-Request__header">
        <p className="app-Request__meta">
          {typeLabel(ticket.type)} · <span className="app-Request__number">{ticket.number}</span> · raised{' '}
          <RelativeTime date={ticket.createdAt} relativeStyle="long" absoluteStyle="date" />
        </p>
        <h1 className="app-Request__title" tabIndex={-1}>
          {ticket.title}
        </h1>
      </header>

      <RequestHero
        number={ticket.number}
        title={ticket.title}
        status={status}
        version={ticket.version}
        hero={hero}
        steps={stepsFor(status, { raised: day(ticket.createdAt) ?? '', resolved: day(ticket.resolvedAt), closed: day(ticket.closedAt) })}
        sla={slaSentence(status, sla?.ok ? sla.value.timers : null, now, locale, timeZone)}
        tasks={taskProgress(entries)}
        approval={approvalLine(approval, now, locale, timeZone)}
        canMove={canMove}
        canReply={canReply}
        startWithNo={query.fixed === 'no'}
        readerId={readerId}
      />

      <Conversation
        number={ticket.number}
        readerId={readerId}
        entries={conversation}
        attachments={
          timeline.ok ? timeline.value.attachments.map((file) => ({ id: file.id, name: file.filename, size: file.size, mime: file.mime })) : []
        }
        composer={composer}
        sendIsPrimary={!heroAsks && hero.primary === null}
        finished={hero.finished}
        unavailable={!timeline.ok}
      />

      <RequestDetails number={ticket.number} kind={typeLabel(ticket.type)} raisedAt={ticket.createdAt} updatedAt={ticket.updatedAt} />
    </div>
  );
}
