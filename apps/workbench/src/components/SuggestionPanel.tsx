'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, type AiCapability, type AiJob, type Suggestion } from '@itsm/sdk';
import { AiSuggestionCard, Button, EmptyState, Skeleton } from '@itsm/ui';
import { api } from '../client/api.js';
import { useChangeStream } from '../client/useChangeStream.js';
import { evidenceFor, hrefForEvidence, renderSuggestion } from '../ai/render.js';

/**
 * The AI surface (ADR-0006, ADR-0040).
 *
 * Everything here is arranged so a person can disbelieve it. The card shows
 * the reason, the confidence as a word and the evidence with references they
 * can open, and the only things they can do with it are accept, edit or
 * reject — which are also the only signals that ever tell anybody whether this
 * feature helps.
 *
 * A suggestion is never applied automatically and there is deliberately no
 * "send this reply" button. ADR-0006 puts a person between the model and the
 * requester; a one-click send would be that line removed in a component, which
 * is precisely where such lines get removed.
 *
 * The job finishes over the stream (ADR-0015): the AI service publishes a
 * notice to the ticket's topic whichever way the job ended, so the panel
 * settles the moment it happens rather than up to an interval later.
 *
 * The poll stays, and that is not belt-and-braces for its own sake. A stream
 * is a thing that can fail to open — an old browser, a proxy that buffers, a
 * corporate middlebox — and the person watching this panel has no way to tell
 * a stream that never connected from a job that never finished. So the poll is
 * the guarantee and the stream is the speed: with the notice arriving, the
 * interval never matters; without it, the panel behaves exactly as it did
 * before. The interval is longer than it was for the same reason it can be.
 */

const POLL_INTERVAL_MS = 5_000;
// Twelve attempts at five seconds is the same sixty-second ceiling the panel
// had at forty attempts of 1.5s: the same patience, a third of the requests.
const POLL_CEILING = 12;

export interface SuggestionPanelProps {
  readonly ticketId: string;
  readonly ticketNumber: string;
  readonly capabilities: readonly AiCapability[];
  readonly existing: readonly Suggestion[];
  readonly onUseText?: (text: string) => void;
}

interface Running {
  readonly jobId: string;
  readonly capability: string;
}

