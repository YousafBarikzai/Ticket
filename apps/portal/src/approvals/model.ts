import type { ApprovalDetail, ApprovalRequest } from '@itsm/sdk';
import type { IconName, StepperStep, Tone } from '@itsm/ui';
import { approvalTitle } from '../home/model.js';

/**
 * The rules behind the Approvals page (SPEC §6.3 `/approvals`, §6.4
 * "Approve"), as data: which approvals wait on this person and which they
 * have dealt with, what a row says about each, how far a request has got,
 * what they decided, and what a bulk approval reports back. Pure, so every
 * rule is tested without rendering, and free of components, so the server
 * page that uses it pays nothing for it in the browser.
 *
 * What a request is about (`subject`) and the requester's answers come from
 * the API only for the people asked to decide it (PA2); nothing here guesses
 * them for anybody else.
 */

/* ------------------------------------------------------------------ Scopes */

export type ApprovalScope = 'waiting' | 'decided';

/** The page's two segments: what is waiting on you, then what you have dealt with. */
export const SCOPES: readonly { readonly value: ApprovalScope; readonly label: string }[] = [
  { value: 'waiting', label: 'To decide' },
  { value: 'decided', label: 'Decided' },
];

/** `?show=decided` is the decided list; anything else is what is waiting. */
export function scopeOf(show: string | readonly string[] | undefined): ApprovalScope {
  const value = typeof show === 'string' ? show : show?.[0];
  return value === 'decided' ? 'decided' : 'waiting';
}

export function scopeHref(scope: ApprovalScope): string {
  return scope === 'decided' ? '/approvals?show=decided' : '/approvals';
}

/* ------------------------------------------------------------ The drawer */

