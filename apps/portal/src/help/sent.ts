import type { IconName } from '@itsm/ui';

/**
 * What the success panel says once a report or a request is in (SPEC v3
 * §7.2, X-M12): a light hero with the kicker "Request sent", the number and
 * when we aim to reply as its verdict ("REQ-003377 · We'll reply by 14:00"),
 * one sentence, and what happens next as a short list of steps.
 *
 * Plain data, no React: the panel is drawn on the server (`SentPanel.tsx`,
 * through the `renderSentPanel` action), so neither flow ships the hero's
 * code, and every sentence here is a unit test away.
 */

/** A report through "How can we help?" (an incident), or a request from the catalogue. */
export type SentKind = 'issue' | 'request';

/** What a flow asks the server to draw: the number it was given, and what it knows that the ticket may not say yet. */
export interface SentRequest {
  readonly number: string;
  readonly kind: SentKind;
  /** The catalogue said the request waits for a decision first (`approvalId`). */
  readonly approval?: boolean;
  /** Under the page's `h1` (2, the default) or a sheet's title (3). */
  readonly headingLevel?: 2 | 3;
}

/**
 * A ticket number as the API writes them: a prefix and digits ("INC-000124",
 * "REQ-003377"). Anything else is not asked about — the action is a POST
 * endpoint anyone can call with anything.
 */
const TICKET_NUMBER = /^[A-Z][A-Z0-9]{1,9}-\d{1,12}$/;

export function isTicketNumber(value: unknown): value is string {
  return typeof value === 'string' && TICKET_NUMBER.test(value);
}

/** A request as it arrived from the browser, checked field by field; `null` when it is not one. */
export function readSentRequest(input: unknown): Required<SentRequest> | null {
  if (typeof input !== 'object' || input === null) return null;
  const record = input as Record<string, unknown>;
  if (!isTicketNumber(record.number)) return null;
  if (record.kind !== 'issue' && record.kind !== 'request') return null;
  return {
    number: record.number,
    kind: record.kind,
    approval: record.approval === true,
    headingLevel: record.headingLevel === 3 ? 3 : 2,
  };
}

/** One step of "What happens next". */
export interface SentStep {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly status: 'complete' | 'waiting' | 'upcoming';
}

export interface SentPanelModel {
  readonly kicker: string;
  readonly verdict: { readonly tone: 'success' | 'hold'; readonly icon: IconName; readonly label: string };
  readonly narrative: string;
  readonly steps: readonly SentStep[];
}

/** The kicker of both flows' panels: one ending for both ways in (X-M12, "the success panel identical to HelpFlow's"). */
export const SENT_KICKER = 'Request sent';
export const NEXT_LABEL = 'What happens next';

/**
 * The panel's words. `replyBy` is the first-response target as a person
 * reads it ("14:00", "09:00 tomorrow"), or `null` while there is no clock —
 * then the verdict is the number alone, never a promise we cannot keep. A
 * request waiting for approval makes no promise either: nothing starts until
 * it is approved.
 */
export function sentPanelModel(input: { readonly number: string; readonly kind: SentKind; readonly approval: boolean; readonly replyBy: string | null }): SentPanelModel {
  const { number, kind, approval, replyBy } = input;
  if (kind === 'request' && approval) {
    return {
      kicker: SENT_KICKER,
      verdict: { tone: 'hold', icon: 'hourglass', label: `${number} · Waiting for approval` },
      narrative: 'Sent for approval. Nothing starts until it’s approved.',
      steps: [
        { id: 'sent', label: 'Request sent', description: 'It’s in, and nothing more is needed from you', status: 'complete' },
        { id: 'approval', label: 'Approval', description: 'Your approver decides first', status: 'waiting' },
        { id: 'team', label: 'The team picks it up', description: 'Follow it, and reply, in My requests', status: 'upcoming' },
      ],
    };
  }
  const verdict = { tone: 'success' as const, icon: 'circle-check' as const, label: replyBy ? `${number} · We’ll reply by ${replyBy}` : number };
  if (kind === 'request') {
    return {
      kicker: SENT_KICKER,
      verdict,
      narrative: 'We’ve got it. The team will pick it up from here.',
      steps: [
        { id: 'sent', label: 'Request sent', description: 'It’s in, and nothing more is needed from you', status: 'complete' },
        { id: 'team', label: 'The team picks it up', description: 'Follow it, and reply, in My requests', status: 'upcoming' },
        { id: 'done', label: 'Done', description: 'We’ll let you know when it’s ready', status: 'upcoming' },
      ],
    };
  }
  return {
    kicker: SENT_KICKER,
    verdict,
    narrative: 'Someone from the service desk will pick it up. You’ll get updates here and by email.',
    steps: [
      { id: 'sent', label: 'Report sent', description: 'It’s with the service desk', status: 'complete' },
      { id: 'desk', label: 'The desk picks it up', description: 'Reply in My requests if they ask you anything', status: 'upcoming' },
      { id: 'fixed', label: 'Fixed', description: 'We’ll ask you to confirm it’s working', status: 'upcoming' },
    ],
  };
}

/** How long the server waits for the first-response clock when it has not started yet: it starts moments after the ticket. */
export const SLA_RETRY_MS = 1500;

/**
 * How long a flow waits for the drawn panel before ending with its own words
 * instead. Both flows write the number out rather than import it (imported,
 * this module would be a chunk of its own on `/catalogue/[key]`);
 * `route-weight.test.ts` holds them to this value.
 */
export const SENT_PANEL_TIMEOUT_MS = 6000;
