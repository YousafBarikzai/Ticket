import type { ReactNode } from 'react';
import type { ArticleSummary } from '@itsm/sdk';
import { EmptyState, Icon } from '@itsm/ui';
import { AppLink } from '../app/AppLink.js';
import { articleHrefFor, CATEGORIES, categoryHref, dayOf, popularOf, publishedOf, recentOf, shelfOf, type KnowledgeCategory } from '../app/(portal)/knowledge/categories.js';
import { SectionProblem } from '../home/SectionProblem.js';
import type { Settled } from '../home/settle.js';

/**
 * Knowledge, browsed (SPEC §6.3 `/knowledge`): the categories as links, then
 * — with no category chosen — the most read and the newest articles from one
 * list of everything published; with one chosen, all of that category's
 * articles, most read first. "Newest" is by publication date: the list's
 * `updatedAt` moves on every view, so it cannot say what was updated
 * (`publishedOf`).
 *
 * Server-safe (no hooks): the pages render it on the server, and it ships no
 * JavaScript of its own. `report` is the page's "Report an issue" (a client
 * button, since it opens the frame's flow), shown when there is nothing to
 * read.
 */

export interface Reader {
  readonly locale: string;
  readonly timeZone: string;
}

export interface BrowseProps {
  readonly category: KnowledgeCategory | null;
  /** Everything published, or the chosen category's articles. */
  readonly read: Settled<readonly ArticleSummary[]>;
  readonly reader: Reader;
  readonly report?: ReactNode;
}

export function Browse({ category, read, reader, report }: BrowseProps): ReactNode {
  return (
    <div className="app-Knowledge__browse">
      <CategoryNav current={category} />
      {!read.ok ? (
        <SectionProblem what="the articles" />
      ) : category ? (
        <CategoryShelf category={category} articles={read.value} reader={reader} />
      ) : read.value.length === 0 ? (
        <EmptyState
          size="md"
          icon="knowledge"
          headingLevel={2}
          title="No articles yet"
          description="Search still covers anything published later. If something isn’t working, tell us."
          action={report}
        />
      ) : (
        <Overview articles={read.value} reader={reader} />
      )}
    </div>
  );
}

/** All · How-to · Troubleshooting · Policies, as links; the one being shown is the current page. */
function CategoryNav({ current }: { readonly current: KnowledgeCategory | null }): ReactNode {
  const links = [{ key: '', label: 'All', href: '/knowledge' }, ...CATEGORIES.map((category) => ({ key: category.key, label: category.label, href: categoryHref(category) }))];
  return (
    <nav className="app-Knowledge__categories" aria-label="Categories">
      <ul className="app-Knowledge__chipList">
        {links.map((link) => (
          <li key={link.key || 'all'}>
            <AppLink className="app-Knowledge__chip" href={link.href} aria-current={(current?.key ?? '') === link.key ? 'page' : undefined}>
              {link.label}
            </AppLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Overview({ articles, reader }: { readonly articles: readonly ArticleSummary[]; readonly reader: Reader }): ReactNode {
  const popular = popularOf(articles);
  return (
    <div className="app-Knowledge__overview">
      {popular.length > 0 ? (
        <section className="app-Knowledge__section" aria-labelledby="knowledge-popular">
          <h2 id="knowledge-popular" className="app-Knowledge__sectionTitle">
            Popular
          </h2>
          <ArticleList articles={popular} reader={reader} />
        </section>
      ) : null}
      <section className="app-Knowledge__section" aria-labelledby="knowledge-recent">
        <h2 id="knowledge-recent" className="app-Knowledge__sectionTitle">
          Recently added
        </h2>
        <ArticleList articles={recentOf(articles)} reader={reader} />
      </section>
    </div>
  );
}

function CategoryShelf({ category, articles, reader }: { readonly category: KnowledgeCategory; readonly articles: readonly ArticleSummary[]; readonly reader: Reader }): ReactNode {
  return (
    <section className="app-Knowledge__section" aria-labelledby="knowledge-shelf">
      <div className="app-Knowledge__head">
        <h2 id="knowledge-shelf" className="app-Knowledge__sectionTitle">
          {category.label}
        </h2>
        {articles.length > 0 ? <p className="app-Knowledge__count">{articles.length === 1 ? '1 article' : `${articles.length} articles`}</p> : null}
      </div>
      {articles.length === 0 ? (
        <EmptyState
          size="sm"
          icon="knowledge"
          headingLevel={3}
          title={`Nothing in ${category.label} yet`}
          description="Try another category, or search for what you need."
          action={{ id: 'all', label: 'Browse all articles', href: '/knowledge', variant: 'secondary' }}
        />
      ) : (
        <ArticleList articles={shelfOf(articles)} reader={reader} />
      )}
    </section>
  );
}

/**
 * Articles as rows: the title is the one link and its hit area covers the
 * row; when it was published underneath. Shared with the article's
 * "More in …".
 */
export function ArticleList({ articles, reader, now }: { readonly articles: readonly ArticleSummary[]; readonly reader: Reader; readonly now?: Date }): ReactNode {
  return (
    <ul className="app-Knowledge__list">
      {articles.map((article) => (
        <li key={article.key} className="app-Knowledge__item">
          <Icon name="knowledge" size="md" className="app-Knowledge__icon" />
          <div className="app-Knowledge__text">
            <AppLink className="app-Knowledge__link" href={articleHrefFor(article.key)}>
              {article.title}
            </AppLink>
            <p className="app-Knowledge__meta">Published {dayOf(publishedOf(article), reader, now)}</p>
          </div>
          <Icon name="chevron-right" size="sm" className="app-Knowledge__chevron" directional />
        </li>
      ))}
    </ul>
  );
}
