import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ValidationError, systemContext, type Tx } from '@itsm/platform';
import { UNSAFE_LINK_MESSAGE } from '@itsm/contracts/links';
import { createArticle, importUsage, linkToTicket, publishArticle, type ImportUsageInput } from '../service/article-service.js';

/**
 * The knowledge history clocks (A4 §1.5 and §2.3, WP-43a): `createArticle`,
 * `publishArticle` and `linkToTicket` take `{ at }`, and `importUsage` brings
 * in the reads and votes an article had before it arrived. The shared demo's
 * twenty-four articles were written over nine months; a base whose articles
 * all read "published today, read by nobody" is plainly not one anybody uses.
 *
 * Each clock is pinned both ways: given, it is what the rows say; omitted,
 * the rows are exactly the ones a live caller always wrote (the clock is
 * frozen, so "the present" is one known instant, and a column the database
 * dates by itself is a key absent from the write).
 */

const platform = vi.hoisted(() => ({ tx: null as unknown, settings: {} as Record<string, unknown> }));
const search = vi.hoisted(() => ({ indexDocument: vi.fn(async () => undefined), removeDocument: vi.fn(async () => undefined) }));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(platform.tx),
    getSetting: async (_ctx: unknown, key: string) => platform.settings[key],
  };
});
vi.mock('@itsm/module-search', () => search);

type Row = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date) && 'in' in (condition as Row)) {
      return (condition as { in: unknown[] }).in.some((each) => same(row[key], each));
    }
    return same(row[key], condition);
  });
}

/** The calls the knowledge service makes, on arrays, with every write kept as it was asked for. */
function memoryDb() {
  const tables: Record<string, Row[]> = {};
  const writes: { model: string; op: string; data: Row | Row[] }[] = [];
  const table = (name: string) => (tables[name] ??= []);
  const defaults: Record<string, Row> = {
    knowledgeArticle: { viewCount: 0, helpfulCount: 0, unhelpfulCount: 0, deflectionCount: 0, publishedAt: null, currentVersionId: null, orgId: null, categoryId: null },
    user: { deletedAt: null },
  };
  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (value !== null && typeof value === 'object' && !(value instanceof Date) && 'increment' in (value as Row)) {
        row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
      } else {
        row[key] = value;
      }
    }
  };
  const model = (name: string) => ({
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) => {
      let rows = table(name).filter((each) => matches(each, where));
      if (orderBy && Object.values(orderBy)[0] === 'desc') {
        const key = Object.keys(orderBy)[0]!;
        rows = [...rows].sort((a, b) => Number(b[key]) - Number(a[key]));
      }
      return rows[0] ? { ...rows[0] } : null;
    },
    findMany: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).map((row) => ({ ...row })),
    count: async ({ where }: { where?: Row } = {}) => table(name).filter((each) => matches(each, where)).length,
    create: async ({ data }: { data: Row }) => {
      writes.push({ model: name, op: 'create', data });
      const row = { ...defaults[name], ...data };
      table(name).push(row);
      return { ...row };
    },
    createMany: async ({ data }: { data: Row[] }) => {
      writes.push({ model: name, op: 'createMany', data });
      data.forEach((each) => table(name).push({ ...defaults[name], ...each }));
      return { count: data.length };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      writes.push({ model: name, op: 'update', data });
      const row = table(name).find((each) => matches(each, where));
      if (!row) throw new Error(`no ${name} row to update`);
      apply(row, data);
      return { ...row };
    },
  });
  const tx = new Proxy({} as Row, {
    get: (_, name: string) => {
      if (name === '$executeRaw') return async () => 1;
      if (name === '$queryRaw') return async () => [];
      return model(name);
    },
  }) as unknown as Tx;
  const written = (name: string, op: string) => writes.filter((write) => write.model === name && write.op === op).map((write) => write.data as Row);
  return { tx, table, writes, written };
}

const TENANT = '0190a000-0000-7000-8000-000000000001';
const EMMA = '0190a000-0000-7000-8000-000000000007';
const HAMZA = '0190a000-0000-7000-8000-000000000008';
const OLIVIA = '0190a000-0000-7000-8000-000000000009';
const TICKET = '0190a000-0000-7000-8000-0000000000f1';

const DAY = 86_400_000;
const NOW = new Date('2026-10-02T23:00:30.000Z');
const WRITTEN = new Date('2026-02-09T10:00:00.000Z');
const PUBLISHED = new Date('2026-02-11T14:30:00.000Z');
const USED = new Date('2026-09-14T11:20:00.000Z');

const ctx = systemContext(TENANT);
let db: ReturnType<typeof memoryDb>;

