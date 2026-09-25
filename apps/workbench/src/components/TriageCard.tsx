'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ApiError, type TriageSuggestion } from '@itsm/sdk';
import { Badge, Button } from '@itsm/ui';
import { api } from '../client/api.js';
import { confidenceWord, fieldName, orderSuggestions, suggestionLine } from '../ai/triage.js';

/**
 * Suggested triage (ADR-0051, `suggest` mode).
 *
 * The AI decided a triage for this ticket when it arrived. Here an agent sees
 * each answer and does something about it — and it is the agent who changes
 * the ticket: Accept is their own edit, under their name, with the version
 * this page loaded, so a ticket somebody else just changed is a conflict to
 * read rather than an overwrite. Dismiss changes nothing on the ticket; both
 * are recorded, because they are how the desk learns whether this helps.
 *
 * A major-incident answer is a warning with no button. Declaring one pages
 * people, and that is never a single click on somebody else's guess.
 */

export interface TriageCardProps {
  readonly triage: TriageSuggestion;
  readonly ticketVersion: number;
  readonly canAct: boolean;
}

export function TriageCard({ triage, ticketVersion, canAct }: TriageCardProps): ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const items = orderSuggestions(triage.suggestions).filter((item) => !done.has(item.question));
  if (items.length === 0) return null;

  async function respond(question: string, response: 'accept' | 'dismiss'): Promise<void> {
    setBusy(question);
    setError(null);
    try {
      if (response === 'accept') await api.acceptTriage(triage.decisionId, question, ticketVersion);
      else await api.dismissTriage(triage.decisionId, question);
      setDone((previous) => new Set([...previous, question]));
      // An accepted value changes the ticket, and the version with it: read
      // the page again so the next action carries the new one.
      if (response === 'accept') router.refresh();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? 'Somebody else changed this ticket while you were looking at it. The page has been refreshed; check the ticket and try again.'
          : failure instanceof ApiError
            ? failure.message
            : 'The suggestion could not be saved just now.',
      );
      if (failure instanceof ApiError && failure.status === 409) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="itsm-Triage" aria-labelledby="triage-heading">
      <h2 id="triage-heading" className="itsm-Triage__heading">
        Suggested triage
      </h2>
      <p className="itsm-Triage__note">
        Suggested by AI when this ticket arrived. Nothing changes until you accept it.
      </p>
      <ul className="itsm-Triage__list">
        {items.map((item) => (
          <li key={item.question} className="itsm-Triage__item" data-kind={item.kind}>
            <p className="itsm-Triage__field">
              <strong>{fieldName(item.question)}</strong>{' '}
              {item.kind === 'warning' ? (
                <Badge intent="warning" srPrefix="Warning">
                  Check this
                </Badge>
              ) : (
                <Badge srPrefix="Confidence">{`${confidenceWord(item.confidence)} confidence`}</Badge>
              )}
            </p>
            <p className="itsm-Triage__line">{suggestionLine(item)}</p>
            {canAct ? (
              <div className="itsm-Triage__actions">
                {item.kind === 'apply' ? (
                  <Button
                    size="sm"
                    onClick={() => void respond(item.question, 'accept')}
                    disabled={busy !== null}
                    aria-label={`Accept ${fieldName(item.question).toLowerCase()}: ${item.display}`}
                  >
                    Accept
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void respond(item.question, 'dismiss')}
                  disabled={busy !== null}
                  aria-label={`Dismiss the ${fieldName(item.question).toLowerCase()} suggestion`}
                >
                  Dismiss
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="itsm-Triage__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
