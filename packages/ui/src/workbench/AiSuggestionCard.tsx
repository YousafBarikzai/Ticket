'use client';

import type { ReactNode } from 'react';
import { Badge } from '../web/Badge.js';
import { Button } from '../web/Button.js';
import { cx } from '../web/cx.js';
import type { IntentName } from '../tokens/tokens.js';

/**
 * A suggestion, its reasoning, and what it was based on.
 *
 * Named as missing in the Phase 4 release gate, and the reason it matters is
 * not decoration. ADR-0006 requires every AI output to be explainable —
 * reason, confidence and evidence shown with the answer — and until something
 * renders them, the requirement is satisfied by a database column nobody
 * reads.
 *
 * Three decisions are worth defending:
 *
 * **The confidence is a word.** The model reports a number that is calibrated
 * against nothing; showing `0.82` invites a person to treat it as a
 * probability. Three bands are what the figure can support.
 *
 * **Evidence is a list of things you can open**, each with the reference a
 * person would type — an article key, a ticket number. A citation nobody can
 * follow is a claim. An answer with no evidence says so in words rather than
 * rendering an empty list, because an empty list reads as an oversight.
 *
 * **The actions are the point.** Accepting, editing or rejecting is how
 * anybody ever learns whether this helps; a card that only displays is a card
 * that teaches the platform nothing. Once an outcome is recorded the actions
 * go and the outcome stays, because an outcome is recorded once (MOD-09).
 */

export type ConfidenceBand = 'low' | 'medium' | 'high';

export interface SuggestionEvidence {
  readonly kind: 'article' | 'ticket' | 'known-error';
  readonly id: string;
  readonly title: string;
  /** What a person opens to check it: an article key, a ticket number. */
  readonly ref: string;
  readonly extract?: string;
  /** Where it opens. Omitted renders the reference as text rather than a dead link. */
  readonly href?: string;
}

export type SuggestionOutcome = 'pending' | 'accepted' | 'edited' | 'rejected';

export interface AiSuggestionCardProps {
  /** What the capability produced, already turned into something readable. */
  readonly children: ReactNode;
  readonly capability: string;
  /** The label a person sees, e.g. "Draft a reply". */
  readonly title: string;
  readonly reason: string;
  readonly confidence: ConfidenceBand;
  readonly evidence: readonly SuggestionEvidence[];
  readonly outcome?: SuggestionOutcome;
  readonly busy?: boolean;
  readonly onAccept?: () => void;
  readonly onEdit?: () => void;
  readonly onReject?: () => void;
  readonly className?: string;
}

const CONFIDENCE_INTENT: Record<ConfidenceBand, IntentName> = {
  low: 'warning',
  medium: 'info',
  high: 'success',
};

const CONFIDENCE_LABEL: Record<ConfidenceBand, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

const KIND_LABEL: Record<SuggestionEvidence['kind'], string> = {
  article: 'Article',
  ticket: 'Ticket',
  'known-error': 'Known error',
};

const OUTCOME_LABEL: Record<Exclude<SuggestionOutcome, 'pending'>, string> = {
  accepted: 'Accepted as written',
  edited: 'Edited before sending',
  rejected: 'Rejected',
};

export function AiSuggestionCard({
  children,
  capability,
  title,
  reason,
  confidence,
  evidence,
  outcome = 'pending',
  busy = false,
  onAccept,
  onEdit,
  onReject,
  className,
}: AiSuggestionCardProps): ReactNode {
  const decided = outcome !== 'pending';

  return (
    <section
      className={cx('itsm-AiSuggestion', className)}
      aria-label={`${title} — suggested by AI`}
      data-capability={capability}
      data-outcome={outcome}
    >
      <header className="itsm-AiSuggestion__head">
        <h3 className="itsm-AiSuggestion__title">{title}</h3>
        {/* Said in words as well as colour: the band is the whole calibration. */}
        <Badge intent={CONFIDENCE_INTENT[confidence]} srPrefix="Confidence">
          {CONFIDENCE_LABEL[confidence]}
        </Badge>
      </header>

      <div className="itsm-AiSuggestion__body">{children}</div>

      <p className="itsm-AiSuggestion__reason">
        <span className="itsm-visually-hidden">Why this was suggested: </span>
        {reason}
      </p>

      <div className="itsm-AiSuggestion__evidence">
        <h4 className="itsm-AiSuggestion__evidenceTitle">Based on</h4>
        {evidence.length === 0 ? (
          // Said plainly. An empty list reads as an oversight, and "nothing"
          // is the most important thing a person can know about an answer.
          <p className="itsm-AiSuggestion__noEvidence">
            Nothing in the knowledge base or in earlier tickets. Check this one yourself before sending it.
          </p>
        ) : (
          <ul className="itsm-AiSuggestion__evidenceList">
            {evidence.map((item) => (
              <li key={`${item.kind}:${item.id}`} className="itsm-AiSuggestion__evidenceItem">
                <span className="itsm-AiSuggestion__evidenceKind">{KIND_LABEL[item.kind]}</span>
                {item.href ? (
                  <a className="itsm-AiSuggestion__evidenceLink" href={item.href}>
                    {item.title}
                  </a>
                ) : (
                  <span className="itsm-AiSuggestion__evidenceLink">{item.title}</span>
                )}
                <span className="itsm-AiSuggestion__evidenceRef">{item.ref}</span>
                {item.extract ? <p className="itsm-AiSuggestion__evidenceExtract">{item.extract}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {decided ? (
        <p className="itsm-AiSuggestion__outcome" data-outcome={outcome}>
          {OUTCOME_LABEL[outcome as Exclude<SuggestionOutcome, 'pending'>]}
        </p>
      ) : (
        <div className="itsm-AiSuggestion__actions">
          <Button variant="primary" onClick={onAccept} disabled={busy}>
            Use it
          </Button>
          <Button variant="secondary" onClick={onEdit} disabled={busy}>
            Edit first
          </Button>
          <Button variant="ghost" onClick={onReject} disabled={busy}>
            Not useful
          </Button>
        </div>
      )}
    </section>
  );
}
