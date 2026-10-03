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
import { refineSafeLinks } from '@itsm/contracts/links/schemas';
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
  // Every link in the body is `https:` or `mailto:` (D23), in every tenant: an
  // article is read by the whole organisation, so one `javascript:` link would
  // run in every reader's session. Each refused link is its own field error at
  // its own path (`body.2.content.0.href`), so the editor can point at the
  // paragraph rather than the article. `draftSchema` inherits the rule.
  body: z.array(z.unknown()).superRefine(refineSafeLinks).default([]),
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

/**
 * When something happened to an article, for a knowledge base written after
 * the fact: the shared demo's articles were written and published over nine
 * months (A4 §1.5), and a base whose every article reads "published today" is
 * plainly not one anybody uses. Omitted, the present — exactly what every live
 * caller has always recorded.
 */
export interface ArticleClock {
  at?: Date;
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

/**
 * Starts an article as a draft. `at` dates the article and its first version.
 */
export async function createArticle(ctx: TenantContext, input: unknown, clock: ArticleClock = {}) {
  authz.require(ctx, 'knowledge.write');
  const parsed = articleSchema.parse(input);
  assertAudienceIsCoherent(parsed.audience, parsed.orgId ?? null);
  const at = clock.at === undefined ? undefined : pastInstant(clock.at, 'at');

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
        ...(at ? { createdAt: at, updatedAt: at } : {}),
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
        ...(at ? { createdAt: at } : {}),
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
 *
 * `at` dates the publication: the version's and (the first time) the
 * article's `publishedAt`, the review date that follows from it, and the
 * search document. It cannot come before the draft it publishes was written.
 */
export async function publishArticle(ctx: TenantContext, key: string, clock: ArticleClock = {}) {
  authz.require(ctx, 'knowledge.publish');
  const at = clock.at === undefined ? undefined : pastInstant(clock.at, 'at');

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
    if (at && at < draft.createdAt) {
      throw new ValidationError('an article cannot be published before its draft was written', [
        { field: 'at', code: 'before_draft', message: `the draft was written at ${draft.createdAt.toISOString()}` },
      ]);
    }

    const requiresApproval = await getSetting<boolean>(ctx, 'knowledge.requireApprovalToPublish');
    if (requiresApproval && article.status !== 'in_review') {
      throw new ValidationError(
        'this tenant reviews articles before publication: send it for review first',
      );
    }

    const intervalDays = (await getSetting<number>(ctx, 'knowledge.reviewIntervalDays')) ?? 180;
    const now = at ?? new Date();

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
        ...(at ? { updatedAt: at } : {}),
      },
    });

    await indexArticle(tx, ctx, { ...article, status: 'published' }, draft, at);

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

    await removeDocument(ctx, tx, 'knowledge', article.id);

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
 *
 * `at` dates a new link: when the article was used, which for a history is
 * the day the ticket was worked, not the day it was imported.
 */
