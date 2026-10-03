'use client';

import type { ReactNode } from 'react';
import type { ActionSpec } from '../types.js';
import { ActionSpecButton } from '../web/ActionSpecButton.js';
import { cx } from '../web/cx.js';
import type { AttentionItem } from './AttentionList.js';

export interface AttentionRowActionsProps {
  /** The actions, as data: a link (`href`) needs nothing else; a button reports through `onAction`. */
  readonly actions: readonly ActionSpec[];
  /** The row they act on: named in the group's label and handed back with the chosen action. */
  readonly item: AttentionItem;
  /** Receives the chosen action's `id` and the row. Absent when a server component rendered the list. */
  readonly onAction?: ((actionId: string, item: AttentionItem) => void) | undefined;
  readonly className?: string;
}

/**
 * The quick actions at the end of an `AttentionList` row: a small client
 * island, so the list itself stays server-rendered (A1 §7.4).
 *
 * Every row carries the same actions, so ten "Assign to me" buttons would be
 * ten identical names. The buttons sit in a group named for the row —
 * "Actions for INC-000123" — which a screen reader says on the way in.
 * Each action is an `ActionSpecButton`, so a link goes through the
 * application's router, an action that asks first asks, and a disabled one
 * says why — the same behaviour as every other action in the product.
 */
export function AttentionRowActions({ actions, item, onAction, className }: AttentionRowActionsProps): ReactNode {
  return (
    <div className={cx('itsm-AttentionList__actions', className)} role="group" aria-label={`Actions for ${item.ref ?? item.title}`}>
      {actions.map((spec) => (
        <ActionSpecButton key={spec.id} spec={spec} defaultVariant="secondary" size="sm" onAction={(id) => onAction?.(id, item)} />
      ))}
    </div>
  );
}
