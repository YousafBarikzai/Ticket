'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, type ApprovalDetail } from '@itsm/sdk';
import { Button, DescriptionList, InlineAlert, SkeletonText, StatusPill, Stepper, useItsm } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { Sheet } from '@itsm/ui/overlays';
import { useFullScreenFlow } from '@itsm/ui/shell';
import { api } from '../client/api.js';
import { reportSessionEnded } from '../client/useAction.js';
import { ApprovalDecision, type DecisionOutcome } from '../components/ApprovalDecision.js';
import { approvalTitle } from '../home/model.js';
import {
  answerText,
  decidableBy,
  itemOf,
  myDecisions,
  outcomePill,
  progressLine,
  stepsOf,
  whatLine,
  type ApprovalItem,
  type ApprovalScope,
} from './model.js';
import './approvals.css';

/**
 * One approval, in a sheet (SPEC §6.3 `/approvals`): from the end edge at
 * 768 px and up, the whole screen on a phone with the tab bar out of the way
 * (X-92).
 *
 * What is being asked for, by whom, and the answers they gave (PA2 — the API
 * gives them to the people deciding and nobody else); how far the request has
 * got; the note; and, pinned to the bottom, exactly two buttons, Approve and
 * Reject (`.app-Decision__actions`). The row it was opened from stands in
 * while the rest is read, so nothing is blank; a full load of
 * `?open=approval:<id>` arrives with the server's copy.
 *
 * Loaded on first use (and prefetched when the page is idle, or when a
 * pointer reaches a row): nothing here is in the page's first load.
 */

export interface ApprovalSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly approvalId: string;
  /** The row it was opened from, if it is in the list. */
  readonly item: ApprovalItem | null;
  readonly scope: ApprovalScope;
  readonly actorId: string | null;
  /** A decision on it is waiting in this device's outbox. */
  readonly queued: boolean;
  /** The server's copy on a full load: null when it failed, `missing` for a 404, undefined when there is none. */
  readonly initialDetail?: ApprovalDetail | null | 'missing' | undefined;
  readonly onSettled: (outcome: DecisionOutcome, title: string) => void;
}

type Read =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly detail: ApprovalDetail }
  | { readonly state: 'missing' }
  | { readonly state: 'failed' };

function initialRead(initial: ApprovalSheetProps['initialDetail']): Read {
  if (initial === 'missing') return { state: 'missing' };
  if (initial) return { state: 'ready', detail: initial };
  return { state: 'loading' };
}

