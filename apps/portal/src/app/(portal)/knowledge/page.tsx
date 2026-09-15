import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { EmptyState } from '@itsm/ui';
import { KnowledgeSearch } from '../../../components/KnowledgeSearch.js';
import { apiFor, requireSession } from '../../../server/session.js';

export const metadata: Metadata = { title: 'Help articles' };
export const dynamic = 'force-dynamic';

/**
 * Searching the knowledge base.
 *
 * A server-rendered search: the query is in the URL, so a result page can be
 * linked to somebody and the back button works. The box is a client component
 * only so it can submit without a full reload.
 *
 * `engine` is surfaced when the answer came from the fallback. When
 * Meilisearch is down the PostgreSQL projection answers — correct, but with no
 * typo tolerance — and somebody who typed "pasword" and got nothing deserves
 * to know that is why, rather than concluding the article does not exist.
 */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const q = (typeof params.q === 'string' ? params.q : '').slice(0, 200).trim();
  const session = await requireSession();

  if (!q) {
    return (
      <div className="itsm-Page">
        <h1 className="itsm-Page__heading">Help articles</h1>
        <p className="itsm-Page__lede">Search for how to do something, or for an error you have seen.</p>
        <KnowledgeSearch />
      </div>
    );
  }

  try {
    const results = await apiFor(session).search(q, { types: 'article', limit: 20 });
    return (
      <div className="itsm-Page">
        <h1 className="itsm-Page__heading">Help articles</h1>
        <KnowledgeSearch initial={q} />

        {results.meta.engine !== 'meilisearch' ? (
          <p className="itsm-Search__degraded" role="status">
            Search is running in a reduced mode, so a typo will not find anything. Try the exact words.
          </p>
        ) : null}

        {results.data.length === 0 ? (
          <EmptyState
            tone="search"
            title={`Nothing matched “${q}”`}
            description="Try fewer words, or report an issue and somebody will help."
            action={<Link href="/report">Report an issue</Link>}
          />
        ) : (
          <ul className="itsm-Search__results">
            {results.data.map((hit) => (
              <li key={`${hit.entityType}:${hit.entityId}`}>
                <Link href={`/knowledge/${encodeURIComponent(String(hit.facets.key ?? hit.entityId))}`}>{hit.title}</Link>
                <p className="itsm-Search__snippet">{hit.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="Search is not available"
        description={error instanceof ApiError ? error.message : 'The service could not be reached.'}
      />
    );
  }
}
