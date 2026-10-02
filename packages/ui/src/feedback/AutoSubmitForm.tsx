'use client';

import { useEffect } from 'react';

export interface AutoSubmitFormProps {
  /** The `id` of the form to submit: `itsm-demo-entry` on the `/demo` pages. */
  readonly formId: string;
}

/**
 * Forms already sent from this document. Module state rather than component
 * state, because "once" must survive what a component cannot see: React
 * running an effect twice in development, the island remounting, a second
 * copy rendered by mistake.
 */
const submitted = new WeakSet<HTMLFormElement>();

interface PrerenderingDocument extends Document {
  /** Speculation Rules: true while the page is being prerendered and not yet shown. */
  readonly prerendering?: boolean;
}

/**
 * Submits a server-rendered form once, by itself, when the person can see the
 * page: the `/demo` entry form that mints a demo session (D22). The page is a
 * plain form that works without JavaScript — a button the person presses —
 * and this island only presses it for them.
 *
 * - **Only when visible.** A tab opened in the background waits until it is
 *   looked at (`visibilitychange`): a session minted for a tab nobody opens is
 *   a session wasted from a shared pool.
 * - **Never while prerendering.** A speculative prerender runs the page's
 *   scripts before anyone navigates to it; minting then would sign a person
 *   in to a demo they only hovered a link to. It waits for
 *   `prerenderingchange`, which fires when the page is actually shown.
 * - **Once.** `requestSubmit()` (validation and `submit` listeners run, as if
 *   the button were pressed), and never again for that form.
 *
 * It renders nothing and announces nothing: the page's own `role="status"`
 * line says what is happening. Client-only, and exported only from the root
 * entry — never from a barrel a layout imports — so it reaches the one route
 * that renders it and no other (≈ 0.4 kB).
 */
export function AutoSubmitForm({ formId }: AutoSubmitFormProps): null {
  useEffect(() => {
    const doc = document as PrerenderingDocument;
    let stopped = false;

    const stop = (): void => {
      stopped = true;
      doc.removeEventListener('visibilitychange', attempt);
      doc.removeEventListener('prerenderingchange', attempt);
      doc.removeEventListener('submit', pressed, true);
    };

    // The person may press the button first (a slow tab, a reader who got
    // there before the effect): their press is the one submission.
    function pressed(event: Event): void {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.id !== formId) return;
      submitted.add(form);
      stop();
    }

    function attempt(): void {
      if (stopped || doc.prerendering === true || doc.visibilityState !== 'visible') return;
      const form = doc.getElementById(formId);
      if (!(form instanceof HTMLFormElement)) return;
      stop();
      if (submitted.has(form)) return;
      submitted.add(form);
      // Older engines lack `requestSubmit`; a plain `submit()` still sends the
      // same fields, only without the validation the hidden inputs never need.
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    }

    doc.addEventListener('visibilitychange', attempt);
    doc.addEventListener('prerenderingchange', attempt);
    doc.addEventListener('submit', pressed, true);
    attempt();
    return stop;
  }, [formId]);

  return null;
}
