import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.LOG_SILENT ??= '1';
// Each role matters: the application role is the one row-level security
// constrains, and the platform role is the only one that may write the tenant
// directory. Pointing both at the owner would test a configuration that never
// runs in production.
process.env.DATABASE_URL_APP = process.env.TEST_DATABASE_URL_APP ?? process.env.TEST_DATABASE_URL ?? '';
process.env.DATABASE_URL_PLATFORM = process.env.TEST_DATABASE_URL_PLATFORM ?? process.env.TEST_DATABASE_URL ?? '';

import type { FastifyInstance } from 'fastify';
import {
  SYSTEM_PERMISSIONS,
  createContext,
  disconnectDb,
  disconnectRedis,
  platformDb,
  withContext,
  type TenantContext,
} from '@itsm/platform';
import { bootstrapModules } from '@itsm/runtime';
import { tenantService } from '@itsm/module-tenancy';
import { userService } from '@itsm/module-identity';
import { ticketService } from '@itsm/module-ticket';
import { buildApp } from '../../apps/api/src/app.js';
import { signDevelopmentToken } from '../../apps/api/src/auth/verify.js';

/**
 * The integration harness.
 *
 * Tests drive the real Fastify app in-process through `app.inject`, so every
 * request passes through the same plugin chain as production: authentication,
 * tenant resolution, context binding, rate limits and the error handler. A test
 * that calls a service directly would skip exactly the layers most likely to
 * be wrong.
 */

export interface TestPerson {
  id: string;
  email: string;
  token: string;
  displayName: string;
}

export interface TestTenant {
  id: string;
  slug: string;
  orgId: string;
  teamId: string;
  otherTeamId: string;
  people: Record<string, TestPerson>;
  ticketIds: string[];
  ticketNumbers: string[];
}

let app: FastifyInstance | undefined;

// Registered at module load, not inside getApp: provisioning a tenant runs the
// modules' seed steps, and a test that creates a tenant before it makes its
// first request would otherwise get a tenant with no roles in it.
bootstrapModules();

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function closeHarness(): Promise<void> {
  await app?.close();
  app = undefined;
  await disconnectDb();
  await disconnectRedis();
}