const article = {
  key: 'vpn-from-home',
  title: 'Connect to the VPN from home',
  summary: 'Three steps, about two minutes.',
  audience: 'tenant',
  body: [
    { type: 'paragraph', content: [{ text: 'Open the VPN client and choose ' }, { text: 'Northwind-Remote-2', bold: true }, { text: '.' }] },
    { type: 'paragraph', content: [{ text: 'The full guide', href: 'https://intranet.northwind.example/it/vpn' }] },
  ],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = memoryDb();
  platform.tx = db.tx;
  platform.settings = { 'knowledge.reviewIntervalDays': 180, 'knowledge.requireApprovalToPublish': false };
  search.indexDocument.mockClear();
  search.removeDocument.mockClear();
  db.table('user').push({ id: EMMA }, { id: HAMZA }, { id: OLIVIA });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The search document the last publication wrote. */
function indexed(): Row {
  return (search.indexDocument.mock.calls.at(-1) as unknown as [Tx, unknown, Row])[2];
}

/** An article as the history writes one: drafted, then published. */
async function published() {
  await createArticle(ctx, article, { at: WRITTEN });
  await publishArticle(ctx, article.key, { at: PUBLISHED });
}

describe('createArticle', () => {
  it('without a clock, writes exactly the rows it always wrote', async () => {
    await createArticle(ctx, article);
    const [row] = db.written('knowledgeArticle', 'create');
    const [version] = db.written('knowledgeArticleVersion', 'create');
    expect(row).not.toHaveProperty('createdAt');
    expect(row).not.toHaveProperty('updatedAt');
    expect(version).not.toHaveProperty('createdAt');
    expect(row).toMatchObject({ key: 'vpn-from-home', status: 'draft', audience: 'tenant' });
  });

  it('with a clock, dates the article and its first version when they were written', async () => {
    await createArticle(ctx, article, { at: WRITTEN });
    expect(db.written('knowledgeArticle', 'create')[0]).toMatchObject({ createdAt: WRITTEN, updatedAt: WRITTEN });
    expect(db.written('knowledgeArticleVersion', 'create')[0]).toMatchObject({ createdAt: WRITTEN, version: 1, status: 'draft' });
  });

  it('keeps the link rule: a dated article with an http: link is refused like any other (D23)', async () => {
    const unsafe = { ...article, body: [{ type: 'paragraph', content: [{ text: 'Guide', href: 'http://intranet.northwind.example/vpn' }] }] };
    await expect(createArticle(ctx, unsafe, { at: WRITTEN })).rejects.toThrow(UNSAFE_LINK_MESSAGE);
    expect(db.writes).toEqual([]);
  });

  it('refuses a date in the future, and one that is not a date', async () => {
    await expect(createArticle(ctx, article, { at: new Date(NOW.getTime() + 1) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'in_future' }],
    });
    await expect(createArticle(ctx, article, { at: new Date('soon') })).rejects.toMatchObject({ status: 422, fieldErrors: [{ field: 'at', code: 'invalid' }] });
    expect(db.writes).toEqual([]);
  });
});

describe('publishArticle', () => {
  it('without a clock, publishes at the present exactly as before', async () => {
    await createArticle(ctx, article, { at: WRITTEN });
    await publishArticle(ctx, article.key);

    const [version] = db.written('knowledgeArticleVersion', 'update');
    expect(version).toMatchObject({ status: 'published', publishedAt: NOW });
    const [row] = db.written('knowledgeArticle', 'update');
    expect(row).toMatchObject({ status: 'published', publishedAt: NOW, reviewDueAt: new Date(NOW.getTime() + 180 * DAY) });
    // `updated_at` is Prisma's own on a live publish.
    expect(row).not.toHaveProperty('updatedAt');
    expect(indexed()).toMatchObject({ entityType: 'knowledge', sourceUpdatedAt: NOW });
  });

  it('with a clock, dates the publication, the review that follows from it and the search document', async () => {
    await published();

    expect(db.written('knowledgeArticleVersion', 'update')[0]).toMatchObject({ status: 'published', publishedAt: PUBLISHED });
    expect(db.written('knowledgeArticle', 'update')[0]).toMatchObject({
      publishedAt: PUBLISHED,
      updatedAt: PUBLISHED,
      reviewDueAt: new Date(PUBLISHED.getTime() + 180 * DAY),
    });
    expect(indexed()).toMatchObject({ entityType: 'knowledge', sourceUpdatedAt: PUBLISHED });
    expect(db.written('outboxEvent', 'create').map((row) => row.type)).toEqual(['knowledge.article.published']);
  });

  it('keeps the first publication date when a later version is published', async () => {
    await published();
    const later = new Date('2026-06-01T09:00:00.000Z');
    db.table('knowledgeArticleVersion').push({ id: 'v2', articleId: db.table('knowledgeArticle')[0]!.id, version: 2, status: 'draft', title: 'Connect to the VPN from home', createdAt: later });
    await publishArticle(ctx, article.key, { at: later });
    expect(db.table('knowledgeArticle')[0]).toMatchObject({ publishedAt: PUBLISHED, currentVersionId: 'v2', updatedAt: later });
  });

  it('refuses to publish before the draft was written, or in the future', async () => {
    await createArticle(ctx, article, { at: WRITTEN });
    await expect(publishArticle(ctx, article.key, { at: new Date(WRITTEN.getTime() - 1) })).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'at', code: 'before_draft' }],
    });
    await expect(publishArticle(ctx, article.key, { at: new Date(NOW.getTime() + 1) })).rejects.toMatchObject({
      fieldErrors: [{ field: 'at', code: 'in_future' }],
    });
    expect(db.table('knowledgeArticle')[0]).toMatchObject({ status: 'draft' });
  });
});

