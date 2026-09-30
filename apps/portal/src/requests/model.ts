import type { ApprovalRequest, SlaTimer, Ticket, TimelineEntry } from '@itsm/sdk';
import type { IconName, Problem, StepperStep, Tone } from '@itsm/ui';
import { replyByPhrase } from '../help/timing.js';
import { needsYou, PROGRESS_STEPS, progressOf, requesterState } from '../tickets/presentation.js';

/**
 * The rules behind My requests and a request's own page (SPEC §6.3
 * `/tickets`, `/tickets/[id]`, X-35), as data: which requests a scope
 * lists and in what order, what the one hero card says for each state and
 * what it offers, the stepper, the service-level sentence, and what of the
 * timeline a requester is shown. Pure, so every rule is tested without
 * rendering, and free of components, so the server pages that use it pay
 * nothing for it in the browser.
 *
 * Nothing here reads a priority or an impact. The fields a request row
 * carries are the ones a requester is told about, and the timeline is read
 * for its public comments and its tasks' states only — never an event or its
 * payload, whatever the API sends (PA4 filters them; this is the second
 * lock).
 */

/* ------------------------------------------------------------------ Scopes */

export type Scope = 'open' | 'needs' | 'resolved' | 'all';

/** The segments of My requests, in order: what is still going on first, everything last. */
export const SCOPES: readonly { readonly value: Scope; readonly label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'needs', label: 'Needs you' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

/** How many rows a page of My requests holds; Load more appends the next as many. */
export const PAGE_SIZE = 25;

/** The longest search the list endpoint accepts. */
const QUERY_MAX = 200;

type Param = string | string[] | undefined;

function first(value: Param): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `?show=` as a scope. Anything unknown is Open, the page's default; the
 * pre-redesign `?all=1` still means All, so an old bookmark lands where it
 * used to.
 */
export function scopeOf(show: Param, legacyAll?: Param): Scope {
  const value = first(show);
  if (value === 'open' || value === 'needs' || value === 'resolved' || value === 'all') return value;
  return first(legacyAll) === '1' ? 'all' : 'open';
}

/** `?q=`, trimmed and bounded as the API bounds it. */
export function queryOf(q: Param): string {
  return (first(q) ?? '').trim().slice(0, QUERY_MAX);
}

/**
 * The list filter for a scope (SPEC §6.3): Open is the `open` and `paused`
 * categories — everything not yet resolved, including what waits on the
 * requester; Needs you is the one state that stops until they answer;
 * Resolved waits for their word; All is everything they have raised.
 * Categories, not states, wherever a category says it: a tenant's own
 * status names map onto them, and the old `new,open,pending` matched
 * nothing.
 */
export function filterFor(scope: Scope): { readonly status?: string; readonly statusCategory?: string } {
  switch (scope) {
    case 'needs':
      return { status: 'pending_requester' };
    case 'resolved':
      return { statusCategory: 'resolved' };
    case 'all':
      return {};
    default:
      return { statusCategory: 'open,paused' };
  }
}

/** The URL of a scope with a search: `/tickets`, `/tickets?show=all&q=vpn`. */
export function listHref(scope: Scope, q = ''): string {
  const params = new URLSearchParams();
  if (scope !== 'open') params.set('show', scope);
  const words = q.trim();
  if (words) params.set('q', words);
  const search = params.toString();
  return search ? `/tickets?${search}` : '/tickets';
}

/* ---------------------------------------------------------------- Ordering */

/**
 * Where a request sits in the list: what needs the requester first, then
 * what is still going on, then what waits for their word, then what is
 * finished. A status nobody has told this table about is "going on" — the
 * safe middle.
 */
export function rankOf(status: string): number {
  if (needsYou(status)) return 0;
  if (status === 'resolved') return 2;
  if (status === 'closed' || status === 'cancelled') return 3;
  return 1;
}

/**
 * The rows in list order. Stable: within a rank they keep the order the API
 * gave (newest first), so a page that is appended to never reshuffles the
 * rows already read.
 */
export function inListOrder<T extends { readonly status: string }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index, rank: rankOf(row.status) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.row);
}

/** One row of My requests: the fields a requester is told about, and the version "Yes, it's fixed" writes against. */
export interface RequestItem {
  readonly id: string;
  readonly number: string;
  readonly type: string;
  readonly title: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly version: number;
}