export function SuggestionPanel({
  ticketId,
  ticketNumber,
  capabilities,
  existing,
  onUseText,
}: SuggestionPanelProps): ReactNode {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([...existing]);
  const [running, setRunning] = useState<Running | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const ask = useCallback(async (capability: string): Promise<void> => {
    setError(null);
    try {
      const started = await api.suggest(capability, ticketId);
      setRunning({ jobId: started.jobId, capability });
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 402
          ? 'This tenant has spent its AI budget for the period. Ask an administrator to raise it.'
          : failure instanceof ApiError
            ? failure.message
            : 'That could not be started.',
      );
    }
  }, [ticketId]);

  /**
   * Reads the job and settles the panel if it has finished.
   *
   * Shared by the poll and the stream so the two cannot disagree about what a
   * finished job means — the notice carries only an id, so both paths end in
   * the same refetch and the same four outcomes.
   *
   * Returns whether it settled, which is what lets the poll decide to stop.
   */
  const settle = useCallback(async (jobId: string): Promise<boolean> => {
    let job: AiJob;
    try {
      job = await api.aiJob(jobId);
    } catch {
      setRunning(null);
      setError('That job could not be read.');
      return true;
    }
    if (cancelled.current) return true;

    if (job.status === 'completed' && job.suggestion) {
      const full: Suggestion = {
        ...job.suggestion,
        capability: job.capability,
        subjectId: job.subjectId,
        createdAt: job.finishedAt ?? job.createdAt,
      };
      // Guarded, because the stream and the poll can both arrive: whichever is
      // second must not add the suggestion twice.
      setSuggestions((current) => (current.some((row) => row.id === full.id) ? current : [full, ...current]));
      setRunning(null);
      return true;
    }
    if (job.status === 'refused') {
      // A refusal is the system working. Saying so plainly — rather than
      // "something went wrong" — is what stops an agent retrying it four
      // times and then mistrusting the whole feature.
      setRunning(null);
      setError(job.error ?? 'There was nothing in the knowledge base to ground an answer in.');
      return true;
    }
    if (job.status === 'failed') {
      setRunning(null);
      setError(job.error ?? 'That did not finish.');
      return true;
    }
    return false;
  }, []);

  // The ticket's topic, because that is where the AI service announces a
  // finished job — and it means a colleague with the same ticket open sees the
  // suggestion appear too, not only the person who asked for it.
  useChangeStream({
    topics: [`ticket:${ticketId}`],
    enabled: running !== null,
    onNotice: (change) => {
      if (change.entity === 'ai_job' && running && change.id === running.jobId) void settle(running.jobId);
    },
    // A reconnection means a gap, and the notice may have fallen in it.
    onReconnect: () => {
      if (running) void settle(running.jobId);
    },
  });

  useEffect(() => {
    if (!running) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async (): Promise<void> => {
      attempts += 1;
      if (await settle(running.jobId)) return;
      if (cancelled.current) return;

      if (attempts >= POLL_CEILING) {
        setRunning(null);
        setError('That is taking longer than expected. It may still finish — reload in a minute.');
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [running, settle]);

  const decide = useCallback(
    async (suggestion: Suggestion, outcome: 'accepted' | 'edited' | 'rejected'): Promise<void> => {
      setDeciding(suggestion.id);
      try {
        await api.decideSuggestion(suggestion.id, outcome);
        setSuggestions((current) =>
          current.map((item) => (item.id === suggestion.id ? { ...item, outcome } : item)),
        );
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'That outcome was not recorded.');
      } finally {
        setDeciding(null);
      }
    },
    [],
  );

  const offered = capabilities.filter((capability) => capability.available);
  const withheld = capabilities.filter((capability) => !capability.available);

  return (
    <section className="itsm-Suggestions" aria-label="AI assistance">
      <h2 className="itsm-Suggestions__heading">Assistance</h2>

      {offered.length === 0 ? (
        <EmptyState
          title="No assistance is available"
          description={
            withheld[0]?.unavailableBecause ??
            'No provider is configured for this tenant. Nothing here is switched on by default.'
          }
        />
      ) : (
        <div className="itsm-Suggestions__actions">
          {offered.map((capability) => (
            <Button
              key={capability.key}
              variant="secondary"
              size="sm"
              onClick={() => void ask(capability.key)}
              loading={running?.capability === capability.key}
              loadingLabel={`Working on ${capability.name}`}
              disabled={running !== null}
            >
              {capability.name}
            </Button>
          ))}
        </div>
      )}

      {/*
        Withheld capabilities are listed with their reason rather than hidden.
        A feature that silently is not there reads as a bug; one that says
        "the budget for this period is spent" is an answer.
      */}
      {withheld.length > 0 && offered.length > 0 ? (
        <ul className="itsm-Suggestions__withheld">
          {withheld.map((capability) => (
            <li key={capability.key}>
              {capability.name} — {capability.unavailableBecause ?? 'not available here'}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="itsm-Suggestions__error" role="alert">
          {error}
        </p>
      ) : null}

      {running ? (
        <div className="itsm-Suggestions__pending" aria-busy="true" aria-label="Preparing a suggestion">
          <Skeleton height={14} />
          <Skeleton height={14} width="80%" />
          <Skeleton height={14} width="60%" />
        </div>
      ) : null}

      {suggestions.map((suggestion) => {
        const rendered = renderSuggestion(suggestion.capability, suggestion.content);
        const usable = rendered.forComposer.length > 0 && onUseText !== undefined;
        return (
          <AiSuggestionCard
            key={suggestion.id}
            capability={suggestion.capability}
            title={rendered.heading ?? titleFor(suggestion.capability)}
            reason={suggestion.reason}
            confidence={suggestion.confidence}
            evidence={evidenceFor(suggestion).map((item) => {
              const href = hrefForEvidence(item);
              return href ? { ...item, href } : item;
            })}
            outcome={suggestion.outcome}
            busy={deciding === suggestion.id}
            onAccept={() => {
              if (usable) onUseText(rendered.forComposer);
              void decide(suggestion, 'accepted');
            }}
            onEdit={() => {
              if (usable) onUseText(rendered.forComposer);
              void decide(suggestion, 'edited');
            }}
            onReject={() => void decide(suggestion, 'rejected')}
          >
            {rendered.paragraphs.length > 0 ? (
              rendered.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)
            ) : (
              <p className="itsm-Suggestions__prose">
                Nothing to read here — what it found is listed below. Ticket {ticketNumber}.
              </p>
            )}
          </AiSuggestionCard>
        );
      })}
    </section>
  );
}

function titleFor(capability: string): string {
  switch (capability) {
    case 'reply-draft':
      return 'Suggested reply';
    case 'ticket-summary':
      return 'Summary';
    case 'article-draft':
      return 'Suggested article';
    case 'similar-work':
      return 'Similar work';
    default:
      return 'Suggestion';
  }
}
