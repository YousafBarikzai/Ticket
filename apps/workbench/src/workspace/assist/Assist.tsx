'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLive } from '@itsm/pwa/live';
import { ApiError, type AiCapability, type Suggestion, type SuggestionOutcome } from '@itsm/sdk';
import { AiSuggestionCard, Button, Disclosure, InlineAlert, Spinner, notify, useItsm } from '@itsm/ui';
import {
  articleKeyOf,
  copyTextFor,
  evidenceFor,
  hrefForEvidence,
  noteFor,
  renderSuggestion,
  ticketNumberOf,
  titleFor,
} from '../../ai/render.js';
import { api } from '../../client/api.js';
import { problemOf } from '../../inbox/presentation.js';
import { demoLock } from '../../server/demo.js';
import { openArticle } from '../ArticleSheet.js';
import { useTicketWorkspace, type WorkspaceApi } from '../TicketWorkspace.js';
import './assist.css';
import { articlesQuery, assistKeys, capabilitiesQuery, suggestionsQuery } from './queries.js';

/**
 * Assist (SPEC §6.2; replaces `SuggestionPanel`): what the AI can do for this
 * ticket, on request, and what it has done — loaded only when the section is
 * opened.
 *
 * Four capabilities as chips (Summarise, Draft reply, Find similar, Draft
 * article); one that is withheld says why in words. While one runs there is a
 * progress line with Cancel — never a spinner without an exit — and a
 * failure says what happened with Retry. The answers are the design system's
 * suggestion cards, which show the reason, the confidence as a word and the
 * evidence behind it, so a person can disbelieve it.
 *
 * Nothing here reaches the requester by itself (ADR-0006). A reply draft goes
 * *into* the reply — "Insert into reply" — and what became of it is recorded
 * when the person sends: accepted if sent as it was, edited if changed,
 * rejected if thrown away. A summary can become an internal note the same
 * way. Evidence opens where it lives: a ticket in the pane beside the list,
 * an article in the article sheet.
 *
 * Suggested articles — published answers that match the ticket — sit at the
 * foot, each opening in the sheet to read and insert.
 *
 * In the shared demo, where calling a live model is turned off (feature
 * `ai`), every chip is drawn locked with the demo's sentence — shown, never
 * hidden, so a visitor learns the feature exists (v3 §7.0.2) — and a stored
 * sample answer carries the "Sample" pill (D13).
 */

/** `/me` on the client (the workspace and the New ticket sheet share the key): the demo's locked features live there. */
const DESK_ME_KEY = ['desk', 'me'] as const;

/** Whether a stored suggestion is one of the demo's samples (its provider, when the API says). */
function isSample(suggestion: Suggestion): boolean {
  return (suggestion as Suggestion & { readonly provider?: unknown }).provider === 'sample';
}

/** Twelve tries five seconds apart: a minute's patience, with the live notice as the fast path. */
const POLL_MS = 5_000;
const POLL_LIMIT = 12;

interface Chip {
  readonly key: string;
  readonly label: string;
  readonly running: string;
  readonly failed: string;
}

const CHIPS: readonly Chip[] = [
  { key: 'ticket-summary', label: 'Summarise', running: 'Summarising the ticket…', failed: 'Couldn’t summarise the ticket.' },
  { key: 'reply-draft', label: 'Draft reply', running: 'Drafting a reply…', failed: 'Couldn’t draft a reply.' },
  { key: 'similar-work', label: 'Find similar', running: 'Finding similar work…', failed: 'Couldn’t look for similar work.' },
  { key: 'article-draft', label: 'Draft article', running: 'Drafting an article…', failed: 'Couldn’t draft an article.' },
];

export const BUDGET_REACHED = 'Monthly AI budget reached';

