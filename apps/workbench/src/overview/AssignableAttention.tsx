'use client';

import { useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AttentionList, describeProblem, notify, type AttentionListProps } from '@itsm/ui';
import { api } from '../client/api.js';
import { problemOf } from '../inbox/presentation.js';

/**
 * "Needs you" on its Unassigned urgent tab, where each row offers **Assign
 * to me** (A6 §5.2.5): the one tab whose rows a person can act on from here.
 *
 * The list is the design system's server-safe `AttentionList`; only a client
 * parent can hand its row actions a handler, so this tab alone is drawn by
 * this island, loaded on its own (`AssignSlot`) so the Overview's other tabs
 * carry none of it. The assignment is the API's own (`ticket.assign`); then
 * the page renders again on the server, and the row moves to the reader's
 * work — the list never claims an assignment the API has not made.
 */

export const ASSIGN_ACTION = 'assign-me';

export interface AssignableAttentionProps extends Omit<AttentionListProps, 'onAction' | 'rowActions' | 'ref'> {
  /** The reader's user id: whom "Assign to me" assigns. */
  readonly meId: string;
}

export default function AssignableAttention({ meId, ...list }: AssignableAttentionProps): ReactNode {
  const router = useRouter();
  // Rows in flight: a second press on the same row while the first is on its way is not a second request.
  const pending = useRef(new Set<string>());

  const assign = async (number: string): Promise<void> => {
    if (pending.current.has(number)) return;
    pending.current.add(number);
    try {
      await api.assign(number, meId);
      notify(`${number} is yours now`, { tone: 'success' });
      router.refresh();
    } catch (error) {
      notify(describeProblem(problemOf(error), { context: `assign ${number}` }).title, { tone: 'danger' });
    } finally {
      pending.current.delete(number);
    }
  };

  return (
    <AttentionList
      {...list}
      rowActions={[{ id: ASSIGN_ACTION, label: 'Assign to me', icon: 'user-plus' }]}
      onAction={(actionId, item) => {
        if (actionId === ASSIGN_ACTION && item.ref) void assign(item.ref);
      }}
    />
  );
}
