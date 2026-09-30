import type { IconName, Tone } from '@itsm/ui';

/**
 * One vocabulary for the state of anything the console configures or runs
 * (B §2.7 "StatusPill"): rules, request types, forms, workflows and their
 * runs, services, fields.
 *
 * The API's words are storage words — `published`, `archived`,
 * `waiting` — and the pages used to print them raw, differently coloured on
 * each screen. Here each becomes the word a person uses ("Live", "Retired")
 * with a tone and an icon, so a state is never carried by colour alone
 * (SPEC §1.1). `DataTable` takes `LIFECYCLE` as a status column's `map`, and
 * a single pill reads `lifecycle(row.status)`.
 */

export interface LifecycleLook {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: IconName;
}

export const LIFECYCLE: Readonly<Record<string, LifecycleLook>> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'circle-dashed' },
  published: { label: 'Live', tone: 'success', icon: 'circle-check' },
  live: { label: 'Live', tone: 'success', icon: 'circle-check' },
  active: { label: 'Active', tone: 'success', icon: 'circle-check' },
  // A published object with edits not yet published (rules, request types, forms).
  changed: { label: 'Unpublished changes', tone: 'warning', icon: 'pencil' },
  archived: { label: 'Retired', tone: 'neutral', icon: 'archive' },
  retired: { label: 'Retired', tone: 'neutral', icon: 'archive' },
  inactive: { label: 'Retired', tone: 'neutral', icon: 'archive' },
  deactivated: { label: 'Deactivated', tone: 'neutral', icon: 'ban' },
  // Runs.
  running: { label: 'Running', tone: 'info', icon: 'loader-circle' },
  waiting: { label: 'Waiting', tone: 'warning', icon: 'hourglass' },
  completed: { label: 'Completed', tone: 'success', icon: 'circle-check' },
  failed: { label: 'Failed', tone: 'danger', icon: 'circle-x' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'circle-x' },
  // Deliveries and alerts.
  open: { label: 'Open', tone: 'warning', icon: 'circle-alert' },
  resolved: { label: 'Resolved', tone: 'success', icon: 'circle-check' },
  dismissed: { label: 'Dismissed', tone: 'neutral', icon: 'circle-x' },
};

/**
 * The look of a state. An unknown one keeps its own word, sentence-cased, in
 * a neutral pill — honest about not knowing rather than guessing a colour.
 */
export function lifecycle(status: string | null | undefined): LifecycleLook {
  const key = (status ?? '').trim().toLowerCase();
  const known = LIFECYCLE[key];
  if (known) return known;
  const words = key.replace(/[_-]+/g, ' ').trim();
  return { label: words === '' ? 'Unknown' : words.charAt(0).toUpperCase() + words.slice(1), tone: 'neutral', icon: 'circle-dashed' };
}

/**
 * The state of something that has a published version and may have edits on
 * top: "Unpublished changes" when the latest draft is newer than what is live.
 */
export function publishState(status: string, hasUnpublishedChanges: boolean): LifecycleLook {
  return status === 'published' && hasUnpublishedChanges ? LIFECYCLE.changed! : lifecycle(status);
}
