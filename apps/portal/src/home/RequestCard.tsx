import type { ReactNode } from 'react';
import { Button, RelativeTime, Stepper, StatusPill, VisuallyHidden } from '@itsm/ui';
import { AppLink } from '../app/AppLink.js';
import { nextAction, requesterState, typeLabel } from '../tickets/presentation.js';
import { miniSteps, waitedFor, type HomeRow } from './model.js';
import { ResolutionActions } from './ResolutionActions.js';

/**
 * One of "Your requests" on Home as a card (v3 §7.2, A6 §6.1.2): the state in
 * the requester's words and the design system's tone (waiting is `hold`),
 * the title as the one link — stretched over the card, so a thumb anywhere
 * on it opens the request — the facts a person scans for, a mini stepper of
 * the four stages, and the row's own move at the end (Reply · "Yes, it's
 * fixed" / "No" · Review).
 *
 * A server component: the pill, the stepper and the card are drawn on the
 * server, and only the controls (the links' client navigation, the
 * relative time, "Yes, it's fixed") are islands — the same ones the v2 row
 * already shipped, so Home's first load does not grow for the cards.
 *
 * The actions are siblings of the link, above its stretched area, never
 * inside it (X-62). The stepper hides itself below a 480 px card (A6), where
 * the pill already says where the request is. Nothing here can show a
 * priority: the row carries only the fields a requester is told about.
 */
export function RequestCard({ row, now }: { readonly row: HomeRow; readonly now: Date }): ReactNode {
  const { ticket } = row;
  const approval = row.approval;
  const shown = requesterState(ticket.status);
  const pill = approval ? { label: 'Approval waiting', tone: 'hold' as const, icon: 'hourglass' as const } : { label: shown.label, tone: shown.tone, icon: shown.icon };
  const href = row.href ?? `/tickets/${encodeURIComponent(ticket.number)}`;
  const yours = approval !== undefined || nextAction(ticket.status).yours;

  return (
    <li className="app-RequestCard" data-yours={yours ? '' : undefined}>
      <div className="app-RequestCard__main">
        <p className="app-RequestCard__state">
          <StatusPill size="sm" srPrefix="Status" label={pill.label} tone={pill.tone} icon={pill.icon} />
        </p>
        <AppLink className="app-RequestCard__link" href={href}>
          <span className="app-RequestCard__title">{ticket.title}</span>
        </AppLink>
        <p className="app-RequestCard__meta">
          {approval ? (
            <span>Oldest {waitedFor(approval.oldestAt, now)}</span>
          ) : (
            <>
              <span className="app-RequestCard__number">{ticket.number}</span>
              <span className="app-RequestCard__fact">{typeLabel(ticket.type)}</span>
              <span className="app-RequestCard__fact">
                Updated <RelativeTime date={ticket.updatedAt} />
              </span>
            </>
          )}
        </p>
        {approval ? null : <Stepper size="sm" label="Progress" className="app-RequestCard__steps" steps={miniSteps(ticket.status)} />}
      </div>
      <CardAction row={row} />
    </li>
  );
}

function CardAction({ row }: { readonly row: HomeRow }): ReactNode {
  switch (row.action) {
    case 'reply':
      return (
        <div className="app-RequestCard__actions">
          <Button size="sm" variant="tinted" iconStart="reply" href={`/tickets/${encodeURIComponent(row.ticket.number)}#reply`}>
            Reply<VisuallyHidden> to {row.ticket.title}</VisuallyHidden>
          </Button>
        </div>
      );
    case 'confirm':
      return row.version === undefined ? null : (
        <div className="app-RequestCard__actions">
          <ResolutionActions number={row.ticket.number} version={row.version} title={row.ticket.title} />
        </div>
      );
    case 'review':
      return (
        <div className="app-RequestCard__actions">
          <Button size="sm" variant="tinted" iconStart="approvals" href={row.href ?? '/approvals'}>
            Review<VisuallyHidden>: {row.ticket.title}</VisuallyHidden>
          </Button>
        </div>
      );
    default:
      return null;
  }
}
