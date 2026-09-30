'use client';

import { useEffect, useRef, useState } from 'react';
import type { CatalogueItem, SearchHit, Ticket } from '@itsm/sdk';
import { api } from '../client/api.js';
import { serviceMatches } from '../client/palette.js';
import type { HelpCan } from './model.js';

/**
 * What might already answer somebody while they describe their problem
 * (SPEC §6.3, MOD-02-E1-S1): help articles, the services they could ask
 * for, and requests of their own that sound the same — the Home search panel
 * and step 1 of "How can we help?" both ask this.
 *
 * Typing pauses for 300 ms before anything is asked (§4.10: 300 for the
 * portal's knowledge suggestions), and an answer that arrives after the
 * person has typed on is dropped rather than shown against the wrong words.
 * A group that fails is empty, not an error: suggestions are a courtesy, and
 * the way forward — "Continue — report this as an issue" — never depends on
 * them.
 */

/** How long typing must pause before anything is asked. */
export const SUGGEST_DELAY_MS = 300;

/** Fewer characters than this ask nothing: two letters match everything. */
export const MIN_QUERY = 2;

export interface SuggestionLimits {
  readonly answers: number;
  readonly services: number;
  readonly requests: number;
}

export const DEFAULT_LIMITS: SuggestionLimits = { answers: 4, services: 3, requests: 3 };

export interface Suggestions {
  /** The words these results are for (trimmed); empty until the first pause. */
  readonly query: string;
  readonly answers: readonly SearchHit[];
  readonly services: readonly CatalogueItem[];
  readonly requests: readonly Ticket[];
  /** Asking now: the text has changed and the answers are not back. */
  readonly loading: boolean;
  /** A group could not be asked (offline, say): said quietly, once. */
  readonly incomplete: boolean;
}

const NOTHING: Omit<Suggestions, 'query' | 'loading'> = { answers: [], services: [], requests: [], incomplete: false };

/**
 * The catalogue, once per tab: short, entitlement-filtered and not indexed by
 * search, so it is filtered here. A failed fetch is asked again next time.
 */
let catalogue: Promise<readonly CatalogueItem[]> | null = null;

export function catalogueOnce(): Promise<readonly CatalogueItem[]> {
  catalogue ??= api
    .catalogue()
    .then((page) => page.data)
    .catch((error: unknown) => {
      catalogue = null;
      throw error;
    });
  return catalogue;
}

/** For the tests: forget the tab's copy of the catalogue. */
export function forgetCatalogue(): void {
  catalogue = null;
}

async function ask(query: string, can: HelpCan, limits: SuggestionLimits): Promise<Omit<Suggestions, 'query' | 'loading'>> {
  const [answers, services, requests] = await Promise.allSettled([
    can.search && can.readKnowledge && limits.answers > 0 ? api.search(query, { types: 'knowledge', limit: limits.answers }).then((results) => results.data) : Promise.resolve([]),
    can.readCatalogue && limits.services > 0
      ? catalogueOnce().then((items) => items.filter((item) => serviceMatches(item, query)).slice(0, limits.services))
      : Promise.resolve([]),
    limits.requests > 0 ? api.myTickets({ q: query, limit: limits.requests }).then((page) => page.data) : Promise.resolve([]),
  ]);
  const value = <T,>(result: PromiseSettledResult<readonly T[]>): readonly T[] => (result.status === 'fulfilled' ? result.value : []);
  return {
    answers: value(answers).slice(0, limits.answers),
    services: value(services),
    requests: value(requests).slice(0, limits.requests),
    incomplete: [answers, services, requests].some((result) => result.status === 'rejected'),
  };
}

/**
 * Suggestions for `text`, asked 300 ms after it stops changing. Fewer than
 * two characters clears them at once. `enabled: false` stops asking (a flow
 * that has moved on to its details step).
 */
export function useSuggestions(
  text: string,
  can: HelpCan,
  { limits = DEFAULT_LIMITS, enabled = true }: { readonly limits?: SuggestionLimits; readonly enabled?: boolean } = {},
): Suggestions {
  const trimmed = text.trim();
  const [result, setResult] = useState<Omit<Suggestions, 'loading'>>({ query: '', ...NOTHING });
  const [pending, setPending] = useState(false);
  const latest = useRef({ can, limits });
  latest.current = { can, limits };
  const asked = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const turn = ++asked.current;
    if (trimmed.length < MIN_QUERY) {
      setPending(false);
      setResult({ query: '', ...NOTHING });
      return;
    }
    setPending(true);
    const timer = setTimeout(() => {
      void ask(trimmed, latest.current.can, latest.current.limits).then((found) => {
        // Typed on while this was out: the next answer is the one to show.
        if (turn !== asked.current) return;
        setResult({ query: trimmed, ...found });
        setPending(false);
      });
    }, SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [trimmed, enabled]);

  return { ...result, loading: enabled && pending };
}

/** Whether there is anything at all to show. */
export function hasSuggestions(found: Pick<Suggestions, 'answers' | 'services' | 'requests'>): boolean {
  return found.answers.length > 0 || found.services.length > 0 || found.requests.length > 0;
}
