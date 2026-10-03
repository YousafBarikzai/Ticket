import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SYSTEM_PERMISSIONS,
  createContext,
  platformDb,
  transaction,
  withContext,
  cache,
} from '@itsm/platform';
import { DEMO_KEYS, DEMO_OPS_KEY, demoWindow, isDemoKey } from '@itsm/contracts/demo';
import { demoTokenSchema, parseDemoRecord } from '@itsm/contracts/demo/schemas';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * The tenant isolation suite (specification Appendix D).
 *
 * Release-blocking. Two tenants are seeded with deliberately identical data —
 * same titles, same email local parts, the same ticket numbers — because a leak
 * between tenants whose data looks different is easy to spot, and a leak
 * between tenants whose data looks the same is not.
 *
 * Every layer is checked separately, since the point of the design is that two
 * independent layers would both have to fail (ADR-0004).
 */

let alpha: TestTenant;
let beta: TestTenant;

beforeAll(async () => {
  alpha = await createTestTenant('iso-alpha');
  beta = await createTestTenant('iso-beta');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('iso-alpha');
  await deleteTestTenant('iso-beta');
  await closeHarness();
});

describe('the two tenants really are identical', () => {
  it('has the same ticket numbers on both sides', () => {
    // If this ever diverges the rest of this file proves much less.
    expect(alpha.ticketNumbers).toEqual(beta.ticketNumbers);
    expect(alpha.id).not.toBe(beta.id);
  });
});

describe('API surface', () => {
  it('never returns another tenant\'s ticket by id', async () => {
    for (const ticketId of alpha.ticketIds) {
      const response = await request(`/api/v1/tickets/${ticketId}`, { token: beta.people.admin!.token });
      // 404, never 403: the response must not reveal that the record exists.
      expect(response.status).toBe(404);
    }
  });

  it('never returns another tenant\'s ticket by number, even though the numbers match', async () => {
    const response = await request<{ id: string }>(`/api/v1/tickets/${alpha.ticketNumbers[0]}`, {
      token: beta.people.admin!.token,
    });
    expect(response.status).toBe(200);
    // The same number resolves, but to this tenant's own ticket.
    expect(beta.ticketIds).toContain(response.body.id);
    expect(alpha.ticketIds).not.toContain(response.body.id);
  });

  it('lists only the caller\'s own tenant', async () => {
    const response = await request<{ data: { id: string }[] }>('/api/v1/tickets?limit=200', {
      token: beta.people.admin!.token,
    });
    const ids = response.body.data.map((ticket) => ticket.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of alpha.ticketIds) expect(ids).not.toContain(id);
  });

  it('never returns another tenant\'s users', async () => {
    const response = await request<{ data: { id: string; email: string }[] }>('/api/v1/users?limit=200', {
      token: beta.people.admin!.token,
    });
    const ids = response.body.data.map((user) => user.id);
    for (const person of Object.values(alpha.people)) expect(ids).not.toContain(person.id);
    // The email local parts are identical across tenants, so compare identity.
    expect(response.body.data.some((user) => user.email.endsWith('@iso-beta.test'))).toBe(true);
    expect(response.body.data.some((user) => user.email.endsWith('@iso-alpha.test'))).toBe(false);
  });

  it('never returns another tenant\'s audit events', async () => {
    const response = await request<{ data: { targetId: string }[] }>('/api/v1/audit-events?limit=200', {
      token: beta.people.admin!.token,
    });
    const targets = response.body.data.map((row) => row.targetId);
    for (const id of alpha.ticketIds) expect(targets).not.toContain(id);
  });

  it('never returns another tenant\'s search results', async () => {
    const response = await request<{ data: { entityId: string }[] }>('/api/v1/search?q=VPN&limit=100', {
      token: beta.people.admin!.token,
    });
    for (const id of alpha.ticketIds) {
      expect(response.body.data.map((hit) => hit.entityId)).not.toContain(id);
    }
  });

  it('refuses a token whose tenant no longer matches the record it names', async () => {
    const response = await request(`/api/v1/tickets/${alpha.ticketIds[0]}/comments`, {
      token: beta.people.agent!.token,
      method: 'POST',
      body: { body: 'writing into another tenant', visibility: 'public' },
    });
    expect(response.status).toBe(404);
  });
});