describe('linkToTicket', () => {
  it('without a clock, writes the link exactly as before', async () => {
    await published();
    await linkToTicket(ctx, article.key, TICKET, 'resolved');
    const [link] = db.written('knowledgeTicketLink', 'create');
    expect(link).not.toHaveProperty('createdAt');
    expect(link).toMatchObject({ ticketId: TICKET, relation: 'resolved' });
  });

  it('with a clock, dates the link when the article was used, and counts the deflection once', async () => {
    await published();
    await linkToTicket(ctx, article.key, TICKET, 'resolved', { at: USED });
    expect(db.written('knowledgeTicketLink', 'create')[0]).toMatchObject({ ticketId: TICKET, relation: 'resolved', createdAt: USED });
    expect(db.table('knowledgeArticle')[0]).toMatchObject({ deflectionCount: 1 });

    // The same link again changes nothing.
    await linkToTicket(ctx, article.key, TICKET, 'resolved', { at: USED });
    expect(db.table('knowledgeTicketLink')).toHaveLength(1);
    expect(db.table('knowledgeArticle')[0]).toMatchObject({ deflectionCount: 1 });
  });

  it('refuses a use in the future', async () => {
    await published();
    await expect(linkToTicket(ctx, article.key, TICKET, 'referenced', { at: new Date(NOW.getTime() + 1) })).rejects.toBeInstanceOf(ValidationError);
    expect(db.table('knowledgeTicketLink')).toEqual([]);
  });
});

