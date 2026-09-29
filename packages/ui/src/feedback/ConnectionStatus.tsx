'use client';

import type { ReactNode } from 'react';
import { cx } from '../web/cx.js';

/** A queued write that needs the person: it failed, or it conflicts with a newer change. */
export interface ConnectionAttentionItem {
  readonly id: string;
  readonly summary: string;
  readonly problem?: string;
  readonly state: 'failed' | 'conflict';
}

export interface ConnectionStatusProps {
  readonly state: 'live' | 'reconnecting' | 'offline' | 'ended';
  /** Writes waiting in the outbox. */
  readonly pending: number;
  readonly attention: readonly ConnectionAttentionItem[];
  /** Client only. */
  readonly onRetry: (id: string) => void;
  /** Client only. */
  readonly onDiscard: (id: string) => void;
  readonly onSignIn?: () => void;
  readonly className?: string;
}

const stateLabels = { live: 'Live', reconnecting: 'Reconnecting…', offline: 'Offline', ended: 'Session ended' } as const;

/**
 * Connection and outbox state, in the shell's status slot. Healthy is the
 * normal case and shows nothing at all (X-82); otherwise a compact pill that
 * opens a tray of waiting and failed writes. Replaces the apps' `OfflineStatus`.
 *
 * Stub (SPEC §4.5): renders nothing when healthy, a pill otherwise; the
 * feedback package adds the tray and its actions.
 */
export function ConnectionStatus({ state, pending, className }: ConnectionStatusProps): ReactNode {
  if (state === 'live' && pending === 0) return null;
  const waiting = pending > 0 ? ` · ${pending} waiting` : '';
  return (
    <span className={cx('itsm-ConnectionStatus', className)} data-state={state}>
      {`${stateLabels[state]}${waiting}`}
    </span>
  );
}
