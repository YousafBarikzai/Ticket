'use client';

import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type TriageAppliedItem, type TriageSuggestionItem } from '@itsm/sdk';
import { Badge, Button, Disclosure, Icon, InfoTipTrigger, InlineAlert, StatusPill, describeProblem, notify } from '@itsm/ui';
import { api } from '../../client/api.js';
import { isConflict } from '../../client/mutations.js';
import { deskKeys } from '../../client/query-client.js';
import { priorityLabel, problemOf } from '../../inbox/presentation.js';
import {
  acceptAllSummary,
  acceptInSequence,
  acceptingLine,
  appliedLine,
  confidenceLabel,
  fieldName,
  notesLine,
  SAMPLE_NOTE,
  stripLine,
  suggestionLine,
  triageView,
  type TriageRow,
  type TriageView,
} from '../../ai/triage.js';
import type { WorkspaceApi } from '../TicketWorkspace.js';
import { triageQuery } from './queries.js';

/**
 * AI triage, shown where it acts (SPEC §6.2, ADR-0051; replaces `TriageCard`).
 *
 * In `suggest` mode each answer sits on the row it would change — "Suggested:
 * Access / VPN · High confidence · Accept · Dismiss" under Category — and a
 * slim strip at the top of the inspector says how many are waiting, with
 * Accept all. In `auto` mode the value the AI set carries "Set by AI" and an
 * Undo on its row. The type note hides behind "1 more note"; a possible major
 * incident is a danger notice (v3: amber is SLA risk alone, D5) with no
 * button that declares anything. A decision the shared demo wrote in advance
 * carries a neutral "Sample" pill with its reason (A6 §5.6.5, D13).
 *
 * Every answer is the agent's own edit, made with the version they are
 * looking at: a ticket somebody else changed meanwhile is a conflict to read,
 * never an overwrite. Accept all takes them one at a time, reading the
 * version again between each, because an accept changes the ticket and does
 * not say what the new version is.
 */

export interface TriageState {
  readonly view: TriageView | null;
  /** Which question is being answered, or `all` while Accept all runs. */
  readonly busy: string | null;
  /** Accept all's progress: which one of how many. */
  readonly progress: { readonly current: number; readonly total: number } | null;
  /** Whether this person may answer (`ai.suggest`). */
  readonly canAct: boolean;
  /** A state gate for every answer ("Needs a connection"). */
  readonly gate?: string;
  accept(item: TriageSuggestionItem): Promise<void>;
  dismiss(item: TriageSuggestionItem): Promise<void>;
  undo(item: TriageAppliedItem): Promise<void>;
  acceptAll(): Promise<void>;
}

/** The toast for a refused answer, in the words the other writes use. */
function refusal(error: unknown): { title: string; description?: string } {
  const problem = problemOf(error);
  if (problem.status === 403) return { title: 'You can’t act on AI suggestions', ...(problem.detail ? { description: problem.detail } : {}) };
  if (problem.status === 422) return { title: 'That suggestion was already dealt with', description: 'Its answer has been read again.' };
  const described = describeProblem(problem);
  return { title: `That didn’t work. ${described.title}.`, ...(described.body ? { description: described.body } : {}) };
}

/** What the accepted value reads as in the toast: a priority as "P2 · High", anything else as the AI named it. */
function valueWords(item: { readonly question: string; readonly display: string }): string {
  return item.question === 'priority' ? priorityLabel(item.display) : item.display;
}

