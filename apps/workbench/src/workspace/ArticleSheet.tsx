'use client';

import { useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Article } from '@itsm/sdk';
import { Button, EmptyState, InlineAlert, Prose, RichText, SkeletonText, asRichBlocks, notify, useItsm } from '@itsm/ui';
import { formatDateTime } from '@itsm/ui/format';
import { Sheet } from '@itsm/ui/overlays';
import { ARTICLE_KIND, OPEN_PARAM, articleKeyOf, articleHref } from '../ai/render.js';
import { api } from '../client/api.js';
import { problemOf } from '../inbox/presentation.js';
import './assist/assist.css';
import { useTicketWorkspace } from './TicketWorkspace.js';

/**
 * The read-only article sheet (SPEC §6.2, §4.10): a knowledge article opened
 * over the ticket from Assist — its evidence, its suggested articles — at
 * `?open=article:<key>`, so Back closes it and the link can be shared.
 *
 * It reads `GET /knowledge/:key` and renders the body through `RichText`
 * (structured blocks, never HTML). Inside a ticket it offers "Insert into
 * reply": the article's title goes into the reply for the requester to find
 * in the help portal, and the ticket is recorded as having used it (`POST
 * /knowledge/:key/link`, relation `referenced`). Writing articles is out of
 * scope here; this only reads them.
 */

/** Articles this tab opened itself, by URL — so closing knows whether Back leads somewhere sensible. */
const openedHere = new Set<string>();

function here(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Opens the sheet on `key` over the current page (a history entry, so Back closes it). */
export function openArticle(key: string): void {
  const href = articleHref(key, { pathname: window.location.pathname, search: window.location.search.replace(/^\?/, '') });
  if (here() === href) return;
  // One article at a time: moving from one to the next does not pile up history.
  if (articleKeyOf(here())) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  openedHere.add(href);
}

/** Closes it: Back when this tab opened it, otherwise the same page without it (a pasted link does not strand anyone). */
export function closeArticle(): void {
  const current = here();
  if (openedHere.has(current)) {
    openedHere.delete(current);
    window.history.back();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete(OPEN_PARAM);
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

/** The article the URL has open, or `null`. */
export function useOpenArticle(): string | null {
  const { useSearchParams } = useItsm();
  const value = useSearchParams().get(OPEN_PARAM);
  return value?.startsWith(`${ARTICLE_KIND}:`) ? value.slice(ARTICLE_KIND.length + 1) || null : null;
}

export const articleKey = (key: string) => ['article', key] as const;

/** What goes into the reply for an article: its title, for the requester to find in the help portal. */
export function articleInsertText(article: Pick<Article, 'title' | 'key'>, internal: boolean): string {
  return internal ? `Article: “${article.title}” (${article.key})` : `This article in the help portal should help: “${article.title}”.`;
}

export function ArticleSheet(): ReactNode {
  const key = useOpenArticle();
  const ws = useTicketWorkspace();
  const { locale, timeZone } = useItsm();
  const query = useQuery({
    queryKey: articleKey(key ?? ''),
    queryFn: () => api.article(key!),
    enabled: key !== null,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const article = key !== null ? query.data : undefined;
  const problem = query.error ? problemOf(query.error) : null;

  const can = ws?.bundle.viewer.can;
  const published = article?.status === 'published';
  const mode: 'reply' | 'note' | null = !ws || !can ? null : can.reply && published ? 'reply' : can.note ? 'note' : null;

  const insert = useCallback(() => {
    if (!ws || !article || !mode) return;
    ws.insertIntoReply(articleInsertText(article, mode === 'note'), { mode });
    // A record that the ticket used it: what "articles that resolve tickets" is counted from.
    void api.linkArticle(article.key, ws.bundle.ticket.id, 'referenced').catch(() => undefined);
    closeArticle();
    notify(mode === 'note' ? 'Article added to your note' : 'Article added to your reply', { tone: 'success' });
  }, [ws, article, mode]);

  const meta: string[] = [];
  if (article?.publishedAt) meta.push(`Published ${formatDateTime(article.publishedAt, { locale, timeZone, style: 'date' })}`);
  if (article && article.helpfulCount > 0) meta.push(`${article.helpfulCount} ${article.helpfulCount === 1 ? 'person' : 'people'} found it helpful`);

  let body: ReactNode;
  if (!article && !problem) {
    body = (
      <div className="app-Article__loading" aria-busy="true">
        <SkeletonText lines={2} />
        <SkeletonText lines={6} />
      </div>
    );
  } else if (problem && (problem.status === 404 || problem.status === 403)) {
    body = (
      <EmptyState
        size="sm"
        icon="knowledge"
        tone="search"
        headingLevel={3}
        title={problem.status === 404 ? 'That article no longer exists' : 'You can’t read this article'}
        description={problem.status === 404 ? 'It may have been retired since it was suggested.' : 'It’s kept for another audience.'}
        action={
          <Button variant="secondary" onClick={closeArticle}>
            Close
          </Button>
        }
      />
    );
  } else if (problem || !article) {
    body = (
      <InlineAlert tone="danger" role="alert">
        Couldn’t open this article.{' '}
        <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </InlineAlert>
    );
  } else {
    const blocks = asRichBlocks(article.body);
    body = (
      <div className="app-Article">
        {!published ? (
          <InlineAlert tone="info" className="app-Article__status">
            Not published yet: requesters can’t see it.
          </InlineAlert>
        ) : null}
        {meta.length > 0 ? <p className="app-Article__meta">{meta.join(' · ')}</p> : null}
        <Prose size="lg">
          {article.summary ? <p className="app-Article__summary">{article.summary}</p> : null}
          {blocks.length > 0 ? <RichText content={blocks} /> : <p className="app-Article__empty">This article has no text yet.</p>}
        </Prose>
      </div>
    );
  }

  return (
    <Sheet
      open={key !== null}
      onOpenChange={(open) => {
        if (!open) closeArticle();
      }}
      side="auto"
      size="md"
      title={article?.title ?? 'Article'}
      description={article ? `Knowledge article ${article.key}` : 'Knowledge article'}
      footer={
        ws && article ? (
          <>
            <Button variant="secondary" onClick={closeArticle}>
              Close
            </Button>
            {mode ? (
              <Button variant="primary" iconStart={mode === 'note' ? 'note' : 'reply'} onClick={insert}>
                {mode === 'note' ? 'Insert into note' : 'Insert into reply'}
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {body}
    </Sheet>
  );
}
