'use client';

import { useState, type ReactNode } from 'react';
import type { AiCapability, Suggestion } from '@itsm/sdk';
import { CommentComposer } from './CommentComposer.js';
import { SuggestionPanel } from './SuggestionPanel.js';

/**
 * The right two panes, sharing one draft.
 *
 * The suggestion panel's "Use it" puts the drafted reply into the composer,
 * which means the two need one piece of state between them. It lives here,
 * at the lowest component that contains both, rather than in a store: one
 * string, one screen, no library.
 *
 * `children` is the timeline, rendered on the server and handed down. Keeping
 * it out of this component is what lets the ticket history be server-rendered
 * while the parts that need interaction are not.
 */

export interface TicketWorkAreaProps {
  readonly ticketId: string;
  readonly ticketNumber: string;
  readonly canBeInternal: boolean;
  readonly capabilities: readonly AiCapability[];
  readonly suggestions: readonly Suggestion[];
  readonly children: ReactNode;
}

export function TicketWorkArea({
  ticketId,
  ticketNumber,
  canBeInternal,
  capabilities,
  suggestions,
  children,
}: TicketWorkAreaProps): ReactNode {
  const [draft, setDraft] = useState('');

  return (
    <>
      <section className="itsm-Ticket__thread" aria-label="History and reply">
        {children}
        <CommentComposer
          ticketNumber={ticketNumber}
          canBeInternal={canBeInternal}
          value={draft}
          onValueChange={setDraft}
        />
      </section>

      <aside className="itsm-Ticket__assist" aria-label="Assistance">
        <SuggestionPanel
          ticketId={ticketId}
          ticketNumber={ticketNumber}
          capabilities={capabilities}
          existing={suggestions}
          onUseText={(text) => {
            // Appended, never overwritten: a half-written reply is somebody's
            // work, and a suggestion arriving on top of it is data loss that
            // looks like a feature.
            setDraft((current) => (current.trim().length > 0 ? `${current.trimEnd()}\n\n${text}` : text));
          }}
        />
      </aside>
    </>
  );
}