export default function ApprovalSheet({ open, onOpenChange, approvalId, item, scope, actorId, queued, initialDetail, onSettled }: ApprovalSheetProps): ReactNode {
  const { locale, timeZone } = useItsm();
  useFullScreenFlow(open);
  const [read, setRead] = useState<Read>(() => initialRead(initialDetail));
  const [attempt, setAttempt] = useState(0);
  // Queued before this opening: the form is not offered again. Queued from this sheet, the form says so itself (and keeps focus).
  const [queuedAtOpen, setQueuedAtOpen] = useState(queued);
  // Opened again (the sheet stays mounted between openings of the same approval): read it afresh.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQueuedAtOpen(queued);
      setAttempt((count) => count + 1);
    }
  }

  // The detail, read in the browser unless the server already did.
  useEffect(() => {
    if (initialDetail && attempt === 0) return;
    let live = true;
    setRead((current) => (current.state === 'ready' ? current : { state: 'loading' }));
    api.approval(approvalId).then(
      (detail) => {
        if (live) setRead({ state: 'ready', detail });
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof ApiError && error.status === 401) reportSessionEnded('background');
        setRead(error instanceof ApiError && error.status === 404 ? { state: 'missing' } : { state: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [approvalId, attempt, initialDetail]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  const when = useCallback((iso: string) => formatDateTime(iso, { locale, timeZone, style: 'datetime' }), [locale, timeZone]);
  // A calendar date (an answer to a date question) is the same day everywhere.
  const day = useCallback((isoDate: string) => formatDateTime(`${isoDate}T12:00:00Z`, { locale, timeZone: 'UTC', style: 'date' }), [locale]);

  const detail = read.state === 'ready' ? read.detail : null;
  const shown: ApprovalItem | null = detail ? itemOf(detail, new Date()) : item;
  const title = detail ? approvalTitle(detail) : (item?.title ?? 'Approval');

  // Approve and Reject only while it is theirs to answer: known from the detail, assumed from a waiting row meanwhile.
  const decidable = !queuedAtOpen && (detail ? decidableBy(detail, actorId) : read.state !== 'missing' && scope === 'waiting' && item !== null);

  const context = shown ? whatLine(shown) : '';
  const decisions = detail ? myDecisions(detail, actorId) : [];
  const steps = detail && detail.steps.length > 1 ? stepsOf(detail, when) : null;
  const progress = !steps && shown ? progressLine(shown) : null;
  const settled = detail && detail.status !== 'pending' ? outcomePill(itemOf(detail, new Date())) : null;

  const body = (note: ReactNode): ReactNode => (
    <div className="app-ApprovalSheet__body">
      {settled ? <StatusPill label={settled.label} tone={settled.tone} icon={settled.icon} className="app-ApprovalSheet__outcome" /> : null}

      <section className="app-ApprovalSheet__section" aria-labelledby="approval-about">
        <h3 id="approval-about" className="app-ApprovalSheet__heading">
          About this request
        </h3>
        {shown && !shown.known ? (
          <p className="app-ApprovalSheet__quiet">Details about what’s being approved aren’t available yet.</p>
        ) : null}
        {shown ? (
          <DescriptionList
            layout="inline"
            items={[
              ...(shown.requester ? [{ id: 'requester', label: 'Asked by', value: shown.requester }] : []),
              ...(shown.item && shown.item.localeCompare(shown.title, undefined, { sensitivity: 'base' }) !== 0 ? [{ id: 'item', label: 'Asking for', value: shown.item }] : []),
              ...(shown.reference ? [{ id: 'reference', label: 'Reference', value: shown.reference }] : []),
              { id: 'requested', label: 'Asked', value: when(shown.requestedAt) },
              ...(shown.dueAt && (!detail || detail.status === 'pending') ? [{ id: 'due', label: 'Decide by', value: when(shown.dueAt) }] : []),
            ]}
          />
        ) : (
          <SkeletonText lines={3} />
        )}
      </section>

      {read.state === 'loading' ? (
        <section className="app-ApprovalSheet__section" aria-busy="true" aria-label="Loading the answers">
          <SkeletonText lines={4} />
        </section>
      ) : null}

      {read.state === 'failed' ? (
        <InlineAlert tone="danger" className="app-ApprovalSheet__problem">
          Couldn’t load the rest of this request. {decidable ? 'You can still decide from what’s shown.' : ''}{' '}
          <Button size="sm" variant="ghost" iconStart="refresh-cw" onClick={retry}>
            Try again
          </Button>
        </InlineAlert>
      ) : null}

      {detail?.answers && detail.answers.length > 0 ? (
        <section className="app-ApprovalSheet__section" aria-labelledby="approval-answers">
          <h3 id="approval-answers" className="app-ApprovalSheet__heading">
            Their answers
          </h3>
          <DescriptionList
            layout="stacked"
            className="app-ApprovalSheet__answers"
            items={detail.answers.map((answer) => ({
              id: answer.field,
              label: answer.label,
              value: <span className="app-ApprovalSheet__answer">{answerText(answer, day)}</span>,
            }))}
          />
        </section>
      ) : null}

      {steps || progress ? (
        <section className="app-ApprovalSheet__section" aria-labelledby="approval-progress">
          <h3 id="approval-progress" className="app-ApprovalSheet__heading">
            Progress
          </h3>
          {steps ? <Stepper label="Approval steps" steps={steps} orientation="vertical" size="sm" /> : <p className="app-ApprovalSheet__quiet">{progress}</p>}
        </section>
      ) : null}

      {decisions.length > 0 ? (
        <section className="app-ApprovalSheet__section" aria-labelledby="approval-yours">
          <h3 id="approval-yours" className="app-ApprovalSheet__heading">
            Your decision
          </h3>
          <ul className="app-ApprovalSheet__decisions">
            {decisions.map((decision) => (
              <li key={`${decision.decidedAt}-${decision.step ?? ''}`}>
                <p className="app-ApprovalSheet__decision">
                  {decision.decision === 'approved' ? 'You approved it' : 'You rejected it'}
                  {decision.step ? ` at ${decision.step}` : ''} · {when(decision.decidedAt)}
                </p>
                {decision.comment ? <blockquote className="app-ApprovalSheet__comment">{decision.comment}</blockquote> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {queuedAtOpen ? (
        <InlineAlert tone="info" icon="cloud-off">
          Your decision is saved on this device. It will be sent when you’re back online — unless somebody else decides
          first, in which case you’ll be told.
        </InlineAlert>
      ) : null}

      {note}
    </div>
  );

  const sheet = (inner: ReactNode, footer?: ReactNode): ReactNode => (
    <Sheet
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      title={title}
      {...(context ? { description: context } : {})}
      {...(footer ? { footer } : {})}
      className="app-ApprovalSheet"
    >
      {inner}
    </Sheet>
  );

  const missing = (
    <div className="app-ApprovalSheet__body">
      <InlineAlert tone="neutral">That approval isn’t available any more. It may have been withdrawn, or it isn’t yours to decide.</InlineAlert>
      <div className="app-ApprovalSheet__closeRow">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    </div>
  );

  // One tree whatever the state, so the sheet is never remounted (no second opening, no lost focus) as the detail arrives.
  return (
    <ApprovalDecision id={approvalId} title={title} onSettled={(outcome) => onSettled(outcome, title)}>
      {(parts) =>
        read.state === 'missing'
          ? sheet(missing)
          : decidable
            ? sheet(body(parts.note), parts.actions ?? undefined)
            : sheet(body(null))
      }
    </ApprovalDecision>
  );
}
