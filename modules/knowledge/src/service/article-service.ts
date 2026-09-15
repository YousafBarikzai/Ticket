import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  publish,
  recordAudit,
  getSetting,
  transaction,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import { indexDocument, removeDocument } from '@itsm/module-search';
import { AUDIENCES, aclForArticle, canRead, type ArticleVisibility } from '../domain/audience.js';
import { canTransition, refusalReason } from '../domain/lifecycle.js';

/**
 * MOD-09 knowledge articles.
 *
 * An article is a versioned definition (docs/architecture/05 §8), the same as a
 * rule, a form or an SLA policy — because the questions are the same. What did
 * this say when the reader followed it? Who approved that wording? Can we go
 * back? A knowledge base whose history is a mutable text field cannot answer
 * any of them, and those are exactly the questions asked after an article gave
 * somebody the wrong instruction.
 */

export const articleSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  title: z.string().min(1).max(200),
  summary: z.string().max(500).optional(),
  body: z.array(z.unknown()).default([]),
  audience: z.enum(AUDIENCES).default('internal'),
  orgId: z.string().uuid().nullable().optional(),
  categoryKey: z.string().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  keywords: z.array(z.string().max(60)).max(20).default([]),
  changeNote: z.string().max(500).optional(),
});

export const draftSchema = articleSchema.partial().omit({ key: true });

function readerOf(ctx: TenantContext) {
  return {
    userId: ctx.actor.id ?? null,
    organisationIds: ctx.organisationIds,
    scope: authz.effectiveScope(ctx, 'knowledge.read') ?? 'own',
  };
}

/** Plain text for the search projection, out of the rich-block body. */
export function plainTextOf(body: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (typeof record.text === 'string') out.push(record.text);
      for (const [key, value] of Object.entries(record)) {
        if (key === 'text') continue;
        walk(value);
      }
    }
  };
  walk(body);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

export async function createArticle(ctx: TenantContext, input: unknown) {
  authz.require(ctx, 'knowledge.write');
  const parsed = articleSchema.parse(input);
  assertAudienceIsCoherent(parsed.audience, parsed.orgId ?? null);

  return transaction(ctx, async (tx) => {
    const existing = await tx.knowledgeArticle.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`an article with the key ${parsed.key} already exists`);

    const categoryId = parsed.categoryKey ? await categoryIdFor(tx, parsed.categoryKey) : null;
    const articleId = newId();

    const article = await tx.knowledgeArticle.create({
      data: {
        id: articleId,
        tenantId: ctx.tenantId,
        key: parsed.key,
        title: parsed.title,
        status: 'draft',
        audience: parsed.audience,
        orgId: parsed.orgId ?? null,
        categoryId,
        ownerId: parsed.ownerId ?? ctx.actor.id ?? null,
        authorId: ctx.actor.id ?? null,
        keywords: parsed.keywords,
      },
    });

    await tx.knowledgeArticleVersion.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        articleId,
        version: 1,
        title: parsed.title,
        summary: parsed.summary ?? null,
        body: parsed.body as never,
        changeNote: parsed.changeNote ?? null,
        status: 'draft',
        authorId: ctx.actor.id ?? null,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'knowledge.article.created',
      targetType: 'knowledge_article',
      targetId: articleId,
      after: { key: parsed.key, title: parsed.title, audience: parsed.audience },
    });

    return article;
  });
}

/**
 * Edits the working draft, creating one if the article is published.
 *
 * A published article stays published while somebody works on the next version.
 * That is the difference between this and a wiki, and it is the reason a reader
 * following an article during an incident does not watch it change underneath
 * them.
 */