describe('database layer', () => {
  it('returns nothing at all without a tenant context', async () => {
    // The application role plus forced row-level security: a query with no
    // app.tenant_id must see zero rows rather than everything.
    const client = platformDb();
    const rows = await client.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM ticket`;
    expect(Number(rows[0]?.count ?? -1)).toBe(0);
  });

  it('sees only one tenant inside a tenant transaction', async () => {
    const ctx = createContext({ tenantId: alpha.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
    const counted = await withContext(ctx, () =>
      transaction(ctx, async (tx) => {
        const rows = await tx.$queryRaw<{ tenant_id: string }[]>`SELECT DISTINCT tenant_id FROM ticket`;
        return rows;
      }),
    );
    expect(counted).toHaveLength(1);
    expect(counted[0]?.tenant_id).toBe(alpha.id);
  });

  it('refuses a write that names another tenant', async () => {
    const ctx = createContext({ tenantId: alpha.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
    await expect(
      withContext(ctx, () =>
        transaction(ctx, async (tx) => {
          await tx.$executeRaw`
            INSERT INTO ticket (id, tenant_id, number, type, title, status, status_category, priority, source_channel, updated_at)
            VALUES (gen_random_uuid(), ${beta.id}::uuid, 'INC-999999', 'incident', 'smuggled', 'new', 'open', 'P3', 'api', now())
          `;
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot be switched off by the application role', async () => {
    const ctx = createContext({ tenantId: alpha.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
    await expect(
      withContext(ctx, () =>
        transaction(ctx, async (tx) => {
          await tx.$executeRawUnsafe('ALTER TABLE ticket DISABLE ROW LEVEL SECURITY');
        }),
      ),
    ).rejects.toThrow(/must be owner|permission denied/i);
  });

  it('protects every tenant-scoped table, not just the ones with tests', async () => {
    // The guard is a function rather than a list precisely so that a table
    // added later cannot be forgotten. It raises rather than returns, so the
    // assertion is that it completes at all.
    const client = platformDb();
    await expect(client.$executeRawUnsafe('SELECT assert_tenant_rls_complete()')).resolves.toBeDefined();

    const unprotected = await client.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname NOT IN (SELECT table_name FROM platform_table_allowlist)
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
        )
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
    `;
    expect(unprotected).toEqual([]);
  });

  it('keeps the audit trail append-only', async () => {
    const ctx = createContext({ tenantId: alpha.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
    await expect(
      withContext(ctx, () =>
        transaction(ctx, async (tx) => {
          await tx.$executeRawUnsafe("UPDATE audit_event SET action = 'tampered'");
        }),
      ),
    ).rejects.toThrow(/permission denied|append-only/i);
  });
});

describe('configuration is per tenant too', () => {
  it('never shows one tenant the other\'s business rules', async () => {
    // Rules carry routing, priority and notification decisions: seeing another
    // tenant's rule set is seeing how they run their service desk.
    const response = await request<{ data: { key: string }[] }>('/api/v1/rules', {
      token: beta.people.admin!.token,
    });
    expect(response.status).toBe(200);
    // Both tenants seed the same keys, so identity is what must be compared.
    const ctx = contextFor(beta.id);
    const { transaction, withContext } = await import('@itsm/platform');
    const visible = await withContext(ctx, () =>
      transaction(ctx, (tx) => tx.businessRule.findMany({})),
    );
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((rule) => rule.tenantId === beta.id)).toBe(true);
  });

  it('never lets one tenant publish into another\'s rule set', async () => {
    const alphaCtx = contextFor(alpha.id);
    const { transaction, withContext } = await import('@itsm/platform');
    const alphaRules = await withContext(alphaCtx, () =>
      transaction(alphaCtx, (tx) => tx.businessRule.findMany({})),
    );
    const target = alphaRules[0]!;

    // Same key in both tenants, so this resolves to beta's own rule, never alpha's.
    const response = await request<{ id: string }>(`/api/v1/rules/${target.id}/publish`, {
      method: 'POST',
      token: beta.people.admin!.token,
    });
    expect(response.status).toBe(404);
  });
});

describe('approvals stay inside their tenant', () => {
  it('never lets one tenant decide another\'s approval', async () => {
    const { transaction, withContext } = await import('@itsm/platform');
    const { approvalService } = await import('@itsm/module-approvals');

    const alphaCtx = contextFor(alpha.id);
    const created = await withContext(alphaCtx, () =>
      transaction(alphaCtx, (tx) =>
        approvalService.requestApproval(alphaCtx, tx, {
          subjectType: 'request',
          subjectId: crypto.randomUUID(),
          subjectUserId: alpha.people.requester!.id,
          facts: {},
        }),
      ),
    );
    expect(created).not.toBeNull();

    // Beta's administrator holds approval.read at `any` — inside beta.
    const response = await request(`/api/v1/approvals/${created!.id}/decide`, {
      method: 'POST',
      token: beta.people.admin!.token,
      body: { decision: 'approved' },
    });
    expect(response.status).toBe(404);
  });
});

describe('the catalogue stays inside its tenant', () => {
  it('never shows one tenant the other\'s request types', async () => {
    const { transaction, withContext } = await import('@itsm/platform');
    const ctx = contextFor(beta.id);
    const visible = await withContext(ctx, () =>
      transaction(ctx, (tx) => tx.requestType.findMany({})),
    );
    // Both tenants seed the same keys, so identity is what must be compared.
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((item) => item.tenantId === beta.id)).toBe(true);
  });

  it('never lets one tenant submit against another\'s catalogue item', async () => {
    const alphaCtx = contextFor(alpha.id);
    const { transaction, withContext } = await import('@itsm/platform');
    const alphaItems = await withContext(alphaCtx, () =>
      transaction(alphaCtx, (tx) => tx.requestType.findMany({})),
    );
    expect(alphaItems.length).toBeGreaterThan(0);

    // Submission resolves by key, and both tenants have the same key — so this
    // must land on beta's own item, never alpha's.
    const response = await request<{ ticketId: string }>('/api/v1/catalogue/system-access/submit', {
      method: 'POST',
      token: beta.people.requester!.token,
      body: { answers: { system: 'crm', accessLevel: 'read' } },
    });
    expect(response.status).toBe(201);

    const betaTickets = await withContext(contextFor(beta.id), () =>
      transaction(contextFor(beta.id), (tx) => tx.ticket.findMany({ where: { id: response.body.ticketId } })),
    );
    expect(betaTickets).toHaveLength(1);
  });
});

