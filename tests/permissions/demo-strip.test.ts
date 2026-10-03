import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEMO_STRIPPED_PERMISSIONS,
  DEMO_STRIPPED_PREFIXES,
  demoDisabledSentence,
  demoFeatureForPermission,
  type DemoFeature,
  type DemoPersonaKey,
  type DemoStrippedPermission,
} from '@itsm/contracts/demo';
import { permissionRegistry, resetConfig } from '@itsm/platform';
import { closeHarness, createTestTenant, deleteTestTenant, getApp, request, type TestTenant } from '../support/harness.js';
import { createDemoFixture, type DemoFixture } from '../support/demo-fixture.js';
import { scanKeys } from '../support/redis-keys.js';
import { registeredRoutes } from '../../apps/api/src/plugins/demo.js';

/**
 * Layer 1 of the shared demo's lockdown, end to end (SPEC v3 §4.7.1; A3
 * §11.2 row 15): every permission the demo strips is missing from every
 * persona's `/me`, and each one's representative route answers 403
 * `demo_disabled` with its feature and the sentence the UI shows. A standard
 * tenant's administrator is refused none of them as `demo_disabled`.
 *
 * The permission matrix (`permission-matrix.test.ts`) is about roles in a
 * standard tenant; the demo's refusals are rows here, not there.
 *
 * Redis hygiene (V-M2): the fixture's BFF app name is this file's,
 * `it-demo-strip`; `dispose()` deletes every key it wrote and restores the
 * demo's singletons.
 */

const APP = 'it-demo-strip';
const GENERATION = 13;
const STANDARD_SLUG = 'demostrip-std';

let demo: DemoFixture;
let standard: TestTenant;
let redis: Redis;

type Problem = { type?: string; detail?: string; feature?: string; title?: string; demo?: boolean };

function code(body: unknown): string | undefined {
  return (body as Problem).type?.split('/').pop();
}

interface Row {
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: () => string;
  readonly body?: unknown;
  /** Whether a standard tenant's administrator may make the call as a control (it must change nothing there). */
  readonly control?: false;
}

type Representative = Row | { readonly none: string; readonly absent: RegExp };

/**
 * One route per stripped permission, the one a visitor would reach first. A
 * permission no route checks yet says so, with the pattern a route for it
 * would have: the day one is mounted, this file fails until it is listed.
 */
const REPRESENTATIVE: Readonly<Record<DemoStrippedPermission, Representative>> = {
  'integration.credential.manage': { method: 'POST', path: () => '/api/v1/credentials', body: {} },
  'integration.action.manage': { method: 'POST', path: () => '/api/v1/actions', body: {} },
  'integration.action.replay': { method: 'POST', path: () => `/api/v1/error-queue/${randomUUID()}/replay`, body: {} },
  'webhook.manage': { method: 'POST', path: () => '/api/v1/webhooks', body: {} },
  'channel.account.manage': { none: 'no route changes a channel account: accounts are configured by the deployment', absent: /^(POST|PUT|PATCH|DELETE) \/api\/v1\/channels\/accounts/ },
  'channel.identity.manage': { method: 'POST', path: () => '/api/v1/channels/identities', body: {} },
  'identity.scim.manage': { method: 'POST', path: () => '/api/v1/scim/token', body: {}, control: false },
  'identity.apikey.manage': { none: 'no API key route is mounted', absent: /api-?keys?/i },
  'identity.role.manage': { method: 'POST', path: () => '/api/v1/role-assignments', body: {} },
  'identity.session.manage': { method: 'DELETE', path: () => `/api/v1/me/sessions/${randomUUID()}` },
  'identity.org.manage': { method: 'POST', path: () => '/api/v1/teams', body: {} },
  'tenant.org.manage': { method: 'POST', path: () => '/api/v1/organisations', body: {} },
  'admin.module.manage': { method: 'POST', path: () => '/api/v1/modules/nothing/disable', body: {} },
  'admin.flag.manage': { method: 'PUT', path: () => '/api/v1/feature-flags/not.a.flag', body: {} },
  'migration.manage': { method: 'POST', path: () => '/api/v1/import/jobs', body: {} },
  'discovery.manage': { method: 'POST', path: () => '/api/v1/discovery/sources', body: {} },
  'analytics.admin': { method: 'POST', path: () => '/api/v1/analytics/rebuild', body: {} },
  'audit.export': { none: 'the audit log has no export route yet', absent: /audit[^ ]*export|export[^ ]*audit/i },
  'ai.manage': { method: 'PUT', path: () => '/api/v1/ai/budget', body: {} },
  'statuspage.manage': { method: 'PATCH', path: () => '/api/v1/status-page', body: { unknownField: true } },
  'ticket.attachment.add': { method: 'POST', path: () => `/api/v1/tickets/${demo.ticketNumbers[0]}/attachments`, body: {} },
  'notification.template.manage': { none: 'notification templates have no route yet (A3 §7.6 row 37)', absent: /notification-templates/ },
};

/** The `platform.` prefix, through the console's tenant door. */
const PLATFORM_ROW: Row = { method: 'POST', path: () => `/api/platform/v1/tenants/${demo.tenantId}/suspend`, body: {} };

