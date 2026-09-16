import type { IntentName } from '@itsm/ui';

/**
 * The words and colours a ticket is shown in.
 *
 * Kept away from the components, and tested, because this is where a workbench
 * either helps an agent or gets in their way. Three rules:
 *
 * **Say it in English.** `pending_third_party` is a database value. An agent
 * scanning forty rows reads "Waiting on supplier" in a glance and `pending_
 * third_party` in a squint. The canonical state is still what the app sends
 * back to the API — this is a rendering, not a translation layer.
 *
 * **Never let colour be the only signal.** Every badge carries its word, and
 * the intent is chosen to agree with the word rather than to replace it
 * (SC 1.4.1).
 *
 * **Only urgency is loud.** If P1 and P2 both shout, neither does. P1 is the
 * one that is styled to interrupt.
 */

export const STATE_LABEL: Record<string, string> = {
  new: 'New',
  in_progress: 'In progress',
  pending_requester: 'Waiting on requester',
  pending_third_party: 'Waiting on supplier',
  pending_approval: 'Waiting for approval',
  resolved: 'Resolved',
  reopened: 'Reopened',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state.replaceAll('_', ' ');
}

/** Categories, not states: a tenant may rename states, and the category is the stable thing. */
export function categoryIntent(category: string): IntentName {
  switch (category) {
    case 'open':
      return 'info';
    case 'paused':
      return 'warning';
    case 'resolved':
      return 'success';
    case 'closed':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function priorityIntent(priority: string): IntentName {
  switch (priority.toUpperCase()) {
    case 'P1':
      return 'danger';
    case 'P2':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Only P1 is emphasised. Everything shouting is the same as nothing shouting. */
export function priorityEmphasis(priority: string): 'solid' | 'subtle' {
  return priority.toUpperCase() === 'P1' ? 'solid' : 'subtle';
}

const TYPE_LABEL: Record<string, string> = {
  incident: 'Incident',
  request: 'Request',
  problem: 'Problem',
  change: 'Change',
};

export function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

/**
 * "2 h 15 m", for a column an agent scans rather than reads. Absolute
 * timestamps stay in the row's `title` attribute, so nothing is lost.
 */
export function ageOf(createdAt: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} m`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days} d ${hours % 24} h` : `${days} d`;
}