describe('knowledge stays inside its tenant', () => {
  it("never shows one tenant the other's articles", async () => {
    // Both tenants write an article under the same key and with the same title,
    // because a leak between tenants whose data differs is easy to spot and one
    // between tenants whose data matches is not.
    for (const tenant of [alpha, beta]) {
      await request('/api/v1/knowledge', {
        method: 'POST',
        token: tenant.people.admin!.token,
        body: {
          key: 'starter-guide',
          title: 'Getting started',
          body: [{ kind: 'paragraph', runs: [{ text: `Secret belonging to ${tenant.slug}` }] }],
          audience: 'tenant',
        },
      });
      await request('/api/v1/knowledge/starter-guide/publish', {
        method: 'POST',
        token: tenant.people.admin!.token,
      });
    }

    const read = await request<{ body: { runs: { text: string }[] }[] }>('/api/v1/knowledge/starter-guide', {
      token: beta.people.admin!.token,
    });
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.body.body)).toContain(beta.slug);
    expect(JSON.stringify(read.body.body)).not.toContain(alpha.slug);
  });

  it("never lets one tenant's search reach the other's articles", async () => {
    const { transaction, withContext } = await import('@itsm/platform');
    const ctx = contextFor(beta.id);
    const documents = await withContext(ctx, () =>
      transaction(ctx, (tx) => tx.searchDocument.findMany({ where: { entityType: 'knowledge' } })),
    );
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.every((document) => document.tenantId === beta.id)).toBe(true);
  });

  it("never lets one tenant publish into the other's article", async () => {
    const { transaction, withContext } = await import('@itsm/platform');
    const alphaCtx = contextFor(alpha.id);
    const before = await withContext(alphaCtx, () =>
      transaction(alphaCtx, (tx) => tx.knowledgeArticle.findFirst({ where: { key: 'starter-guide' } })),
    );

    // Resolves by key, and both tenants have the same key.
    await request('/api/v1/knowledge/starter-guide/retire', {
      method: 'POST',
      token: beta.people.admin!.token,
      body: { reason: 'testing isolation' },
    });

    const after = await withContext(alphaCtx, () =>
      transaction(alphaCtx, (tx) => tx.knowledgeArticle.findFirst({ where: { key: 'starter-guide' } })),
    );
    expect(before?.status).toBe('published');
    expect(after?.status).toBe('published');
  });
});

