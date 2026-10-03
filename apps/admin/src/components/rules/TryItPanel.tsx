'use client';

import { useId, useState, type ReactNode } from 'react';
import { Badge, Button, InlineAlert, SkeletonList, describeProblem, type Problem } from '@itsm/ui';
import type { RuleTestResult } from '@itsm/sdk';
import { CROSS_AREA_DEMO_TEAM_NOTE, crossAreaTicketHref, type AreaModel } from '@itsm/contracts/areas';
import { effectChips, testSummary } from './presentation.js';
import type { RuleNames } from './types.js';

/**
 * "Try it on recent tickets" (SPEC §6.1; A8): the rule as it is on the
 * canvas — saved or not — replayed against the desk's most recent tickets,
 * with nothing written. It says what would change ("Would change 7 of the
 * last 100 tickets"), ticket by ticket with the effects as chips; each
 * number opens the ticket in the Service Desk (same tab) when it is listed.
 * A replay does not say which team has each ticket, so in a demo — where the
 * Service Desk opens only Alex Morgan's teams' tickets (X-B2) — the numbers
 * stay text, and the list says why once. A test that finds
 * nothing is neutral, not an error. A condition the engine could not
 * evaluate is named, and the builder marks the *If* card.
 *
 * The result belongs to the definition it was run on: once the canvas
 * changes, it says so and asks for another run rather than passing off an
 * old answer as the current one.
 */

export type TestState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly result: RuleTestResult; readonly signature: string }
  | { readonly kind: 'invalid'; readonly messages: readonly string[] }
  | { readonly kind: 'failed'; readonly problem: Problem };

export interface TryItPanelProps {
  readonly state: TestState;
  /** The canvas changed since the result was produced. */
  readonly stale: boolean;
  /** Tickets replayed; null is the API's default of 100. */
  readonly sampleSize: number | null;
  /** Client only. */
  readonly onRun: () => void;
  /** "Run test", or "Save draft & test" where the API cannot test an unsaved rule. */
  readonly runLabel: string;
  /** A state gate (offline, a live rule without A8). */
  readonly disabledReason?: string;
  readonly names: RuleNames;
  /** The person's areas (`currentAreas()`): ticket numbers open in the Service Desk when it is listed (A2 §3.7). */
  readonly areas?: AreaModel;
  /** The heading's level: 2 on the page, 3 inside a sheet whose title is the 2. */
  readonly headingLevel?: 2 | 3;
}

const SHOWN = 20;

export function TryItPanel({ state, stale, sampleSize, onRun, runLabel, disabledReason, names, areas, headingLevel = 2 }: TryItPanelProps): ReactNode {
  const [showAll, setShowAll] = useState(false);
  const size = sampleSize ?? 100;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = useId();
  const deskHref = (number: string): string | null => (areas ? crossAreaTicketHref(areas, { number, groupId: null }) : null);
  const demoDesk = areas?.demo === true && areas.areas.some((row) => row.id === 'workbench');

  return (
    <section className="app-TryIt" aria-labelledby={headingId} aria-busy={state.kind === 'running' ? true : undefined}>
      <Heading id={headingId} className="app-TryIt__title">
        Try it on recent tickets
      </Heading>
      <p className="app-TryIt__lede">
        Runs the rule as it is here — saved or not — against the last {size} tickets. Nothing is changed.
      </p>
      <Button variant="secondary" iconStart="play" onClick={onRun} loading={state.kind === 'running'} loadingLabel={`Testing on ${size} tickets…`} {...(disabledReason ? { disabledReason } : {})}>
        {runLabel}
      </Button>

      <div className="app-TryIt__result" aria-live="polite">
        {state.kind === 'running' ? <SkeletonList rows={4} label={`Testing on ${size} tickets…`} /> : null}

        {state.kind === 'invalid' ? (
          <InlineAlert tone="warning">
            The test couldn’t run: {state.messages.join(' ')}
          </InlineAlert>
        ) : null}

        {state.kind === 'failed' ? (
          <InlineAlert tone="danger">
            {describeProblem(state.problem).title}. {describeProblem(state.problem).body}{' '}
            <Button variant="ghost" size="sm" onClick={onRun}>
              Try again
            </Button>
          </InlineAlert>
        ) : null}

        {state.kind === 'done' ? (
          <>
            {stale ? <InlineAlert tone="info">The rule has changed since this test. Run it again to see what your changes do.</InlineAlert> : null}
            <p className="app-TryIt__summary" data-stale={stale ? '' : undefined}>
              {testSummary(state.result)}
            </p>
            {state.result.errors.length > 0 ? (
              <InlineAlert tone="danger">
                The condition couldn’t be checked on some tickets: {state.result.errors.map((error) => error.message).join('; ')}
              </InlineAlert>
            ) : null}
            {state.result.wouldChange.length > 0 ? (
              <ol className="app-TryIt__tickets" aria-label="Tickets it would change">
                {(showAll ? state.result.wouldChange : state.result.wouldChange.slice(0, SHOWN)).map((ticket) => {
                  const href = deskHref(ticket.number);
                  return (
                    <li key={ticket.ticketId} className="app-TryIt__ticket">
                      <span className="app-TryIt__number">{href ? <a href={href}>{ticket.number}</a> : ticket.number}</span>
                      <span className="app-TryIt__ticketTitle">{ticket.title}</span>
                      <span className="app-TryIt__effects">
                        {effectChips(ticket.effects, names).map((chip) => (
                          <Badge key={chip} size="sm" tone="neutral">
                            {chip}
                          </Badge>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {demoDesk && state.result.wouldChange.length > 0 ? <p className="app-TryIt__lede">{CROSS_AREA_DEMO_TEAM_NOTE}</p> : null}
            {!showAll && state.result.wouldChange.length > SHOWN ? (
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                Show all {state.result.wouldChange.length}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
