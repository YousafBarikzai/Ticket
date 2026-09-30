'use client';

import type { ReactNode } from 'react';
import { SearchField, useItsm } from '@itsm/ui';

/**
 * The results page's own field (SPEC §6.3 `/search`): the words that were
 * searched, ready to change. Enter searches again (a new URL, so Back
 * returns to the previous results); clearing it does nothing until Enter.
 */
export function SearchBox({ query }: { readonly query: string }): ReactNode {
  const { router } = useItsm();
  return (
    <SearchField
      className="app-Results__field"
      label="Search for an answer, a service or one of your requests"
      labelHidden
      size="lg"
      value={query}
      placeholder="Describe the problem or search…"
      onValueChange={() => undefined}
      onSubmit={(value) => {
        const next = value.trim().slice(0, 200);
        if (next && next !== query) router.push(`/search?q=${encodeURIComponent(next)}`);
      }}
    />
  );
}
