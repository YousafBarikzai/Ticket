import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SYSTEM_PERMISSIONS,
  beginQuiet,
  createContext,
  endQuiet,
  newId,
  quietRefusals,
  transaction,
  withContext,
  type TenantContext,
  type Tx,
} from '@itsm/platform';
import { DEMO_BUILD_REASON } from '@itsm/contracts/demo';
import { newestGeneration, tenantService } from '@itsm/module-tenancy';
import { userService } from '@itsm/module-identity';
import { ticketService } from '@itsm/module-ticket';
import { approvalService } from '@itsm/module-approvals';
import { catalogueService } from '@itsm/module-catalogue';
import { articleService } from '@itsm/module-knowledge';
import { closeHarness } from '../support/harness.js';

/**
 * The core history imports (WP-43a; A4 §2.3) against PostgreSQL, in a demo
 * build as the generator makes one: a `kind = 'demo'` tenant provisioned
 * `seeding` and kept quiet from before its first row.
 *
 * One row of each kind goes in through its owner's public entry point with
 * the instant it happened — a colleague who joined last year, a team on the
 * office calendar, a catalogue submission behind an imported request, the
 * approval it needed and the decision that settled it, an article written,
 * published, read, voted on and used — and each is read back from the
 * database with that instant on it. Because the tenant is quiet the whole
 * time, any of these paths that enqueued a job would fail here with
 * `QuietTenantError`; and because it is `seeding`, nothing it wrote to the
 * outbox may have been published.
 *
 * The unit suites of the four modules prove each clock and refusal as logic,
 * including that omitting the clock writes exactly today's rows.
 */

const RUN = randomBytes(3).toString('hex');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Every instant below is in the past, as a history is. */
const NOW = Date.now();
const at = (daysAgo: number, hours = 0) => new Date(NOW - daysAgo * DAY + hours * HOUR);
const JOINED_MANAGER = at(700);
const JOINED_REQUESTER = at(400);
const RAISED = at(30);
const DECIDED = at(30, 3);
const WRITTEN = at(200);
const PUBLISHED = at(199);
const VOTED = at(60);
const USED = at(29);

let tenantId = '';
let ctx: TenantContext;
let refusalsBefore = 0;

const ids = { org: '', calendar: '', manager: '', requester: '', team: '', ticket: '', ticketNumber: '', approval: '', article: '' };

function as(userId: string): TenantContext {
  return createContext({ tenantId, actor: { type: 'user', id: userId, displayName: userId }, permissions: SYSTEM_PERMISSIONS });
}

function read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext(ctx, () => transaction(ctx, fn));
}

function run<T>(fn: () => Promise<T>): Promise<T> {
  return withContext(ctx, fn);
}

beforeAll(async () => {
  const generation = (await newestGeneration()) + 1;
  tenantId = newId();
  // Quiet before the row exists, as the build does (A4 §2.4 Q2), and for the
  // whole file: every import below runs inside the quiet window.
  beginQuiet(tenantId);
  refusalsBefore = quietRefusals();
  await tenantService.provisionTenant(
    { name: 'Northwind Traders (UK)', slug: `demo-build-g${generation}-${RUN}`, kind: 'demo' },
    { status: 'seeding', id: tenantId, demo: { generation, seed: 20261002, anchor: new Date(NOW), scale: 0.2, generatorVersion: 'wp43a-test' } },
  );
  ctx = createContext({ tenantId, actor: { type: 'system', id: null, displayName: 'demo-build' }, permissions: SYSTEM_PERMISSIONS });
  ids.org = (await tenantService.createOrganisation(ctx, { name: 'Northwind Traders (UK)', code: 'NW' })).id;
  // The provisioning seed's office-hours calendar stands in for the demo's
  // `northwind-uk`, which the generator creates through the SLA module.
  ids.calendar = (await read((tx) => tx.businessCalendar.findFirstOrThrow({ where: { key: 'uk-office' }, select: { id: true } }))).id;
}, 180_000);

afterAll(async () => {
  endQuiet(tenantId);
  if (tenantId) await tenantService.purgeTenant(tenantId);
  await closeHarness();
}, 180_000);

