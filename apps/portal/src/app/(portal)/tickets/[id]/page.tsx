import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ApprovalRequest, SlaTimers, Ticket, Timeline } from '@itsm/sdk';
import { Button, RelativeTime, Skeleton, SkeletonConversation, SkeletonText } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { LiveRefresh } from '../../../../client/live.js';
import { NOT_FOUND_METADATA } from '../../../../components/NotFoundScreen.js';
import { settle, type Settled } from '../../../../home/settle.js';
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
  if (!read.ok && read.status === 404) return NOT_FOUND_METADATA;
  return { title: read.ok ? read.ticket.title : id };
}

/**
 * One request, as the person who raised it follows it (SPEC §6.3
 * `/tickets/[id]`, X-35): the reference and when it was raised, its title,
 * then **one card** that says where it is and what they can do about it,
 * then the conversation and the composer, then the details folded away.
 *
 * **Existence first** (SPEC §5.5, A4 §5.4). The request itself (lensed,
 * `GET /tickets/:id`) is the one read this page waits for before it draws
 * anything, and no `loading.tsx` or `<Suspense>` sits above it: a request
 * that does not exist, or is not this person's (the API answers both the
 * same way, deliberately), calls `notFound()` while nothing has been sent,
 * so the browser gets a real 404 and the frame's not-found screen. A request
 * opened by its id (a notification) moves to its number the same way, as a
 * real redirect.
 *
 * Everything else streams. The timeline — read for public comments and task
 * states only, never events or their payloads — starts beside the existence
 * read; the service-level timers (best effort) and, for a request waiting
 * for approval, how far the approval has got start the moment the request is
 * known. The card and the conversation wait for them inside their own
 * boundary, behind a skeleton of their shape, so the heading is on screen
 * as soon as the request is.
 *
 * Nothing on this page reads a priority or an impact.
 */