describe('workflow runs stay inside their tenant', () => {
  it("never shows one tenant the other's runs", async () => {
    const { transaction, withContext } = await import('@itsm/platform');
    const ctx = contextFor(beta.id);
    // Both tenants seed the same reference workflows under the same keys.
    const definitions = await withContext(ctx, () =>
      transaction(ctx, (tx) => tx.workflowDefinition.findMany({})),
    );
    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions.every((definition) => definition.tenantId === beta.id)).toBe(true);
  });

  it("never lets one tenant start a run on the other's ticket", async () => {
    const { transaction, withContext } = await import('@itsm/platform');
    const { workflowService } = await import('@itsm/module-workflow');

    const alphaTicketId = alpha.ticketIds[0]!;
    const betaCtx = contextFor(beta.id);

    // Resolves by key, and both tenants have `auto-close-resolved`. The ticket
    // id belongs to alpha, so beta's run must not end up pointing at it.
    const started = await withContext(betaCtx, () =>
      transaction(betaCtx, (tx) =>
        workflowService.startRun(betaCtx, tx, { key: 'auto-close-resolved', ticketId: alphaTicketId }),
      ),
    );

    if (started) {
      const visibleToAlpha = await withContext(contextFor(alpha.id), () =>
        transaction(contextFor(alpha.id), (tx) => tx.workflowRun.findMany({ where: { id: started.runId } })),
      );
      // Row-level security keeps beta's run out of alpha's reach whatever the
      // ticket id says.
      expect(visibleToAlpha).toEqual([]);
    }
  });

  it("never lets one tenant's step runs be seen by the other", async () => {
    const { transaction, withContext } = await import('@itsm/platform');
    const ctx = contextFor(alpha.id);
    const steps = await withContext(ctx, () => transaction(ctx, (tx) => tx.workflowStepRun.findMany({})));
    expect(steps.every((step) => step.tenantId === alpha.id)).toBe(true);
  });
});

/**
 * Keys that may live outside a `t:<tenant>:` prefix, and why each is safe.
 *
 * - `bull:`: BullMQ's own structure; every job carries its tenant inside.
 * - `jwks:`, `platform:`: the identity provider's keys and deployment-wide
 *   state, holding no tenant data.
 * - `sess:deny:`: the session denylist is deliberately global. A `sid` comes
 *   from the identity provider and is unique across every tenant, and the
 *   token verifier has to consult the list *before* it knows which tenant the
 *   token names — a tenant-prefixed key could not be read at that point in
 *   the request. The key is the session identifier and the value is "1".
 * - `ops:config-warnings`, `ops:demo`: the operator's deployment warnings
 *   (D24, Y-M7), a field per service; codes and counts, no tenant data.
 * - the demo's own keys (Y-B4), by exact shape through `isDemoKey`, never by a
 *   `demo:` prefix: a token key carrying a raw token, or a cap for a category
 *   nobody declared, is a key the demo did not mean to write and fails here.
 *
 * `bff:` is not on the list, on purpose (V-M2): a BFF session record holds a
 * person's tokens and tenant, so one left behind by a test is a leak of
 * exactly the kind this scan exists to find. Integration files that create
 * BFF sessions use their own app name and delete what they wrote.
 */
