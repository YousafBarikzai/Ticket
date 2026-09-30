import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import type { CatalogueItem, Page, SearchResults, Ticket } from '@itsm/sdk';
import { Button, EmptyState, Icon, VisuallyHidden } from '@itsm/ui';
import { AppLink } from '../../AppLink.js';
import { serviceIcon } from '../../../catalogue/icons.js';
import { articleHref, knowledgeSearchHref, serviceMatches } from '../../../client/palette.js';
import { RequestRow } from '../../../components/RequestRow.js';
import { SectionProblem } from '../../../home/SectionProblem.js';
import { settle, type Settled } from '../../../home/settle.js';
import { highlight } from '../../../knowledge/highlight.js';
import { mayOpen, portalCan } from '../../../navigation.js';
import { apiFor, currentMe, heldPermissions, requireSession } from '../../../server/session.js';
import { ReportFromSearch } from './ReportFromSearch.js';
import { queryOf, SECTION_LIMIT } from './query.js';
import { SearchBox } from './SearchBox.js';
import './search.css';

export const dynamic = 'force-dynamic';

type Params = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: Params }): Promise<Metadata> {
  const query = queryOf((await searchParams).q);
  return { title: query ? `Results for ‘${query}’` : 'Search' };
}

/**
 * `/search?q=` — every result for what somebody typed on Home and pressed
 * Enter on (SPEC §6.3, §5.4): help articles, services, and their own
 * requests, each with "See all" on the page made for that kind, and always
 * "Report 'vpn' as an issue" at the end — a search is never a dead end.
 *
 * The three reads start together and each fails on its own. Snippets are
 * highlighted without ever becoming HTML (`highlight()`): the search's
 * `<b>` markers become `<mark>`, everything else stays text.
 */
