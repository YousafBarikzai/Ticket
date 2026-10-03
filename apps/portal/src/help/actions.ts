'use server';

import { createElement, type ReactNode } from 'react';
import { currentSession, apiFor } from '../server/session.js';
import { responseDueAt } from './model.js';
import { SentPanel } from './SentPanel.js';
import { readSentRequest, SLA_RETRY_MS, sentPanelModel } from './sent.js';
import { replyByPhrase } from './timing.js';

/**
 * The success panel, drawn on the server (SPEC v3 §7.2, X-M12: "success
 * panels are server-rendered `HeroCard`s").
 *
 * Both flows send from the browser — through the BFF, with their own
 * idempotency keys and, for a report, the offline outbox — so the ticket
 * number is only known there. They hand it to this action, which reads the
 * ticket and its first-response clock **as the signed-in person** and answers
 * with the finished panel. The browser renders markup and ships none of the
 * hero's code: `/catalogue/[key]` has a few hundred bytes to spare, and the
 * panel would cost more than that as client code (§10.3).
 *
 * An action is a POST endpoint anyone holding its id can call, so nothing is
 * taken on trust: the input is checked field by field, the number must read
 * as the caller's own ticket (the API decides what they may see), and the
 * answer says no more than the request page would. Anything that fails —
 * no session, a number they cannot read, the API down — answers `null`, and
 * the flow ends with its own plain words instead: the request is in either
 * way, and that is what must never be lost.
 *
 * The first-response clock starts moments after the ticket (an event the SLA
 * module handles), so a read that finds none waits {@link SLA_RETRY_MS} and
 * asks once more before ending without a promise. A request waiting for
 * approval makes no promise at all: nothing starts until it is approved.
 */
export async function renderSentPanel(input: unknown): Promise<ReactNode> {
  const request = readSentRequest(input);
  if (!request) return null;
  try {
    const session = await currentSession();
    if (!session) return null;
    const api = apiFor(session);
    const [ticket, me] = await Promise.all([api.ticket(request.number), api.me()]);
    const approval = request.kind === 'request' && (request.approval || ticket.status === 'pending_approval');

    let replyBy: string | null = null;
    if (!approval) {
      const dueAt = await firstResponseDue(() => api.slaTimers(ticket.number));
      replyBy = dueAt ? replyByPhrase(dueAt, new Date(), me.locale, me.timeZone, { today: false }) : null;
    }

    const model = sentPanelModel({ number: ticket.number, kind: request.kind, approval, replyBy });
    return createElement(SentPanel, { model, headingLevel: request.headingLevel, id: 'request-sent' });
  } catch {
    return null;
  }
}

/** The response target's due time, asking a second time after a pause when the clock has not started yet. A failed read is no promise, not a failure. */
async function firstResponseDue(read: () => Promise<{ readonly timers: readonly { targetType: string; state: string; dueAt: string | null }[] }>): Promise<string | null> {
  const once = async (): Promise<string | null> => {
    try {
      return responseDueAt((await read()).timers);
    } catch {
      return null;
    }
  };
  const first = await once();
  if (first) return first;
  await new Promise((resolve) => setTimeout(resolve, SLA_RETRY_MS));
  return once();
}