/** The chips in their order, then any capability this screen does not know by name. */
export function chipsFor(capabilities: readonly AiCapability[]): { readonly chip: Chip; readonly capability: AiCapability }[] {
  const known = CHIPS.flatMap((chip) => {
    const capability = capabilities.find((entry) => entry.key === chip.key);
    return capability ? [{ chip, capability }] : [];
  });
  const rest = capabilities
    .filter((entry) => !CHIPS.some((chip) => chip.key === entry.key))
    .map((capability) => ({
      chip: { key: capability.key, label: capability.name, running: `${capability.name}…`, failed: `Couldn’t finish ${capability.name.toLowerCase()}.` },
      capability,
    }));
  return [...known, ...rest];
}

/** "Switched off for this tenant": a withheld capability's reason, as a sentence. */
export function reasonText(reason: string | null): string {
  const text = (reason ?? 'not available here').trim();
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
}

interface Running {
  readonly jobId: string;
  readonly chip: Chip;
}

interface Failure {
  readonly chip: Chip;
  readonly message: string;
  readonly tone: 'danger' | 'warning';
}

function openInPane(number: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('t', number);
  url.searchParams.delete('open');
  window.history.pushState(null, '', `${url.pathname}${url.search}`);
}

export default function Assist(): ReactNode {
  const ws = useTicketWorkspace();
  if (!ws) return null;
  return <AssistPanel ws={ws} />;
}