const GLOBAL_KEY_PREFIXES = ['bull:', 'jwks:', 'platform:', 'sess:deny:'] as const;
const GLOBAL_KEYS: ReadonlySet<string> = new Set(['ops:config-warnings', DEMO_OPS_KEY]);

function mayLiveOutsideATenant(key: string): boolean {
  return (
    key.startsWith('t:') ||
    GLOBAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    GLOBAL_KEYS.has(key) ||
    isDemoKey(key)
  );
}

async function scanKeys(match: string): Promise<string[]> {
  const redis = cache();
  const found: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 500);
    cursor = next;
    found.push(...keys);
  } while (cursor !== '0');
  return found;
}

/** A failure message that names the keys, so a leftover can be traced to the file that wrote it. */
function listed(what: string, keys: readonly string[]): string {
  const shown = keys.slice(0, 50).join('\n  ');
  return `${what} (${keys.length}):\n  ${shown}${keys.length > 50 ? `\n  … and ${keys.length - 50} more` : ''}`;
}

/** A token key as a failure message may show it: the hash cut to eight characters, as the logs do. */
function shortTokenKey(key: string): string {
  return `${key.slice(0, 'demo:tok:'.length + 8)}…`;
}

/**
 * What is wrong with a set of demo token values (Y-B4, V-M2): a value that
 * does not parse as a token record, or a record naming a tenant whose kind is
 * not `demo`. A record naming a tenant that no longer exists is fine: that is
 * a purged generation whose tokens have not expired yet. A value of `null`
 * expired between the scan and the read.
 */
async function demoTokenProblems(entries: readonly (readonly [key: string, raw: string | null])[]): Promise<string[]> {
  const problems: string[] = [];
  const byTenant = new Map<string, string[]>();
  for (const [key, raw] of entries) {
    if (raw === null) continue;
    const record = parseDemoRecord(demoTokenSchema, raw);
    if (!record) {
      problems.push(`${shortTokenKey(key)} does not parse as a demo token record`);
      continue;
    }
    byTenant.set(record.tenantId, [...(byTenant.get(record.tenantId) ?? []), key]);
  }
  if (byTenant.size === 0) return problems;
  const tenants = await platformDb().tenant.findMany({
    where: { id: { in: [...byTenant.keys()] } },
    select: { id: true, kind: true },
  });
  for (const tenant of tenants) {
    if (tenant.kind === 'demo') continue;
    for (const key of byTenant.get(tenant.id) ?? []) {
      problems.push(`${shortTokenKey(key)} names the ${tenant.kind} tenant ${tenant.id}`);
    }
  }
  return problems;
}