beforeAll(async () => {
  vi.stubEnv('DEMO_MODE', 'on');
  vi.stubEnv('DEMO_TENANT_SLUG', 'demo');
  resetConfig();
  redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { family: 0 });
  demo = await createDemoFixture({ slug: 'demo-it-strip', appName: APP, generation: GENERATION, redis, tickets: 2 });
  demo.track([`demo:cap:${GENERATION}:*`]);
  standard = await createTestTenant(STANDARD_SLUG);
  await getApp();
}, 180_000);

afterAll(async () => {
  await demo?.dispose();
  await deleteTestTenant(STANDARD_SLUG);
  expect(await scanKeys(redis, `bff:${APP}:*`)).toEqual([]);
  await redis.quit();
  await closeHarness();
  vi.unstubAllEnvs();
  resetConfig();
});

/** A fresh visit for a persona, with its counters tracked for clean-up. */
async function visit(persona: DemoPersonaKey): Promise<string> {
  const token = await demo.mintTestToken(persona);
  const { createHash } = await import('node:crypto');
  const raw = await redis.get(`demo:tok:${createHash('sha256').update(token).digest('hex')}`);
  const record = JSON.parse(raw ?? '{}') as { sid: string; ipb: string };
  demo.track([`demo:wb:${record.sid}:*`, `demo:rb:ip:${record.ipb}:*`, `demo:wb:ip:${record.ipb}:*`]);
  return token;
}

describe('the strip-list (§4.7.1)', () => {
  it('lists every stripped key in a module manifest, so a renamed permission cannot slip back in', () => {
    const declared = new Set(permissionRegistry().map((permission) => permission.key));
    for (const key of Object.keys(DEMO_STRIPPED_PERMISSIONS)) expect(declared.has(key), key).toBe(true);
    expect([...declared].some((key) => key.startsWith('platform.'))).toBe(true);
  });

  it.each(['employee', 'agent', 'admin'] as const)('leaves no stripped key in the %s persona’s /me', async (persona) => {
    const me = await request<{ permissions: { key: string }[] }>('/api/v1/me', { token: await visit(persona) });
    expect(me.status).toBe(200);
    const keys = me.body.permissions.map((permission) => permission.key);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) expect(demoFeatureForPermission(key), key).toBeNull();
  });

  const rows = Object.entries(REPRESENTATIVE) as [DemoStrippedPermission, Representative][];

  it.each(rows)('%s → demo_disabled with its feature, through its route', async (permission, representative) => {
    const feature = DEMO_STRIPPED_PERMISSIONS[permission] as DemoFeature;
    if ('none' in representative) {
      // Still stripped (the /me rows above); there is no door to knock on.
      const mounted = registeredRoutes(await getApp()).filter((route) => representative.absent.test(route));
      expect(mounted, `${permission}: ${representative.none} — a route now exists, so give it a row`).toEqual([]);
      return;
    }
    const jordan = await visit('admin');
    const response = await request<Problem>(representative.path(), { method: representative.method, token: jordan, body: representative.body });
    expect(response.status).toBe(403);
    expect(code(response.body)).toBe('demo_disabled');
    expect(response.body).toMatchObject({ demo: true, feature, title: 'Not available in the demo' });
    expect(response.body.detail).toBe(demoDisabledSentence(feature));
  });

  it('platform.* → demo_disabled "platform", through the console', async () => {
    expect(Object.keys(DEMO_STRIPPED_PREFIXES)).toEqual(['platform.']);
    const response = await request<Problem>(PLATFORM_ROW.path(), { method: PLATFORM_ROW.method, token: await visit('admin'), body: PLATFORM_ROW.body });
    expect(response.status).toBe(403);
    expect(code(response.body)).toBe('demo_disabled');
    expect(response.body.feature).toBe('platform');
    expect(response.body.detail).toBe(demoDisabledSentence('platform'));
  });

  it('refuses each persona the same way, whatever its roles', async () => {
    const role = REPRESENTATIVE['identity.role.manage'] as Row;
    for (const persona of ['employee', 'agent'] as const) {
      const response = await request<Problem>(role.path(), { method: role.method, token: await visit(persona), body: role.body });
      expect(response.status, persona).toBe(403);
      expect(response.body.feature).toBe('roles');
    }
  });

  it('refuses a standard tenant’s administrator none of these as demo_disabled', async () => {
    const admin = standard.people.admin!.token;
    for (const [permission, representative] of rows) {
      if ('none' in representative || representative.control === false) continue;
      // Paths that name the demo's own records are pointed at nothing: the
      // control is about who is refused, and must change nothing.
      const path = permission === 'ticket.attachment.add' ? `/api/v1/tickets/${standard.ticketNumbers[0]}/attachments` : representative.path();
      const response = await request<Problem>(path, { method: representative.method, token: admin, body: representative.body });
      expect(code(response.body), `${permission} ${response.status}`).not.toBe('demo_disabled');
      expect(response.body.demo, permission).toBeUndefined();
    }
  });
});
