import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { asRichBlocks, RichText } from '@itsm/ui';
import { ArticleFeedback } from '../../../../components/ArticleFeedback.js';
import { apiFor, requireSession } from '../../../../server/session.js';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  return { title: (await params).key };
}

/**
 * One article.
 *
 * The body renders through `RichText`, which walks a closed set of node types
 * and never touches `dangerouslySetInnerHTML`. Articles are authored inside
 * the tenant by people who are trusted, and that is still not a security
 * model: a stored document is data that reached us over the wire, and one
 * compromised author account would otherwise be stored cross-site scripting
 * for everybody in the organisation.
 *
 * Audience is enforced by MOD-09, which answers 404 for an article this reader
 * may not see — the same answer as one that does not exist, deliberately.
 */
export default async function ArticlePage({ params }: { params: Promise<{ key: string }> }): Promise<ReactNode> {
  const { key } = await params;
  const session = await requireSession();

  try {
    const article = await apiFor(session).article(key);
    return (
      <article className="itsm-Page itsm-Article">
        <h1 className="itsm-Page__heading">{article.title}</h1>
        {article.summary ? <p className="itsm-Page__lede">{article.summary}</p> : null}

        <RichText content={asRichBlocks(article.body)} />

        <ArticleFeedback articleKey={article.key} />

        <p className="itsm-Article__escape">
          Did this not help? <Link href="/report">Report an issue</Link> and somebody will pick it up.
        </p>
      </article>
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
