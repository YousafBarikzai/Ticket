import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApiError, type Suggestion, type TimelineEntry } from '@itsm/sdk';
import { Badge, EmptyState, SlaClock, Timeline, type TimelineEvent } from '@itsm/ui';
import { TicketActions } from '../../../../components/TicketActions.js';
import { TriageCard } from '../../../../components/TriageCard.js';
import { TicketWorkArea } from '../../../../components/TicketWorkArea.js';
import { categoryIntent, priorityEmphasis, priorityIntent, stateLabel, typeLabel } from '../../../../queue/presentation.js';
import { transitionsFrom } from '../../../../queue/transitions.js';
import { apiFor, requireSession } from '../../../../server/session.js';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: id };
}

/** Whichever of the five calls fail, the page still renders what did load. */
async function orNull<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch {
    return null;
  }
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }): Promise<ReactNode> {
  const { id } = await params;
  const session = await requireSession();
  const api = apiFor(session);

  let timeline: Awaited<ReturnType<typeof api.timeline>>;
  try {
    timeline = await api.timeline(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <EmptyState
        tone="error"
        title="This ticket could not be loaded"
        description={error instanceof ApiError ? error.message : 'The API could not be reached.'}
      />
    );
  }

  const ticket = timeline.ticket;

  // In parallel, and each one allowed to fail on its own. SLA, time and AI are
  // supporting panes: a tenant without the time module, or an agent without
  // `ai.read`, should still get the ticket rather than an error page.
  const [timers, time, capabilities, suggestions, triage, me] = await Promise.all([
    orNull(api.slaTimers(id)),
    orNull(api.timeOnTicket(ticket.id)),
    orNull(api.capabilities()),
    orNull(api.suggestions(ticket.id)),
    // Null unless the desk is in `suggest` mode and something is waiting.
    orNull(api.triageSuggestion(ticket.id)),
    orNull(api.me()),
  ]);

  const held = new Set(me?.permissions.map((permission) => permission.key) ?? []);
  const myUserId = me?.actor.id ?? null;

  return (
    <article className="itsm-Ticket">
      <header className="itsm-Ticket__head">
        <p className="itsm-Ticket__number">
          {ticket.number} · {typeLabel(ticket.type)}
        </p>
        <h1 className="itsm-Ticket__title">{ticket.title}</h1>
        <p className="itsm-Ticket__badges">
          <Badge intent={priorityIntent(ticket.priority)} emphasis={priorityEmphasis(ticket.priority)} srPrefix="Priority">
            {ticket.priority}
          </Badge>
          <Badge intent={categoryIntent(ticket.statusCategory)} srPrefix="Status">
            {stateLabel(ticket.status)}
          </Badge>
          {timeline.includesInternal ? null : (
            // Said out loud rather than inferred from an empty thread: an agent
            // who cannot see internal notes is reading a different ticket from
            // the one their colleague is describing.
            <Badge intent="warning">Internal notes are hidden from you</Badge>
          )}
        </p>
      </header>

      <section className="itsm-Ticket__facts" aria-label="Ticket details">
        <dl className="itsm-Ticket__properties">
          <dt>Raised</dt>
          <dd>
            <time dateTime={ticket.createdAt}>{ticket.createdAt}</time>
          </dd>
          <dt>Requester</dt>
          <dd>{ticket.requesterId ?? 'Not recorded'}</dd>
          <dt>Assignee</dt>
          <dd>{ticket.assigneeId ? (ticket.assigneeId === myUserId ? 'You' : ticket.assigneeId) : 'Nobody'}</dd>
          <dt>Impact / urgency</dt>
          <dd>
            {ticket.impact} / {ticket.urgency}
          </dd>
          <dt>Channel</dt>
          <dd>{ticket.sourceChannel}</dd>
          {time ? (
            <>
              <dt>Time logged</dt>
              <dd>
                {time.summary.loggedMinutes} min across {time.summary.entries}{' '}
                {time.summary.entries === 1 ? 'entry' : 'entries'}
              </dd>
            </>
          ) : null}
        </dl>

        {timers && timers.timers.length > 0 ? (
          <div className="itsm-Ticket__sla">
            {timers.timers.map((timer) => (
              <SlaClock
                key={timer.id}
                targetType={timer.targetType}
                state={slaStateOf(timer.state)}
                remainingMinutes={remainingMinutesOf(timer)}
              />
            ))}
          </div>
        ) : null}

        {triage?.data ? (
          <TriageCard triage={triage.data} ticketVersion={ticket.version} canAct={held.has('ai.suggest')} />
        ) : null}

        <TicketActions
          ticketNumber={ticket.number}
          version={ticket.version}
          currentStatus={ticket.status}
          allowedTransitions={transitionsFrom(ticket.status)}
          assignedToMe={ticket.assigneeId !== null && ticket.assigneeId === myUserId}
          canAssign={held.has('ticket.assign') || held.has('ticket.update')}
          myUserId={myUserId}
        />
      </section>

      <TicketWorkArea
        ticketId={ticket.id}
        ticketNumber={ticket.number}
        canBeInternal={timeline.includesInternal}
        capabilities={capabilities?.capabilities ?? []}
        suggestions={(suggestions?.data ?? []) as Suggestion[]}
      >
        <Timeline label="Ticket history" events={timeline.entries.map(toEvent)} />
      </TicketWorkArea>
    </article>
  );
}

/**
 * MOD-07's timer states, mapped onto what the clock can show.
 *
 * Anything unrecognised reads as `paused`, which shows no number. A clock that
 * guessed and counted down against a state it did not understand would be
 * confidently wrong about the one thing it exists to say.
 */
function slaStateOf(state: string): 'running' | 'paused' | 'met' | 'breached' {
  switch (state) {
    case 'running':
      return 'running';
    case 'met':
      return 'met';
    case 'breached':
      return 'breached';
    default:
      return 'paused';
  }
}

function remainingMinutesOf(timer: { state: string; dueAt: string | null; remainingMs: number }): number | null {
  if (timer.state !== 'running') return null;
  // The due instant is the truth while the clock runs: `remainingMs` is
  // business milliseconds banked at the last state change, and counting down
  // from it in wall-clock time would overstate the time left across an evening.
  if (timer.dueAt) return Math.round((new Date(timer.dueAt).getTime() - Date.now()) / 60_000);
  return Math.round(timer.remainingMs / 60_000);
}

function toEvent(entry: TimelineEntry): TimelineEvent {
  if (entry.kind === 'comment') {
    return {
      id: entry.id,
      timestamp: entry.at,
      title: entry.visibility === 'internal' ? 'Internal note' : 'Reply',
      body: entry.body,
      visibility: entry.visibility,
      ...(entry.authorId ? { actor: entry.authorId } : {}),
      meta: entry.channel,
    };
  }
  if (entry.kind === 'task') {
    return { id: entry.id, timestamp: entry.at, title: `Task: ${entry.title}`, meta: entry.status };
  }
  return {
    id: entry.id,
    timestamp: entry.at,
    // The event type is the honest label. Prose invented per type would be a
    // second vocabulary to keep in step with MOD-04's event catalogue, and it
    // would be wrong for every event added after it was written.
    title: entry.type.replaceAll('.', ' · '),
    ...(entry.actorId ? { actor: entry.actorId } : {}),
  };
}
