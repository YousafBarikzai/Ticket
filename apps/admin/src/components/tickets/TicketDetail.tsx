'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CROSS_AREA_DEMO_TEAM_NOTE, crossAreaTicketHref, type AreaId, type AreaModel } from '@itsm/contracts/areas';
import { Button, DescriptionList, EmptyState, IconButton, InlineAlert, ProblemState, RelativeTime, SkeletonText, StatusPill, type Problem } from '@itsm/ui';
import { SlaClock, type SlaState } from '@itsm/ui/workbench';
import { api } from '../../client/api.js';
import { problemFrom } from '../../problem.js';
import { CHANNELS } from '../../rules/facts.js';
import { PRIORITY_LOOK, detailOf, plainText, priorityText, statusLook, typeLabel, type TicketDetail, type TicketRowView } from './presentation.js';

export type { TicketDetail } from './presentation.js';

const SLA_STATES: ReadonlySet<string> = new Set(['running', 'paused', 'met', 'breached']);

/** Whether `area` is listed for this person: a contextual link to it can be drawn at all (A2 §3.7). */
export function areaListed(areas: AreaModel | undefined, area: AreaId): boolean {
  return areas?.areas.some((row) => row.id === area) ?? false;
}

/**
 * What a cross-area control says in a demo about who the visitor becomes
 * there — "Opens the Service Desk as Alex Morgan" (A2 §3.7, D11) — as its
 * `title` and `aria-description`. Nothing outside a demo, where the person
 * stays themselves.
 */
export function crossAreaHint(areas: AreaModel | undefined, area: AreaId): { readonly title: string; readonly 'aria-description': string } | Record<string, never> {
  if (!areas?.demo) return {};
  const row = areas.areas.find((one) => one.id === area);
  if (!row?.persona || row.current) return {};
  const text = `Opens the ${row.name} as ${row.persona.name}`;
  return { title: text, 'aria-description': text };
}

/**
 * The ticket summary drawer (SPEC §6.1): facts only — type, priority with
 * impact and urgency, status, assignee, team, requester, service, channel,
 * raised and due — its SLA clocks, and one primary action, *Open in
 * Service Desk* (same tab, through the area model, so a demo visitor arrives
 * as Alex Morgan). Nothing here writes.
 *
 * In a demo, Alex reads tickets at team scope: a ticket outside his teams
 * would open on a 404, so the control stays, disabled, with the reason
 * (`CROSS_AREA_DEMO_TEAM_NOTE`, X-B2). Until the ticket's team is known the
 * demo's control waits, disabled, rather than guess.
 *
 * The row is the placeholder while the ticket loads through the SDK; a hard
 * load of `?open=ticket:<number>` arrives with the detail already (D12). A
 * ticket that has gone (deleted, or out of this person's reach) says so and
 * offers nothing else.
 */
