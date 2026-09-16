'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, FormField, Input } from '@itsm/ui';

/**
 * The search box.
 *
 * A form that navigates, rather than a box that fetches. The results are
 * rendered on the server, so the URL is the state: a search can be shared, the
 * back button retraces it, and a reload returns the same page. Fetching in the
 * browser would be quicker to type into and would lose all three.
 */
export function KnowledgeSearch({ initial = '' }: { readonly initial?: string }): ReactNode {
  const router = useRouter();
  const [query, setQuery] = useState(initial);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = query.trim();
    router.push(trimmed ? `/knowledge?q=${encodeURIComponent(trimmed)}` : '/knowledge');
  }

  return (
    <form className="itsm-Search" onSubmit={submit} role="search">
      <FormField label="Search help articles" labelHidden>
        {(control) => (
          <Input
            {...control}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="How do I…"
            maxLength={200}
          />
        )}
      </FormField>
      <Button type="submit" variant="primary">
        Search
      </Button>
    </form>
  );
}