export async function saveDraft(ctx: TenantContext, key: string, input: unknown) {
  authz.require(ctx, 'knowledge.write');
  const parsed = draftSchema.parse(input);
  if (parsed.audience) assertAudienceIsCoherent(parsed.audience, parsed.orgId ?? null);

  return transaction(ctx, async (tx) => {
    const article = await loadArticle(tx, key);
    if (article.status === 'retired') {
      throw new ValidationError(refusalReason('retired', 'draft') ?? 'this article is retired');
    }

    const draft = await draftVersionFor(tx, ctx, article);

    const updated = await tx.knowledgeArticleVersion.update({
      where: { id: draft.id },
      data: {
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
        ...(parsed.body !== undefined ? { body: parsed.body as never } : {}),
        ...(parsed.changeNote !== undefined ? { changeNote: parsed.changeNote } : {}),
      },
    });

    // Audience, owner and category belong to the article rather than a version:
    // they decide who may read it at all, and a draft must not be able to widen
    // that for the version readers are currently getting.
    if (parsed.audience !== undefined || parsed.ownerId !== undefined || parsed.categoryKey !== undefined || parsed.keywords !== undefined) {
      await tx.knowledgeArticle.update({
        where: { id: article.id },
        data: {
          ...(parsed.audience !== undefined ? { audience: parsed.audience, orgId: parsed.orgId ?? null } : {}),
          ...(parsed.ownerId !== undefined ? { ownerId: parsed.ownerId } : {}),
          ...(parsed.keywords !== undefined ? { keywords: parsed.keywords } : {}),
          ...(parsed.categoryKey !== undefined
            ? { categoryId: parsed.categoryKey ? await categoryIdFor(tx, parsed.categoryKey) : null }
            : {}),
        },
      });
      // The audience may have changed, so the indexed ACL is now wrong.
      if (article.status === 'published') await reindex(tx, ctx, article.id);
    }

    await recordAudit(tx, ctx, {
      action: 'knowledge.draft.saved',
      targetType: 'knowledge_article',
      targetId: article.id,
      after: { version: updated.version },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function submitForReview(ctx: TenantContext, key: string) {
  authz.require(ctx, 'knowledge.write');

  return transaction(ctx, async (tx) => {
    const article = await loadArticle(tx, key);
    assertTransition(article.status, 'in_review');

    const draft = await draftVersionFor(tx, ctx, article);
    if (plainTextOf(draft.body).length === 0) {
      throw new ValidationError('this article has no content yet, so there is nothing to review');
    }

    await tx.knowledgeArticle.update({ where: { id: article.id }, data: { status: 'in_review' } });
    await tx.knowledgeArticleVersion.update({ where: { id: draft.id }, data: { status: 'in_review' } });

    await recordAudit(tx, ctx, {
      action: 'knowledge.article.submitted',
      targetType: 'knowledge_article',
      targetId: article.id,
      before: { status: article.status },
      after: { status: 'in_review', version: draft.version },
    });

    // MOD-17 already consumes this event: an approval policy matching
    // `knowledge_article` turns review into a real approval without this module
    // knowing that approvals exist.
    await publish(tx, ctx, {
      definition: events.knowledgeArticleSubmitted,
      aggregateId: article.id,
      payload: { articleId: article.id, key: article.key, version: draft.version, authorId: ctx.actor.id ?? null },
    });

    return { status: 'in_review', version: draft.version };
  });
}

/**
 * Publishes the working draft, freezing it as the version readers get.
 *
 * Indexing happens here, in the same transaction, so an article is never
 * published-but-unfindable or findable-but-unpublished.
 */
export async function publishArticle(ctx: TenantContext, key: string) {
  authz.require(ctx, 'knowledge.publish');

  return transaction(ctx, async (tx) => {
    const article = await loadArticle(tx, key);
    // An article that is already published is publishing its *next version*,
    // which is the ordinary case rather than a transition: the status does not
    // change, the current version does. Asserting a published → published
    // transition would refuse every edit after the first.
    if (article.status !== 'published') assertTransition(article.status, 'published');

    const draft = await tx.knowledgeArticleVersion.findFirst({
      where: { articleId: article.id, status: { in: ['draft', 'in_review'] } },
      orderBy: { version: 'desc' },
    });
    if (!draft) throw new ValidationError('there is no draft to publish; start one by editing the article');

    const requiresApproval = await getSetting<boolean>(ctx, 'knowledge.requireApprovalToPublish');
    if (requiresApproval && article.status !== 'in_review') {
      throw new ValidationError(
        'this tenant reviews articles before publication: send it for review first',
      );
    }

    const intervalDays = (await getSetting<number>(ctx, 'knowledge.reviewIntervalDays')) ?? 180;
    const now = new Date();

    await tx.knowledgeArticleVersion.update({
      where: { id: draft.id },
      data: { status: 'published', publishedAt: now, publishedBy: ctx.actor.id ?? null, title: draft.title },
    });

    await tx.knowledgeArticle.update({
      where: { id: article.id },
      data: {
        status: 'published',
        title: draft.title,
        currentVersionId: draft.id,
        publishedAt: article.publishedAt ?? now,
        retiredAt: null,
        reviewDueAt: new Date(now.getTime() + intervalDays * 86_400_000),
      },
    });

    await indexArticle(tx, ctx, { ...article, status: 'published' }, draft);

    await recordAudit(tx, ctx, {
      action: 'knowledge.article.published',
      targetType: 'knowledge_article',
      targetId: article.id,
      before: { status: article.status, version: article.currentVersionId },
      after: { status: 'published', version: draft.version },
    });

    await publish(tx, ctx, {
      definition: events.knowledgeArticlePublished,
      aggregateId: article.id,
      payload: {
        articleId: article.id,
        key: article.key,
        version: draft.version,
        audience: article.audience,
        rolledBackFrom: null,
      },
    });

    return { key: article.key, version: draft.version, status: 'published' };
  });
}

/**
 * Restores an earlier version's content by publishing it forward as a new one.
 *
 * Not a mutation of history: version 7 restoring version 3 becomes version 8,
 * whose change note says where it came from. Somebody reading the article's
 * history a year later can see that a rollback happened, which a silent
 * reversion would hide.
 */
export async function rollbackArticle(ctx: TenantContext, key: string, toVersion: number) {
  authz.require(ctx, 'knowledge.publish');

  return transaction(ctx, async (tx) => {
    const article = await loadArticle(tx, key);
    const source = await tx.knowledgeArticleVersion.findFirst({
      where: { articleId: article.id, version: toVersion, status: 'published' },
    });
    if (!source) throw new NotFoundError('article version', String(toVersion));

    const next = await nextVersionNumber(tx, article.id);
    const now = new Date();

    const restored = await tx.knowledgeArticleVersion.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        articleId: article.id,
        version: next,
        title: source.title,
        summary: source.summary,
        body: source.body as never,
        changeNote: `Restored the content of version ${toVersion}`,
        status: 'published',
        authorId: ctx.actor.id ?? null,
        publishedAt: now,
        publishedBy: ctx.actor.id ?? null,
      },
    });

    await tx.knowledgeArticle.update({
      where: { id: article.id },
      data: { status: 'published', title: source.title, currentVersionId: restored.id, retiredAt: null },
    });

    await indexArticle(tx, ctx, { ...article, status: 'published' }, restored);

    await recordAudit(tx, ctx, {
      action: 'knowledge.article.rolled_back',
      targetType: 'knowledge_article',
      targetId: article.id,
      after: { version: next, restoredFrom: toVersion },
    });

    await publish(tx, ctx, {
      definition: events.knowledgeArticlePublished,
      aggregateId: article.id,
      payload: {
        articleId: article.id,
        key: article.key,
        version: next,
        audience: article.audience,
        rolledBackFrom: toVersion,
      },
    });

    return { key: article.key, version: next, restoredFrom: toVersion };
  });
}

/**
 * Withdraws an article.
 *
 * The search document goes immediately: a retired article that is still
 * findable is worse than one that never existed, because a reader has no way to
 * know the instructions are withdrawn. The versions stay, so the history of
 * what it once said survives.
 */
export async function retireArticle(ctx: TenantContext, key: string, reason?: string) {
  authz.require(ctx, 'knowledge.publish');

  return transaction(ctx, async (tx) => {
    const article = await loadArticle(tx, key);
    assertTransition(article.status, 'retired');

    await tx.knowledgeArticle.update({
      where: { id: article.id },
      data: { status: 'retired', retiredAt: new Date(), currentVersionId: null },
    });

    await removeDocument(tx, 'knowledge', article.id);

    await recordAudit(tx, ctx, {
      action: 'knowledge.article.retired',
      targetType: 'knowledge_article',
      targetId: article.id,
      before: { status: article.status },
      after: { status: 'retired' },
      reason: reason ?? null,
    });

    await publish(tx, ctx, {
      definition: events.knowledgeArticleRetired,
      aggregateId: article.id,
      payload: { articleId: article.id, key: article.key, reason: reason ?? null },
    });

    return { key: article.key, status: 'retired' };
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * One article, as a reader gets it.
 *
 * Checked against the audience here as well as through the search ACL, because
 * these answer different questions: search decides what is *listed*, this
 * decides what is *served*. Somebody who guesses a key must be refused even
 * though nothing ever showed them the article — and refused with a 404, because
 * "you may not read article `exec-redundancy-process`" confirms it exists.
 */
export async function readArticle(ctx: TenantContext, key: string) {
  authz.require(ctx, 'knowledge.read');

  return transaction(ctx, async (tx) => {
    const article = await tx.knowledgeArticle.findFirst({ where: { key } });
    if (!article) throw new NotFoundError('article', key);
    if (!canRead(article as ArticleVisibility, readerOf(ctx))) throw new NotFoundError('article', key);

    const version = article.currentVersionId
      ? await tx.knowledgeArticleVersion.findFirst({ where: { id: article.currentVersionId } })
      : await tx.knowledgeArticleVersion.findFirst({
          where: { articleId: article.id },
          orderBy: { version: 'desc' },
        });

    await tx.knowledgeArticle.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } });

    return {
      key: article.key,
      title: article.title,
      status: article.status,
      audience: article.audience,
      version: version?.version ?? null,
      summary: version?.summary ?? null,
      body: version?.body ?? [],
      keywords: article.keywords,
      helpfulCount: article.helpfulCount,
      unhelpfulCount: article.unhelpfulCount,
      reviewDueAt: article.reviewDueAt,
      publishedAt: article.publishedAt,
    };
  });
}

export async function listArticles(
  ctx: TenantContext,
  filter: { status?: string; categoryKey?: string; limit?: number } = {},
) {
  authz.require(ctx, 'knowledge.read');
  const reader = readerOf(ctx);

  return transaction(ctx, async (tx) => {
    const categoryId = filter.categoryKey ? await categoryIdFor(tx, filter.categoryKey) : undefined;
    const rows = await tx.knowledgeArticle.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(categoryId ? { categoryId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(filter.limit ?? 50, 200),
    });

    // Filtered in the service rather than the query because the audience rule
    // lives in one place and is tested there. The list is small and bounded; a
    // predicate duplicated into SQL is a predicate that drifts.
    return rows.filter((row) => canRead(row as ArticleVisibility, reader));
  });
}

export async function articleHistory(ctx: TenantContext, key: string) {
  authz.require(ctx, 'knowledge.read');
  return transaction(ctx, async (tx) => {
    const article = await loadArticle(tx, key);
    if (!canRead(article as ArticleVisibility, readerOf(ctx))) throw new NotFoundError('article', key);
    const versions = await tx.knowledgeArticleVersion.findMany({
      where: { articleId: article.id },
      orderBy: { version: 'desc' },
    });
    return versions.map((version) => ({
      version: version.version,
      title: version.title,
      status: version.status,
      changeNote: version.changeNote,
      publishedAt: version.publishedAt,
      isCurrent: version.id === article.currentVersionId,
    }));
  });
}

// ---------------------------------------------------------------------------
// Feedback and deflection
// ---------------------------------------------------------------------------

/** Did this answer your question? One vote per person, changeable. */
export async function recordFeedback(ctx: TenantContext, key: string, helpful: boolean, comment?: string) {
  authz.require(ctx, 'knowledge.feedback');
  const userId = ctx.actor.id;
  if (!userId) throw new ValidationError('feedback needs a signed-in reader');

  return transaction(ctx, async (tx) => {
    const article = await loadArticle(tx, key);
    if (!canRead(article as ArticleVisibility, readerOf(ctx))) throw new NotFoundError('article', key);

    const existing = await tx.knowledgeFeedback.findFirst({ where: { articleId: article.id, userId } });

    // Counters move by the difference rather than being recomputed, and a
    // changed vote moves both. Recounting on every vote would be correct and
    // slower; moving by one and forgetting the old vote would be neither.
    let helpfulDelta = helpful ? 1 : 0;
    let unhelpfulDelta = helpful ? 0 : 1;
    if (existing) {
      if (existing.helpful === helpful) {
        helpfulDelta = 0;
        unhelpfulDelta = 0;
      } else {
        helpfulDelta = helpful ? 1 : -1;
        unhelpfulDelta = helpful ? -1 : 1;
      }
      await tx.knowledgeFeedback.update({
        where: { id: existing.id },
        data: { helpful, comment: comment ?? null, versionId: article.currentVersionId },
      });
    } else {
      await tx.knowledgeFeedback.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          articleId: article.id,
          versionId: article.currentVersionId,
          userId,
          helpful,
          comment: comment ?? null,
        },
      });
    }

    await tx.knowledgeArticle.update({
      where: { id: article.id },
      data: {
        helpfulCount: { increment: helpfulDelta },
        unhelpfulCount: { increment: unhelpfulDelta },
      },
    });

    await publish(tx, ctx, {
      definition: events.knowledgeArticleFeedback,
      aggregateId: article.id,
      payload: { articleId: article.id, userId, helpful, comment: comment ?? null },
    });

    return { key: article.key, helpful };
  });
}