export default async function RequestPage({ params, searchParams }: { params: Params; searchParams: Search }): Promise<ReactNode> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const session = await requireSession();
  const api = apiFor(session);
  const timeline = settle(api.timeline(id));
  const [me, read] = await Promise.all([currentMe(), readTicket(id)]);

  if (!read.ok) {
    if (read.status === 404) notFound();
    if (read.status === 401) redirect(await loginHref());
    return (
      <div className="app-Page app-Page--reading app-Request">
        <BackToRequests />
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

  const held = heldPermissions(me);
  const sla = held.has('sla.read') ? settle(api.slaTimers(ticket.id)) : Promise.resolve(null);
  const approvals =
    ticket.status === 'pending_approval' && held.has('approval.read') ? settle(api.approvals({ ticketId: ticket.id })) : Promise.resolve(null);

  return (
    <div className="app-Page app-Page--reading app-Request">
      <LiveRefresh entity="ticket" id={ticket.id} />
      <BackToRequests />
      <header className="app-Request__header">
        <p className="app-Request__meta">
          {typeLabel(ticket.type)} · <span className="app-Request__number">{ticket.number}</span> · raised{' '}
          <RelativeTime date={ticket.createdAt} relativeStyle="long" absoluteStyle="date" />
        </p>
        <h1 className="app-Request__title" tabIndex={-1}>
          {ticket.title}
        </h1>
      </header>

      <Suspense fallback={<RequestBodySkeleton />}>
        <RequestBody
          ticket={ticket}
          reader={{ id: me.actor.id, locale: me.locale, timeZone: me.timeZone }}
          can={{ move: held.has('ticket.transition'), reply: held.has('ticket.comment.public'), markSeen: held.has('notification.read') }}
          startWithNo={query.fixed === 'no'}
          timeline={timeline}
          sla={sla}
          approvals={approvals}
        />
      </Suspense>

      <RequestDetails number={ticket.number} kind={typeLabel(ticket.type)} raisedAt={ticket.createdAt} updatedAt={ticket.updatedAt} />
    </div>
  );
}

interface RequestBodyProps {
  readonly ticket: Ticket;
  readonly reader: { readonly id: string | null; readonly locale: string; readonly timeZone: string };
  readonly can: { readonly move: boolean; readonly reply: boolean; readonly markSeen: boolean };
  readonly startWithNo: boolean;
  readonly timeline: Promise<Settled<Timeline>>;
  readonly sla: Promise<Settled<SlaTimers> | null>;
  readonly approvals: Promise<Settled<{ readonly data: readonly ApprovalRequest[] }> | null>;
}

/**
 * The card and the conversation: the part of the page that waits for the
 * second reads. Each of them may fail on its own — no timers is no sentence
 * about time, no timeline is "Couldn't load the conversation" under a card
 * that still says where the request is.
 */
async function RequestBody({ ticket, reader, can, startWithNo, timeline, sla, approvals }: RequestBodyProps): Promise<ReactNode> {
  const [lines, clocks, approvalRead] = await Promise.all([timeline, sla, approvals]);
  const { locale, timeZone } = reader;
  const status = ticket.status;
  const now = new Date();
  const hero = heroFor(status);
  const day = (at: string | null): string | null => (at ? formatDateTime(at, { locale, timeZone, style: 'monthDay' }) : null);
  const entries = lines.ok ? lines.value.entries : null;
  const approval: ApprovalRequest | undefined = approvalRead?.ok ? approvalRead.value.data[0] : undefined;
  const conversation = conversationOf(ticket, entries, reader.id);

  // The card asks for something (Reply, Is it fixed?): the composer rests as one line under it.
  const heroAsks = (hero.primary === 'reply' && can.reply) || (hero.primary === 'confirm' && can.move);
  const composer = hero.finished || !can.reply ? 'hidden' : heroAsks ? 'collapsed' : 'open';

  return (
    <>
      {can.markSeen ? <MarkSeen ticketId={ticket.id} messages={conversation.length} /> : null}
      <RequestHero
        number={ticket.number}
        title={ticket.title}
        status={status}
        version={ticket.version}
        hero={hero}
        steps={stepsFor(status, { raised: day(ticket.createdAt) ?? '', resolved: day(ticket.resolvedAt), closed: day(ticket.closedAt) })}
        sla={slaSentence(status, clocks?.ok ? clocks.value.timers : null, now, locale, timeZone)}
        tasks={taskProgress(entries)}
        approval={approvalLine(approval, now, locale, timeZone)}
        canMove={can.move}
        canReply={can.reply}
        startWithNo={startWithNo}
        readerId={reader.id}
      />

      <Conversation
        number={ticket.number}
        readerId={reader.id}
        entries={conversation}
        attachments={lines.ok ? lines.value.attachments.map((file) => ({ id: file.id, name: file.filename, size: file.size, mime: file.mime })) : []}
        composer={composer}
        sendIsPrimary={!heroAsks && hero.primary === null}
        finished={hero.finished}
        unavailable={!lines.ok}
      />
    </>
  );
}

/**
 * The card and the conversation while they are read, in their shape: the
 * card with its heading, sentence and steps, then messages. Revealed after
 * 200 ms; "Loading the request…" for a screen reader after a second.
 */
function RequestBodySkeleton(): ReactNode {
  return (
    <>
      <div className="app-RequestHero app-RequestHero--loading" aria-hidden="true">
        <div className="app-RequestHero__head">
          <Skeleton width={40} height={40} radius="full" />
          <div className="app-RequestHero__text">
            <Skeleton width="40%" height={22} radius="md" />
            <SkeletonText lines={2} size="callout" />
          </div>
        </div>
        <Skeleton width="10rem" height={36} radius="md" />
        <Skeleton width="100%" height={40} radius="md" />
      </div>
      <SkeletonConversation messages={3} label="Loading the request…" />
    </>
  );
}

function BackToRequests(): ReactNode {
  return (
    <Button variant="ghost" size="sm" iconStart="chevron-left" href="/tickets" className="app-Request__back">
      My requests
    </Button>
  );
}
