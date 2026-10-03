'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Badge, StatusPill, useItsm } from '@itsm/ui';
import { personName } from '../../inbox/presentation.js';
import type { WorkspaceApi } from '../TicketWorkspace.js';
import { openFromQuery, personQuery, tagsQuery } from './queries.js';

/**
 * The inspector's first card (A6 §5.6.5 row 1): who asked. Their name, how
 * to reach them, a VIP pill when the ticket is tagged `vip`, the person the
 * problem is with when that is someone else, and "Other open tickets from Ada
 * (2)" — the question an agent asks before replying to anyone.
 *
 * Moved out of Details so the card order reads the way a ticket is worked:
 * who, how long, what the AI thinks, then the facts.
 */

/** The tag that marks a requester to look after (A6 §5.6.5). */
export const VIP_TAG = 'vip';

export function RequesterCard({ ws }: { readonly ws: WorkspaceApi }): ReactNode {
  const { ticket, people, viewer } = ws.bundle;
  const { Link } = useItsm();
  const id = ticket.requesterId?.toLowerCase() ?? null;
  const person = useQuery(personQuery(id, viewer.can.readPeople)).data;
  const others = useQuery(openFromQuery(id, id !== null)).data;
  const tags = useQuery(tagsQuery(ticket.number, id !== null)).data;
  if (!id) return <p className="app-Insp__empty">Not recorded</p>;

  const name = person?.displayName || person?.email || personName(id, people, viewer.id);
  const shortName = id === viewer.id ? 'you' : (name.split(/\s+/)[0] ?? name);
  const otherCount = others ? others.numbers.filter((number) => number !== ticket.number).length : 0;
  const detail = person?.email ?? (ticket.sourceChannel === 'email' ? 'Replying by email' : null);
  const vip = (tags ?? []).some((tag) => tag.toLowerCase() === VIP_TAG);
  const affected = ticket.affectedUserId?.toLowerCase() ?? null;
  const affectedLine = affected && affected !== id ? `Affected user: ${personName(affected, people, viewer.id)}` : 'Affected user: same as requester';

  return (
    <div className="app-Person">
      <Avatar name={id === viewer.id ? viewer.name : name} size="lg" decorative />
      <div className="app-Person__body">
        <p className="app-Person__name">
          <span>{id === viewer.id ? 'You' : name}</span>
          {vip ? <StatusPill size="sm" tone="danger" icon="star" label="VIP" /> : null}
          {person?.isExternal ? (
            <Badge size="sm" tone="neutral">
              External
            </Badge>
          ) : null}
        </p>
        {detail ? <p className="app-Person__detail">{detail}</p> : null}
        <p className="app-Person__detail">{affectedLine}</p>
        {otherCount > 0 ? (
          <Link className="app-Person__more" href={`/inbox/all?requester=${encodeURIComponent(id)}`}>
            {`Other open tickets from ${shortName} (${otherCount}${others?.more ? '+' : ''})`}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
