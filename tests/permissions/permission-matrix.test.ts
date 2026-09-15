import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permissionRegistry } from '@itsm/platform';
import { SYSTEM_ROLES } from '@itsm/module-identity';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * The permission matrix suite (specification Appendix B).
 *
 * Release-blocking. For each persona and each endpoint, the expected allow or
 * deny is asserted against the running API — not against the permission
 * checker in isolation, because the thing worth proving is that the route, the
 * service and the scope resolver agree.
 *
 * "Denied" means 403 when the caller may know the record exists and 404 when
 * they may not (specification §7).
 */

type Persona = 'requester' | 'agent' | 'lead' | 'otherAgent' | 'admin';

interface MatrixEntry {
  what: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: (tenant: TestTenant) => string;
  body?: (tenant: TestTenant) => unknown;
  /** Personas that must be allowed. Everyone else must be refused. */
  allowed: Persona[];
  /** The status a refusal takes for personas that cannot see the record at all. */
  deniedStatus?: Record<string, number>;
}

const ALL_PERSONAS: Persona[] = ['requester', 'agent', 'lead', 'otherAgent', 'admin'];

const MATRIX: MatrixEntry[] = [
  {
    what: 'read own ticket',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[0]}`,
    // Ticket 0 belongs to `requester` and sits in the primary team's queue, so
    // the agent in the other team cannot see it at all.
    allowed: ['requester', 'agent', 'lead', 'admin'],
    deniedStatus: { otherAgent: 404 },
  },
  {
    what: 'read another person\'s ticket',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[1]}`,
    allowed: ['agent', 'lead', 'admin'],
    deniedStatus: { requester: 404, otherAgent: 404 },
  },
  {
    what: 'read a ticket in another team',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[2]}`,
    // Ticket 2 is the other team's and was raised by `requester`.
    allowed: ['requester', 'otherAgent', 'admin'],
    deniedStatus: { agent: 404, lead: 404 },
  },
  {
    what: 'create a ticket',
    method: 'POST',
    path: () => '/api/v1/tickets',
    body: () => ({ type: 'incident', title: 'Matrix test ticket', sourceChannel: 'portal' }),
    allowed: ALL_PERSONAS,
  },
  {
    what: 'add a public reply',
    method: 'POST',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[0]}/comments`,
    body: () => ({ body: 'a public reply', visibility: 'public' }),
    allowed: ['requester', 'agent', 'lead', 'admin'],
    deniedStatus: { otherAgent: 404 },
  },
  {
    what: 'add an internal note',
    method: 'POST',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[0]}/comments`,
    body: () => ({ body: 'an internal note', visibility: 'internal' }),
    // The requester may see this ticket, so the refusal is 403, not 404.
    allowed: ['agent', 'lead', 'admin'],
    deniedStatus: { requester: 403, otherAgent: 404 },
  },
  {
    what: 'assign a ticket',
    method: 'POST',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[0]}/assign`,
    body: () => ({ method: 'manual' }),
    allowed: ['agent', 'lead', 'admin'],
    deniedStatus: { requester: 403, otherAgent: 404 },
  },
  {
    what: 'search',
    path: () => '/api/v1/search?q=VPN',
    allowed: ALL_PERSONAS,
  },
  {
    what: 'list users',
    path: () => '/api/v1/users',
    // A requester holds `identity.user.read` at `own` scope, so the request
    // succeeds but returns only themselves; the assertion is on the contents.
    allowed: ['agent', 'lead', 'admin', 'otherAgent', 'requester'],
  },
  {
    what: 'create a user',
    method: 'POST',
    path: () => '/api/v1/users',
    body: () => ({ email: `matrix-${Date.now()}@example.test`, displayName: 'Matrix User' }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'grant a role',
    method: 'POST',
    path: () => '/api/v1/role-assignments',
    // Granted to the spare person: a matrix entry must not change what another
    // entry expects of a persona.
    body: (t) => ({ userId: t.people.spare!.id, roleKey: 'agent' }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'read the audit trail',
    path: () => '/api/v1/audit-events?limit=5',
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'read security alerts',
    path: () => '/api/v1/security/alerts',
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'publish a setting',
    method: 'PATCH',
    path: () => '/api/v1/settings/ticket.autoClose.days',
    body: () => ({ value: 10 }),
    allowed: [],
    // PATCH is not a method this route accepts; the matrix proves nobody gets in
    // through an unintended verb either.
    deniedStatus: { requester: 404, agent: 404, lead: 404, otherAgent: 404, admin: 404 },
  },
  {
    what: 'change a setting',
    method: 'POST',
    path: () => '/api/v1/settings/ticket.autoClose.days',
    body: () => ({ value: 10 }),
    allowed: [],
    deniedStatus: { requester: 404, agent: 404, lead: 404, otherAgent: 404, admin: 404 },
  },
  {
    what: 'manage webhooks',
    method: 'POST',
    path: () => '/api/v1/webhooks',
    body: () => ({ name: 'matrix', url: 'https://example.test/hook', eventTypes: ['ticket.created'] }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'enable a module',
    method: 'POST',
    path: () => '/api/v1/modules/MOD-09/enable',
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'read the business rules',
    path: () => '/api/v1/rules',
    // A lead needs to see why their queue is routed as it is; an agent does not.
    allowed: ['admin', 'lead'],
    deniedStatus: { requester: 403, agent: 403, otherAgent: 403 },
  },
  {
    what: 'write a business rule',
    method: 'POST',
    path: () => '/api/v1/rules',
    body: () => ({
      key: `matrix-${Date.now()}`,
      name: 'Matrix rule',
      event: 'ticket.created',
      conditions: { always: true },
      actions: [{ type: 'addTag', tag: 'matrix' }],
    }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'publish a business rule',
    method: 'POST',
    path: () => '/api/v1/rules/major-incident-p1/publish',
    // Publishing changes what happens to every team's tickets, so it is the
    // administrator's, not a lead's.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'see the approvals waiting on them',
    path: () => '/api/v1/approvals',
    // Anyone can be named an approver, so everyone may open their own queue.
    allowed: ALL_PERSONAS,
  },
  {
    what: 'read the approval policies',
    path: () => '/api/v1/approval-policies',
    allowed: ['admin', 'lead'],
    deniedStatus: { requester: 403, agent: 403, otherAgent: 403 },
  },
  {
    what: 'write an approval policy',
    method: 'POST',
    path: () => '/api/v1/approval-policies',
    body: () => ({
      key: `matrix-approval-${Date.now()}`,
      name: 'Matrix policy',
      subjectType: 'request',
      steps: [{ name: 'Manager', approvers: [{ kind: 'manager', levels: 1 }] }],
    }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'browse the catalogue',
    path: () => '/api/v1/catalogue',
    allowed: ALL_PERSONAS,
  },
  {
    what: 'raise a request from the catalogue',
    method: 'POST',
    path: () => '/api/v1/catalogue/system-access/submit',
    body: () => ({ answers: { system: 'crm', accessLevel: 'read' } }),
    allowed: ALL_PERSONAS,
  },
  {
    what: 'write a catalogue item',
    method: 'POST',
    path: () => '/api/v1/request-types',
    body: () => ({ key: `matrix-item-${Date.now()}`, serviceKey: 'business-applications', name: 'Matrix item' }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'write a form definition',
    method: 'POST',
    path: () => '/api/v1/forms',
    body: () => ({
      key: `matrix-form-${Date.now()}`,
      name: 'Matrix form',
      document: {
        key: 'matrix-form',
        schema: { type: 'object', properties: { note: { type: 'string' } } },
        ui: { elements: [{ kind: 'field', field: 'note', control: 'text' }] },
      },
    }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'read the knowledge base',
    path: () => '/api/v1/knowledge',
    // Everyone reads; what differs is what comes back, which the scope tests
    // below cover rather than this allow/deny matrix.
    allowed: ['requester', 'agent', 'lead', 'otherAgent', 'admin'],
  },
  {
    what: 'write an article',
    method: 'POST',
    path: () => '/api/v1/knowledge',
    body: () => ({
      key: `matrix-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Written during the permission matrix run',
      body: [{ kind: 'paragraph', runs: [{ text: 'Placeholder.' }] }],
      audience: 'internal',
    }),
    // An article is usually written by whoever just worked out the answer, so
    // an agent writes. A requester does not.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'see who is on call',
    path: () => '/api/v1/workload/rotations',
    // Anybody who takes tickets needs to know who to hand a P1 to at six in
    // the evening. A requester does not.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'say they are available for work',
    method: 'PUT',
    path: () => '/api/v1/workload/availability',
    body: () => ({ status: 'available' }),
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'write a shift pattern',
    method: 'POST',
    path: () => '/api/v1/workload/shifts',
    body: (t) => ({
      key: `matrix-shift-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Written during the permission matrix run',
      teamId: t.teamId,
      timeZone: 'Europe/London',
      pattern: { mon: [{ from: '09:00', to: '17:00' }] },
    }),
    // A lead runs the rota day to day; writing the pattern changes who works
    // every week to come, which is an administrator's.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'ask why the queue is not moving',
    path: (t) => `/api/v1/workload/routing/${t.teamId}/explain`,
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'see the major incidents',
    path: () => '/api/v1/major-incidents',
    // Anybody who takes tickets needs to know what is on fire. A requester
    // hears about it from the portal and the status page, not from here.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'declare a major incident',
    method: 'POST',
    path: () => '/api/v1/major-incidents',
    body: (t) => ({
      title: 'Declared during the permission matrix run',
      severity: 'SEV3',
      commanderId: t.people.lead!.id,
    }),
    // Declaring pages people, so it is a lead's. An agent runs one once it is
    // declared, which is `incident.major.command`, not this.
    allowed: ['lead', 'admin'],
    deniedStatus: { requester: 403, agent: 403, otherAgent: 403 },
  },
  {
    what: 'search the known errors',
    path: () => '/api/v1/known-errors',
    // What an agent reads before spending an hour on something already solved.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'raise a problem',
    method: 'POST',
    path: () => '/api/v1/problems',
    body: () => ({ title: 'Raised during the permission matrix run', priority: 'P4' }),
    // An agent raises one: they are the person who noticed it three times.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'see the change calendar',
    path: () => '/api/v1/changes',
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'declare a blackout window',
    method: 'POST',
    path: () => '/api/v1/change-windows',
    body: () => ({
      kind: 'blackout',
      name: `Matrix blackout ${Math.random().toString(36).slice(2, 10)}`,
      timeZone: 'Europe/London',
      startsAt: '2027-01-01T00:00:00Z',
      endsAt: '2027-01-02T00:00:00Z',
    }),
    // A blackout stops everybody's changes, so writing one is an
    // administrator's.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'read the configuration item register',
    path: () => '/api/v1/cis',
    // An agent reads the CMDB during triage; a requester has no business in it.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'say what a record touched',
    method: 'POST',
    path: () => '/api/v1/ci-links',
    body: () => ({
      entityType: 'ticket',
      entityId: '00000000-0000-4000-8000-000000000000',
      ciId: '00000000-0000-4000-8000-000000000001',
    }),
    // Nobody is allowed outright here because the configuration item does not
    // exist, so a permitted caller gets 404 and a refused one 403 — which is
    // the distinction worth asserting: an agent may link, a requester may not.
    allowed: [],
    deniedStatus: { requester: 403, agent: 404, lead: 404, otherAgent: 404, admin: 404 },
  },
  {
    what: 'read the asset register',
    path: () => '/api/v1/assets',
    // An agent is asked "what laptop does this person have?" all day. Changing
    // the answer is a lead's.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'reach the platform console',
    path: () => '/api/platform/v1/tenants',
    // A tenant administrator is not a platform operator.
    allowed: [],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403, admin: 403 },
  },
];

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('matrix');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('matrix');
  await closeHarness();
});

describe('permission matrix', () => {
  for (const entry of MATRIX) {
    for (const persona of ALL_PERSONAS) {
      const shouldAllow = entry.allowed.includes(persona);
      const expectedDenied = entry.deniedStatus?.[persona];

      it(`${persona} ${shouldAllow ? 'may' : 'may not'} ${entry.what}`, async () => {
        const response = await request(entry.path(tenant), {
          method: entry.method ?? 'GET',
          token: tenant.people[persona]!.token,
          ...(entry.body ? { body: entry.body(tenant) } : {}),
        });

        if (expectedDenied !== undefined) {
          expect(response.status).toBe(expectedDenied);
          return;
        }
        if (shouldAllow) {
          expect(response.status).toBeLessThan(400);
        } else {
          expect([401, 403, 404]).toContain(response.status);
        }
      });
    }
  }
});

describe('publishing knowledge is a separate permission from writing it', () => {
  // Not in the matrix above, because publishing is not idempotent: once one
  // persona publishes the draft, the next finds nothing to publish and fails
  // for the wrong reason. Each persona gets its own article instead, which is
  // also closer to what actually happens.
  for (const persona of ALL_PERSONAS) {
    const mayPublish = persona === 'lead' || persona === 'admin';

    it(`${persona} ${mayPublish ? 'may' : 'may not'} publish an article`, async () => {
      const key = `matrix-publish-${persona.toLowerCase()}`;
      const created = await request('/api/v1/knowledge', {
        method: 'POST',
        token: tenant.people.admin!.token,
        body: {
          key,
          title: `An article for ${persona} to try to publish`,
          body: [{ kind: 'paragraph', runs: [{ text: 'Placeholder.' }] }],
          audience: 'tenant',
        },
      });
      // A 404 from a missing article would pass a deny assertion for the wrong
      // reason, which is how a permission test quietly stops testing anything.
      expect(created.status).toBe(201);

      const response = await request(`/api/v1/knowledge/${key}/publish`, {
        method: 'POST',
        token: tenant.people[persona]!.token,
      });

      if (mayPublish) {
        expect(response.status).toBeLessThan(400);
      } else {
        expect(response.status).toBe(403);
      }
    });
  }

  it('lets an agent write a draft but not make it live', async () => {
    // The distinction the two permissions exist for: anyone who works out an
    // answer should write it down; somebody accountable decides it is right.
    const key = 'matrix-agent-draft';
    const created = await request('/api/v1/knowledge', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: {
        key,
        title: 'Written by an agent',
        body: [{ kind: 'paragraph', runs: [{ text: 'What I just worked out.' }] }],
        audience: 'internal',
      },
    });
    expect(created.status).toBe(201);
    expect((await request(`/api/v1/knowledge/${key}/publish`, { method: 'POST', token: tenant.people.agent!.token })).status).toBe(403);
    expect((await request(`/api/v1/knowledge/${key}/publish`, { method: 'POST', token: tenant.people.lead!.token })).status).toBeLessThan(400);
  });
});

describe('writing the register is separate from reading it', () => {
  // Not in the matrix above, because the call needs a class that exists, and
  // creating one is itself a permitted write. Each persona is asserted against
  // a register that is already set up, which is the real situation.
  beforeAll(async () => {
    const created = await request('/api/v1/ci-classes', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { key: 'matrix-server', name: 'Server' },
    });
    // A 409 means a previous run left it behind, which is fine; anything else
    // would make the deny assertions below pass for the wrong reason.
    expect([201, 409]).toContain(created.status);
  }, 60_000);

  for (const persona of ALL_PERSONAS) {
    const mayWrite = persona === 'lead' || persona === 'admin';

    it(`${persona} ${mayWrite ? 'may' : 'may not'} add a configuration item`, async () => {
      const response = await request('/api/v1/cis', {
        method: 'POST',
        token: tenant.people[persona]!.token,
        body: { classKey: 'matrix-server', name: `Matrix item for ${persona}` },
      });

      if (mayWrite) {
        expect(response.status).toBe(201);
      } else {
        // The value of a CMDB is that its contents were decided. A register
        // anybody may edit mid-incident stops being one anybody trusts.
        expect(response.status).toBe(403);
      }
    });
  }
});

describe('scope narrows what a permitted call returns', () => {
  it('shows a requester only themselves in the user directory', async () => {
    // Holding `identity.user.read` is not licence to enumerate the tenant: the
    // scope has to narrow the result, not merely open the door.
    const response = await request<{ data: { id: string }[] }>('/api/v1/users?limit=200', {
      token: tenant.people.requester!.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.map((user) => user.id)).toEqual([tenant.people.requester!.id]);
  });

  it('shows an administrator everyone', async () => {
    const response = await request<{ data: { id: string }[] }>('/api/v1/users?limit=200', {
      token: tenant.people.admin!.token,
    });
    expect(response.body.data.length).toBeGreaterThanOrEqual(Object.keys(tenant.people).length);
  });

  it('shows an agent only their own tenant\'s queues, not every ticket', async () => {
    const response = await request<{ data: { id: string }[] }>('/api/v1/tickets?limit=200', {
      token: tenant.people.agent!.token,
    });
    const ids = response.body.data.map((ticket) => ticket.id);
    // The third seeded ticket belongs to the other team.
    expect(ids).not.toContain(tenant.ticketIds[2]);
    expect(ids).toContain(tenant.ticketIds[0]);
  });
});

describe('the matrix and the registry agree', () => {
  it('grants only permissions some module actually declares', () => {
    // A role naming a permission no module defines would be silently inert: it
    // would look granted in the admin console and do nothing.
    const declared = new Set(permissionRegistry().map((permission) => permission.key));
    const unknown: string[] = [];
    for (const role of SYSTEM_ROLES) {
      for (const permission of role.permissions) {
        if (!declared.has(permission.key)) unknown.push(`${role.key} → ${permission.key}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('grants only scopes the declaring module supports', () => {
    const byKey = new Map(permissionRegistry().map((permission) => [permission.key, permission.scopes]));
    const mismatched: string[] = [];
    for (const role of SYSTEM_ROLES) {
      for (const permission of role.permissions) {
        const scopes = byKey.get(permission.key);
        if (scopes && !scopes.includes(permission.scope)) {
          mismatched.push(`${role.key} → ${permission.key} at ${permission.scope}`);
        }
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('gives the administrator role every tenant-level permission available in this phase', () => {
    // A permission no role can hold is a feature nobody can reach. Permissions
    // declared for a later phase are exempt, and say so in their declaration.
    const administrator = SYSTEM_ROLES.find((role) => role.key === 'administrator')!;
    const held = new Set(administrator.permissions.map((permission) => permission.key));
    const missing = permissionRegistry()
      .filter((permission) => !held.has(permission.key))
      // Platform operations belong to the platform team, not to a tenant.
      .filter((permission) => !permission.key.startsWith('platform.'))
      .filter((permission) => (permission.phase ?? 'PH-1') === 'PH-1')
      .map((permission) => permission.key);
    expect(missing).toEqual([]);
  });

  it('declares a phase for every permission no role holds yet', () => {
    const held = new Set(SYSTEM_ROLES.flatMap((role) => role.permissions.map((permission) => permission.key)));
    const unheldWithoutPhase = permissionRegistry()
      .filter((permission) => !held.has(permission.key))
      .filter((permission) => !permission.key.startsWith('platform.'))
      .filter((permission) => !permission.phase)
      .map((permission) => permission.key);
    expect(unheldWithoutPhase).toEqual([]);
  });
});
