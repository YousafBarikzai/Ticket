'use client';

import type { ReactNode } from 'react';
import type { Ticket } from '@itsm/sdk';
import { Badge, RelativeTime, StatusPill, VisuallyHidden, cx, type IconName, type Tone } from '@itsm/ui';
import { AppLink } from '../app/AppLink.js';
import { nextAction, requesterState, typeLabel } from '../tickets/presentation.js';

/**
 * One request in a list — Home's "Your requests", My requests, search
 * results (SPEC §6.3). No hooks and no handlers, and every prop a server page
 * can pass (`actions` is JSX). A client module all the same: a server
 * component reaching `StatusPill` through the design system's root would
 * make every client component of its display group part of the page's first
 * load (the barrel is followed one level), and the list pages that draw rows
 * also append them on the client (Load more).
 *
 * The whole row is the way in: the title is the one link, and its hit area is
 * stretched over the row, so a thumb anywhere on it opens the request and a
 * screen reader hears one link named by the title rather than five. The
 * facts under it read in the order a person scans for them — the state (with
 * its icon, never colour alone), the number, what kind of thing it is, when
 * it last moved — and the chip on the end says whose move it is
 * (`nextAction`).
 *
 * Inline actions (Reply · "Yes, it's fixed" / "No" · Review) are *siblings*
 * of the link, above its stretched area, never inside it: a button inside a
 * link is two controls a screen reader cannot tell apart (X-62).
 *
 * Nothing here can show a priority or an impact: the row takes only the
 * fields a requester is told about.
 */

export type RequestSummary = Pick<Ticket, 'number' | 'type' | 'title' | 'status' | 'updatedAt'>;

export interface RequestRowProps {
  readonly ticket: RequestSummary;
  /** Where the row leads. The request's page by default. */
  readonly href?: string;
  /** The state pill, when it should say something other than the ticket's state ("Approval waiting"). */
  readonly state?: { readonly label: string; readonly tone: Tone; readonly icon?: IconName };
  /** The chip, when it should say something other than `nextAction` ("Review"); `null` for none. */
  readonly next?: { readonly label: string; readonly tone: Tone } | null;
  /** Whether the row is the requester's to move (drawn with the "yours" edge). From `nextAction` by default. */
  readonly yours?: boolean;
  /** A notification about it has not been read: a dot, and the words for a screen reader. */
  readonly unread?: boolean;
  /** Controls beside the link: the row's inline action. */
  readonly actions?: ReactNode;
  /** `li` (default) inside a list; `div` on its own. */
  readonly as?: 'li' | 'div';
  readonly className?: string;
}

export function RequestRow({ ticket, href, state, next, yours, unread = false, actions, as: Tag = 'li', className }: RequestRowProps): ReactNode {
  const shown = requesterState(ticket.status);
  const pill = state ?? { label: shown.label, tone: shown.tone, icon: shown.icon };
  const action = nextAction(ticket.status);
  const chip = next === undefined ? (action.label ? { label: action.label, tone: action.tone } : null) : next;
  const isYours = yours ?? action.yours;

  return (
    <Tag className={cx('app-RequestRow', className)} data-yours={isYours ? (chip?.tone ?? 'warning') : undefined} data-unread={unread ? '' : undefined}>
      <div className="app-RequestRow__main">
        <AppLink className="app-RequestRow__link" href={href ?? `/tickets/${encodeURIComponent(ticket.number)}`}>
          {unread ? (
            <span className="app-RequestRow__unread">
              <VisuallyHidden>Unread update: </VisuallyHidden>
            </span>
          ) : null}
          <span className="app-RequestRow__title">{ticket.title}</span>
        </AppLink>
        <p className="app-RequestRow__meta">
          <StatusPill size="sm" srPrefix="Status" label={pill.label} tone={pill.tone} {...(pill.icon ? { icon: pill.icon } : {})} />
          <span className="app-RequestRow__number">{ticket.number}</span>
          <span className="app-RequestRow__fact">{typeLabel(ticket.type)}</span>
          <span className="app-RequestRow__fact">
            Updated <RelativeTime date={ticket.updatedAt} />
          </span>
        </p>
      </div>
      {chip || actions ? (
        <div className="app-RequestRow__end">
          {chip ? (
            <Badge tone={chip.tone} className="app-RequestRow__next">
              {chip.label}
            </Badge>
          ) : null}
          {actions ? <div className="app-RequestRow__actions">{actions}</div> : null}
        </div>
      ) : null}
    </Tag>
  );
}