/** A ticket as a row: only what a requester may see. No priority, impact or custom field can travel this way. */
export function itemOf(ticket: Pick<Ticket, 'id' | 'number' | 'type' | 'title' | 'status' | 'updatedAt' | 'version'>): RequestItem {
  return {
    id: ticket.id,
    number: ticket.number,
    type: ticket.type,
    title: ticket.title,
    status: ticket.status,
    updatedAt: ticket.updatedAt,
    version: ticket.version,
  };
}

/** Rows from several pages as one list: the first copy of a request wins, so a refreshed first page beats a stale appended one. */
export function mergeRows(...pages: readonly (readonly RequestItem[])[]): RequestItem[] {
  const seen = new Set<string>();
  const merged: RequestItem[] = [];
  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}

/* ------------------------------------------------------------ Empty states */

export interface EmptyCopy {
  readonly title: string;
  readonly description: string;
  readonly tone: 'empty' | 'search' | 'success';
  readonly icon: IconName;
  /** The next step it offers: a new request, clearing the search, or searching everything. */
  readonly next: 'new-request' | 'clear-search' | null;
  /** A second way on: every request (from a narrower scope). */
  readonly widen: boolean;
}

/**
 * What an empty list says (SPEC §6.3, §4.10): an honest "nothing" per
 * scope with the next step, and for a search that matched nothing, the way
 * back out of it. A list that failed to load never comes here — that says
 * "Couldn't load your requests".
 */
export function emptyFor(scope: Scope, q: string): EmptyCopy {
  if (q) {
    return {
      title: `No requests match ‘${q}’`,
      description:
        scope === 'all'
          ? 'Check the spelling, or search for the reference (INC-000123).'
          : 'Check the spelling, or search all your requests, including finished ones.',
      tone: 'search',
      icon: 'search',
      next: 'clear-search',
      widen: scope !== 'all',
    };
  }
  switch (scope) {
    case 'needs':
      return {
        title: 'Nothing needs you',
        description: 'When we ask you something, it waits here until you reply.',
        tone: 'success',
        icon: 'circle-check',
        next: null,
        widen: true,
      };
    case 'resolved':
      return {
        title: 'Nothing waiting for your word',
        description: 'When we sort something for you, it waits here for you to tell us it’s fixed.',
        tone: 'empty',
        icon: 'circle-check',
        next: null,
        widen: true,
      };
    case 'all':
      return {
        title: 'You haven’t raised anything yet',
        description: 'Report a problem or ask for something, and you’ll follow it here.',
        tone: 'empty',
        icon: 'inbox',
        next: 'new-request',
        widen: false,
      };
    default:
      return {
        title: 'Nothing open. That’s the goal.',
        description: 'When you ask us for something, you’ll follow it here.',
        tone: 'success',
        icon: 'circle-check',
        next: 'new-request',
        widen: true,
      };
  }
}

/* -------------------------------------------------------------- Hero card */

/** The hero's one primary action: answer the desk, settle the fix, or raise it again. */
export type HeroPrimary = 'reply' | 'confirm' | 'report-again';

/** The quieter moves under More: withdraw it, or say it sorted itself out. */
export type HeroMore = 'withdraw' | 'sorted';

export interface HeroModel {
  readonly tone: Tone;
  readonly icon: IconName;
  /** The state, said once, as the card's heading: "Waiting for you", "Is it fixed?". */
  readonly title: string;
  readonly sentence: string;
  readonly primary: HeroPrimary | null;
  readonly more: readonly HeroMore[];
  /** Whether the request is finished: no transitions, no composer. */
  readonly finished: boolean;
}

/**
 * The one card at the top of a request (SPEC §6.3, X-35): its state in the
 * requester's words, one sentence on whose move it is, and what they can do
 * about it — so the state is said once, not four times.
 *
 * The moves are the state machine's requester moves (`isRequesterTransition`):
 * withdraw from `new` and `pending_requester`, "It's sorted now" from
 * anything still open, close or reopen from `resolved`, nothing from a
 * finished request — which offers "Report it again" instead.
 */