/**
 * Records that an article was used on a ticket.
 *
 * `resolved` is the honest deflection measure: not "somebody opened the
 * article", which counts curiosity, but "this article is why the ticket
 * closed". A knowledge base judged on views optimises for titles that look
 * interesting.
 */
export async function linkToTicket(
  ctx: TenantContext,
  key: string,
  ticketId: string,
  relation: 'referenced' | 'resolved' = 'referenced',
) {
  authz.require(ctx, 'knowledge.read');

  return transaction(ctx, async (tx) => {
    const article = await loadArticle(tx, key);
    if (!canRead(article as ArticleVisibility, readerOf(ctx))) throw new NotFoundError('article', key);

    const existing = await tx.knowledgeTicketLink.findFirst({ where: { articleId: article.id, ticketId } });
    if (existing) {
      if (existing.relation === relation) return existing;
      await tx.knowledgeTicketLink.update({ where: { id: existing.id }, data: { relation } });
    } else {
      await tx.knowledgeTicketLink.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          articleId: article.id,
          ticketId,
          relation,
          createdBy: ctx.actor.id ?? null,
        },
      });
    }

    if (relation === 'resolved' && existing?.relation !== 'resolved') {
      await tx.knowledgeArticle.update({
        where: { id: article.id },
        data: { deflectionCount: { increment: 1 } },
      });
    }

    return { articleKey: article.key, ticketId, relation };
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function loadArticle(tx: Tx, key: string) {
  const article = await tx.knowledgeArticle.findFirst({ where: { key } });
  if (!article) throw new NotFoundError('article', key);
  return article;
}

