import { cache, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError, type Article } from '@itsm/sdk';
import { Button, EmptyState } from '@itsm/ui';
import { AppLink } from '../../../AppLink.js';
import { SectionProblem } from '../../../../home/SectionProblem.js';
import { ArticleEnd } from '../../../../knowledge/ArticleEnd.js';
import { ArticleList } from '../../../../knowledge/Browse.js';
import { NOT_FOUND_METADATA, NotFoundScreen } from '../../../../components/NotFoundScreen.js';
import { mayOpen } from '../../../../navigation.js';
import { apiFor, currentMe, heldPermissions, loginHref, requireSession } from '../../../../server/session.js';
import { categoryHref, dayOf, moreIn, readingTime } from '../categories.js';
import { readShelves, shelfWith } from '../server.js';
import { ArticleBody } from './ArticleBody.js';
import '../knowledge.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ key: string }>;

/** One read of the article per request, shared by the page and its `<title>` (each read counts a view). */
const readArticle = cache(async (key: string): Promise<Article> => apiFor(await requireSession()).article(key));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { key } = await params;
  try {
    return { title: (await readArticle(key)).title };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return NOT_FOUND_METADATA;
    return { title: 'Knowledge' };
  }
}

/**
 * `/knowledge/[key]` — one article, to read (SPEC §6.3): where it sits
 * (Knowledge › How-to), its title and summary, when it was published and how
 * long it takes, the body in article typography, then one card — "Did this
 * solve it?" — and up to three more from the same category. No table of
 * contents: these are short.
 *
 * Audience is enforced by MOD-09, which answers 404 for an article this reader
 * may not see — the same answer as one that does not exist, deliberately.
 * The category is not on the article, so the category shelves are read
 * beside it; if they fail, the breadcrumb and "More in" are simply absent.
 */
export default async function ArticlePage({ params }: { params: Params }): Promise<ReactNode> {
  const { key } = await params;
  const session = await requireSession();
  const me = await currentMe();

  if (!mayOpen('/knowledge/[key]', heldPermissions(me))) {
    return (
      <div className="app-Page app-Page--reading app-Article">
        <BackToKnowledge />
        <h1 className="app-Article__title" tabIndex={-1}>
          Knowledge
        </h1>
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

  const [read, shelves] = await Promise.all([settleArticle(readArticle(key)), readShelves(apiFor(session))]);

  if (read.kind !== 'ok') {
    // Returned, not thrown: the response is already streaming (see NotFoundScreen).
    if (read.kind === 'missing') return <NotFoundScreen />;
    if (read.kind === 'signed-out') redirect(await loginHref());
    return (
      <div className="app-Page app-Page--reading app-Article">
        <BackToKnowledge />
        <h1 className="app-Article__title" tabIndex={-1}>
          Knowledge
        </h1>
        <SectionProblem what="this article" />
      </div>
    );
  }

  const article = read.value;
  const reader = { locale: me.locale, timeZone: me.timeZone };
  const shelf = shelfWith(shelves, article.key);
  const more = shelf ? moreIn(shelf.articles, article.key) : [];

  return (
    <article className="app-Page app-Page--reading app-Article" aria-labelledby="article-title">
      <nav className="app-Article__crumbs" aria-label="Breadcrumb">
        <ol className="app-Article__crumbList">
          <li>
            <AppLink href="/knowledge">Knowledge</AppLink>
          </li>
          {shelf ? (
            <li>
              <AppLink href={categoryHref(shelf.category)}>{shelf.category.label}</AppLink>
            </li>
          ) : null}
        </ol>
      </nav>

      <header className="app-Article__header">
        <h1 id="article-title" className="app-Article__title" tabIndex={-1}>
          {article.title}
        </h1>
        {article.summary ? <p className="app-Article__lede">{article.summary}</p> : null}
        <p className="app-Article__meta">
          {[article.publishedAt ? `Published ${dayOf(article.publishedAt, reader)}` : null, readingTime(article.body)].filter(Boolean).join(' · ')}
        </p>
      </header>

      <ArticleBody body={article.body} />

      <ArticleEnd articleKey={article.key} title={article.title} />

      {shelf && more.length > 0 ? (
        <section className="app-Article__more" aria-labelledby="article-more">
          <h2 id="article-more" className="app-Article__moreTitle">
            More in {shelf.category.label}
          </h2>
          <ArticleList articles={more} reader={reader} />
        </section>
      ) : null}
    </article>
  );
}

type ArticleRead = { readonly kind: 'ok'; readonly value: Article } | { readonly kind: 'missing' | 'signed-out' | 'failed' };

async function settleArticle(read: Promise<Article>): Promise<ArticleRead> {
  try {
    return { kind: 'ok', value: await read };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'missing' };
    if (error instanceof ApiError && error.status === 401) return { kind: 'signed-out' };
    return { kind: 'failed' };
  }
}

function BackToKnowledge(): ReactNode {
  return (
    <Button variant="ghost" size="sm" iconStart="chevron-left" href="/knowledge" className="app-Article__back">
      Knowledge
    </Button>
  );
}