export function heroFor(status: string): HeroModel {
  const state = requesterState(status);
  const base = { tone: state.tone, icon: state.icon, title: state.label, finished: false };
  switch (status) {
    case 'new':
      return { ...base, sentence: 'We’ve got it. Somebody will pick it up shortly.', primary: null, more: ['withdraw'] };
    case 'in_progress':
      return { ...base, sentence: 'Somebody is on it now. We’ll tell you here as soon as there’s news.', primary: null, more: ['sorted'] };
    case 'reopened':
      return { ...base, sentence: 'You told us it wasn’t fixed, so it’s back with us.', primary: null, more: ['sorted'] };
    case 'pending_third_party':
      return {
        ...base,
        sentence: 'We’re waiting on somebody outside the service desk, and we’ll pick it up as soon as they come back to us.',
        primary: null,
        more: ['sorted'],
      };
    case 'pending_requester':
      return { ...base, sentence: 'We’ve asked you something. Nothing moves until you reply.', primary: 'reply', more: ['withdraw', 'sorted'] };
    case 'pending_approval':
      return { ...base, sentence: 'Somebody has to approve this before it can start.', primary: null, more: ['sorted'] };
    case 'resolved':
      return {
        ...base,
        title: 'Is it fixed?',
        sentence: 'We think this is sorted. Tell us, and we’ll close it — or pick it back up if it isn’t.',
        primary: 'confirm',
        more: [],
      };
    case 'closed':
      return {
        ...base,
        sentence: 'This request is finished. If it happens again, report it and we’ll link the two.',
        primary: 'report-again',
        more: [],
        finished: true,
      };
    case 'cancelled':
      return {
        ...base,
        title: 'Withdrawn',
        sentence: 'This request was withdrawn. If you still need it, report it again.',
        primary: 'report-again',
        more: [],
        finished: true,
      };
    default:
      return { ...base, title: 'With the service desk', sentence: 'We’re looking after this.', primary: null, more: [] };
  }
}

/* ----------------------------------------------------------------- Stepper */

export interface StepDates {
  /** Already in the reader's words and zone: "29 Sep". */
  readonly raised: string;
  readonly resolved: string | null;
  readonly closed: string | null;
}

/**
 * The four dots in the hero card: Received → Being worked on → Resolved →
 * Closed (`progressOf`). A pause is still "being worked on", its step
 * saying who it waits for; dates come from the request's own timestamps,
 * never from its events. A withdrawn request ends at "Withdrawn" with the
 * steps it never reached marked skipped.
 */
export function stepsFor(status: string, dates: StepDates): StepperStep[] {
  const progress = progressOf(status);
  const cancelled = status === 'cancelled';
  const finished = status === 'closed' || cancelled;
  return PROGRESS_STEPS.map((label, index): StepperStep => {
    let state: StepperStep['status'];
    if (cancelled && index > 0 && index < 3) state = 'skipped';
    else if (index < progress.current || (finished && index === progress.current)) state = 'complete';
    else if (index === progress.current) state = 'current';
    else state = 'upcoming';

    let description: string | undefined;
    if (index === 0) description = dates.raised;
    if (index === 1 && state === 'current') {
      if (status === 'reopened') description = 'Reopened';
      else if (progress.currentLabel !== label) description = progress.currentLabel;
    }
    if (index === 2 && (state === 'complete' || state === 'current') && dates.resolved) description = dates.resolved;
    if (index === 3 && state === 'complete' && dates.closed) description = dates.closed;

    return {
      id: `step-${index}`,
      label: index === 3 && cancelled ? 'Withdrawn' : label,
      status: state,
      ...(description ? { description } : {}),
    };
  });
}

/* ------------------------------------------------------ Service level line */

const PAUSED_BECAUSE: Record<string, string> = {
  pending_requester: 'Paused while we wait for you.',
  pending_third_party: 'Paused while we wait on a supplier.',
  pending_approval: 'Paused while it waits for approval.',
};

const LATE = 'This is taking longer than we aimed for. It’s still with us.';

function aimFor(targetType: string, when: string): string {
  switch (targetType) {
    case 'response':
      return `We aim to reply by ${when}.`;
    case 'update':
      return `We aim to update you by ${when}.`;
    default:
      return `We aim to have this sorted by ${when}.`;
  }
}

/**
 * The one sentence about time (SPEC §6.3): when we aim to answer or finish,
 * that the clock is paused and why, or that it is late — never a priority
 * or a target's name. Best effort: without timers (no service level, or
 * the read failed) there is no sentence rather than a guess. Approval
 * clocks are the approvers', not the request's.
 */
