'use client';

import type { ReactNode } from 'react';
import type { Ticket, TimelineEntry } from '@itsm/sdk';
import { StatusPill, Stepper, useItsm, type StepperStep } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { stateLabel, ticketEventType } from '../inbox/presentation.js';
import { PHASE_LABEL, PHASES, phaseOf, type Phase } from './TicketHero.js';

/**
 * The ticket's lifecycle on the full page (A6 §5.6.2): New → In progress →
 * Waiting → Resolved → Closed as a small horizontal stepper, each step
 * reached showing when it was first reached, from the history's
 * `status.changed` events. The Waiting step names the wait ("Waiting on
 * requester") while the ticket is in it; a step the ticket went past without
 * visiting reads "skipped", so a ticket resolved straight from New does not
 * pretend it was ever worked. A cancelled ticket leaves the path: one
 * "Cancelled 14:02" pill instead. Reopened work adds "Reopened ×1" after it.
 *
 * Page only: in the pane the status chip says "Step 2 of 5" instead.
 */

export type LifecycleModel =
  | { readonly kind: 'steps'; readonly steps: readonly StepperStep[]; readonly reopened: number }
  | { readonly kind: 'cancelled'; readonly at: string | null };

/** When each stage was first reached: the ticket's creation for New, then each status change in order. */
function firstReached(ticket: Pick<Ticket, 'createdAt'>, entries: readonly TimelineEntry[]): Partial<Record<Phase, string>> {
  const reached: Partial<Record<Phase, string>> = { new: ticket.createdAt };
  const changes = entries
    .filter((entry) => entry.kind === 'event' && ticketEventType(entry.type) === 'ticket.status.changed')
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const entry of changes) {
    if (entry.kind !== 'event') continue;
    const to = typeof entry.payload?.to === 'string' ? entry.payload.to : null;
    const phase = to ? phaseOf(to) : null;
    if (phase && !reached[phase]) reached[phase] = entry.at;
  }
  return reached;
}

/** The last time the ticket was cancelled, from its history. */
function cancelledAt(entries: readonly TimelineEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === 'event' && ticketEventType(entry.type) === 'ticket.status.changed' && entry.payload?.to === 'cancelled') return entry.at;
  }
  return null;
}

/**
 * The lifecycle as steps. Pure, so the stepper's states — times, skipped,
 * the named wait, the finished path — are tested from a ticket and its
 * history; `at` formats a moment for the step's second line.
 */
export function lifecycleModel(
  ticket: Pick<Ticket, 'status' | 'statusCategory' | 'createdAt' | 'reopenCount'>,
  entries: readonly TimelineEntry[],
  at: (value: string) => string,
): LifecycleModel | null {
  if (ticket.status === 'cancelled') return { kind: 'cancelled', at: cancelledAt(entries) };
  const current = phaseOf(ticket.status, ticket.statusCategory);
  if (!current) return null;
  const reached = firstReached(ticket, entries);
  const index = PHASES.indexOf(current);
  // A closed ticket has finished the path: its last step is done, not "current".
  const finished = current === 'closed';
  const steps = PHASES.map((phase, position): StepperStep => {
    const time = reached[phase];
    const label = phase === 'waiting' && current === 'waiting' ? stateLabel(ticket.status) : PHASE_LABEL[phase];
    let status: StepperStep['status'];
    if (position < index || (finished && position === index)) status = time ? 'complete' : 'skipped';
    else if (position === index) status = current === 'waiting' ? 'waiting' : 'current';
    else status = 'upcoming';
    return { id: phase, label, status, ...(time && status !== 'upcoming' && status !== 'skipped' ? { description: at(time) } : {}) };
  });
  return { kind: 'steps', steps, reopened: ticket.reopenCount };
}

export interface LifecycleProps {
  readonly ticket: Ticket;
  readonly entries: readonly TimelineEntry[];
}

export function Lifecycle({ ticket, entries }: LifecycleProps): ReactNode {
  const { locale, timeZone } = useItsm();
  const at = (value: string): string => formatDateTime(value, { locale, timeZone, style: 'weekdayTime' });
  const model = lifecycleModel(ticket, entries, at);
  if (!model) return null;
  if (model.kind === 'cancelled') {
    return (
      <div className="app-Lifecycle">
        <StatusPill size="sm" tone="neutral" icon="ban" label={model.at ? `Cancelled ${at(model.at)}` : 'Cancelled'} />
      </div>
    );
  }
  return (
    <div className="app-Lifecycle">
      <Stepper label="Ticket progress" steps={model.steps} size="sm" orientation="horizontal" className="app-Lifecycle__steps" />
      {model.reopened > 0 ? <StatusPill size="sm" tone="neutral" icon="history" label={`Reopened ×${model.reopened}`} /> : null}
    </div>
  );
}

export default Lifecycle;