const OPEN = /^approval:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * `?open=approval:<id>` (SPEC §4.10, Home's "Review" link) → the id; anything
 * else is no drawer at all rather than a request for an id the API would
 * refuse.
 */
export function openIdOf(open: string | readonly string[] | null | undefined): string | null {
  const value = typeof open === 'string' ? open : open?.[0];
  const match = value ? OPEN.exec(value.trim()) : null;
  return match ? match[1]!.toLowerCase() : null;
}

export function openParam(id: string): string {
  return `approval:${id}`;
}

/* -------------------------------------------------------------------- Rows */

export interface ApprovalItem {
  readonly id: string;
  /** What is being asked for: the request's title, else the step's name. */
  readonly title: string;
  /** Who asked, by name. Null when the API has no name to give. */
  readonly requester: string | null;
  /** The catalogue item the request came from ("New laptop"). */
  readonly item: string | null;
  /** The request's number ("REQ-000046"). */
  readonly reference: string | null;
  readonly requestedAt: string;
  /** When the step waiting on a decision is due; the request's own date otherwise. */
  readonly dueAt: string | null;
  /** Past its due date when the page was drawn (a server fact, so the first paint and hydration agree). */
  readonly overdue: boolean;
  /** Where the request has got to; null once settled. */
  readonly step: {
    readonly sequence: number;
    readonly count: number;
    readonly name: string;
    readonly quorum: number;
    readonly decided: number;
  } | null;
  /** `pending`, `approved`, `rejected`, … */
  readonly status: string;
  readonly decidedAt: string | null;
  /** Whether the API told us what it is about (it does for the people deciding it). */
  readonly known: boolean;
}

export function itemOf(approval: ApprovalRequest, now: Date): ApprovalItem {
  const step = approval.currentStep;
  const dueAt = step?.dueAt ?? approval.dueAt;
  const due = dueAt ? Date.parse(dueAt) : Number.NaN;
  return {
    id: approval.id,
    title: approvalTitle(approval),
    requester: approval.subject?.requesterName?.trim() || null,
    item: approval.subject?.itemName?.trim() || null,
    reference: approval.subject?.ticketNumber?.trim() || null,
    requestedAt: approval.requestedAt,
    dueAt: dueAt ?? null,
    overdue: approval.status === 'pending' && Number.isFinite(due) && due < now.getTime(),
    step: step
      ? {
          sequence: step.sequence,
          count: Math.max(approval.stepCount, step.sequence),
          name: step.name.trim(),
          quorum: step.quorum,
          decided: step.decidedCount,
        }
      : null,
    status: approval.status,
    decidedAt: approval.decidedAt,
    known: approval.subject !== null,
  };
}

/**
 * "Ada Lovelace · New laptop · REQ-000046": who asked, for what, and its
 * number — whichever are known. The item is left out when the request's
 * title already says it (a catalogue request is titled after its item).
 */
export function whatLine(item: Pick<ApprovalItem, 'requester' | 'item' | 'reference'> & { readonly title?: string }): string {
  const sameAsTitle = item.item !== null && item.title !== undefined && item.item.localeCompare(item.title, undefined, { sensitivity: 'base' }) === 0;
  return [item.requester, sameAsTitle ? null : item.item, item.reference].filter((part): part is string => Boolean(part)).join(' · ');
}

/**
 * "Step 2 of 3 · Finance · 1 of 2 approvers decided": said only where there
 * is more to it than one step and one person, so a simple approval reads
 * simply.
 */
export function progressLine(item: Pick<ApprovalItem, 'step'>): string | null {
  const step = item.step;
  if (!step) return null;
  const parts: string[] = [];
  if (step.count > 1) parts.push(`Step ${step.sequence} of ${step.count}`);
  if (step.count > 1 && step.name) parts.push(step.name);
  if (step.quorum > 1) parts.push(`${Math.min(step.decided, step.quorum)} of ${step.quorum} approvers decided`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Newest first; the waiting list puts what is overdue, then what is due soonest, ahead of it. */
export function inListOrder(items: readonly ApprovalItem[], scope: ApprovalScope): ApprovalItem[] {
  const at = (value: string | null): number => (value ? Date.parse(value) || 0 : 0);
  if (scope === 'decided') {
    return [...items].sort((a, b) => at(b.decidedAt ?? b.requestedAt) - at(a.decidedAt ?? a.requestedAt));
  }
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const aDue = a.dueAt ? at(a.dueAt) : Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ? at(b.dueAt) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return at(b.requestedAt) - at(a.requestedAt);
  });
}

export interface Pill {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: IconName;
}

/** The pill on a waiting row: only when it is overdue — an ordinary wait needs no badge. */
export function waitingPill(item: Pick<ApprovalItem, 'overdue'>): Pill | null {
  return item.overdue ? { label: 'Overdue', tone: 'warning', icon: 'clock' } : null;
}

/** How a request you dealt with ended — or that it still waits on somebody else. */
export function outcomePill(item: Pick<ApprovalItem, 'status'>): Pill {
  switch (item.status) {
    case 'approved':
      return { label: 'Approved', tone: 'success', icon: 'circle-check' };
    case 'rejected':
      return { label: 'Rejected', tone: 'danger', icon: 'circle-x' };
    case 'pending':
      return { label: 'Waiting on others', tone: 'neutral', icon: 'hourglass' };
    default:
      return { label: 'Closed', tone: 'neutral', icon: 'ban' };
  }
}

/* ---------------------------------------------- Who has decided what */

function decisionsOn(detail: Pick<ApprovalDetail, 'steps'>, stepFilter: (step: ApprovalDetail['steps'][number]) => boolean) {
  return detail.steps.filter(stepFilter).flatMap((step) => step.decisions.map((decision) => ({ step, decision })));
}

function isMine(decision: { approverId: string; actedById: string | null }, actorId: string): boolean {
  return decision.approverId === actorId || decision.actedById === actorId;
}

/**
 * Whether this person has already answered the step now waiting — a step
 * that needs two approvals stays open after the first, and the API still
 * lists it as waiting on everyone named on it.
 */
export function answeredCurrentStep(detail: Pick<ApprovalDetail, 'steps' | 'currentStep'>, actorId: string | null): boolean {
  const current = detail.currentStep;
  if (!actorId || !current) return false;
  return decisionsOn(detail, (step) => step.sequence === current.sequence).some(({ decision }) => isMine(decision, actorId));
}

/** Whether this person answered any step of it. */
export function answeredAny(detail: Pick<ApprovalDetail, 'steps'>, actorId: string | null): boolean {
  if (!actorId) return false;
  return decisionsOn(detail, () => true).some(({ decision }) => isMine(decision, actorId));
}

/** Whether this person is named on the step now waiting and has not answered it: the only time Approve and Reject are offered. */
export function decidableBy(detail: Pick<ApprovalDetail, 'steps' | 'currentStep' | 'status'>, actorId: string | null): boolean {
  const current = detail.currentStep;
  if (!actorId || !current || detail.status !== 'pending' || current.status !== 'open') return false;
  const step = detail.steps.find((candidate) => candidate.sequence === current.sequence);
  return Boolean(step?.approverIds.includes(actorId)) && !answeredCurrentStep(detail, actorId);
}

export interface MyDecision {
  readonly decision: 'approved' | 'rejected';
  readonly comment: string | null;
  readonly decidedAt: string;
  /** The step's name, when the request had more than one. */
  readonly step: string | null;
}

/** What this person said, step by step. */
export function myDecisions(detail: Pick<ApprovalDetail, 'steps'>, actorId: string | null): MyDecision[] {
  if (!actorId) return [];
  const several = detail.steps.length > 1;
  return decisionsOn(detail, () => true)
    .filter(({ decision }) => isMine(decision, actorId))
    .sort((a, b) => a.decision.decidedAt.localeCompare(b.decision.decidedAt))
    .map(({ step, decision }) => ({
      decision: decision.decision,
      comment: decision.comment?.trim() || null,
      decidedAt: decision.decidedAt,
      step: several ? step.name : null,
    }));
}

/**
 * Every step as the stepper shows it, in order: what each one needs, and
 * what happened to it. `when` words a date in the reader's zone.
 */
export function stepsOf(detail: Pick<ApprovalDetail, 'steps' | 'status'>, when: (iso: string) => string): StepperStep[] {
  return [...detail.steps]
    .sort((a, b) => a.sequence - b.sequence)
    .map((step): StepperStep => {
      const needs = step.quorum > 1 ? `${Math.min(step.decisions.length, step.quorum)} of ${step.quorum} approvers decided` : null;
      switch (step.status) {
        case 'approved':
          return { id: step.id, label: step.name, status: 'complete', description: step.decidedAt ? `Approved ${when(step.decidedAt)}` : 'Approved' };
        case 'rejected':
          return { id: step.id, label: step.name, status: 'error', description: step.decidedAt ? `Rejected ${when(step.decidedAt)}` : 'Rejected' };
        case 'skipped':
          return { id: step.id, label: step.name, status: 'skipped', description: 'Not needed' };
        case 'blocked':
          return { id: step.id, label: step.name, status: 'error', description: 'Nobody is left to decide this step' };
        case 'open': {
          const due = step.dueAt ? `due ${when(step.dueAt)}` : null;
          const description = [needs, due].filter(Boolean).join(' · ');
          return detail.status === 'pending'
            ? { id: step.id, label: step.name, status: 'current', description: description || 'Waiting for a decision' }
            : { id: step.id, label: step.name, status: 'skipped', description: 'Not needed' };
        }
        default:
          return { id: step.id, label: step.name, status: detail.status === 'pending' ? 'upcoming' : 'skipped', description: detail.status === 'pending' ? 'Next' : 'Not needed' };
      }
    });
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An answer as the person deciding reads it: its words, or that it was left
 * empty. A date question's answer arrives as `2026-10-12`; `formatDate`
 * writes it the reader's way (a calendar date, so it is never shifted into
 * the day before by a time zone).
 */
export function answerText(answer: { readonly display: string }, formatDate?: (isoDate: string) => string): string {
  const words = answer.display.trim();
  if (!words) return 'Not answered';
  return formatDate && DATE_ONLY.test(words) ? formatDate(words) : words;
}

/* ------------------------------------------------------------ Bulk approve */

export type BulkOutcome = 'sent' | 'queued' | 'conflict' | 'failed';

export interface BulkResult {
  readonly id: string;
  readonly title: string;
  readonly outcome: BulkOutcome;
}

function listOf(titles: readonly string[]): string {
  const quoted = titles.map((title) => `‘${title}’`);
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

function requests(count: number): string {
  return count === 1 ? '1 request' : `${count} requests`;
}

/**
 * The one toast a bulk approval ends with (SPEC §6.3): how many went, how
 * many wait on this device, and — by name — the ones somebody else had
 * already decided and the ones that did not send.
 */
export function bulkSummary(results: readonly BulkResult[]): { title: string; description?: string; tone: 'success' | 'info' | 'warning' | 'danger' } {
  const of = (outcome: BulkOutcome) => results.filter((result) => result.outcome === outcome);
  const sent = of('sent');
  const queued = of('queued');
  const conflict = of('conflict');
  const failed = of('failed');

  const heads: string[] = [];
  if (sent.length > 0) heads.push(`Approved ${requests(sent.length)}`);
  if (queued.length > 0) heads.push(`${requests(queued.length)} saved on this device`);
  if (conflict.length > 0) heads.push(`${conflict.length} already decided`);
  if (failed.length > 0) heads.push(`${failed.length} didn’t send`);
  const title = heads.join(' · ') || 'Nothing was approved';

  const lines: string[] = [];
  if (queued.length > 0) lines.push('They’ll be sent when you’re back online.');
  if (conflict.length > 0) lines.push(`Somebody else decided ${listOf(conflict.map((result) => result.title))} first.`);
  if (failed.length > 0) lines.push(`${listOf(failed.map((result) => result.title))} ${failed.length === 1 ? 'is' : 'are'} still selected. Try again.`);

  const tone = failed.length > 0 ? (sent.length + queued.length > 0 ? 'warning' : 'danger') : conflict.length > 0 ? 'warning' : queued.length > 0 ? 'info' : 'success';
  return { title, ...(lines.length > 0 ? { description: lines.join(' ') } : {}), tone };
}

/** What a single decision's toast says. */
export function decidedToast(decision: 'approved' | 'rejected'): string {
  return decision === 'approved' ? 'Approved' : 'Rejected';
}

/* ------------------------------------------------------------ Empty states */

export function emptyFor(scope: ApprovalScope): { title: string; description: string; tone: 'success' | 'empty'; icon: IconName } {
  return scope === 'waiting'
    ? {
        title: 'Nothing waiting on you',
        description: 'When somebody needs your decision, it appears here, with a count on your profile.',
        tone: 'success',
        icon: 'circle-check',
      }
    : {
        title: 'Nothing decided yet',
        description: 'Requests you approve or reject are kept here, with how each one ended.',
        tone: 'empty',
        icon: 'approvals',
      };
}
