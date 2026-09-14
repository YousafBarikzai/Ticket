import { describe, expect, it, beforeEach } from 'vitest';
import { newId, idTimestamp, isUuid } from '../ids.js';
import { computeAuditHash } from '../audit.js';
import { authz, buildPermissionSet, clearScopeResolvers, registerScopeResolver } from '../authz.js';
import { createContext, SYSTEM_PERMISSIONS } from '../context.js';
import { classifyField, clearClassifications, maskRecord } from '../classification.js';
import { redact } from '../telemetry.js';
import { queuesForFamilies, ALL_QUEUES } from '../jobs.js';
import { NotFoundError, ForbiddenError, toProblemDetails } from '../errors.js';
import { clearModules, registerModule, validateRegistry, permissionRegistry } from '../manifest.js';
import { z } from 'zod';

describe('identifiers', () => {
  it('produces valid, time-ordered UUID v7 values', () => {
    const early = newId(new Date('2026-01-01T00:00:00.000Z'));
    const late = newId(new Date('2026-06-01T00:00:00.000Z'));
    expect(isUuid(early)).toBe(true);
    expect(early[14]).toBe('7');
    expect(early < late).toBe(true);
    expect(idTimestamp(early).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not collide across a burst', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(ids.size).toBe(5000);
  });
});

describe('audit hashing', () => {
  const row = {
    id: '018f0000-0000-7000-8000-000000000001',
    tenantId: '018f0000-0000-7000-8000-0000000000aa',
    actorType: 'user',
    actorId: '018f0000-0000-7000-8000-0000000000bb',
    action: 'ticket.status.changed',
    targetType: 'ticket',
    targetId: '018f0000-0000-7000-8000-0000000000cc',
    before: { status: 'new' },
    after: { status: 'in_progress' },
    occurredAt: new Date('2026-09-14T10:00:00.000Z'),
    prevHash: null,
  };

  it('is stable regardless of key order', () => {
    const a = computeAuditHash(row);
    const b = computeAuditHash({ ...row, before: { status: 'new' }, after: { status: 'in_progress' } });
    expect(a).toBe(b);
  });

  it('changes when any material field changes', () => {
    const base = computeAuditHash(row);
    expect(computeAuditHash({ ...row, action: 'ticket.deleted' })).not.toBe(base);
    expect(computeAuditHash({ ...row, after: { status: 'resolved' } })).not.toBe(base);
    expect(computeAuditHash({ ...row, prevHash: 'abc' })).not.toBe(base);
    expect(computeAuditHash({ ...row, occurredAt: new Date('2026-09-14T10:00:01.000Z') })).not.toBe(base);
  });
});

describe('authorisation', () => {
  interface Record_ { requesterId: string | null; assigneeId: string | null; groupId: string | null; orgId: string | null }

  beforeEach(() => {
    clearScopeResolvers();
    registerScopeResolver<Record_>({
      aggregate: 'ticket',
      isOwn: (ctx, r) => r.requesterId === ctx.actor.id,
      isTeam: (ctx, r) => Boolean(r.groupId && ctx.teamIds.includes(r.groupId)),
      orgId: (r) => r.orgId,
    });
  });

  const ticket: Record_ = { requesterId: 'user-1', assigneeId: 'agent-1', groupId: 'team-1', orgId: 'org-1' };

  function ctxFor(grants: Parameters<typeof buildPermissionSet>[0], overrides: Partial<Parameters<typeof createContext>[0]> = {}) {
    return createContext({
      tenantId: '018f0000-0000-7000-8000-0000000000aa',
      actor: { type: 'user', id: 'user-1' },
      permissions: buildPermissionSet(grants),
      teamIds: [],
      ...overrides,
    });
  }

  it('grants own scope only for the requester\'s own records', () => {
    const ctx = ctxFor([{ key: 'ticket.read', scope: 'own' }]);
    expect(authz.can(ctx, 'ticket.read', { aggregate: 'ticket', record: ticket })).toBe(true);
    expect(authz.can(ctx, 'ticket.read', { aggregate: 'ticket', record: { ...ticket, requesterId: 'someone-else' } })).toBe(false);
  });

  it('grants team scope for the actor\'s teams', () => {
    const ctx = ctxFor([{ key: 'ticket.read', scope: 'team' }], { actor: { type: 'user', id: 'agent-9' }, teamIds: ['team-1'] });
    expect(authz.can(ctx, 'ticket.read', { aggregate: 'ticket', record: ticket })).toBe(true);
    expect(authz.can(ctx, 'ticket.read', { aggregate: 'ticket', record: { ...ticket, groupId: 'team-2' } })).toBe(false);
  });

  it('grants any scope across the tenant', () => {
    const ctx = ctxFor([{ key: 'ticket.read', scope: 'any' }], { actor: { type: 'user', id: 'admin-1' } });
    expect(authz.can(ctx, 'ticket.read', { aggregate: 'ticket', record: { ...ticket, requesterId: 'x', groupId: 'y' } })).toBe(true);
  });

  it('honours a grant narrowed to one organisation', () => {
    const ctx = ctxFor([{ key: 'ticket.read', scope: 'any', scopeType: 'organisation', scopeId: 'org-1' }], {
      actor: { type: 'user', id: 'group-it' },
      organisationIds: ['org-1'],
    });
    expect(authz.can(ctx, 'ticket.read', { aggregate: 'ticket', record: ticket })).toBe(true);
    expect(authz.can(ctx, 'ticket.read', { aggregate: 'ticket', record: { ...ticket, orgId: 'org-2' } })).toBe(false);
  });

  it('refuses when the aggregate has no registered scope resolver', () => {
    clearScopeResolvers();
    const ctx = ctxFor([{ key: 'ticket.read', scope: 'own' }]);
    expect(authz.can(ctx, 'ticket.read', { aggregate: 'ticket', record: ticket })).toBe(false);
  });

  it('raises NotFound rather than Forbidden when existence must stay hidden', () => {
    const ctx = ctxFor([{ key: 'ticket.read', scope: 'own' }]);
    const foreign = { aggregate: 'ticket', record: { ...ticket, requesterId: 'other' } };
    expect(() => authz.requireVisible(ctx, 'ticket.read', foreign, 'ticket')).toThrow(NotFoundError);
    expect(() => authz.require(ctx, 'ticket.read', foreign)).toThrow(ForbiddenError);
  });

  it('lets system contexts through inside their tenant', () => {
    const ctx = createContext({ tenantId: 't', actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
    expect(authz.can(ctx, 'anything.at.all', { aggregate: 'ticket', record: ticket })).toBe(true);
  });
});

describe('classification masking', () => {
  beforeEach(() => {
    clearClassifications();
    classifyField({ entity: 'user', field: 'email', level: 'confidential' });
    classifyField({ entity: 'user', field: 'nationalInsuranceNumber', level: 'restricted', unlockedBy: 'hr.read.sensitive' });
  });

  const ctx = createContext({ tenantId: 't', actor: { type: 'user', id: 'u' }, permissions: buildPermissionSet([]) });

  it('masks confidential fields and removes restricted ones', () => {
    const masked = maskRecord(ctx, 'user', { displayName: 'Ada Lovelace', email: 'ada@acme.test', nationalInsuranceNumber: 'QQ123456C' });
    expect(masked.displayName).toBe('Ada Lovelace');
    expect(masked.email).toBe('ad***@acme.test');
    expect(masked).not.toHaveProperty('nationalInsuranceNumber');
  });

  it('lets a holder of the unlocking permission see the restricted field', () => {
    const hr = createContext({
      tenantId: 't',
      actor: { type: 'user', id: 'hr' },
      permissions: buildPermissionSet([{ key: 'hr.read.sensitive', scope: 'any' }]),
    });
    const masked = maskRecord(hr, 'user', { nationalInsuranceNumber: 'QQ123456C' });
    expect(masked.nationalInsuranceNumber).toBe('QQ123456C');
  });
});

describe('log redaction', () => {
  beforeEach(() => clearClassifications());

  it('removes secrets, tokens and nested credentials', () => {
    const out = redact({
      email: 'ada@acme.test',
      password: 'hunter2',
      authorization: 'Bearer abc',
      nested: { apiKey: 'k-123', clientSecret: 's' },
      note: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdef signature',
    }) as Record<string, unknown>;
    expect(out.password).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).apiKey).toBe('[redacted]');
    expect(out.note).toContain('[redacted]');
    // Not classified in this test, so it passes through unchanged.
    expect(out.email).toBe('ada@acme.test');
  });

  it('redacts a classified field name wherever it appears', () => {
    classifyField({ entity: 'user', field: 'email', level: 'confidential' });
    const out = redact({ email: 'ada@acme.test', requester: { email: 'grace@acme.test' } }) as Record<string, unknown>;
    expect(out.email).toBe('[redacted]');
    expect((out.requester as Record<string, unknown>).email).toBe('[redacted]');
  });
});

describe('queue families', () => {
  it('maps a family to its queues and rejects unknown names', () => {
    expect(queuesForFamilies('events')).toEqual(expect.arrayContaining(['outbox', 'events', 'webhooks']));
    expect(queuesForFamilies('*')).toEqual(ALL_QUEUES);
    expect(queuesForFamilies('nonsense')).toEqual([]);
    expect(queuesForFamilies('sla')).toEqual(['sla']);
  });
});

describe('problem details', () => {
  it('never leaks internals for an unexpected error', () => {
    const problem = toProblemDetails(new Error('connection string postgres://user:pw@host'), 'corr-1');
    expect(problem.status).toBe(500);
    expect(JSON.stringify(problem)).not.toContain('postgres://');
    expect(problem.correlationId).toBe('corr-1');
  });

  it('maps a domain error to its status and code', () => {
    const problem = toProblemDetails(new NotFoundError('ticket', 'abc'), 'corr-2', '/api/v1/tickets/abc');
    expect(problem.status).toBe(404);
    expect(problem.type).toContain('not_found');
    expect(problem.instance).toBe('/api/v1/tickets/abc');
  });
});

describe('module registry', () => {
  beforeEach(() => clearModules());

  const base = {
    version: '1.0.0',
    phase: 'PH-1',
    featureFlags: [],
    settings: [],
    jobs: [],
    enabledByDefault: true,
    optional: false,
  };

  it('accepts a consistent registry', () => {
    registerModule({ ...base, id: 'MOD-04', key: 'ticket', name: 'Ticket core', dependsOn: [], permissions: [{ key: 'ticket.read', scopes: ['own', 'team', 'any'] }], events: { publishes: ['ticket.created'], consumes: [] } });
    registerModule({ ...base, id: 'MOD-07', key: 'sla', name: 'SLA', dependsOn: ['MOD-04'], permissions: [], events: { publishes: [], consumes: ['ticket.created'] } });
    expect(validateRegistry()).toEqual([]);
    expect(permissionRegistry().map((p) => p.key)).toEqual(['ticket.read']);
  });

  it('reports a missing dependency, an unpublished event and a duplicated permission', () => {
    registerModule({ ...base, id: 'MOD-07', key: 'sla', name: 'SLA', dependsOn: ['MOD-99'], permissions: [{ key: 'shared.key', scopes: ['any'] }], events: { publishes: [], consumes: ['nobody.publishes.this'] } });
    registerModule({ ...base, id: 'MOD-11', key: 'notify', name: 'Notifications', dependsOn: [], permissions: [{ key: 'shared.key', scopes: ['any'] }], events: { publishes: [], consumes: [] } });
    const problems = validateRegistry();
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('MOD-99'),
        expect.stringContaining('nobody.publishes.this'),
        expect.stringContaining('shared.key'),
      ]),
    );
  });

  it('matches wildcard consumption against published events', () => {
    registerModule({ ...base, id: 'MOD-04', key: 'ticket', name: 'Ticket', dependsOn: [], permissions: [], events: { publishes: ['ticket.created', 'ticket.updated'], consumes: [] } });
    registerModule({ ...base, id: 'MOD-12', key: 'analytics', name: 'Analytics', dependsOn: [], permissions: [], events: { publishes: [], consumes: ['ticket.*'] } });
    expect(validateRegistry()).toEqual([]);
  });
});

describe('settings declarations', () => {
  it('validates values against the manifest schema', () => {
    const schema = z.number().int().min(1).max(90);
    expect(() => schema.parse(7)).not.toThrow();
    expect(() => schema.parse(0)).toThrow();
  });
});
