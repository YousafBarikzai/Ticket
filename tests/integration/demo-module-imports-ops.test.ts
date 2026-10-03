import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SYSTEM_PERMISSIONS,
  beginQuiet,
  buildPermissionSet,
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
import { majorIncidentService, reviewService } from '@itsm/module-incident';
import { problemService } from '@itsm/module-problem';
import { changeService } from '@itsm/module-change';
import { incidentService as statusIncidents } from '@itsm/module-statuspage';
import { entryService } from '@itsm/module-time';
import { notificationService } from '@itsm/module-notifications';
import { importInvitations, importResponses } from '../../modules/feedback/src/service/import-service.js';
import { importSampleDecisions } from '../../modules/ai/src/service/sample-decisions.js';
import { importInApp } from '../../modules/notifications/src/service/import-in-app.js';
import { closeHarness } from '../support/harness.js';

/**
 * The operations, AI and notification history imports (WP-43b; A4 §2.3)
 * against PostgreSQL, in a demo build as the generator makes one: a
 * `kind = 'demo'` tenant provisioned `seeding` and kept quiet from before its
 * first row.
 *
 * One row of each kind goes in through its owner's public entry point, dated
 * when it happened — a satisfaction answer and an unanswered ask, the time
 * an agent logged, a major incident from declaration to its published
 * review, a problem with its workaround, an emergency and a normal change, a
 * status-page incident and maintenance window, two AI sample decisions, two
 * bell notifications — and each is read back from the database with that
 * instant on it. Because the tenant is quiet throughout, any of these paths
 * that queued a job would fail here with `QuietTenantError`; because it is
 * `seeding`, nothing it wrote to the outbox may have been published; and the
 * imports that announce nothing must have left no event behind at all.
 *
 * The unit suites of the eight modules prove each clock and refusal as
 * logic, including that omitting the clock writes exactly today's rows.
 */

const RUN = randomBytes(3).toString('hex');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Every instant below is in the past, as a history is. */
const NOW = Date.now();
const at = (daysAgo: number, minutes = 0) => new Date(NOW - daysAgo * DAY + minutes * MINUTE);

const RESOLVED_RAISED = at(20);
const RESOLVED_AT = at(20, 180);
const CLOSED_AT = at(18);
const REQUEST_RAISED = at(15);
const REQUEST_RESOLVED = at(15, 240);
const OPEN_RAISED = at(1);

let tenantId = '';
let ctx: TenantContext;
let refusalsBefore = 0;

const ids = {
  org: '',
  daniel: '',
  jordan: '',
  aisha: '',
  olivia: '',
  network: '',
  category: '',
  resolved: '',
  resolvedNumber: '',
  request: '',
  open: '',
  mi: '',
  miNumber: '',
  normalChange: '',
  component: '',
};

function as(userId: string): TenantContext {
  return createContext({ tenantId, actor: { type: 'user', id: userId, displayName: userId }, permissions: SYSTEM_PERMISSIONS });
}

function read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext(ctx, () => transaction(ctx, fn));
}

