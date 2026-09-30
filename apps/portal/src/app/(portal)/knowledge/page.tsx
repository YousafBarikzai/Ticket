import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { EmptyState } from '@itsm/ui';
import { settle } from '../../../home/settle.js';
import { Browse } from '../../../knowledge/Browse.js';
import { Results, RESULT_LIMIT } from '../../../knowledge/Results.js';
import { mayOpen, portalCan } from '../../../navigation.js';
import { apiFor, currentMe, heldPermissions, requireSession } from '../../../server/session.js';
import { categoryFor, queryOf } from './categories.js';
import { ReportButton } from './ReportButton.js';
import { SearchBox } from './SearchBox.js';
import { readArticles } from './server.js';
import './knowledge.css';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const params = await searchParams;
  const query = queryOf(params.q);
  if (query) return { title: `Results for ‘${query}’ · Knowledge` };
  const category = categoryFor(params.category);
  return { title: category ? `${category.label} · Knowledge` : 'Knowledge' };
}

/**
 * `/knowledge` — answers written by the service desk (SPEC §6.3, §5.4).
 *
 * Browsing: the categories, then what is most read and most recently
 * updated, or one category's shelf. Searching (`?q=`): the knowledge index
 * only — `types: 'knowledge'`, the index's real name; `article` matched
 * nothing and every search here once came back empty (F2) — with the
 * matched words marked safely.
 *
 * The heading and the field stay whatever happens below them, so a search
 * that fails, finds nothing, or is still loading never takes the page's
 * shape with it.
 */
export default async function KnowledgePage({ searchParams }: { searchParams: SearchParams }): Promise<ReactNode> {
  const session = await requireSession();
  const me = await currentMe();
  const held = heldPermissions(me);
  const params = await searchParams;

  if (!mayOpen('/knowledge', held)) {
    return (
      <div className="app-Page app-Knowledge">
        <header className="app-Knowledge__header">
          <h1 className="app-Knowledge__title" tabIndex={-1}>
            Knowledge
          </h1>
        </header>
        <EmptyState
          tone="forbidden"
          icon="lock"
          headingLevel={2}
          title="Knowledge isn’t available to you"
          description="Your account can’t read help articles here. You can still report an issue or follow your requests."
          action={{ id: 'requests', label: 'My requests', href: '/tickets' }}
        />
      </div>
    );
  }

  const can = portalCan(held);
  const query = can.search ? queryOf(params.q) : '';
  const category = categoryFor(params.category);
  const api = apiFor(session);
  const reader = { locale: me.locale, timeZone: me.timeZone };

  return (
    <div className="app-Page app-Knowledge">
      <header className="app-Knowledge__header">
        <h1 className="app-Knowledge__title" tabIndex={-1}>
          Knowledge
        </h1>
        <p className="app-Knowledge__lede">Answers to common questions, from your service desk.</p>
        {can.search ? <SearchBox query={query} /> : null}
      </header>

      {query ? (
        <Results
          query={query}
          read={await settle(api.search(query, { types: 'knowledge', limit: RESULT_LIMIT }))}
          {...(can.createTickets
            ? {
                report: (
                  <ReportButton text={query} variant="tinted">
                    Report ‘{query}’ as an issue
                  </ReportButton>
                ),
              }
            : {})}
        />
      ) : (
        <Browse
          category={category}
          read={await readArticles(api, category)}
          reader={reader}
          {...(can.createTickets ? { report: <ReportButton variant="tinted">Report an issue</ReportButton> } : {})}
        />
      )}
    </div>
  );
}