export async function linkToTicket(
  ctx: TenantContext,
  key: string,
  ticketId: string,
  relation: 'referenced' | 'resolved' = 'referenced',
  clock: ArticleClock = {},
) {
  authz.require(ctx, 'knowledge.read');
  const at = clock.at === undefined ? undefined : pastInstant(clock.at, 'at');

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
          ...(at ? { createdAt: at } : {}),
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

/**
 * One vote an article had before it arrived here. `userId` is the reader who
 * gave it: a vote is one person's, one per article, as `recordFeedback` keeps
 * it.
 */
export const importedVoteSchema = z
  .object({
    userId: z.string().uuid(),
    helpful: z.boolean(),
    comment: z.string().min(1).max(2000).optional(),
    at: z.coerce.date(),
  })
  .strict();

export const importUsageSchema = z
  .object({
    /** Reads to add to the article's count. */
    views: z.number().int().min(0).max(100_000_000).default(0),
    /**
     * "Yes, this helped" answers to add, the votes below included. Omitted,
     * the helpful votes below and no more; never fewer than them, because
     * each one is an answer the count must hold.
     */
    helpful: z.number().int().min(0).max(100_000_000).optional(),
    /** "No" answers to add, on the same terms. */
    notHelpful: z.number().int().min(0).max(100_000_000).optional(),
    /**
     * When the article was first published where it came from, if earlier
     * than its publication here. It becomes the article's `publishedAt`, and
     * no vote may come before it.
     */
    publishedAt: z.coerce.date().optional(),
    /** The votes that are kept as rows, with who gave them and any comment. */
    feedback: z.array(importedVoteSchema).max(10_000).default([]),
  })
  .strict();
export type ImportUsageInput = z.input<typeof importUsageSchema>;

export interface ImportUsageOptions {
  /** The audit row's reason, e.g. the demo build's `DEMO_BUILD_REASON`. */
  reason?: string;
}

/**
 * Brings in the use a published article had before it arrived: reads,
 * "did this help?" answers, and the votes kept with who gave them.
 *
 * A knowledge base is judged by these numbers, and an imported or generated
 * one would otherwise open with every article read by nobody. The counts are
 * added to whatever the article has recorded since, so nothing a reader did
 * here is lost; the votes are written as `knowledge_feedback` rows dated when
 * they were given, against the current version, one per person as
 * `recordFeedback` keeps them. A person who has already voted here keeps
 * their own vote and the import is refused (409), rather than one silently
 * replacing the other.
 *
 * Usage is not an edit, so the article's `updatedAt` — the order the article
 * list is read in — is left where it was; and nothing is set off: no
 * `knowledge.article.feedback` event per vote and no enqueue, so it runs
 * inside the demo build's quiet window. One audit row says what came in.
 */
export async function importUsage(ctx: TenantContext, key: string, input: ImportUsageInput, options: ImportUsageOptions = {}) {
  authz.require(ctx, 'knowledge.publish');
  const parsed = importUsageSchema.parse(input);
  const reason = z.string().min(1).max(500).optional().parse(options.reason);

  const votes = parsed.feedback;
  const helpfulVotes = votes.filter((vote) => vote.helpful).length;
  const unhelpfulVotes = votes.length - helpfulVotes;
  const helpful = parsed.helpful ?? helpfulVotes;
  const notHelpful = parsed.notHelpful ?? unhelpfulVotes;

  const problems: { field: string; code: string; message: string }[] = [];
  if (helpful < helpfulVotes) {
    problems.push({ field: 'helpful', code: 'fewer_than_votes', message: `${helpfulVotes} helpful votes are listed` });
  }
  if (notHelpful < unhelpfulVotes) {
    problems.push({ field: 'notHelpful', code: 'fewer_than_votes', message: `${unhelpfulVotes} unhelpful votes are listed` });
  }
  if (parsed.publishedAt && parsed.publishedAt.getTime() > Date.now()) {
    problems.push({ field: 'publishedAt', code: 'in_future', message: 'must not be later than now' });
  }
  const voters = new Set<string>();
  votes.forEach((vote, index) => {
    if (voters.has(vote.userId)) {
      problems.push({ field: `feedback.${index}.userId`, code: 'duplicate', message: 'one vote per person' });
    }
    voters.add(vote.userId);
    if (vote.at.getTime() > Date.now()) {
      problems.push({ field: `feedback.${index}.at`, code: 'in_future', message: 'must not be later than now' });
    }
  });
  if (problems.length > 0) throw new ValidationError('this usage cannot be imported as it stands', problems);

  return transaction(ctx, async (tx) => {
    const article = await loadArticle(tx, key);
    if (article.status !== 'published') {
      throw new ValidationError(`only a published article has readers; ${article.key} is ${article.status}`);
    }

    // A first publication elsewhere can only be earlier than the one here: a
    // later one would leave the article saying it was published after the
    // version readers have been getting.
    if (parsed.publishedAt && article.publishedAt && parsed.publishedAt > article.publishedAt) {
      throw new ValidationError('the article was already published here before then', [
        { field: 'publishedAt', code: 'after_publication', message: `published here at ${article.publishedAt.toISOString()}` },
      ]);
    }
    const since = parsed.publishedAt ?? article.publishedAt;
    const early = since ? votes.flatMap((vote, index) => (vote.at < since ? [index] : [])) : [];
    if (early.length > 0) {
      throw new ValidationError(
        'a vote cannot come before the article was published',
        early.map((index) => ({ field: `feedback.${index}.at`, code: 'before_published', message: `published at ${since!.toISOString()}` })),
      );
    }

    if (votes.length > 0) {
      const people = await tx.user.findMany({ where: { id: { in: [...voters] }, deletedAt: null }, select: { id: true } });
      const known = new Set(people.map((person) => person.id));
      const strangers = votes.flatMap((vote, index) => (known.has(vote.userId) ? [] : [index]));
      if (strangers.length > 0) {
        throw new ValidationError(
          'every vote must be by somebody in this directory',
          strangers.map((index) => ({ field: `feedback.${index}.userId`, code: 'not_found', message: votes[index]!.userId })),
        );
      }
      const existing = await tx.knowledgeFeedback.count({ where: { articleId: article.id, userId: { in: [...voters] } } });
      if (existing > 0) {
        throw new ConflictError(`${existing} of these readers have already voted on ${article.key}, and their own vote stands`);
      }
      await tx.knowledgeFeedback.createMany({
        data: votes.map((vote) => ({
          id: newId(),
          tenantId: ctx.tenantId,
          articleId: article.id,
          versionId: article.currentVersionId,
          userId: vote.userId,
          helpful: vote.helpful,
          comment: vote.comment ?? null,
          createdAt: vote.at,
        })),
      });
    }

    const updated = await tx.knowledgeArticle.update({
      where: { id: article.id },
      data: {
        viewCount: { increment: parsed.views },
        helpfulCount: { increment: helpful },
        unhelpfulCount: { increment: notHelpful },
        ...(parsed.publishedAt ? { publishedAt: parsed.publishedAt } : {}),
        updatedAt: article.updatedAt,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'knowledge.usage.imported',
      targetType: 'knowledge_article',
      targetId: article.id,
      before: { views: article.viewCount, helpful: article.helpfulCount, notHelpful: article.unhelpfulCount },
      after: {
        views: updated.viewCount,
        helpful: updated.helpfulCount,
        notHelpful: updated.unhelpfulCount,
        votes: votes.length,
        ...(parsed.publishedAt ? { publishedAt: parsed.publishedAt.toISOString() } : {}),
      },
      ...(reason ? { reason } : {}),
    });

    return {
      key: article.key,
      views: updated.viewCount,
      helpful: updated.helpfulCount,
      notHelpful: updated.unhelpfulCount,
      votes: votes.length,
      publishedAt: updated.publishedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * A supplied clock, once it is known to be a real instant that has already
 * happened. A history records the past; an article published "tomorrow" would
 * sit in the base with a review date nobody chose.
 */
function pastInstant(at: Date, field: string): Date {
  if (Number.isNaN(at.getTime())) {
    throw new ValidationError('the time given is not a date', [{ field, code: 'invalid', message: 'not a date' }]);
  }
  if (at.getTime() > Date.now()) {
    throw new ValidationError('an article cannot be dated in the future', [
      { field, code: 'in_future', message: 'must not be later than now' },
    ]);
  }
  return at;
}

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

/** Writes the search document for a published article, as of `at` when a history says when. */
async function indexArticle(
  tx: Tx,
  ctx: TenantContext,
  article: ArticleVisibility & { id: string; key: string; keywords: string[]; categoryId: string | null },
  version: { title: string; summary: string | null; body: unknown },
  at?: Date,
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
    sourceUpdatedAt: at ?? new Date(),
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