function run<T>(actor: TenantContext, fn: () => Promise<T>): Promise<T> {
  return withContext(actor, fn);
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
    { status: 'seeding', id: tenantId, demo: { generation, seed: 20261002, anchor: new Date(NOW), scale: 0.2, generatorVersion: 'wp43b-test' } },
  );
  ctx = createContext({ tenantId, actor: { type: 'system', id: null, displayName: 'demo-build' }, permissions: SYSTEM_PERMISSIONS });
  ids.org = (await tenantService.createOrganisation(ctx, { name: 'Northwind Traders (UK)', code: 'NW' })).id;

  const person = async (name: string, email: string) =>
    (await run(ctx, () => userService.createUser(ctx, { email: `${email}@${RUN}.example`, displayName: name, primaryOrgId: ids.org, createdAt: at(400) }, 'seed'))).id;
  ids.daniel = await person('Daniel Hughes', 'daniel.hughes');
  ids.jordan = await person('Jordan Lee', 'jordan.lee');
  ids.aisha = await person('Aisha Rahman', 'aisha.rahman');
  ids.olivia = await person('Olivia Bennett', 'olivia.bennett');
  ids.network = (await run(ctx, () => userService.createTeam(ctx, { key: 'network', name: 'Network', orgId: ids.org }))).id;

  // Categories have no service door; the triage questions read them as rows.
  ids.category = randomUUID();
  await read((tx) => tx.category.createMany({ data: [{ id: ids.category, tenantId, name: 'VPN', key: 'network-vpn', path: 'Network > VPN' }] }));

  const tickets = await run(ctx, () =>
    ticketService.importTickets(
      ctx,
      [
        {
          type: 'incident',
          title: 'VPN keeps disconnecting',
          status: 'closed',
          priority: 'P2',
          requesterId: ids.olivia,
          assigneeId: ids.daniel,
          groupId: ids.network,
          categoryId: ids.category,
          sourceChannel: 'email',
          externalRef: `demo:${RUN}:t:0001`,
          createdAt: RESOLVED_RAISED,
          resolvedAt: RESOLVED_AT,
          closedAt: CLOSED_AT,
        },
        {
          type: 'request',
          title: 'New starter laptop for Finance',
          status: 'resolved',
          priority: 'P3',
          requesterId: ids.olivia,
          sourceChannel: 'portal',
          externalRef: `demo:${RUN}:t:0002`,
          createdAt: REQUEST_RAISED,
          resolvedAt: REQUEST_RESOLVED,
        },
        {
          type: 'incident',
          title: 'Cannot sign in to the VPN from home',
          status: 'new',
          priority: 'P3',
          requesterId: ids.olivia,
          sourceChannel: 'teams',
          externalRef: `demo:${RUN}:t:0003`,
          createdAt: OPEN_RAISED,
        },
      ],
      { audit: 'batch', label: `wp43b ${RUN} tickets`, reason: DEMO_BUILD_REASON },
    ),
  );
  ids.resolved = tickets[0]!.id;
  ids.resolvedNumber = tickets[0]!.number;
  ids.request = tickets[1]!.id;
  ids.open = tickets[2]!.id;

  // The provisioning seed's default service is a component of the page.
  ids.component = (await read((tx) => tx.statusComponent.findFirstOrThrow({ select: { key: true } }))).key;
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

describe('feedback: who was asked, and what they said', () => {
  it('imports an answered survey and an ask nobody answered, each when it happened', async () => {
    const sent = new Date(RESOLVED_AT.getTime() + HOUR);
    const answered = new Date(RESOLVED_AT.getTime() + 5 * HOUR);
    const [response] = await run(ctx, () =>
      importResponses(
        ctx,
        [{ surveyKey: 'csat', ticketId: ids.resolved, trigger: 'ticket.resolved', sentAt: sent, respondedAt: answered, answers: { rating: 5, comment: 'Daniel sorted it in minutes.' }, via: 'email' }],
        { audit: 'batch', label: `wp43b ${RUN} csat`, reason: DEMO_BUILD_REASON },
      ),
    );
    expect(response).toMatchObject({ ticketNumber: ids.resolvedNumber, score: 100 });
    const asked = new Date(REQUEST_RESOLVED.getTime() + HOUR);
    await run(ctx, () => importInvitations(ctx, [{ surveyKey: 'csat', ticketId: ids.request, trigger: 'request.fulfilled', sentAt: asked }], { reason: DEMO_BUILD_REASON }));

    const invitations = await read((tx) => tx.surveyInvitation.findMany({ orderBy: { sentAt: 'asc' } }));
    expect(invitations.map((row) => [row.ticketId, row.status, row.sentAt, row.respondedAt])).toEqual([
      [ids.resolved, 'responded', sent, answered],
      // Fourteen days on, its link would no longer work.
      [ids.request, 'expired', asked, null],
    ]);
    const responses = await read((tx) => tx.surveyResponse.findMany());
    expect(responses).toEqual([expect.objectContaining({ ticketId: ids.resolved, respondentId: ids.olivia, score: 100, scale: '1-5', comment: 'Daniel sorted it in minutes.', via: 'email', respondedAt: answered })]);
  });
});