export function slaSentence(status: string, timers: readonly SlaTimer[] | null, now: Date, locale: string, timeZone: string): string | null {
  if (!timers || status === 'resolved' || status === 'closed' || status === 'cancelled') return null;
  const relevant = timers.filter((timer) => timer.targetType !== 'approval');
  if (relevant.some((timer) => timer.state === 'breached')) return LATE;
  if (relevant.some((timer) => timer.state === 'paused')) return PAUSED_BECAUSE[status] ?? 'Paused for now.';

  const running = relevant
    .filter((timer) => timer.state === 'running' && timer.dueAt !== null && !Number.isNaN(Date.parse(timer.dueAt)))
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
  const next = running[0];
  if (!next?.dueAt) return null;
  // Past its target but not yet marked breached (the worker runs once a minute): say it plainly.
  if (Date.parse(next.dueAt) <= now.getTime()) return LATE;
  const when = replyByPhrase(next.dueAt, now, locale, timeZone);
  return when ? aimFor(next.targetType, when) : null;
}

/* -------------------------------------------------------------- Timeline */

/** How far the request's tasks have got, as counts only: task titles are the desk's working notes. */
export function taskProgress(entries: readonly TimelineEntry[] | null): { readonly done: number; readonly total: number } | null {
  if (!entries) return null;
  const tasks = entries.filter((entry) => entry.kind === 'task' && entry.status !== 'cancelled');
  if (tasks.length === 0) return null;
  const done = tasks.filter((entry) => entry.kind === 'task' && (entry.status === 'done' || entry.status === 'completed')).length;
  return { done, total: tasks.length };
}

/** "Progress: 1 of 2 steps done". */
export function taskProgressLabel(progress: { readonly done: number; readonly total: number }): string {
  return `Progress: ${progress.done} of ${progress.total} ${progress.total === 1 ? 'step' : 'steps'} done`;
}

/** One message in the conversation, as the requester's page draws it. */
export interface ConversationEntry {
  readonly id: string;
  readonly at: string;
  readonly body: string;
  /** Written by the person reading: "You", on the end side. Everybody else is "Service desk". */
  readonly mine: boolean;
  /** The request's own description is the first message: what they told us. */
  readonly kind: 'description' | 'comment';
}

/**
 * The conversation: the description as the first message, then the public
 * comments in time order. Nothing else — no events (however the API sent
 * them), no internal notes (filtered by the API; dropped again here), no
 * tasks (counted in the hero card instead).
 */
export function conversationOf(
  ticket: Pick<Ticket, 'id' | 'description' | 'createdAt' | 'requesterId'>,
  entries: readonly TimelineEntry[] | null,
  readerId: string | null,
): ConversationEntry[] {
  const messages: ConversationEntry[] = [];
  const description = ticket.description?.trim();
  if (description) {
    messages.push({
      id: `description-${ticket.id}`,
      at: ticket.createdAt,
      body: description,
      mine: readerId !== null && ticket.requesterId === readerId,
      kind: 'description',
    });
  }
  for (const entry of entries ?? []) {
    if (entry.kind !== 'comment' || entry.visibility !== 'public') continue;
    const body = entry.body.trim();
    if (!body) continue;
    messages.push({ id: entry.id, at: entry.at, body, mine: readerId !== null && entry.authorId === readerId, kind: 'comment' });
  }
  return messages
    .map((message, index) => ({ message, index, at: Date.parse(message.at) || 0 }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((entry) => entry.message);
}

/* ---------------------------------------------------------------- Approval */

/**
 * "Step 1 of 2 · Manager approval · due Fri 14:00" for a request waiting
 * for approval (PA3): how far the decision has got, never who is deciding.
 */
export function approvalLine(approval: ApprovalRequest | null | undefined, now: Date, locale: string, timeZone: string): string | null {
  const step = approval?.currentStep;
  if (!approval || !step) return null;
  const parts: string[] = [];
  if (approval.stepCount > 1) parts.push(`Step ${step.sequence} of ${approval.stepCount}`);
  if (step.name.trim()) parts.push(step.name.trim());
  if (step.dueAt) {
    const when = replyByPhrase(step.dueAt, now, locale, timeZone);
    if (when) parts.push(`due ${when}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/* ------------------------------------------------------------ Resolutions */

/**
 * A reopen the API refused because the request was resolved too long ago
 * (`ticket.reopen.windowDays`): a 422 about the request, not about a field
 * — the reason is bounded before it is sent, so a field error cannot be it.
 */
export function isTooLateToReopen(problem: Problem): boolean {
  return problem.status === 422 && !problem.fieldErrors && problem.code !== 'invalid_transition';
}

/** What "Report it again" carries into the new report: the link, and what they said was still wrong. */
export function relatedDetails(number: string, text = ''): string {
  const words = text.trim();
  return words ? `Related to ${number}.\n\n${words}` : `Related to ${number}.`;
}