describe('a seeding demo tenant, kept quiet', () => {
  it('is the kind of tenant the build writes into', async () => {
    const row = await read((tx) => tx.$queryRaw<{ kind: string; status: string }[]>`SELECT kind, status FROM tenant WHERE id = ${tenantId}::uuid`);
    expect(row[0]).toEqual({ kind: 'demo', status: 'seeding' });
  });
});

describe('identity: when colleagues joined, and the calendar their team works to', () => {
  it('imports a person dated when they joined', async () => {
    const manager = await run(() =>
      userService.createUser(ctx, { email: `emma.clarke@${RUN}.example`, displayName: 'Emma Clarke', primaryOrgId: ids.org, createdAt: JOINED_MANAGER }, 'seed'),
    );
    const requester = await run(() =>
      userService.createUser(
        ctx,
        { email: `hamza.ali@${RUN}.example`, displayName: 'Hamza Ali', primaryOrgId: ids.org, managerId: manager.id, createdAt: JOINED_REQUESTER },
        'import',
      ),
    );
    ids.manager = manager.id;
    ids.requester = requester.id;

    const rows = await read((tx) => tx.user.findMany({ where: { id: { in: [manager.id, requester.id] } }, select: { id: true, createdAt: true, updatedAt: true } }));
    expect(rows.find((row) => row.id === manager.id)).toMatchObject({ createdAt: JOINED_MANAGER, updatedAt: JOINED_MANAGER });
    expect(rows.find((row) => row.id === requester.id)).toMatchObject({ createdAt: JOINED_REQUESTER, updatedAt: JOINED_REQUESTER });

    const audit = await read((tx) => tx.auditEvent.findFirst({ where: { action: 'user.provisioned', targetId: requester.id } }));
    expect(audit?.after).toMatchObject({ source: 'import', createdAt: JOINED_REQUESTER.toISOString() });
  });

  it('refuses a back-dated person from anywhere but an import or the seed', async () => {
    await expect(
      run(() => userService.createUser(ctx, { email: `late@${RUN}.example`, displayName: 'Late Joiner', createdAt: JOINED_REQUESTER }, 'admin')),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('creates a team on a business calendar, which analytics then measures it against', async () => {
    const team = await run(() => userService.createTeam(ctx, { key: 'service-desk', name: 'Service Desk', orgId: ids.org, calendarId: ids.calendar }));
    ids.team = team.id;
    const row = await read((tx) => tx.team.findFirst({ where: { id: team.id }, select: { calendarId: true } }));
    expect(row).toEqual({ calendarId: ids.calendar });
  });

  it('refuses a calendar this tenant does not have', async () => {
    await expect(run(() => userService.createTeam(ctx, { key: 'euc', name: 'End-User Computing', orgId: ids.org, calendarId: newId() }))).rejects.toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'calendarId', code: 'not_found' }],
    });
  });
});