describe('time: what an agent logged', () => {
  it('imports an entry at its instant, priced at the activity’s rate', async () => {
    const logged = new Date(RESOLVED_RAISED.getTime() + HOUR);
    const [entry] = await run(ctx, () =>
      entryService.importEntries(ctx, [{ ticketId: ids.resolved, userId: ids.daniel, activityKey: 'investigation', minutes: 25, loggedAt: logged }], {
        audit: 'batch',
        label: `wp43b ${RUN} time`,
        reason: DEMO_BUILD_REASON,
      }),
    );
    const row = await read((tx) => tx.timeEntry.findFirstOrThrow({ where: { id: entry!.id } }));
    expect(row).toMatchObject({ ticketId: ids.resolved, userId: ids.daniel, kind: 'manual', minutes: 25, loggedAt: logged });
  });
});

describe('a major incident, from declaration to its published review', () => {
  it('dates every timeline entry, stamp and review step when it happened', async () => {
    const daniel = as(ids.daniel);
    const declared = new Date(RESOLVED_RAISED.getTime() + 10 * MINUTE);
    const told = new Date(RESOLVED_RAISED.getTime() + 20 * MINUTE);
    const identified = new Date(RESOLVED_RAISED.getTime() + 30 * MINUTE);
    const handed = new Date(RESOLVED_RAISED.getTime() + 35 * MINUTE);
    const resolved = new Date(RESOLVED_RAISED.getTime() + 130 * MINUTE);
    const reviewed = at(19);
    const agreed = at(19, 30);
    const published = at(17);

    const incident = await run(daniel, () =>
      majorIncidentService.declare(
        daniel,
        { title: 'VPN sign-in failures', severity: 'SEV2', commanderId: ids.daniel, ticketId: ids.resolved, bridgeUrl: 'https://teams.example/l/meetup/vpn-bridge', updateIntervalMinutes: 60 },
        { at: declared },
      ),
    );
    ids.mi = incident.id;
    ids.miNumber = incident.number;
    await run(daniel, () => majorIncidentService.postUpdate(daniel, incident.number, { kind: 'comms', audience: 'stakeholders', body: 'Remote staff may be unable to connect.' }, { at: told }));
    await run(daniel, () => majorIncidentService.transition(daniel, incident.number, { to: 'identified', note: 'Certificate-chain errors since the rotation.' }, { at: identified }));
    await run(daniel, () => majorIncidentService.setRoles(daniel, incident.number, { scribeId: ids.aisha }, { at: handed }));
    await run(daniel, () => majorIncidentService.transition(daniel, incident.number, { to: 'resolved', note: 'The certificate was reissued.' }, { at: resolved }));
    await run(daniel, () => reviewService.saveReview(daniel, incident.number, { summary: 'An intermediate certificate was rotated without its chain.' }, { at: reviewed }));
    await run(daniel, () => reviewService.addAction(daniel, incident.number, { description: 'Alert on certificate-chain errors', ownerId: ids.aisha }, { at: agreed }));
    await run(daniel, () => reviewService.publishAndClose(daniel, incident.number, { at: published }));

    const row = await read((tx) => tx.majorIncident.findFirstOrThrow({ where: { id: incident.id } }));
    expect(row).toMatchObject({ status: 'closed', declaredAt: declared, identifiedAt: identified, resolvedAt: resolved, closedAt: published, updatedAt: published, scribeId: ids.aisha });
    const timeline = await read((tx) => tx.majorIncidentUpdate.findMany({ where: { incidentId: incident.id }, orderBy: { occurredAt: 'asc' } }));
    expect(timeline.map((entry) => entry.occurredAt)).toEqual([declared, told, identified, handed, resolved, published]);
    const review = await read((tx) => tx.postIncidentReview.findFirstOrThrow({ where: { incidentId: incident.id } }));
    expect(review).toMatchObject({ status: 'published', createdAt: resolved, publishedAt: published, durationMinutes: 120 });
    const action = await read((tx) => tx.actionItem.findFirstOrThrow({ where: { reviewId: review.id } }));
    expect(action).toMatchObject({ createdAt: agreed, ownerId: ids.aisha });
  });
});