describe('importUsage', () => {
  const usage = (over: Partial<ImportUsageInput> = {}): ImportUsageInput => ({
    views: 412,
    helpful: 40,
    notHelpful: 6,
    feedback: [
      { userId: EMMA, helpful: true, comment: 'Worked first time from the hotel.', at: new Date('2026-03-02T19:10:00.000Z') },
      { userId: HAMZA, helpful: false, at: new Date('2026-05-20T08:45:00.000Z') },
    ],
    ...over,
  });

  it('adds the reads and answers, keeps the votes dated against the current version, and leaves the article’s edit time alone', async () => {
    await published();
    const before = db.table('knowledgeArticle')[0]!;

    const result = await importUsage(ctx, article.key, usage(), { reason: 'demo.build' });

    expect(result).toEqual({ key: 'vpn-from-home', views: 412, helpful: 40, notHelpful: 6, votes: 2, publishedAt: PUBLISHED });
    const [votes] = db.written('knowledgeFeedback', 'createMany') as unknown as Row[][];
    expect(votes).toEqual([
      expect.objectContaining({ userId: EMMA, helpful: true, comment: 'Worked first time from the hotel.', createdAt: new Date('2026-03-02T19:10:00.000Z'), versionId: before.currentVersionId }),
      expect.objectContaining({ userId: HAMZA, helpful: false, comment: null, createdAt: new Date('2026-05-20T08:45:00.000Z'), versionId: before.currentVersionId }),
    ]);
    // Usage is not an edit: the list's order is left as it was.
    expect(db.written('knowledgeArticle', 'update').at(-1)).toMatchObject({ updatedAt: before.updatedAt });
    expect(db.table('knowledgeArticle')[0]).toMatchObject({ viewCount: 412, helpfulCount: 40, unhelpfulCount: 6, updatedAt: PUBLISHED });
  });

  it('adds to what readers have done here, so nothing recorded since is lost', async () => {
    await published();
    Object.assign(db.table('knowledgeArticle')[0]!, { viewCount: 3, helpfulCount: 1 });
    await importUsage(ctx, article.key, usage({ feedback: [] }));
    expect(db.table('knowledgeArticle')[0]).toMatchObject({ viewCount: 415, helpfulCount: 41, unhelpfulCount: 6 });
  });

  it('counts the votes it is given when no totals are', async () => {
    await published();
    await importUsage(ctx, article.key, { views: 20, feedback: usage().feedback });
    expect(db.table('knowledgeArticle')[0]).toMatchObject({ viewCount: 20, helpfulCount: 1, unhelpfulCount: 1 });
  });

  it('dates the first publication earlier when the source says so', async () => {
    await published();
    const first = new Date('2025-12-01T09:00:00.000Z');
    const result = await importUsage(ctx, article.key, usage({ publishedAt: first, feedback: [{ userId: OLIVIA, helpful: true, at: new Date('2026-01-05T09:00:00.000Z') }] }));
    expect(result.publishedAt).toEqual(first);
    expect(db.table('knowledgeArticle')[0]).toMatchObject({ publishedAt: first });
  });

  it('writes one audit row, with the reason given, and sets nothing off', async () => {
    await published();
    const events = db.written('outboxEvent', 'create').length;
    await importUsage(ctx, article.key, usage(), { reason: 'demo.build' });

    const audit = db.written('auditEvent', 'create').at(-1);
    expect(audit).toMatchObject({
      action: 'knowledge.usage.imported',
      targetType: 'knowledge_article',
      reason: 'demo.build',
      before: { views: 0, helpful: 0, notHelpful: 0 },
      after: { views: 412, helpful: 40, notHelpful: 6, votes: 2 },
    });
    // No `knowledge.article.feedback` per vote: an import announces nothing.
    expect(db.written('outboxEvent', 'create')).toHaveLength(events);
  });

  it('refuses usage for an article nobody can read yet', async () => {
    await createArticle(ctx, article, { at: WRITTEN });
    await expect(importUsage(ctx, article.key, usage())).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses totals smaller than the votes listed, a second vote by one person, and a vote from the future', async () => {
    await published();
    await expect(importUsage(ctx, article.key, usage({ helpful: 0 }))).rejects.toMatchObject({ fieldErrors: [{ field: 'helpful', code: 'fewer_than_votes' }] });
    await expect(importUsage(ctx, article.key, usage({ notHelpful: 0 }))).rejects.toMatchObject({ fieldErrors: [{ field: 'notHelpful', code: 'fewer_than_votes' }] });
    await expect(
      importUsage(ctx, article.key, usage({ feedback: [usage().feedback![0]!, { ...usage().feedback![0]!, helpful: false }] })),
    ).rejects.toMatchObject({ fieldErrors: [{ field: 'feedback.1.userId', code: 'duplicate' }] });
    await expect(
      importUsage(ctx, article.key, usage({ feedback: [{ userId: EMMA, helpful: true, at: new Date(NOW.getTime() + 1) }] })),
    ).rejects.toMatchObject({ fieldErrors: [{ field: 'feedback.0.at', code: 'in_future' }] });
    expect(db.table('knowledgeFeedback')).toEqual([]);
  });

  it('refuses a vote before the article was published', async () => {
    await published();
    await expect(
      importUsage(ctx, article.key, usage({ feedback: [{ userId: EMMA, helpful: true, at: new Date(PUBLISHED.getTime() - 1) }] })),
    ).rejects.toMatchObject({ fieldErrors: [{ field: 'feedback.0.at', code: 'before_published' }] });
  });

  it('refuses a first publication later than the one here', async () => {
    await published();
    await expect(importUsage(ctx, article.key, usage({ publishedAt: new Date(PUBLISHED.getTime() + DAY) }))).rejects.toMatchObject({
      fieldErrors: [{ field: 'publishedAt', code: 'after_publication' }],
    });
  });

  it('refuses a vote by somebody outside the directory', async () => {
    await published();
    const stranger = '0190a000-0000-7000-8000-0000000000ff';
    await expect(importUsage(ctx, article.key, usage({ feedback: [{ userId: stranger, helpful: true, at: USED }] }))).rejects.toMatchObject({
      fieldErrors: [{ field: 'feedback.0.userId', code: 'not_found' }],
    });
  });

  it('keeps a reader’s own vote rather than replacing it', async () => {
    await published();
    db.table('knowledgeFeedback').push({ id: 'f1', articleId: db.table('knowledgeArticle')[0]!.id, userId: EMMA, helpful: false });
    await expect(importUsage(ctx, article.key, usage())).rejects.toBeInstanceOf(ConflictError);
    expect(db.table('knowledgeFeedback')).toHaveLength(1);
    expect(db.table('knowledgeArticle')[0]).toMatchObject({ viewCount: 0 });
  });
});