export function contextFor(tenantId: string): TenantContext {
  return createContext({ tenantId, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
}

const PEOPLE = [
  { key: 'admin', name: 'Alex Administrator', local: 'alex.admin', role: 'administrator' },
  { key: 'lead', name: 'Priya Lead', local: 'priya.lead', role: 'team_lead', team: 'primary' },
  { key: 'agent', name: 'Sam Agent', local: 'sam.agent', role: 'agent', team: 'primary' },
  { key: 'otherAgent', name: 'Jo Resolver', local: 'jo.resolver', role: 'agent', team: 'other' },
  { key: 'requester', name: 'Ada Requester', local: 'ada.requester', role: 'requester' },
  { key: 'otherRequester', name: 'Grace Requester', local: 'grace.requester', role: 'requester' },
  // A person whose roles tests may change without disturbing anyone else's
  // expectations. Nothing asserts this person's permissions.
  { key: 'spare', name: 'Sandy Spare', local: 'sandy.spare', role: 'requester' },
] as const;

/**
 * Builds a tenant with a fixed shape. Two of these, with identical data, are
 * what the isolation suite compares: identical-looking records are the only way
 * to prove that nothing crosses the boundary by accident.
 */
export async function createTestTenant(slug: string): Promise<TestTenant> {
  const existing = await tenantService.findTenantBySlug(slug);
  if (existing) await tenantService.purgeTenant(existing.id);

  const { tenantId } = await tenantService.provisionTenant({ name: `Tenant ${slug}`, slug, region: 'eu-west' });
  const base = contextFor(tenantId);

  return withContext(base, async () => {
    const org = await tenantService.createOrganisation(base, { name: `Org ${slug}`, code: `ORG-${slug.toUpperCase()}` });
    const ctx: TenantContext = { ...base, organisationIds: [org.id], organisationPaths: [org.path] };

    const primary = await userService.createTeam(ctx, { key: 'service-desk', name: 'Service Desk', orgId: org.id });
    const other = await userService.createTeam(ctx, { key: 'network-team', name: 'Network Team', orgId: org.id });
    const teams: Record<string, string> = { primary: primary.id, other: other.id };

    const people: Record<string, TestPerson> = {};
    for (const person of PEOPLE) {
      const user = await userService.createUser(
        ctx,
        { email: `${person.local}@${slug}.test`, displayName: person.name, primaryOrgId: org.id },
        'seed',
      );
      await userService.assignRole(ctx, { userId: user.id, roleKey: person.role });
      if ('team' in person && person.team) {
        await userService.addTeamMember(ctx, teams[person.team]!, user.id, person.role === 'team_lead');
      }
      people[person.key] = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        token: signDevelopmentToken({
          sub: user.id,
          itsm_user_id: user.id,
          tenant_id: tenantId,
          email: user.email,
          name: user.displayName,
          sid: `test-${user.id}`,
        }),
      };
    }

    // Identical titles in both tenants on purpose.
    const ticketIds: string[] = [];
    const ticketNumbers: string[] = [];
    for (const seed of [
      { title: 'VPN will not connect', group: primary.id, requester: 'requester' },
      { title: 'Printer is jammed', group: primary.id, requester: 'otherRequester' },
      { title: 'Switch port is down', group: other.id, requester: 'requester' },
    ]) {
      const requesterCtx: TenantContext = {
        ...ctx,
        actor: { type: 'user', id: people[seed.requester]!.id, displayName: seed.requester },
      };
      const ticket = await withContext(requesterCtx, () =>
        ticketService.createTicket(requesterCtx, {
          type: 'incident',
          title: seed.title,
          description: `${seed.title} — created by the test harness.`,
          priority: 'P3',
          requesterId: people[seed.requester]!.id,
          groupId: seed.group,
          orgId: org.id,
          sourceChannel: 'portal',
        }),
      );
      ticketIds.push(ticket.id);
      ticketNumbers.push(ticket.number);
    }

    return { id: tenantId, slug, orgId: org.id, teamId: primary.id, otherTeamId: other.id, people, ticketIds, ticketNumbers };
  });
}

export async function deleteTestTenant(slug: string): Promise<void> {
  const tenant = await tenantService.findTenantBySlug(slug);
  // A real purge, not just the directory row. Deleting the tenant alone leaves
  // every tenant-scoped table holding its rows, and anything that looks *across*
  // tenants can still find them — which is how an orphaned mailbox from a
  // deleted tenant went on receiving mail.
  if (tenant) await tenantService.purgeTenant(tenant.id);
}

export interface InjectOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** One request through the whole plugin chain. */
export async function request<T = unknown>(
  path: string,
  options: InjectOptions = {},
): Promise<{ status: number; body: T; headers: Record<string, unknown> }> {
  const instance = await getApp();
  const response = await instance.inject({
    method: options.method ?? 'GET',
    url: path,
    ...(options.token ? { headers: { authorization: `Bearer ${options.token}`, ...options.headers } } : { headers: options.headers ?? {} }),
    ...(options.body !== undefined ? { payload: options.body as object } : {}),
  });

  let body: T;
  try {
    body = response.body ? (JSON.parse(response.body) as T) : ({} as T);
  } catch {
    body = response.body as unknown as T;
  }
  return { status: response.statusCode, body, headers: response.headers as Record<string, unknown> };
}

/**
 * Runs the event handlers the way the worker would, in process.
 *
 * Phase 1's event-driven behaviour was proved by the walking skeleton against a
 * real worker, which is the right test but a slow one to write against. From
 * Phase 2 the rules engine, approvals and the email channel are all reached
 * only through events, so the suite needs to be able to drive a handler
 * directly. This reads the outbox exactly as the publisher does and hands each
 * envelope to each registered consumer, then repeats: a handler may publish
 * events of its own, and a rule that changes a ticket is precisely that case.
 *
 * Returns how many deliveries were made, so a test can assert that something
 * actually ran rather than silently passing on an empty outbox.
 */
/**
 * Waits for the external search engine to finish what it has been given.
 *
 * Meilisearch accepts a write with 202 and indexes it a moment later, so any
 * assertion made immediately after indexing is a race. Waiting here rather than
 * sleeping in each test keeps the waiting in one place and makes it honest: the
 * platform's contract is search freshness within seconds, not instantly.
 */
export async function settleSearch(timeoutMs = 20_000): Promise<void> {
  const url = process.env.MEILISEARCH_URL;
  if (!url) return;

  const base = url.replace(/\/+$/, '');
  const key = process.env.MEILISEARCH_API_KEY;
  const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const response = await fetch(`${base}/tasks?statuses=enqueued,processing&limit=1`, { headers });
      const body = (await response.json()) as { results?: unknown[] };
      if ((body.results?.length ?? 0) === 0) return;
    } catch {
      // The engine is not answering; the fallback covers this, and a test that
      // needed it will fail on its own assertion rather than here.
      return;
    }
    if (Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function drainEvents(tenantId: string, rounds = 5): Promise<number> {
  const { consumersFor, systemContext, transaction, withContext } = await import('@itsm/platform');
  const { outboxPublisher } = await import('@itsm/module-integrations');

  const ctx = systemContext(tenantId, { region: 'eu-west' });
  let delivered = 0;
  const seen = new Set<string>();

  for (let round = 0; round < rounds; round += 1) {
    const rows = await withContext(ctx, () =>
      transaction(ctx, (tx) =>
        tx.outboxEvent.findMany({ orderBy: { createdAt: 'asc' }, take: 500 }),
      ),
    );
    const fresh = rows.filter((row) => !seen.has(row.id));
    if (fresh.length === 0) {
      // Pushing a document to the external search engine is one of the
      // consumers that just ran, and the engine indexes asynchronously. A test
      // that drains events and then searches is entitled to see the result.
      await settleSearch();
      return delivered;
    }

    for (const row of fresh) {
      seen.add(row.id);
      const envelope = row.envelope as never as { type: string };
      for (const consumer of consumersFor(envelope.type)) {
        await outboxPublisher.dispatchToConsumer(consumer, row.envelope as never);
        delivered += 1;
      }
    }
  }
  await settleSearch();
  return delivered;
}
