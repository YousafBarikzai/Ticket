'use client';

import type { ReactNode } from 'react';
import { DescriptionList, Disclosure, RelativeTime } from '@itsm/ui';

/**
 * "Details", folded away at the foot of a request (SPEC §6.3): the
 * reference, what kind of thing it is, when it was raised and when it last
 * moved — nothing else. No priority, impact, team, category or custom field:
 * the requester chose the urgency, and the rest is the desk's own
 * bookkeeping.
 *
 * A client module only because the disclosure and the list come through the
 * design system's display group; the times render in the reader's zone on
 * the server and never change after.
 */
export function RequestDetails({
  number,
  kind,
  raisedAt,
  updatedAt,
}: {
  readonly number: string;
  readonly kind: string;
  readonly raisedAt: string;
  readonly updatedAt: string;
}): ReactNode {
  return (
    <Disclosure summary="Details" className="app-RequestDetails">
      <DescriptionList
        layout="inline"
        items={[
          { id: 'reference', label: 'Reference', value: <span className="app-Request__number">{number}</span> },
          { id: 'type', label: 'Type', value: kind },
          { id: 'raised', label: 'Raised', value: <RelativeTime date={raisedAt} mode="absolute" absoluteStyle="datetime" /> },
          { id: 'updated', label: 'Last update', value: <RelativeTime date={updatedAt} mode="absolute" absoluteStyle="datetime" /> },
        ]}
      />
    </Disclosure>
  );
}
