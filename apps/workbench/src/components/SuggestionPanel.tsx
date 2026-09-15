'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, type AiCapability, type AiJob, type Suggestion } from '@itsm/sdk';
import { AiSuggestionCard, Button, EmptyState, Skeleton } from '@itsm/ui';
import { api } from '../client/api.js';
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
 * The job is polled rather than streamed. SSE exists (ADR-0015) and would be
 * the better answer for a queue that updates by itself; for a job the person
 * just started and is watching, a poll with a ceiling is less machinery for
 * the same result, and it stops on its own.
 */

const POLL_INTERVAL_MS = 1500;
const POLL_CEILING = 40;

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

  useEffect(() => {
    if (!running) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async (): Promise<void> => {
      attempts += 1;
      let job: AiJob;
      try {
        job = await api.aiJob(running.jobId);
      } catch {
        setRunning(null);
        setError('That job could not be read.');
        return;
      }
      if (cancelled.current) return;

      if (job.status === 'completed' && job.suggestion) {
        // The job's nested suggestion omits what the job already names, so
        // the two are put back together here rather than typed as one
        // half-optional shape.
        const full: Suggestion = {
          ...job.suggestion,
          capability: job.capability,
          subjectId: job.subjectId,
          createdAt: job.finishedAt ?? job.createdAt,
        };
        setSuggestions((current) => [full, ...current]);
        setRunning(null);
        return;
      }
      if (job.status === 'refused') {
        // A refusal is the system working. Saying so plainly — rather than
        // "something went wrong" — is what stops an agent retrying it four
        // times and then mistrusting the whole feature.
        setRunning(null);
        setError(job.error ?? 'There was nothing in the knowledge base to ground an answer in.');
        return;
      }
      if (job.status === 'failed') {
        setRunning(null);
        setError(job.error ?? 'That did not finish.');
        return;
      }
      if (attempts >= POLL_CEILING) {
        setRunning(null);
        setError('That is taking longer than expected. It may still finish — reload in a minute.');
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [running]);

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