function assertTransition(from: string, to: string): void {
  const reason = refusalReason(from, to);
  if (reason) throw new ValidationError(reason);
  if (!canTransition(from, to)) throw new ValidationError(`cannot go from ${from} to ${to}`);
}

function assertAudienceIsCoherent(audience: string, orgId: string | null): void {
  if (audience === 'organisation' && !orgId) {
    throw new ValidationError('an article for one organisation needs to say which organisation', [
      { field: 'orgId', code: 'required', message: 'choose an organisation' },
    ]);
  }
  if (audience !== 'organisation' && orgId) {
    throw new ValidationError('only an article for one organisation carries an organisation');
  }
}

async function nextVersionNumber(tx: Tx, articleId: string): Promise<number> {
  const latest = await tx.knowledgeArticleVersion.findFirst({
    where: { articleId },
    orderBy: { version: 'desc' },
  });
  return (latest?.version ?? 0) + 1;
}

/** The working draft, started from the published version if there is not one yet. */
async function draftVersionFor(tx: Tx, ctx: TenantContext, article: { id: string; currentVersionId: string | null }) {
  const existing = await tx.knowledgeArticleVersion.findFirst({
    where: { articleId: article.id, status: { in: ['draft', 'in_review'] } },
    orderBy: { version: 'desc' },
  });
  if (existing) return existing;

  const published = article.currentVersionId
    ? await tx.knowledgeArticleVersion.findFirst({ where: { id: article.currentVersionId } })
    : null;

  return tx.knowledgeArticleVersion.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      articleId: article.id,
      version: await nextVersionNumber(tx, article.id),
      title: published?.title ?? 'Untitled',
      summary: published?.summary ?? null,
      body: (published?.body ?? []) as never,
      changeNote: null,
      status: 'draft',
      authorId: ctx.actor.id ?? null,
    },
  });
}

