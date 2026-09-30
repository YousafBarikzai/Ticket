'use client';

import { useTransition, type ReactNode } from 'react';
import { SearchField, useItsm } from '@itsm/ui';
import { queryOf } from './categories.js';

/**
 * The knowledge search (SPEC §6.3, D14): large, `/` focuses it from anywhere
 * on the page, and results follow the words 300 ms after typing pauses (the
 * portal's knowledge pace). The words live in the URL: typing replaces it,
 * so Back is not a trail of half-words; Enter pushes it, so a finished
 * search is a place Back returns to. The field keeps focus and its text
 * while the results redraw beneath it, with a spinner in place of a
 * flash.
 */
export function SearchBox({ query }: { readonly query: string }): ReactNode {
  const { router } = useItsm();
  const [pending, startTransition] = useTransition();

  const go = (value: string, how: 'replace' | 'push'): void => {
    const next = queryOf(value);
    if (next === query) return;
    const href = next ? `/knowledge?q=${encodeURIComponent(next)}` : '/knowledge';
    startTransition(() => {
      if (how === 'push') router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    });
  };

  return (
    <SearchField
      className="app-Knowledge__search"
      label="Search knowledge"
      labelHidden
      size="lg"
      placeholder="Search for an answer…"
      value={query}
      debounceMs={300}
      shortcut="/"
      shortcutEssential
      loading={pending}
      onValueChange={(value) => go(value, 'replace')}
      onSubmit={(value) => go(value, 'push')}
    />
  );
}