export default async function SearchPage({ searchParams }: { searchParams: Params }): Promise<ReactNode> {
  const session = await requireSession();
  const me = await currentMe();
  const held = heldPermissions(me);
  const query = queryOf((await searchParams).q);

  if (!mayOpen('/search', held)) {
    return (
      <div className="app-Page app-Results">
        <h1 className="app-Results__title" tabIndex={-1}>
          Search
        </h1>
        <EmptyState
          tone="forbidden"
          icon="lock"
          headingLevel={2}
          title="Search isn’t available to you"
          description="Your account can’t search here. You can still find your requests under My requests."
          action={{ id: 'requests', label: 'My requests', href: '/tickets' }}
        />
      </div>
    );
  }

  if (!query) {
    return (
      <div className="app-Page app-Results">
        <header className="app-Results__header">
          <h1 className="app-Results__title" tabIndex={-1}>
            Search
          </h1>
          <SearchBox query="" />
        </header>
        <p className="app-Results__quiet">Search help articles, services and your own requests. Describe the problem in a few words.</p>
      </div>
    );
  }

  const can = portalCan(held);
  const api = apiFor(session);
  const [answers, services, requests] = await Promise.all([
    can.readKnowledge ? settle(api.search(query, { types: 'knowledge', limit: SECTION_LIMIT })) : Promise.resolve(null),
    can.readCatalogue ? settle(api.catalogue()) : Promise.resolve(null),
    settle(api.myTickets({ q: query, limit: SECTION_LIMIT })),
  ]);

  const found = {
    answers: answers?.ok ? answers.value.data : [],
    services: services?.ok ? services.value.data.filter((item) => serviceMatches(item, query)) : [],
    requests: requests.ok ? requests.value.data : [],
  };
  const failed = [answers, services, requests].some((read) => read !== null && !read.ok);
  const nothing = found.answers.length + found.services.length + found.requests.length === 0;

  return (
    <div className="app-Page app-Results">
      <header className="app-Results__header">
        <h1 className="app-Results__title" tabIndex={-1}>
          Results for ‘{query}’
        </h1>
        <SearchBox query={query} />
      </header>

      {nothing && !failed ? (
        <EmptyState
          tone="search"
          icon="search"
          headingLevel={2}
          title={`Nothing matched ‘${query}’`}
          description="Try other words, or tell us about it and we’ll pick it up."
          action={<ReportFromSearch query={query} variant="tinted" />}
        />
      ) : (
        <>
          {answers ? <Answers read={answers} query={query} /> : null}
          {services ? <Services read={services} items={found.services} query={query} /> : null}
          <Requests read={requests} query={query} />
          <footer className="app-Results__footer">
            <p className="app-Results__quiet">Not what you were looking for?</p>
            <ReportFromSearch query={query} />
          </footer>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Sections */

function SectionHead({ id, title, seeAll }: { readonly id: string; readonly title: string; readonly seeAll?: string }): ReactNode {
  return (
    <div className="app-Results__head">
      <h2 id={id} className="app-Results__sectionTitle">
        {title}
      </h2>
      {seeAll ? (
        <Button variant="ghost" size="sm" href={seeAll} iconEnd="chevron-right">
          See all<VisuallyHidden> {title.toLocaleLowerCase('en-GB')}</VisuallyHidden>
        </Button>
      ) : null}
    </div>
  );
}

function Answers({ read, query }: { readonly read: Settled<SearchResults>; readonly query: string }): ReactNode {
  const hits = read.ok ? read.value.data : [];
  return (
    <section className="app-Results__section" aria-labelledby="results-answers">
      <SectionHead id="results-answers" title="Answers" {...(hits.length > 0 ? { seeAll: knowledgeSearchHref(query) } : {})} />
      {!read.ok ? (
        <SectionProblem what="answers" />
      ) : hits.length === 0 ? (
        <p className="app-Results__quiet">No help articles matched.</p>
      ) : (
        <>
          {read.value.meta.engine === 'postgres' ? (
            <p className="app-Results__quiet">Search is working in a simpler way just now, so it may miss a misspelling. Try other words if you don’t see it.</p>
          ) : null}
          <ul className="app-Results__list">
            {hits.map((hit) => (
              <li key={hit.entityId} className="app-Results__item">
                <Icon name="knowledge" size="md" className="app-Results__icon" />
                <div className="app-Results__text">
                  <AppLink className="app-Results__link" href={articleHref(hit)}>
                    {hit.title}
                  </AppLink>
                  {hit.snippet ? <p className="app-Results__snippet">{highlight(hit.snippet)}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Services({ read, items, query }: { readonly read: Settled<{ data: CatalogueItem[] }>; readonly items: readonly CatalogueItem[]; readonly query: string }): ReactNode {
  const shown = items.slice(0, SECTION_LIMIT);
  return (
    <section className="app-Results__section" aria-labelledby="results-services">
      <SectionHead id="results-services" title="Services" {...(items.length > 0 ? { seeAll: `/catalogue?q=${encodeURIComponent(query)}` } : {})} />
      {!read.ok ? (
        <SectionProblem what="services" />
      ) : shown.length === 0 ? (
        <p className="app-Results__quiet">No services matched.</p>
      ) : (
        <ul className="app-Results__list">
          {shown.map((item) => (
            <li key={item.key} className="app-Results__item">
              <Icon name={serviceIcon(item.service, item.name, item.shortSummary)} size="md" className="app-Results__icon" />
              <div className="app-Results__text">
                <AppLink className="app-Results__link" href={`/catalogue/${encodeURIComponent(item.key)}`}>
                  {item.name}
                </AppLink>
                {item.shortSummary || item.service ? <p className="app-Results__snippet">{item.shortSummary ?? item.service}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Requests({ read, query }: { readonly read: Settled<Page<Ticket>>; readonly query: string }): ReactNode {
  const tickets = read.ok ? read.value.data : [];
  return (
    <section className="app-Results__section" aria-labelledby="results-requests">
      <SectionHead id="results-requests" title="Your requests" {...(tickets.length > 0 ? { seeAll: `/tickets?show=all&q=${encodeURIComponent(query)}` } : {})} />
      {!read.ok ? (
        <SectionProblem what="your requests" />
      ) : tickets.length === 0 ? (
        <p className="app-Results__quiet">None of your requests matched.</p>
      ) : (
        <ul className="app-RequestList">
          {tickets.map((ticket) => (
            <RequestRow
              key={ticket.id}
              ticket={{ number: ticket.number, type: ticket.type, title: ticket.title, status: ticket.status, updatedAt: ticket.updatedAt }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