describe('a problem, its workaround and its fix', () => {
  it('dates the problem, each link, the known error and the resolution', async () => {
    const aisha = as(ids.aisha);
    const raised = new Date(RESOLVED_RAISED.getTime() + 3 * HOUR);
    const workaround = at(19);
    const linked = new Date(OPEN_RAISED.getTime() + HOUR);
    const fixed = at(0, -600);

    const problem = await run(aisha, () =>
      problemService.createProblem(aisha, { title: 'Intermittent VPN authentication failures after certificate rotation', ownerId: ids.aisha, ticketIds: [ids.resolved] }, { at: raised }),
    );
    await run(aisha, () =>
      problemService.publishKnownError(aisha, problem.number, { symptom: 'The VPN says "Authentication failed"', workaround: 'Reconnect after clearing the saved certificate.', articleKey: 'vpn-authentication-failed' }, { at: workaround }),
    );
    await run(aisha, () => problemService.linkTickets(aisha, problem.number, { ticketIds: [ids.open], workaroundApplied: true }, { at: linked }));
    await run(aisha, () => problemService.transition(aisha, problem.number, { to: 'resolved', rootCause: 'The rotation script dropped the intermediate.' }, { at: fixed }));

    const row = await read((tx) => tx.problem.findFirstOrThrow({ where: { id: problem.id } }));
    expect(row).toMatchObject({ status: 'resolved', createdAt: raised, resolvedAt: fixed, updatedAt: fixed });
    const links = await read((tx) => tx.problemTicket.findMany({ where: { problemId: problem.id }, orderBy: { linkedAt: 'asc' } }));
    expect(links.map((link) => [link.ticketId, link.linkedAt])).toEqual([
      [ids.resolved, raised],
      [ids.open, linked],
    ]);
    const knownError = await read((tx) => tx.knownError.findFirstOrThrow({ where: { problemId: problem.id } }));
    expect(knownError).toMatchObject({ status: 'retired', publishedAt: workaround, retiredAt: fixed });
  });
});

describe('changes: an emergency approved afterwards, and a normal one carried out', () => {
  it('dates each step, and the debt is paid when it was', async () => {
    const daniel = as(ids.daniel);
    const jordan = as(ids.jordan);
    const raised = new Date(RESOLVED_RAISED.getTime() + 40 * MINUTE);
    const started = new Date(RESOLVED_RAISED.getTime() + 60 * MINUTE);
    const approved = at(19, 120);

    const emergency = await run(daniel, () =>
      changeService.createChange(daniel, { title: 'Reissue the VPN gateway intermediate certificate', kind: 'emergency', risk: 'high', majorIncidentId: ids.mi }, { at: raised }),
    );
    await run(daniel, () => changeService.submitChange(daniel, emergency.number, { at: raised }));
    await run(daniel, () => changeService.transition(daniel, emergency.number, { to: 'implementing' }, { at: started }));
    await run(jordan, () => changeService.approveRetrospectively(jordan, emergency.number, 'Reviewed at CAB.', { at: approved }));
    const row = await read((tx) => tx.change.findFirstOrThrow({ where: { id: emergency.id } }));
    expect(row).toMatchObject({ status: 'implementing', createdAt: raised, actualStartAt: started, retrospectiveApprovedAt: approved, retrospectiveApprovedBy: ids.jordan, updatedAt: approved });

    const window = { plannedStartAt: at(9, 19 * 60), plannedEndAt: at(9, 21 * 60) };
    const normal = await run(daniel, () =>
      changeService.createChange(daniel, { title: 'Wi-Fi AP replacement — London 4th floor', kind: 'normal', risk: 'medium', backoutPlan: 'Refit the old access points.' }, { at: at(12) }),
    );
    ids.normalChange = normal.id;
    // No change policy is seeded, so it is approved on submission, with the reason written down.
    await run(daniel, () => changeService.submitChange(daniel, normal.number, { at: at(12, 30) }));
    await run(daniel, () => changeService.scheduleChange(daniel, normal.number, window, { at: at(11) }));
    await run(daniel, () => changeService.transition(daniel, normal.number, { to: 'implementing' }, { at: window.plannedStartAt }));
    await run(daniel, () => changeService.transition(daniel, normal.number, { to: 'review' }, { at: window.plannedEndAt }));
    await run(daniel, () => changeService.transition(daniel, normal.number, { to: 'closed', closeCode: 'successful' }, { at: at(8) }));
    const done = await read((tx) => tx.change.findFirstOrThrow({ where: { id: normal.id } }));
    expect(done).toMatchObject({ status: 'closed', createdAt: at(12), actualStartAt: window.plannedStartAt, actualEndAt: window.plannedEndAt, closedAt: at(8), closeCode: 'successful' });
  });
});