describe('caches and keys', () => {
  it('allows the demo\'s keys, the operator hashes and tenant keys, and nothing of the BFF', () => {
    const now = Date.UTC(2026, 9, 2, 12);
    const sid = 'demo-0b6f3c1e-2a4d-4c1b-9e3f-5a6b7c8d9e0f';
    const allowed = [
      `t:${alpha.id}:perm:${alpha.people.agent!.id}`,
      'bull:outbox:42',
      'sess:deny:abc',
      'ops:config-warnings',
      'ops:demo',
      DEMO_KEYS.live,
      DEMO_KEYS.active,
      DEMO_KEYS.token('a'.repeat(64)),
      DEMO_KEYS.salt('2026-10-02'),
      DEMO_KEYS.mintAll(demoWindow('m', now)),
      DEMO_KEYS.mintPerBucket('workbench', 'agent', '0123456789abcdef', demoWindow('h', now)),
      DEMO_KEYS.readsPerBucket('unknown', demoWindow('m', now)),
      DEMO_KEYS.capPerVisit(41, 'mi.declare', sid),
    ];
    const refused = [
      'bff:portal:sess:3f2a',
      'bff:it-demo-auth:sess:3f2a',
      'bff:workbench:rl:login:0123456789abcdef:m:29340000',
      // A raw token in a key name is exactly what the builders refuse to write.
      'demo:tok:itsmdemo_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'demo:gen',
      'demo:resetting',
      'demo:cap:41:not.a.category:all',
      'ops:something-else',
      'sess:abc',
      'perm:abc',
    ];
    expect(allowed.filter((key) => !mayLiveOutsideATenant(key))).toEqual([]);
    expect(refused.filter((key) => mayLiveOutsideATenant(key))).toEqual([]);
  });

  it('prefixes every tenant-specific Redis key with its tenant', async () => {
    // A cache key without a tenant prefix is a cross-tenant read waiting to
    // happen, so the keyspace is scanned rather than trusted.
    await request('/api/v1/me', { token: alpha.people.agent!.token });
    await request('/api/v1/me', { token: beta.people.agent!.token });

    const suspicious = (await scanKeys('*')).filter((key) => !mayLiveOutsideATenant(key)).sort();
    expect(suspicious, listed('Redis keys outside every tenant prefix and every allowed global key', suspicious)).toEqual([]);
  });

  it('lets a demo token name only a demo tenant, or one that no longer exists', async () => {
    const keys = await scanKeys('demo:tok:*');
    const values = keys.length === 0 ? [] : await cache().mget(...keys);
    const problems = await demoTokenProblems(keys.map((key, index) => [key, values[index] ?? null] as const));
    expect(problems, listed('Demo token values that name a standard tenant or do not parse', problems)).toEqual([]);
  });

  it('flags a token naming a standard tenant or one that does not parse, and nothing else', async () => {
    // The check above passes trivially on an empty keyspace, so its logic is
    // proven here on values that are never written to Redis.
    const record = (tenantId: string) =>
      JSON.stringify({
        v: 1,
        tenantId,
        userId: alpha.people.agent!.id,
        persona: 'agent',
        app: 'workbench',
        sid: 'demo-0b6f3c1e-2a4d-4c1b-9e3f-5a6b7c8d9e0f',
        gen: 3,
        iat: 1_790_000_000_000,
        exp: 1_790_000_900_000,
        ipb: '0123456789abcdef',
      });
    const standard = `demo:tok:${'1'.repeat(64)}`;
    const purged = `demo:tok:${'2'.repeat(64)}`;
    const garbled = `demo:tok:${'3'.repeat(64)}`;
    const expired = `demo:tok:${'4'.repeat(64)}`;
    const problems = await demoTokenProblems([
      [standard, record(alpha.id)],
      [purged, record('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d')],
      [garbled, '{"v":1,"tenantId":"not a record"}'],
      [expired, null],
    ]);
    expect(problems).toEqual([
      `${shortTokenKey(garbled)} does not parse as a demo token record`,
      `${shortTokenKey(standard)} names the standard tenant ${alpha.id}`,
    ]);
  });

  it('keeps one tenant\'s permission cache out of another\'s', async () => {
    const redis = cache();
    const alphaKeys = await redis.keys(`t:${alpha.id}:perm:*`);
    const betaKeys = await redis.keys(`t:${beta.id}:perm:*`);
    expect(alphaKeys.every((key) => !key.includes(beta.id))).toBe(true);
    expect(betaKeys.every((key) => !key.includes(alpha.id))).toBe(true);
  });
});

describe('object storage', () => {
  it('scopes presigned upload keys to the requesting tenant', async () => {
    const response = await request<{ objectKey: string }>(
      `/api/v1/tickets/${beta.ticketNumbers[0]}/attachments:presign`,
      {
        token: beta.people.agent!.token,
        method: 'POST',
        body: { filename: 'evidence.png', mime: 'image/png', size: 1024 },
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.objectKey.startsWith(`tenants/${beta.id}/`)).toBe(true);
  });

  it('refuses to register an object belonging to another tenant', async () => {
    const response = await request(`/api/v1/tickets/${beta.ticketNumbers[0]}/attachments`, {
      token: beta.people.agent!.token,
      method: 'POST',
      body: {
        objectKey: `tenants/${alpha.id}/attachments/2026/09/stolen`,
        filename: 'stolen.png',
        mime: 'image/png',
        size: 1024,
      },
    });
    expect(response.status).toBe(422);
  });
});