function AssistPanel({ ws }: { readonly ws: WorkspaceApi }): ReactNode {
  const { ticket, viewer, entries } = ws.bundle;
  const can = viewer.can;
  const client = useQueryClient();
  const { usePathname, useSearchParams } = useItsm();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  const capabilities = useQuery(capabilitiesQuery(can.aiRead === true));
  const me = useQuery({ queryKey: DESK_ME_KEY, queryFn: () => api.me(), staleTime: 10 * 60_000 }).data;
  const aiLock = demoLock(me, 'ai');
  const suggestions = useQuery(suggestionsQuery(ticket.id, can.aiRead === true));
  const articles = useQuery(articlesQuery(ticket.number, ticket.title.slice(0, 200), can.search === true && can.knowledge === true));

  const [running, setRunning] = useState<Running | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [budgetReached, setBudgetReached] = useState(false);
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, SuggestionOutcome>>>({});
  const [inserted, setInserted] = useState<ReadonlySet<string>>(new Set());
  const [deciding, setDeciding] = useState<string | null>(null);
  const alive = useRef(true);
  /** Jobs the person stopped waiting for: if one ends badly later, that is not news to interrupt them with. */
  const abandoned = useRef(new Set<string>());
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // A comment was posted (perhaps an inserted draft): its outcome was recorded at send, so read them again.
  const comments = entries.filter((entry) => entry.kind === 'comment').length;
  const seenComments = useRef(comments);
  useEffect(() => {
    if (comments === seenComments.current) return;
    seenComments.current = comments;
    void client.invalidateQueries({ queryKey: assistKeys.suggestions(ticket.id) });
  }, [comments, client, ticket.id]);

  /* ------------------------------------------------------------ Asking */

  /** Reads the job and settles the panel if it has finished; whether it did. Shared by the poll and the live notice. */
  const settle = useCallback(
    async (job: Running): Promise<boolean> => {
      let answer;
      try {
        answer = await api.aiJob(job.jobId);
      } catch {
        if (!alive.current) return true;
        setRunning(null);
        setFailure({ chip: job.chip, message: `${job.chip.failed} Its progress couldn’t be read.`, tone: 'danger' });
        return true;
      }
      if (!alive.current) return true;
      if (abandoned.current.has(job.jobId) && answer.status !== 'completed') return true;
      if (answer.status === 'completed' && answer.suggestion) {
        const full: Suggestion = {
          ...answer.suggestion,
          capability: answer.capability,
          subjectId: answer.subjectId,
          createdAt: answer.finishedAt ?? answer.createdAt,
        };
        // The poll and the notice can both arrive: the second must not add it twice.
        client.setQueryData<Suggestion[] | null>(assistKeys.suggestions(ticket.id), (current) =>
          current?.some((row) => row.id === full.id) ? current : [full, ...(current ?? [])],
        );
        setRunning((current) => (current?.jobId === job.jobId ? null : current));
        return true;
      }
      if (answer.status === 'refused') {
        // The system working, said plainly — so nobody retries it four times and then mistrusts the feature.
        setRunning(null);
        setFailure({ chip: job.chip, message: answer.error ?? 'There was nothing in the knowledge base to ground an answer in.', tone: 'warning' });
        return true;
      }
      if (answer.status === 'failed') {
        setRunning(null);
        setFailure({ chip: job.chip, message: `${job.chip.failed} ${answer.error ?? 'It didn’t finish.'}`, tone: 'danger' });
        return true;
      }
      return false;
    },
    [client, ticket.id],
  );

  const ask = useCallback(
    async (chip: Chip): Promise<void> => {
      if (running) return;
      setFailure(null);
      try {
        const started = await api.suggest(chip.key, ticket.id);
        const job = { jobId: started.jobId, chip };
        if (started.status === 'completed') {
          await settle(job);
          return;
        }
        setRunning(job);
      } catch (error) {
        const problem = problemOf(error);
        if (problem.status === 402) {
          setBudgetReached(true);
          setFailure({ chip, message: `${BUDGET_REACHED}. Ask an administrator to raise it; finding similar work still works.`, tone: 'warning' });
        } else if (problem.status === 429) {
          setFailure({ chip, message: `Too many requests just now. Try again in ${problem.retryAfterSeconds ?? 20} s.`, tone: 'warning' });
        } else if (problem.status === 403) {
          setFailure({ chip, message: 'You can’t ask for AI help on this ticket.', tone: 'danger' });
        } else if (problem.status === 0) {
          setFailure({ chip, message: `${chip.failed} You’re offline.`, tone: 'danger' });
        } else {
          setFailure({ chip, message: `${chip.failed} ${problem.detail ?? 'Try again.'}`, tone: 'danger' });
        }
      }
    },
    [running, ticket.id, settle],
  );

  // The live notice is the fast path: the service tells the person who asked when the job ends.
  useLive({
    entity: 'ai_job',
    ...(running ? { id: running.jobId } : {}),
    enabled: running !== null,
    onNotice: () => {
      if (running) void settle(running);
    },
    onReconnect: () => {
      if (running) void settle(running);
    },
  });

  // The poll is the guarantee: a stream that never opened looks, from here, exactly like a job that never ends.
  useEffect(() => {
    if (!running) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (): Promise<void> => {
      attempts += 1;
      if (await settle(running)) return;
      if (!alive.current) return;
      if (attempts >= POLL_LIMIT) {
        setRunning(null);
        setFailure({ chip: running.chip, message: 'That’s taking longer than expected. It may still arrive; check back in a minute.', tone: 'warning' });
        return;
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    timer = setTimeout(() => void poll(), POLL_MS);
    return () => clearTimeout(timer);
  }, [running, settle]);

  /* ---------------------------------------------------------- Deciding */

  const decide = useCallback(async (suggestion: Suggestion, outcome: 'accepted' | 'edited' | 'rejected'): Promise<void> => {
    setDeciding(suggestion.id);
    setOutcomes((current) => ({ ...current, [suggestion.id]: outcome }));
    try {
      await api.decideSuggestion(suggestion.id, outcome);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) {
        setOutcomes((current) => {
          const next = { ...current };
          delete next[suggestion.id];
          return next;
        });
        notify('That wasn’t recorded', { tone: 'danger', description: problemOf(error).detail ?? 'Try again.' });
      }
    } finally {
      setDeciding(null);
    }
  }, []);

  const insert = useCallback(
    (suggestion: Suggestion, text: string, mode: 'reply' | 'note') => {
      ws.insertIntoReply(text, { suggestionId: suggestion.id, mode });
      setInserted((current) => new Set([...current, suggestion.id]));
    },
    [ws],
  );

  const copy = useCallback(
    async (suggestion: Suggestion, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notify('Article text copied', { tone: 'success' });
        void decide(suggestion, 'accepted');
      } catch {
        notify('Couldn’t copy that', { tone: 'warning', description: 'Select the text on the card and copy it instead.' });
      }
    },
    [decide],
  );

  /* ---------------------------------------------------------- Evidence */

  // A ticket opens in the pane beside the list; an article in the sheet over the ticket.
  const onEvidenceClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a[href]');
      const href = anchor?.getAttribute('href');
      if (!href) return;
      const key = articleKeyOf(href);
      if (key) {
        event.preventDefault();
        openArticle(key);
        return;
      }
      const number = ticketNumberOf(href);
      if (number && ws.mode === 'pane') {
        event.preventDefault();
        openInPane(number);
      }
    },
    [ws.mode],
  );

  /* ------------------------------------------------------------ Render */

  const list = capabilities.data?.capabilities ?? [];
  const chips = useMemo(() => chipsFor(list), [list]);
  const offered = chips.filter((entry) => entry.capability.available);
  const withheld = chips.filter((entry) => !entry.capability.available);
  const allOffForOneReason = offered.length === 0 && withheld.length > 0 && new Set(withheld.map((entry) => entry.capability.unavailableBecause)).size === 1;

  const cards = suggestions.data ?? [];
  const outcomeOf = (suggestion: Suggestion): SuggestionOutcome => outcomes[suggestion.id] ?? suggestion.outcome;
  const pending = cards.filter((suggestion) => outcomeOf(suggestion) === 'pending');
  const decided = cards.filter((suggestion) => outcomeOf(suggestion) !== 'pending');
  const [latestDecided, ...olderDecided] = decided;
  const here = { pathname, search };

  const card = (suggestion: Suggestion): ReactNode => {
    const rendered = renderSuggestion(suggestion.capability, suggestion.content);
    const outcome = outcomeOf(suggestion);
    const done = inserted.has(suggestion.id);
    const canDecide = can.ai === true;
    let actions: ('accept' | 'edit' | 'reject')[] = canDecide ? ['reject'] : [];
    let acceptLabel = 'Use it';
    let onAccept: (() => void) | undefined;
    if (canDecide && !done) {
      if (suggestion.capability === 'reply-draft' && rendered.forComposer && (can.reply || can.note)) {
        actions = ['accept', 'reject'];
        acceptLabel = can.reply ? 'Insert into reply' : 'Insert into note';
        onAccept = () => insert(suggestion, rendered.forComposer, can.reply ? 'reply' : 'note');
      } else if (suggestion.capability === 'ticket-summary' && can.note) {
        const note = noteFor(suggestion.capability, suggestion.content);
        if (note) {
          actions = ['accept', 'reject'];
          acceptLabel = 'Add as internal note';
          onAccept = () => insert(suggestion, note, 'note');
        }
      } else if (suggestion.capability === 'article-draft') {
        const text = copyTextFor(suggestion.capability, suggestion.content);
        if (text) {
          actions = ['accept', 'reject'];
          acceptLabel = 'Copy text';
          onAccept = () => void copy(suggestion, text);
        }
      } else if (suggestion.capability === 'similar-work') {
        actions = ['accept', 'reject'];
        acceptLabel = 'Useful';
        onAccept = () => void decide(suggestion, 'accepted');
      }
    }
    if (done) actions = [];
    return (
      <div key={suggestion.id} className="app-Assist__card" onClickCapture={onEvidenceClick}>
        <AiSuggestionCard
          capability={suggestion.capability}
          title={rendered.heading ?? titleFor(suggestion.capability)}
          reason={suggestion.reason}
          confidence={suggestion.confidence}
          evidence={evidenceFor(suggestion).map((item) => {
            const href = hrefForEvidence(item, here);
            return href ? { ...item, href } : item;
          })}
          outcome={outcome}
          busy={deciding === suggestion.id}
          acceptLabel={acceptLabel}
          // The composer's Send is the view's one filled button (SPEC §1.1).
          acceptVariant="tinted"
          actions={actions}
          sample={isSample(suggestion)}
          {...(onAccept ? { onAccept } : {})}
          onReject={() => void decide(suggestion, 'rejected')}
        >
          {rendered.paragraphs.length > 0 ? (
            rendered.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)
          ) : (
            <p className="app-Assist__prose">Nothing to read here: what it found is listed below.</p>
          )}
        </AiSuggestionCard>
        {done && outcome === 'pending' ? (
          <p className="app-Assist__inserted">
            {suggestion.capability === 'ticket-summary' ? 'In your note.' : 'In your reply.'} What you send is recorded, so the desk learns whether this helps.
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="app-Assist">
      {capabilities.data === null ? (
        <p className="app-Insp__empty">AI help isn’t available to you here.</p>
      ) : capabilities.isPending ? (
        <p className="app-Insp__empty">Loading…</p>
      ) : allOffForOneReason ? (
        <p className="app-Assist__withheld">{reasonText(withheld[0]!.capability.unavailableBecause)}</p>
      ) : (
        <>
          {offered.length > 0 && can.ai ? (
            <div className="app-Assist__chips" role="group" aria-label="Ask the AI">
              {offered.map(({ chip, capability }) => {
                const reason =
                  aiLock.disabledReason ??
                  (budgetReached && capability.callsAModel ? BUDGET_REACHED : ws.gate ?? (running && running.chip.key !== chip.key ? 'One request at a time' : undefined));
                return (
                  <Button
                    key={chip.key}
                    size="sm"
                    variant="secondary"
                    shape="capsule"
                    iconStart="sparkles"
                    loading={running?.chip.key === chip.key}
                    loadingLabel={chip.running}
                    title={capability.description}
                    {...(reason ? { disabledReason: reason } : {})}
                    {...(aiLock.disabledIcon ? { disabledIcon: aiLock.disabledIcon } : {})}
                    onClick={() => void ask(chip)}
                  >
                    {chip.label}
                  </Button>
                );
              })}
            </div>
          ) : null}
          {withheld.length > 0 ? (
            <ul className="app-Assist__withheldList">
              {withheld.map(({ chip, capability }) => (
                <li key={chip.key} className="app-Assist__withheld">
                  <span className="app-Assist__withheldName">{chip.label}</span> · {reasonText(capability.unavailableBecause)}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      {running ? (
        <div className="app-Assist__running" role="status">
          <Spinner size="sm" />
          <span className="app-Assist__runningText">{running.chip.running}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              abandoned.current.add(running.jobId);
              setRunning(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {failure ? (
        <InlineAlert tone={failure.tone} role="alert" className="app-Assist__failure">
          <span>{failure.message}</span>{' '}
          {failure.message.startsWith(BUDGET_REACHED) ? null : (
            <Button size="sm" variant="ghost" onClick={() => void ask(failure.chip)}>
              Retry
            </Button>
          )}
        </InlineAlert>
      ) : null}

      {pending.map(card)}
      {latestDecided ? card(latestDecided) : null}
      {olderDecided.length > 0 ? (
        <Disclosure summary={`${olderDecided.length} earlier ${olderDecided.length === 1 ? 'suggestion' : 'suggestions'}`} className="app-Assist__older">
          {olderDecided.map(card)}
        </Disclosure>
      ) : null}

      {articles.data && articles.data.length > 0 ? (
        <section className="app-Assist__articles" aria-label="Suggested articles">
          <h3 className="app-Assist__heading">Suggested articles</h3>
          <ul className="app-Assist__articleList">
            {articles.data.map((hit) => (
              <li key={hit.key}>
                <button type="button" className="app-Assist__article" onClick={() => openArticle(hit.key)}>
                  <span className="app-Assist__articleTitle">{hit.title}</span>
                  {hit.snippet ? <span className="app-Assist__articleSnippet">{hit.snippet}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