describe('the status page, written by the build rather than mirrored', () => {
  it('imports a past incident with its timeline and a maintenance window, and tells nobody', async () => {
    const opened = new Date(RESOLVED_RAISED.getTime() + 15 * MINUTE);
    const fixed = new Date(RESOLVED_RAISED.getTime() + 130 * MINUTE);
    const { incident } = await run(ctx, () =>
      statusIncidents.importIncident(
        ctx,
        {
          title: 'VPN sign-in failures for remote staff',
          impact: 'major',
          componentKeys: [ids.component],
          majorIncidentId: ids.mi,
          updates: [
            { body: 'Remote staff may be unable to connect to the VPN.', at: opened },
            { status: 'resolved', body: 'Everyone can connect again.', at: fixed },
          ],
        },
        { reason: DEMO_BUILD_REASON },
      ),
    );
    const announced = at(3);
    const window = await run(ctx, () =>
      statusIncidents.importMaintenance(
        ctx,
        { title: 'Wi-Fi AP replacement — London 4th floor', componentKeys: [ids.component], startsAt: new Date(NOW + 2 * DAY), endsAt: new Date(NOW + 2 * DAY + 2 * HOUR), changeId: ids.normalChange, at: announced },
        { reason: DEMO_BUILD_REASON },
      ),
    );

    const row = await read((tx) => tx.statusIncident.findFirstOrThrow({ where: { id: incident.id } }));
    expect(row).toMatchObject({ status: 'resolved', majorIncidentId: ids.mi, startedAt: opened, resolvedAt: fixed, createdAt: opened });
    const lines = await read((tx) => tx.statusUpdate.findMany({ where: { incidentId: incident.id }, orderBy: { postedAt: 'asc' } }));
    expect(lines.map((line) => [line.status, line.postedAt, line.notifiedAt])).toEqual([
      ['investigating', opened, null],
      ['resolved', fixed, null],
    ]);
    expect(await read((tx) => tx.maintenanceWindow.findFirstOrThrow({ where: { id: window.id } }))).toMatchObject({ status: 'scheduled', createdAt: announced, changeId: ids.normalChange });
    expect(await read((tx) => tx.statusComponent.findFirstOrThrow({ where: { key: ids.component } }))).toMatchObject({ status: 'operational' });
  });
});

