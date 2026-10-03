'use client';

import { lazy, Suspense, type ReactNode } from 'react';
import type { AreaModel } from '@itsm/contracts/areas';
import type { SlaTimer, Ticket, TimelineEntry } from '@itsm/sdk';
import { SlaClock } from '@itsm/ui';
import { Header, type HeaderProps } from './Header.js';
import './hero.css';
import { clockState, headlineTimer, SlaBlock } from './SlaBlock.js';

/**
 * The ticket hero (v3 §7.1.4, A6 §5.6.2): a white bordered card at the top
 * of the ticket — D2 keeps the navy for dashboards; a ticket is a record —
 * holding everything an agent reads before they act. Its rows, in order:
 *
 * - **identity**: the type's neutral tile (D5: a type is never a status
 *   colour), the number in the `id` style, the type, the channel and who
 *   raised it when, with ‹ › through the list, the inspector's toggle and ⋯;
 * - **title**: the page's `<h1>` (the pane's `h2`), edited in place with `e`;
 * - **chips**: status, priority, assignee, team and category, each a menu,
 *   with the one next step at the end of the row;
 * - **lifecycle** (page only): New → In progress → Waiting → Resolved →
 *   Closed, each step with when it was first reached;
 * - **SLA block**, in the end column: the clock the ticket answers to.
 *
 * It wraps the `Header` logic rather than replacing it, so the keyboard map
 * (v2 D14), the title editor and the menus behave exactly as before. As the
 * conversation scrolls it condenses to one row — number, title, status, a
 * 28 px ring and the next step — and every control keeps its place in the tab
 * order. On a phone the SLA block gives way to its chip in the header row.
 *
 * The lifecycle is loaded on its own, after the hero: it is page-only, below
 * the chips, and the route's first load is budgeted to the byte.
 */

/* ------------------------------------------------------------ Lifecycle */

/** The five stages every ticket passes through, whatever its states are called (A6 §5.6.2). */
export const PHASES = ['new', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  new: 'New',
  in_progress: 'In progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

/**
 * The stage a state belongs to. Reopened work is in progress again; every
 * `pending_*` state is waiting; a tenant's own state goes by its category,
 * which a tenant cannot rename. `null` for cancelled, which leaves the path.
 */
export function phaseOf(status: string, category?: string): Phase | null {
  if (status === 'cancelled') return null;
  if (status === 'new') return 'new';
  if (status === 'in_progress' || status === 'reopened') return 'in_progress';
  if (status.startsWith('pending_')) return 'waiting';
  if (status === 'resolved') return 'resolved';
  if (status === 'closed') return 'closed';
  switch (category) {
    case 'paused':
      return 'waiting';
    case 'resolved':
      return 'resolved';
    case 'closed':
      return 'closed';
    case 'open':
      return 'in_progress';
    default:
      return null;
  }
}

/** "Step 2 of 5": what the status chip says where the lifecycle row is not drawn (the pane, a phone). */
export function stepText(ticket: Pick<Ticket, 'status' | 'statusCategory'>): string | null {
  const phase = phaseOf(ticket.status, ticket.statusCategory);
  return phase ? `Step ${PHASES.indexOf(phase) + 1} of ${PHASES.length}` : null;
}

/* ------------------------------------------------------ View as requester */

/** What "View as requester" does on this ticket: a link, a reason it cannot, or nothing to offer. */
export type RequesterView = { readonly kind: 'offer' } | { readonly kind: 'disabled'; readonly reason: string } | null;

/**
 * "View as requester" (A6 §5.6.9): the ticket as its requester sees it in the
 * Help Portal. A person may open only their own requests there, so it is
 * offered when the requester is the signed-in person. In the shared demo the
 * hop opens the Help Portal as Emma Clarke (D11), so it is offered on her
 * tickets and, on anybody else's, shown disabled with the reason — a link
 * that switched persona and landed on a 404 would teach a visitor the
 * product is broken. Absent when the Help Portal is not one of the person's
 * areas, or the ticket has no requester.
 */
export function requesterView(input: {
  readonly areas: AreaModel | null;
  readonly requesterId: string | null;
  readonly viewerId: string | null;
  /** The demo's Employee persona (`me.demo.personaUserIds.employee`); `null` outside the demo or until read. */
  readonly employeeId: string | null;
}): RequesterView {
  const { areas, requesterId, viewerId, employeeId } = input;
  const portal = areas?.areas.find((area) => area.id === 'portal');
  if (!areas || !portal || !requesterId) return null;
  const requester = requesterId.toLowerCase();
  if (areas.demo) {
    if (employeeId && requester === employeeId.toLowerCase()) return { kind: 'offer' };
    const name = portal.persona?.name ?? 'the Employee persona';
    return { kind: 'disabled', reason: `In the demo, only tickets raised by ${name} can be opened as the requester` };
  }
  return viewerId && requester === viewerId.toLowerCase() ? { kind: 'offer' } : null;
}

/* ------------------------------------------------------------------ Hero */

const LazyLifecycle = lazy(() => import('./Lifecycle.js'));

export interface TicketHeroProps extends HeaderProps {
  /** The history, for the lifecycle's times. */
  readonly entries: readonly TimelineEntry[];
  readonly timers: readonly SlaTimer[] | null;
  /** Opens the inspector's Service levels card (the SLA block's button). */
  readonly onOpenSla?: () => void;
}

/** The SLA as a chip: the phone's header row and the condensed hero, where the block does not fit. */
function SlaChip({ timers }: { readonly timers: readonly SlaTimer[] | null }): ReactNode {
  const timer = headlineTimer(timers);
  if (!timer) return null;
  const state = clockState(timer.state);
  return (
    <span className="app-TicketHero__slaChip">
      <SlaClock
        targetType={timer.targetType}
        state={state}
        remainingMinutes={state === 'running' ? Math.round(timer.remainingMs / 60_000) : null}
        display="chip"
        dueAt={timer.dueAt}
        breachedAt={timer.breachedAt}
      />
    </span>
  );
}

export function TicketHero({ entries, timers, onOpenSla, ...header }: TicketHeroProps): ReactNode {
  const { ticket, mode, condensed = false } = header;
  return (
    <header className="app-TicketHero app-WsHeader" data-mode={mode} data-condensed={condensed ? '' : undefined} data-sla={timers === null ? undefined : ''}>
      <div className="app-TicketHero__main">
        <Header {...header} properties={undefined} />
        <div className="app-TicketHero__chips">
          {header.properties}
          <SlaChip timers={timers} />
        </div>
        {mode === 'page' ? (
          <div className="app-TicketHero__lifecycle">
            <Suspense fallback={<div className="app-Lifecycle app-Lifecycle--loading" aria-hidden="true" />}>
              <LazyLifecycle ticket={ticket} entries={entries} />
            </Suspense>
          </div>
        ) : null}
      </div>
      {timers !== null ? (
        <div className="app-TicketHero__sla">
          <SlaBlock timers={timers} status={ticket.status} compact={mode === 'pane' || condensed} {...(onOpenSla ? { onOpen: onOpenSla } : {})} />
        </div>
      ) : null}
    </header>
  );
}