async function categoryIdFor(tx: Tx, key: string): Promise<string> {
  const category = await tx.knowledgeCategory.findFirst({ where: { key } });
  if (!category) throw new NotFoundError('knowledge category', key);
  return category.id;
}

/** Writes the search document for a published article. */
async function indexArticle(
  tx: Tx,
  ctx: TenantContext,
  article: ArticleVisibility & { id: string; key: string; keywords: string[]; categoryId: string | null },
  version: { title: string; summary: string | null; body: unknown },
): Promise<void> {
  await indexDocument(tx, ctx, {
    entityType: 'knowledge',
    entityId: article.id,
    title: version.title,
    bodyText: [version.title, version.summary ?? '', plainTextOf(version.body), article.keywords.join(' ')]
      .filter(Boolean)
      .join('\n'),
    orgId: article.orgId,
    acl: aclForArticle(article),
    facets: { key: article.key, audience: article.audience, categoryId: article.categoryId },
    sourceUpdatedAt: new Date(),
  });
}

/** Rewrites the search document after something that changes who may read it. */
async function reindex(tx: Tx, ctx: TenantContext, articleId: string): Promise<void> {
  const article = await tx.knowledgeArticle.findFirst({ where: { id: articleId } });
  if (!article || article.status !== 'published' || !article.currentVersionId) return;
  const version = await tx.knowledgeArticleVersion.findFirst({ where: { id: article.currentVersionId } });
  if (!version) return;
  await indexArticle(tx, ctx, article as never, version);
}