describe('catalogue: the submission behind an imported request', () => {
  it('writes the form_submission dated when it was made, and describes it as a live request', async () => {
    const answers = { system: 'crm', accessLevel: 'read' };
    const [ticket] = await run(() =>
      ticketService.importTickets(
        ctx,
        [
          {
            type: 'request',
            title: 'Access to a system',
            description: 'System: CRM\nAccess level: Read only',
            status: 'in_progress',
            priority: 'P3',
            requesterId: ids.requester,
            groupId: ids.team,
            orgId: ids.org,
            externalRef: `demo:wp43a:${RUN}:t:0001`,
            sourceChannel: 'portal',
            createdAt: RAISED,
            custom: answers,
            events: [{ type: 'created', payload: { channel: 'portal' }, actorId: ids.requester, occurredAt: RAISED }],
          },
        ],
        { audit: 'batch', label: `wp43a ${RUN} tickets`, reason: DEMO_BUILD_REASON },
      ),
    );
    ids.ticket = ticket!.id;
    ids.ticketNumber = ticket!.number;

    const imported = await run(() =>
      transaction(ctx, (tx) =>
        catalogueService.importSubmission(
          ctx,
          tx,
          { requestTypeKey: 'system-access', ticketId: ticket!.id, answers, submittedBy: ids.requester, at: RAISED },
          { reason: DEMO_BUILD_REASON },
        ),
      ),
    );

    // The description a live submission writes is the one the ticket was imported with.
    expect(imported.description).toBe('System: CRM\nAccess level: Read only');
    const row = await read((tx) => tx.formSubmission.findFirst({ where: { ticketId: ticket!.id } }));
    expect(row).toMatchObject({ id: imported.submissionId, submittedBy: ids.requester, answers, createdAt: RAISED, formVersionId: imported.formVersionId });

    const audit = await read((tx) => tx.auditEvent.findFirst({ where: { action: 'request.submission.imported', targetId: ticket!.id } }));
    expect(audit).toMatchObject({ reason: DEMO_BUILD_REASON, after: { requestType: 'system-access', number: ticket!.number } });
  });

  it('refuses a second submission for the same ticket', async () => {
    await expect(
      run(() =>
        transaction(ctx, (tx) =>
          catalogueService.importSubmission(ctx, tx, {
            requestTypeKey: 'system-access',
            ticketId: ids.ticket,
            answers: { system: 'hr', accessLevel: 'read' },
            submittedBy: ids.requester,
            at: RAISED,
          }),
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('approvals: requested, decided and settled when they were', () => {
  it('opens the approval at the request and makes it due from then', async () => {
    const approval = await run(() =>
      transaction(ctx, (tx) =>
        approvalService.requestApproval(
          ctx,
          tx,
          {
            subjectType: 'request',
            subjectId: ids.ticket,
            ticketId: ids.ticket,
            subjectUserId: ids.requester,
            facts: { requestType: { key: 'system-access' }, answers: { system: 'crm', accessLevel: 'read' } },
          },
          { at: RAISED },
        ),
      ),
    );
    ids.approval = approval!.id;

    expect(approval).toMatchObject({ status: 'pending', requestedAt: RAISED });
    const steps = await read((tx) => tx.approvalStep.findMany({ where: { requestId: ids.approval }, orderBy: { sequence: 'asc' } }));
    // The provisioning default: the requester's line manager, due in two days.
    expect(steps).toEqual([expect.objectContaining({ status: 'open', approverIds: [ids.manager], openedAt: RAISED, dueAt: new Date(RAISED.getTime() + 2 * DAY) })]);
  });

  it('records the decision, and settles the step and the request, when it was made', async () => {
    const outcome = await run(() => approvalService.decide(as(ids.manager), ids.approval, { decision: 'approved', via: 'email' }, { at: DECIDED }));
    expect(outcome).toEqual({ requestStatus: 'approved', stepStatus: 'approved' });

    const request = await read((tx) => tx.approvalRequest.findFirst({ where: { id: ids.approval } }));
    expect(request).toMatchObject({ status: 'approved', outcome: 'approved', decidedAt: DECIDED });
    const decisions = await read((tx) => tx.approvalDecision.findMany({ where: { approverId: ids.manager } }));
    expect(decisions).toEqual([expect.objectContaining({ decision: 'approved', via: 'email', decidedAt: DECIDED })]);
    const step = await read((tx) => tx.approvalStep.findFirst({ where: { requestId: ids.approval } }));
    expect(step).toMatchObject({ status: 'approved', decidedAt: DECIDED });
  });
});

describe('knowledge: written, published, read, voted on and used when it was', () => {
  const key = 'vpn-from-home';

  it('dates the article, its version, its publication, its review and its search document', async () => {
    await run(() =>
      articleService.createArticle(
        ctx,
        {
          key,
          title: 'Connect to the VPN from home',
          summary: 'Three steps, about two minutes.',
          audience: 'tenant',
          categoryKey: 'how-to',
          // Every link in demo content is https: or mailto: (D23).
          body: [
            { type: 'paragraph', content: [{ text: 'Open the VPN client and choose Northwind-Remote-2.' }] },
            { type: 'paragraph', content: [{ text: 'Ask the service desk', href: `mailto:servicedesk@${RUN}.example` }] },
          ],
        },
        { at: WRITTEN },
      ),
    );
    await run(() => articleService.publishArticle(ctx, key, { at: PUBLISHED }));

    const article = await read((tx) => tx.knowledgeArticle.findFirstOrThrow({ where: { key } }));
    ids.article = article.id;
    expect(article).toMatchObject({ status: 'published', createdAt: WRITTEN, updatedAt: PUBLISHED, publishedAt: PUBLISHED, reviewDueAt: new Date(PUBLISHED.getTime() + 180 * DAY) });
    const version = await read((tx) => tx.knowledgeArticleVersion.findFirstOrThrow({ where: { articleId: article.id } }));
    expect(version).toMatchObject({ version: 1, status: 'published', createdAt: WRITTEN, publishedAt: PUBLISHED });
    const document = await read((tx) => tx.searchDocument.findFirst({ where: { entityType: 'knowledge', entityId: article.id } }));
    expect(document).toMatchObject({ title: 'Connect to the VPN from home', sourceUpdatedAt: PUBLISHED });
  });

  it('imports its reads and votes without touching when it was last edited', async () => {
    const result = await run(() =>
      articleService.importUsage(
        ctx,
        key,
        { views: 412, helpful: 40, notHelpful: 6, feedback: [{ userId: ids.requester, helpful: true, comment: 'Worked first time from the hotel.', at: VOTED }] },
        { reason: DEMO_BUILD_REASON },
      ),
    );
    expect(result).toMatchObject({ views: 412, helpful: 40, notHelpful: 6, votes: 1 });

    const article = await read((tx) => tx.knowledgeArticle.findFirstOrThrow({ where: { id: ids.article } }));
    expect(article).toMatchObject({ viewCount: 412, helpfulCount: 40, unhelpfulCount: 6, updatedAt: PUBLISHED });
    const votes = await read((tx) => tx.knowledgeFeedback.findMany({ where: { articleId: ids.article } }));
    expect(votes).toEqual([expect.objectContaining({ userId: ids.requester, helpful: true, createdAt: VOTED, versionId: article.currentVersionId })]);
    const audit = await read((tx) => tx.auditEvent.findFirst({ where: { action: 'knowledge.usage.imported', targetId: ids.article } }));
    expect(audit).toMatchObject({ reason: DEMO_BUILD_REASON, after: { views: 412, votes: 1 } });
  });

  it('records the article as resolving the imported ticket on the day it was used', async () => {
    await run(() => articleService.linkToTicket(ctx, key, ids.ticket, 'resolved', { at: USED }));
    const link = await read((tx) => tx.knowledgeTicketLink.findFirst({ where: { articleId: ids.article, ticketId: ids.ticket } }));
    expect(link).toMatchObject({ relation: 'resolved', createdAt: USED });
    const article = await read((tx) => tx.knowledgeArticle.findFirstOrThrow({ where: { id: ids.article } }));
    expect(article.deflectionCount).toBe(1);
  });
});

describe('the quiet window held', () => {
  it('refused no enqueue: none of these paths tried to start a job', () => {
    expect(quietRefusals()).toBe(refusalsBefore);
  });

  it('published nothing from the outbox while the tenant was seeding', async () => {
    const [row] = await read((tx) =>
      tx.$queryRaw<{ total: bigint; published: bigint }[]>`
        SELECT count(*) AS total, count(published_at) AS published FROM outbox_event WHERE tenant_id = ${tenantId}::uuid`,
    );
    expect(Number(row!.total)).toBeGreaterThan(0);
    expect(Number(row!.published)).toBe(0);
  });

  it('announced nothing an import must not: no submission, vote or feedback events', async () => {
    const types = await read((tx) => tx.outboxEvent.findMany({ where: { tenantId }, select: { type: true } }));
    const seen = new Set(types.map((row) => row.type));
    expect(seen.has('request.submitted')).toBe(false);
    expect(seen.has('knowledge.article.feedback')).toBe(false);
  });
});