export function useTriage(ws: WorkspaceApi): TriageState {
  const { ticket, viewer } = ws.bundle;
  const number = ticket.number;
  const client = useQueryClient();
  const enabled = viewer.can.aiRead === true;
  const query = useQuery(triageQuery(number, ticket.id, enabled));
  /** Questions answered here, gone from view at once rather than at the next read. */
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const latest = useRef(ws);
  latest.current = ws;

  const view = useMemo(() => triageView(query.data, handled), [query.data, handled]);
  const handle = useCallback((questions: readonly string[]) => {
    if (questions.length > 0) setHandled((current) => new Set([...current, ...questions]));
  }, []);
  const rereadTriage = useCallback(() => client.invalidateQueries({ queryKey: triageQuery(number, ticket.id, true).queryKey }), [client, number, ticket.id]);
  /** After an answer that changed the ticket: it (and its triage) again, and the lists and counts it may have moved in. */
  const changed = useCallback(async () => {
    void client.invalidateQueries({ queryKey: deskKeys.views() });
    void client.invalidateQueries({ queryKey: deskKeys.counts() });
    await latest.current.refresh();
  }, [client]);

  const run = useCallback(
    async (question: string, work: () => Promise<void>): Promise<void> => {
      if (busy) return;
      setBusy(question);
      try {
        await work();
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const accept = useCallback(
    (item: TriageSuggestionItem) =>
      run(item.question, async () => {
        const decisionId = view?.decisionId;
        if (!decisionId) return;
        try {
          await api.acceptTriage(decisionId, item.question, latest.current.bundle.ticket.version);
          handle([item.question]);
          notify(`${fieldName(item.question)} set to ${valueWords(item)}`, { tone: 'success' });
          await changed();
        } catch (error) {
          if (isConflict(error)) {
            await latest.current.refresh();
            notify('Someone else changed this ticket first', { tone: 'warning', description: 'Check what they did, then accept again.' });
            return;
          }
          if (error instanceof ApiError && error.status === 422) void rereadTriage();
          const words = refusal(error);
          notify(words.title, { tone: 'danger', ...(words.description ? { description: words.description } : {}) });
        }
      }),
    [run, view?.decisionId, handle, rereadTriage, changed],
  );

  const dismiss = useCallback(
    (item: TriageSuggestionItem) =>
      run(item.question, async () => {
        const decisionId = view?.decisionId;
        if (!decisionId) return;
        try {
          await api.dismissTriage(decisionId, item.question);
          handle([item.question]);
          // No Undo: the service keeps no way to take a dismissal back.
          notify(`${fieldName(item.question)} suggestion dismissed`, { tone: 'neutral' });
        } catch (error) {
          if (error instanceof ApiError && error.status === 422) void rereadTriage();
          const words = refusal(error);
          notify(words.title, { tone: 'danger', ...(words.description ? { description: words.description } : {}) });
        }
      }),
    [run, view?.decisionId, handle, rereadTriage],
  );

  const undo = useCallback(
    (item: TriageAppliedItem) =>
      run(item.question, async () => {
        const decisionId = view?.decisionId;
        if (!decisionId) return;
        try {
          await api.undoTriage(decisionId, item.question, latest.current.bundle.ticket.version);
          handle([item.question]);
          notify('Put back what it was before', { tone: 'success', description: `${fieldName(item.question)} is no longer ${valueWords(item)}.` });
          await changed();
        } catch (error) {
          if (isConflict(error)) {
            await latest.current.refresh();
            notify('Someone else changed this ticket first', { tone: 'warning', description: 'Their change stands. Check it before undoing anything.' });
            return;
          }
          if (error instanceof ApiError && error.status === 422) void rereadTriage();
          const words = refusal(error);
          notify(words.title, { tone: 'danger', ...(words.description ? { description: words.description } : {}) });
        }
      }),
    [run, view?.decisionId, handle, rereadTriage, changed],
  );

  const acceptAll = useCallback(
    () =>
      run('all', async () => {
        const decisionId = view?.decisionId;
        const items = view?.acceptable ?? [];
        if (!decisionId || items.length === 0) return;
        setProgress({ current: 1, total: items.length });
        try {
          const result = await acceptInSequence(items, latest.current.bundle.ticket.version, {
            version: async () => (await api.ticket(number)).version,
            accept: async (question, version) => {
              await api.acceptTriage(decisionId, question, version);
            },
            onProgress: (current, total) => setProgress({ current, total }),
            isConflict,
          });
          handle(result.accepted);
          await changed();
          if (result.failed) {
            const words = refusal(result.failed.error);
            notify(acceptAllSummary(result, items.length), {
              tone: 'warning',
              description: `${fieldName(result.failed.question)} wasn’t accepted: ${words.title.replace(/\.$/, '')}.`,
            });
          } else {
            notify(acceptAllSummary(result, items.length), { tone: 'success' });
          }
        } finally {
          setProgress(null);
        }
      }),
    [run, view, number, handle, changed],
  );

  return {
    view: enabled ? view : null,
    busy,
    progress,
    canAct: viewer.can.ai === true,
    ...(ws.gate ? { gate: ws.gate } : {}),
    accept,
    dismiss,
    undo,
    acceptAll,
  };
}

/** "Sample", beside the triage's heading, with what it means one press away. */
function SampleBadge(): ReactNode {
  return (
    <span className="app-Triage__sample">
      <StatusPill size="sm" tone="neutral" icon="sparkles" label="Sample" />
      <InfoTipTrigger label="About Sample" title="Sample" body={SAMPLE_NOTE} />
    </span>
  );
}

/* ------------------------------------------------------------- The strip */

/**
 * At the top of the inspector, only while something waits (X-12): "AI
 * triage: 3 suggestions · Accept all · Review", the type note behind "1 more
 * note", and the major-incident warning.
 */
export function TriageStrip({
  triage,
  onReview,
  summaryText,
}: {
  readonly triage: TriageState;
  /** Opens Details and moves to the first suggestion. */
  readonly onReview: () => void;
  /** What "Copy summary" copies for the major-incident process. */
  readonly summaryText: string;
}): ReactNode {
  const { view, busy, progress, canAct, gate } = triage;
  const headingId = useId();
  if (!view) return null;
  const count = view.acceptable.length;
  if (count === 0 && view.notes.length === 0 && !view.warning) return null;
  const blocked = gate ?? (busy ? 'Finishing the last answer…' : undefined);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(summaryText);
      notify('Summary copied', { tone: 'success', description: 'Paste it into your major-incident process.' });
    } catch {
      notify('Couldn’t copy that', { tone: 'warning', description: summaryText });
    }
  };

  return (
    <section className="app-Triage" data-card="triage" aria-labelledby={headingId} aria-busy={progress ? true : undefined}>
      {count > 0 ? (
        <div className="app-Triage__head">
          <p id={headingId} className="app-Triage__line">
            <Icon name="sparkles" size="sm" className="app-Triage__mark" />
            {stripLine(count)}
            {view.sample ? <SampleBadge /> : null}
          </p>
          {canAct ? (
            <div className="app-Triage__actions">
              <Button
                size="sm"
                variant="tinted"
                loading={progress !== null}
                loadingLabel={progress ? acceptingLine(progress.current, progress.total) : 'Accepting…'}
                {...(blocked && !progress ? { disabledReason: blocked } : {})}
                onClick={() => void triage.acceptAll()}
              >
                {count === 1 ? 'Accept' : 'Accept all'}
              </Button>
              <Button size="sm" variant="ghost" onClick={onReview}>
                Review
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p id={headingId} className="app-Triage__line">
          <Icon name="sparkles" size="sm" className="app-Triage__mark" />
          AI triage
          {view.sample ? <SampleBadge /> : null}
        </p>
      )}
      <p className="app-Triage__progress" role="status">
        {progress ? acceptingLine(progress.current, progress.total) : ''}
      </p>

      {view.warning ? (
        <InlineAlert tone="danger" className="app-Triage__warning">
          <p className="app-Triage__warningText">{suggestionLine(view.warning)}</p>
          <div className="app-Triage__warningActions">
            <Button size="sm" variant="secondary" iconStart="copy" onClick={() => void copy()}>
              Copy summary
            </Button>
            {canAct ? (
              <Button
                size="sm"
                variant="ghost"
                {...(blocked ? { disabledReason: blocked } : {})}
                aria-label="Dismiss the major-incident warning"
                onClick={() => view.warning && void triage.dismiss(view.warning)}
              >
                Dismiss
              </Button>
            ) : null}
          </div>
        </InlineAlert>
      ) : null}

      {view.notes.length > 0 ? (
        <Disclosure summary={notesLine(view.notes.length)} className="app-Triage__notes">
          <ul className="app-Triage__noteList">
            {view.notes.map((item) => (
              <li key={item.question} className="app-Triage__note">
                <p>{suggestionLine(item)}</p>
                {canAct ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    {...(blocked ? { disabledReason: blocked } : {})}
                    aria-label={`Dismiss the ${fieldName(item.question).toLowerCase()} note`}
                    onClick={() => void triage.dismiss(item)}
                  >
                    Dismiss
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------- On the row */

/**
 * What the AI has to say about one row: a suggestion to accept or dismiss,
 * or a value it set with Undo. Nothing when it has nothing to say.
 */
export function TriageOnRow({ triage, row }: { readonly triage: TriageState; readonly row: TriageRow }): ReactNode {
  const { view, busy, canAct, gate } = triage;
  const describedBy = useId();
  if (!view) return null;
  const pending = view.pending[row];
  const applied = view.applied[row];
  const blocked = gate ?? (busy ? 'Finishing the last answer…' : undefined);

  if (pending) {
    const field = fieldName(pending.question).toLowerCase();
    return (
      <div className="app-TriageRow" data-kind="suggested" data-triage-pending="">
        <p className="app-TriageRow__line">
          <Icon name="sparkles" size="xs" className="app-TriageRow__mark" />
          <span>
            Suggested: <strong className="app-TriageRow__value">{valueWords(pending)}</strong>
            <span className="itsm-visually-hidden">, </span>
            <span className="app-TriageRow__confidence">{confidenceLabel(pending.confidence)}</span>
          </span>
        </p>
        <span id={describedBy} hidden>
          {suggestionLine(pending)}
        </span>
        {canAct ? (
          <div className="app-TriageRow__actions">
            <Button
              size="sm"
              variant="secondary"
              loading={busy === pending.question}
              loadingLabel="Accepting…"
              {...(blocked && busy !== pending.question ? { disabledReason: blocked } : {})}
              aria-label={`Accept ${field}: ${valueWords(pending)}`}
              aria-describedby={describedBy}
              onClick={() => void triage.accept(pending)}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              {...(blocked ? { disabledReason: blocked } : {})}
              aria-label={`Dismiss the ${field} suggestion`}
              onClick={() => void triage.dismiss(pending)}
            >
              Dismiss
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (applied) {
    return (
      <div className="app-TriageRow" data-kind="applied">
        <p className="app-TriageRow__line">
          <Badge tone="info" size="sm" icon="sparkles" srPrefix="Changed by">
            Set by AI
          </Badge>
        </p>
        <span id={describedBy} hidden>
          {appliedLine(applied)}
        </span>
        {canAct ? (
          <div className="app-TriageRow__actions">
            <Button
              size="sm"
              variant="ghost"
              iconStart="undo-2"
              loading={busy === applied.question}
              loadingLabel="Undoing…"
              {...(blocked && busy !== applied.question ? { disabledReason: blocked } : {})}
              aria-label={`Undo the ${fieldName(applied.question).toLowerCase()} the AI set: ${valueWords(applied)}`}
              aria-describedby={describedBy}
              onClick={() => void triage.undo(applied)}
            >
              Undo
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  return null;
}
