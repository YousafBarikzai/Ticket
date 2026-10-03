'use client';

import type { ReactNode } from 'react';
import { StatusPill } from '../../display/StatusPill.js';
import { SLA_STATE_LOOK, type SlaStateKey } from '../../display/ticket-states.js';
import { formatDuration } from '../../format/duration.js';
import { useNow } from '../../provider/clock.js';
import type { SlaState } from '../../workbench/SlaClock.js';

export interface SlaCellProps {
  readonly state: SlaState;
  /** Minutes left as the server worked them out; `null` when paused, met or breached. */
  readonly remainingMinutes: number | null;
  /** When the target falls (or fell) due. With it the cell counts down to the real moment and says how long ago a breach was. */
  readonly dueAt?: string;
  readonly locale: string;
  readonly srPrefix?: string;
}

/** Below this many minutes a running clock is due soon: amber, the one use amber has (D5). */
const DUE_SOON_MINUTES = 60;

/** What the pill says, and which look it takes. */
export function slaReading(
  state: SlaState,
  remaining: number | null,
  sinceDueMinutes: number | null,
  locale: string,
): { readonly key: SlaStateKey; readonly label: string } {
  const span = (minutes: number): string => formatDuration(Math.max(1, minutes), { locale, maxParts: minutes >= 24 * 60 ? 2 : 1 });
  switch (state) {
    case 'breached':
      return { key: 'breached', label: sinceDueMinutes !== null && sinceDueMinutes >= 1 ? `Breached ${span(sinceDueMinutes)} ago` : 'Breached' };
    case 'met':
      return { key: 'met', label: SLA_STATE_LOOK.met.label };
    case 'paused':
      return { key: 'paused', label: SLA_STATE_LOOK.paused.label };
    case 'running':
    default:
      if (remaining === null) return { key: 'on_track', label: SLA_STATE_LOOK.on_track.label };
      if (remaining <= 0) return { key: 'due_soon', label: 'Due now' };
      return { key: remaining <= DUE_SOON_MINUTES ? 'due_soon' : 'on_track', label: `Due in ${span(remaining)}` };
  }
}

/**
 * An `sla` cell (v3 §2.14): a small `StatusPill` from `SLA_STATE_LOOK` —
 * "Due in 3 h" on track, "Due in 43 min" due soon, "Breached 2 h ago",
 * "SLA paused", "Met". Never a ring: rings stay out of rows (X-33).
 *
 * It counts down on the page's shared clock when it knows `dueAt`; on the
 * server and while hydrating (`useNow` is `null`) it shows the minutes the
 * server sent, so the first render matches the HTML. Nothing here is a live
 * region: a list of countdowns that spoke every minute would drown a screen
 * reader, so the time is read when the person reaches it.
 */
export function SlaCell({ state, remainingMinutes, dueAt, locale, srPrefix }: SlaCellProps): ReactNode {
  const now = useNow();
  const due = dueAt === undefined ? Number.NaN : Date.parse(dueAt);
  const known = now !== null && Number.isFinite(due);
  const remaining = state === 'running' && known ? Math.ceil((due - now) / 60_000) : remainingMinutes;
  const since = state === 'breached' && known ? Math.floor((now - due) / 60_000) : null;
  const { key, label } = slaReading(state, remaining, since, locale);
  const look = SLA_STATE_LOOK[key];
  return <StatusPill size="sm" tone={look.tone} icon={look.icon} label={label} {...(srPrefix ? { srPrefix } : {})} />;
}
