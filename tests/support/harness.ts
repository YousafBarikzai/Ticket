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
  if (existing) await platformDb().tenant.delete({ where: { id: existing.id } });

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
  if (tenant) await platformDb().tenant.delete({ where: { id: tenant.id } });
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
