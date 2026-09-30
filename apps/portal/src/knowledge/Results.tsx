import type { ReactNode } from 'react';
import type { SearchResults } from '@itsm/sdk';
import { EmptyState, Icon } from '@itsm/ui';
import { AppLink } from '../app/AppLink.js';
import { articleHref } from '../client/palette.js';
import { SectionProblem } from '../home/SectionProblem.js';
import type { Settled } from '../home/settle.js';
import { highlight } from './highlight.js';

/**
 * Knowledge search results (SPEC §6.3 `/knowledge?q=`): each article with
 * the passage that matched, the matched words marked — through `highlight()`,
 * so the search's `<b>` markers become `<mark>` and everything else stays
 * text (an article's words never become markup). Each result opens the
 * article by its key.
 *
 * When the answer came from the PostgreSQL fallback, one quiet line says a
 * misspelling may be missed. Nothing found is "Nothing matched" with a way
 * to report it; a failed search says so under the heading, with Retry.
 *
 * Server-safe (no hooks). `report` is the page's report button (a client
 * component), told the words.
 */

/** How many results a search asks for. */
export const RESULT_LIMIT = 20;

export interface ResultsProps {
  readonly query: string;
  readonly read: Settled<SearchResults>;
  readonly report?: ReactNode;
}

export function Results({ query, read, report }: ResultsProps): ReactNode {
  if (!read.ok) return <SectionProblem what="the search results" />;
  // Only articles, whatever else an index might hold.
  const hits = read.value.data.filter((hit) => hit.entityType === 'knowledge');

  if (hits.length === 0) {
    return (
      <EmptyState
        size="md"
        tone="search"
        icon="search"
        headingLevel={2}
        title={`Nothing matched ‘${query}’`}
        description="Try other words, or browse by category. If something isn’t working, tell us."
        action={report}
        secondaryAction={{ id: 'browse', label: 'Browse all articles', href: '/knowledge', variant: 'ghost' }}
      />
    );
  }

  return (
    <section className="app-Knowledge__section" aria-labelledby="knowledge-results">
      <div className="app-Knowledge__head">
        <h2 id="knowledge-results" className="app-Knowledge__sectionTitle">
          Results for ‘{query}’
        </h2>
        <p className="app-Knowledge__count">{hits.length === 1 ? '1 article' : read.value.data.length >= RESULT_LIMIT ? `Showing ${hits.length} · more available` : `${hits.length} articles`}</p>
      </div>
      {read.value.meta.engine !== 'meilisearch' ? (
        <p className="app-Knowledge__quiet">Search is working in a simpler way just now, so it may miss a misspelling. Try the exact words if you don’t see it.</p>
      ) : null}
      <ul className="app-Knowledge__list">
        {hits.map((hit) => (
          <li key={hit.entityId} className="app-Knowledge__item">
            <Icon name="knowledge" size="md" className="app-Knowledge__icon" />
            <div className="app-Knowledge__text">
              <AppLink className="app-Knowledge__link" href={articleHref(hit)}>
                {hit.title}
              </AppLink>
              {hit.snippet ? <p className="app-Knowledge__snippet">{highlight(hit.snippet)}</p> : null}
            </div>
            <Icon name="chevron-right" size="sm" className="app-Knowledge__chevron" directional />
          </li>
        ))}
      </ul>
      {report ? (
        <footer className="app-Knowledge__footer">
          <p className="app-Knowledge__quiet">Not what you were looking for?</p>
          {report}
        </footer>
      ) : null}
    </section>
  );
}
