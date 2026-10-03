import { cache, Suspense, type ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError, type Article } from '@itsm/sdk';
import { Button, EmptyState } from '@itsm/ui';
import { AppLink } from '../../../AppLink.js';
import { SectionProblem } from '../../../../home/SectionProblem.js';
import { ArticleEnd } from '../../../../knowledge/ArticleEnd.js';
import { ArticleList } from '../../../../knowledge/Browse.js';
import { NOT_FOUND_METADATA } from '../../../../components/NotFoundScreen.js';
import { mayOpen } from '../../../../navigation.js';
import { apiFor, currentMe, heldPermissions, loginHref, requireSession } from '../../../../server/session.js';
import { categoryHref, dayOf, moreIn, readingTime } from '../categories.js';
import { readShelves, shelfWith, type Shelf } from '../server.js';
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
 *
 * **Existence first** (SPEC §5.5, A4 §5.4). The article is the one read this
 * page waits for before it draws anything, and no `loading.tsx` or
 * `<Suspense>` sits above it, so a missing article calls `notFound()` while
 * nothing has been sent: the browser gets a real 404 and the frame's
 * not-found screen.
 *
 * The category is not on the article, so the category shelves are read
 * beside it, starting at the same moment, and streamed: the breadcrumb's
 * category and "More in" arrive in boundaries of their own, after the
 * article is already on screen. Both are optional — if the shelves fail, or
 * the article is on none of them, they are simply absent — so neither holds
 * a placeholder for something that may never come.
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

  // Never rejects (a shelf that fails is left out), so it can wait unwatched while the article is read.
  const shelves = readShelves(apiFor(session));
  const read = await settleArticle(readArticle(key));

  if (read.kind !== 'ok') {
    if (read.kind === 'missing') notFound();
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
  const shelf = shelves.then((all) => shelfWith(all, article.key));

  return (
    <article className="app-Page app-Page--reading app-Article" aria-labelledby="article-title">
      <nav className="app-Article__crumbs" aria-label="Breadcrumb">
        <ol className="app-Article__crumbList">
          <li>
            <AppLink href="/knowledge">Knowledge</AppLink>
          </li>
          <Suspense fallback={null}>
            <CategoryCrumb shelf={shelf} />
          </Suspense>
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

      <Suspense fallback={null}>
        <MoreIn shelf={shelf} articleKey={article.key} reader={reader} />
      </Suspense>
    </article>
  );
}

/** The breadcrumb's second step, the article's category, once the shelves say which it is. */
async function CategoryCrumb({ shelf }: { readonly shelf: Promise<Shelf | null> }): Promise<ReactNode> {
  const found = await shelf;
  if (!found) return null;
  return (
    <li>
      <AppLink href={categoryHref(found.category)}>{found.category.label}</AppLink>
    </li>
  );
}

/** Up to three more articles from the same category, after the one card at the end. */
async function MoreIn({
  shelf,
  articleKey,
  reader,
}: {
  readonly shelf: Promise<Shelf | null>;
  readonly articleKey: string;
  readonly reader: { readonly locale: string; readonly timeZone: string };
}): Promise<ReactNode> {
  const found = await shelf;
  const more = found ? moreIn(found.articles, articleKey) : [];
  if (!found || more.length === 0) return null;
  return (
    <section className="app-Article__more" aria-labelledby="article-more">
      <h2 id="article-more" className="app-Article__moreTitle">
        More in {found.category.label}
      </h2>
      <ArticleList articles={more} reader={reader} />
    </section>
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