export function TicketDetailView({
  number,
  row,
  initial,
  teamNames,
  serviceNames,
  known,
  areas,
}: {
  readonly number: string;
  readonly row?: TicketRowView;
  readonly initial?: TicketDetail;
  readonly teamNames: ReadonlyMap<string, string>;
  readonly serviceNames: ReadonlyMap<string, string>;
  /** Names the table already knows, shared so the drawer asks only for the rest. */
  readonly known: Map<string, string | null>;
  /** The person's areas; the Service Desk control is drawn only when the Service Desk is listed. */
  readonly areas?: AreaModel;
}): ReactNode {
  const [detail, setDetail] = useState<TicketDetail | null>(initial ?? null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (initial && attempt === 0) return;
    let live = true;
    setProblem(null);
    void (async () => {
      try {
        const [ticket, sla] = await Promise.all([
          api.observe.ticket(number),
          api.observe.ticketSla(number).then(
            (value) => value.timers,
            () => null,
          ),
        ]);
        const ids = [ticket.assigneeId, ticket.requesterId].filter((id): id is string => !!id);
        const missing = ids.filter((id) => !known.has(id));
        if (missing.length > 0) {
          try {
            for (const person of await api.tenant.users({ ids: missing, limit: missing.length })) known.set(person.id, person.displayName || person.email);
          } catch {
            // Names are a courtesy; the facts still show.
          }
        }
        const people = Object.fromEntries(ids.map((id) => [id, known.get(id) ?? null]));
        if (live) setDetail(detailOf(ticket, people, sla));
      } catch (error) {
        if (live) setProblem(problemFrom(error));
      }
    })();
    return () => {
      live = false;
    };
    // `known` is a shared, mutable cache; the load depends on which ticket and on Retry.
  }, [number, attempt]);

  if (problem && !detail) {
    if (problem.status === 404) {
      return <EmptyState size="sm" icon="ticket" title="That ticket no longer exists" description="It may have been deleted, or moved out of your reach, since the link was shared." />;
    }
    return <ProblemState problem={problem} size="sm" onRetry={() => setAttempt((value) => value + 1)} />;
  }

  const ticket = detail?.ticket;
  const person = (id: string | null | undefined, empty: string): string => (id ? (detail?.people[id] ?? known.get(id) ?? 'Unknown person') : empty);
  const status = ticket ? statusLook(ticket.status, ticket.statusCategory) : row ? statusLook(row.status, row.statusCategory) : null;
  const priority = ticket?.priority ?? row?.priority;
  const channel = ticket?.sourceChannel ?? row?.channel;
  const desk = areas && areaListed(areas, 'workbench') ? areas : undefined;
  // A real session links at once; a demo waits for the ticket's team (X-B2).
  const deskHref = desk && (!desk.demo || ticket) ? crossAreaTicketHref(desk, { number, groupId: ticket?.groupId ?? null }) : null;

  return (
    <div className="app-TicketDetail">
      <div className="app-TicketDetail__pills">
        {priority ? <StatusPill size="sm" srPrefix="Priority" label={priority} tone={PRIORITY_LOOK[priority]?.tone ?? 'neutral'} /> : null}
        {status ? <StatusPill size="sm" srPrefix="Status" label={status.label} tone={status.tone} icon={status.icon} /> : null}
      </div>

      {deskHref ? (
        <Button variant="primary" href={deskHref} iconEnd="arrow-right" fullWidth {...crossAreaHint(desk, 'workbench')}>
          Open in Service Desk
        </Button>
      ) : desk ? (
        <Button variant="primary" iconEnd="arrow-right" fullWidth {...(ticket ? { disabledReason: CROSS_AREA_DEMO_TEAM_NOTE } : { disabled: true })}>
          Open in Service Desk
        </Button>
      ) : (
        <CopyNumber number={number} />
      )}

      {ticket ? (
        <>
          <DescriptionList
            layout="inline"
            items={[
              { id: 'type', label: 'Type', value: typeLabel(ticket.type) },
              { id: 'priority', label: 'Priority', value: priorityText(ticket) },
              { id: 'status', label: 'Status', value: status?.label ?? ticket.status },
              { id: 'assignee', label: 'Assignee', value: person(ticket.assigneeId, 'Unassigned') },
              { id: 'team', label: 'Team', value: ticket.groupId ? (teamNames.get(ticket.groupId) ?? 'A team you can’t see') : 'No team' },
              { id: 'requester', label: 'Requester', value: person(ticket.requesterId, 'Nobody') },
              ...(ticket.serviceId ? [{ id: 'service', label: 'Service', value: serviceNames.get(ticket.serviceId) ?? 'A service' }] : []),
              { id: 'channel', label: 'Channel', value: CHANNELS.find((entry) => entry.value === channel)?.label ?? channel ?? '' },
              { id: 'raised', label: 'Raised', value: <RelativeTime date={ticket.createdAt} /> },
              { id: 'due', label: 'Due', value: ticket.dueAt ? <RelativeTime date={ticket.dueAt} /> : 'No due date' },
            ]}
          />
          <section className="app-TicketDetail__sla" aria-labelledby="ticket-sla">
            <h3 id="ticket-sla" className="app-TicketDetail__heading">
              Service level
            </h3>
            {detail.timers === null ? (
              <InlineAlert tone="warning">Couldn’t load this ticket’s clocks.</InlineAlert>
            ) : detail.timers.length === 0 ? (
              <p className="app-TicketDetail__note">No SLA clocks: no policy matched this ticket, or it has no target for its priority.</p>
            ) : (
              <ul className="app-TicketDetail__timers">
                {detail.timers.map((timer) =>
                  SLA_STATES.has(timer.state) ? (
                    <li key={timer.id}>
                      <SlaClock
                        targetType={timer.targetType}
                        state={timer.state as SlaState}
                        remainingMinutes={timer.state === 'running' ? Math.round(timer.remainingMs / 60000) : null}
                        {...(timer.dueAt ? { dueAt: timer.dueAt } : {})}
                      />
                    </li>
                  ) : (
                    <li key={timer.id} className="app-TicketDetail__note">
                      {timer.targetType}: {timer.state}
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>
          {ticket.description ? (
            <section className="app-TicketDetail__description" aria-labelledby="ticket-description">
              <h3 id="ticket-description" className="app-TicketDetail__heading">
                Description
              </h3>
              <p className="app-TicketDetail__text">{plainText(ticket.description)}</p>
            </section>
          ) : null}
        </>
      ) : (
        <div className="app-TicketDetail__loading">
          <SkeletonText lines={6} />
          <span className="itsm-visually-hidden" role="status">
            Loading the ticket…
          </span>
        </div>
      )}
    </div>
  );
}

/** With no Service Desk to open, the number to quote: copyable, never a dead link. */
function CopyNumber({ number }: { readonly number: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <p className="app-TicketDetail__copy">
      Work it in the Service Desk: <code>{number}</code>
      <IconButton
        icon={copied ? 'check' : 'copy'}
        size="sm"
        label={copied ? `Copied ${number}` : `Copy ${number}`}
        onClick={() =>
          void navigator.clipboard?.writeText(number).then(
            () => setCopied(true),
            () => undefined,
          )
        }
      />
    </p>
  );
}