describe('AI samples, in the demo only', () => {
  it('records a suggestion on an open ticket, and an accepted one settled at its ticket’s resolution', async () => {
    const answers = {
      type: { value: 'incident', confidence: 0.95 },
      category: { value: 'Network > VPN', confidence: 0.86 },
      group: { value: 'Network', confidence: 0.8 },
      priority: { value: 'P2', confidence: 0.7 },
      majorIncident: { value: false, confidence: 0.9 },
    };
    const results = await run(ctx, () =>
      importSampleDecisions(
        ctx,
        [
          { provider: 'sample', ticketId: ids.open, createdAt: new Date(OPEN_RAISED.getTime() + 5_000), answers },
          {
            provider: 'sample',
            ticketId: ids.resolved,
            createdAt: new Date(RESOLVED_RAISED.getTime() + 5_000),
            answers,
            baseline: { type: 'incident', categoryId: null, groupId: null, priority: 'P2' },
            responses: { group: { action: 'accepted', by: ids.daniel, at: new Date(RESOLVED_RAISED.getTime() + 8 * MINUTE) } },
          },
        ],
        { label: `wp43b ${RUN} AI samples`, reason: DEMO_BUILD_REASON },
      ),
    );
    expect(results.map((each) => [each.outcome, each.settled])).toEqual([
      ['suggested', false],
      ['suggested', true],
    ]);
    const rows = await read((tx) => tx.aiDecision.findMany({ orderBy: { createdAt: 'asc' } }));
    expect(rows.map((row) => [row.subjectId, row.provider, row.model, row.mode, Number(row.costMicros), row.settledAt])).toEqual([
      [ids.resolved, 'sample', 'sample', 'suggest', 0, RESOLVED_AT],
      [ids.open, 'sample', 'sample', 'suggest', 0, null],
    ]);
    expect(rows[1]!.proposed).toMatchObject({ category: ids.category, group: ids.network, priority: 'P2' });
  });
});

describe('the bell: notifications already in the inbox', () => {
  it('imports samples the live inbox reads, newest first', async () => {
    await run(ctx, () =>
      importInApp(
        ctx,
        [
          { recipientId: ids.daniel, ticketId: ids.open, subject: 'A ticket was assigned to you', body: 'Cannot sign in to the VPN from home.', createdAt: at(0, -30), kind: 'assigned' },
          { recipientId: ids.daniel, subject: `${ids.miNumber} declared`, body: 'SEV2: VPN sign-in failures.', createdAt: at(0, -60), readAt: at(0, -50), kind: 'major_incident' },
        ],
        { reason: DEMO_BUILD_REASON },
      ),
    );
    const daniel = createContext({ tenantId, actor: { type: 'user', id: ids.daniel }, permissions: buildPermissionSet([{ key: 'notification.read', scope: 'own' }]) });
    const inbox = await run(daniel, () => notificationService.listInbox(daniel, { limit: 10 }));
    expect(inbox.unread).toBe(1);
    expect(inbox.data.map((row) => [row.eventType, row.subject, row.status])).toEqual([
      ['demo.sample', 'A ticket was assigned to you', 'sent'],
      ['demo.sample', `${ids.miNumber} declared`, 'sent'],
    ]);
  });
});

describe('the quiet window held', () => {
  it('refused no job, published no event, and the announcing-nothing imports left no event behind', async () => {
    expect(quietRefusals()).toBe(refusalsBefore);
    const published = await read((tx) => tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM outbox_event WHERE tenant_id = ${tenantId}::uuid AND published_at IS NOT NULL`);
    expect(Number(published[0]!.count)).toBe(0);
    const silent = await read((tx) =>
      tx.$queryRaw<{ type: string }[]>`
        SELECT DISTINCT type FROM outbox_event
         WHERE tenant_id = ${tenantId}::uuid
           AND type IN ('survey.invited', 'survey.responded', 'time.entry.logged', 'status.incident.updated', 'status.maintenance.scheduled', 'notification.queued')`,
    );
    expect(silent).toEqual([]);
    expect(await read((tx) => tx.deliveryAttempt.count())).toBe(0);
    expect(await read((tx) => tx.notification.count({ where: { eventType: { not: 'demo.sample' } } }))).toBe(0);
  });

  it('wrote the batch imports’ audit rows with the build’s reason', async () => {
    const actions = await read((tx) => tx.auditEvent.findMany({ where: { reason: DEMO_BUILD_REASON }, select: { action: true } }));
    expect(new Set(actions.map((row) => row.action))).toEqual(
      new Set([
        'ticket.imported.batch',
        'survey.responses.imported.batch',
        'survey.invitation.imported',
        'time.entries.imported.batch',
        'statuspage.incident.imported',
        'statuspage.maintenance.imported',
        'ai.decisions.imported.batch',
        'notifications.inapp.imported.batch',
      ]),
    );
  });
});
