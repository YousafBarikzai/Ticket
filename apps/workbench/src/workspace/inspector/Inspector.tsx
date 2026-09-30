'use client';

import type { ReactNode } from 'react';
import type { Ticket } from '@itsm/sdk';
import { DescriptionList } from '@itsm/ui';
import { channelLabel, personName, priorityLabel, stateLabel, typeLabel, type PeopleMap } from '../../inbox/presentation.js';

/**
 * The ticket inspector: Details, custom fields, SLA, connections and tasks,
 * in the right-hand column at 1440 px and up and in a sheet below (SPEC §6.2).
 *
 * **Stub → WP25.** The frame's contract is the props below; this version
 * lists the ticket's own facts so the column is never empty. WP25 adds the
 * requester card, the editable fields, triage suggestions inline, SLA timers,
 * connections, tasks and Assist.
 */

export interface InspectorProps {
  readonly ticket: Ticket;
  /** Names for the ids on the ticket (requester, assignee). */
  readonly people?: PeopleMap;
  /** The signed-in person's id, so their own name reads "You". */
  readonly me?: string | null;
  /** `column` beside the conversation; `sheet` when the window is narrower. */
  readonly mode?: 'column' | 'sheet';
}

export function Inspector({ ticket, people = {}, me = null }: InspectorProps): ReactNode {
  return (
    <DescriptionList
      layout="inline"
      dense
      items={[
        { id: 'status', label: 'Status', value: stateLabel(ticket.status) },
        { id: 'priority', label: 'Priority', value: priorityLabel(ticket.priority) },
        { id: 'type', label: 'Type', value: typeLabel(ticket.type), hint: 'Fixed when the ticket was raised' },
        { id: 'requester', label: 'Requester', value: ticket.requesterId ? personName(ticket.requesterId, people, me) : null },
        { id: 'assignee', label: 'Assignee', value: personName(ticket.assigneeId, people, me) },
        { id: 'channel', label: 'Channel', value: channelLabel(ticket.sourceChannel) },
      ]}
    />
  );
}
