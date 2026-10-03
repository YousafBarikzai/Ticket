import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import {
  DEMO_COMPANY,
  DEMO_KEYS,
  DEMO_PERSONAS,
  DEMO_TENANT_SLUG_PATTERN,
  demoPersona,
  demoWindow,
  type DemoLiveRecord,
  type DemoPersonaKey,
  type DemoTokenRecord,
} from '@itsm/contracts/demo';
import { SYSTEM_PERMISSIONS, createContext, withContext, type TenantContext } from '@itsm/platform';
import { bootstrapModules } from '@itsm/runtime';
import { tenantService } from '@itsm/module-tenancy';
import { userService } from '@itsm/module-identity';
import { ticketService } from '@itsm/module-ticket';
import { redisDemoTokenStore } from '../../packages/bff/src/demo/redis-store.js';
import { DEMO_SETTING_DEFAULTS } from '../../packages/bff/src/demo/settings.js';
import { demoTokenHash, newDemoSid, newDemoToken, type DemoTokenStore } from '../../packages/bff/src/demo/store.js';
import { deleteTracked, preserveRedisKeys, trackRedisKeys } from './redis-keys.js';

/**
 * A minimal shared demo, for the integration suites and the harness's
 * `--fixture minimal` (SPEC v3 §4.10; A3 §11.2).
 *
 * `createDemoFixture()` builds a `kind = 'demo'` tenant through the real
 * `provisionTenant`, the three personas exactly as `DEMO_PERSONAS` describes
 * them (names, emails, roles, Alex leading `service-desk`), twelve tickets,
 * and the `demo:live` record a swap would have written. `mintTestToken`
 * then mints through the BFF's real Redis store, so the Lua scripts are the
 * code under test rather than a copy of them. The full generator (A4) is the
 * harness's `--fixture full`; this is the smallest demo the API accepts.
 *
 * Redis hygiene (V-M2): everything the fixture writes is tracked and deleted
 * by `dispose()`, and the demo's singletons (`demo:live`, `demo:paused`,
 * `demo:active`, the reset keys) are snapshotted first and put back exactly,
 * so the next integration file — or a developer's running demo — finds the
 * Redis this one found. BFF keys use the caller's app name (`it-<file>`).
 *
 * No test framework is imported: the harness runs this outside Vitest.
 */

export interface DemoFixtureOptions {
  /** A slug of the demo's form (`demo-…`), unique to the caller; a leftover tenant with it is purged first. */
  readonly slug?: string;
  /** The BFF app name the token store keys sessions under; integration files use `it-<file>`, whose keys `dispose()` removes. */
  readonly appName?: string;
  /** The live generation to publish. */
  readonly generation?: number;
  /** A connection to share; otherwise one is opened on `REDIS_URL` and closed by `dispose()`. */
  readonly redis?: Redis;
  /** How many tickets to raise (12, as A3 §10.2 says). */
  readonly tickets?: number;
}

export interface DemoFixturePerson {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
}

export interface DemoFixture {
  readonly tenantId: string;
  readonly slug: string;
  readonly orgId: string;
  readonly serviceDeskTeamId: string;
  readonly personas: Readonly<Record<DemoPersonaKey, DemoFixturePerson>>;
  readonly ticketIds: readonly string[];
  readonly ticketNumbers: readonly string[];
  readonly redis: Redis;
  readonly store: DemoTokenStore;
  /** The generation `demo:live` currently names. */
  generation: number;
  /** The live record this fixture publishes, with any overrides. */
  liveRecord(overrides?: Partial<DemoLiveRecord>): DemoLiveRecord;
  /** Writes `demo:live` (the whole record, as the swap does). */
  publishLive(overrides?: Partial<DemoLiveRecord>): Promise<DemoLiveRecord>;
  /** Mints a token for a persona through the BFF's Lua `mint`, from a fresh IP bucket. */
  mintTestToken(persona: DemoPersonaKey): Promise<string>;
  /** Writes a token record directly, as only a forged or corrupted Redis would; returns a token that names it. */
  forgeToken(record: Partial<DemoTokenRecord>): Promise<string>;
  /** Tracks keys the caller writes itself, so `dispose()` removes them too. */
  track(keys: readonly string[]): void;
  /** Deletes what the fixture wrote, restores the singletons and purges the tenant. */
  dispose(): Promise<void>;
}

/** The demo's singletons: never deleted by a fixture, always restored. */
const SINGLETONS = [
  DEMO_KEYS.live,
  DEMO_KEYS.paused,
  DEMO_KEYS.active,
  DEMO_KEYS.build,
  DEMO_KEYS.resetLock,
  DEMO_KEYS.resetCooldown,
  DEMO_KEYS.resetRequested,
  DEMO_KEYS.resetBackoff,
] as const;

/** Twelve ordinary requests at Northwind, in the story's own words. */
const TICKET_TITLES = [
  'Outlook keeps asking for my password',
  'Laptop docking station not detecting monitors',
  'Cannot open the month-end reporting workbook',
  'New starter needs access to the finance share',
  'Printer on the second floor is jammed',
  'VPN drops every few minutes when working from home',
  'Teams calls have no audio on my headset',
  'Request a replacement keyboard',
  'Expense system says my approver is unknown',
  'Shared mailbox missing from Outlook',
  'Password reset for the payroll system',
  'Wi-Fi in the Leeds meeting room keeps disconnecting',
] as const;

let latest: DemoFixture | null = null;

function systemContextFor(tenantId: string): TenantContext {
  return createContext({ tenantId, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
}

/** A fresh, valid IP bucket: sixteen hex characters, never an address. */
function freshBucket(): string {
  return randomBytes(8).toString('hex');
}

export async function createDemoFixture(options: DemoFixtureOptions = {}): Promise<DemoFixture> {
  const slug = options.slug ?? `demo-it-${randomBytes(3).toString('hex')}`;
  if (!DEMO_TENANT_SLUG_PATTERN.test(slug)) throw new RangeError(`a demo fixture slug must look like a demo slug: ${slug}`);
  const appName = options.appName ?? 'it-demo-fixture';
  const ownsRedis = !options.redis;
  const redis = options.redis ?? new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { family: 0, maxRetriesPerRequest: 3 });
  const store = redisDemoTokenStore(redis, appName);

  // Provisioning runs the modules' seed steps, so the registry must be up.
  bootstrapModules();
  const restoreSingletons = await preserveRedisKeys(redis, SINGLETONS);
  // A test's own app name (`it-<file>`) is cleaned up; a real one (the
  // harness's) is left to the BFF that owns it.
  if (appName.startsWith('it-')) trackRedisKeys(redis, [`bff:${appName}:*`]);

  const existing = await tenantService.findTenantBySlug(slug);
  if (existing) await tenantService.purgeTenant(existing.id);
  const { tenantId } = await tenantService.provisionTenant({ name: DEMO_COMPANY.name, slug, region: 'eu-west', kind: 'demo' });
  const base = systemContextFor(tenantId);

  const built = await withContext(base, async () => {
    const org = await tenantService.createOrganisation(base, { name: DEMO_COMPANY.name, code: 'NWT' });
    const ctx: TenantContext = { ...base, organisationIds: [org.id], organisationPaths: [org.path] };
    const serviceDesk = await userService.createTeam(ctx, { key: 'service-desk', name: 'Service Desk', orgId: org.id });

    const personas = {} as Record<DemoPersonaKey, DemoFixturePerson>;
    for (const persona of DEMO_PERSONAS) {
      const user = await userService.createUser(ctx, { email: persona.email, displayName: persona.name, primaryOrgId: org.id }, 'seed');
      for (const role of persona.roles) await userService.assignRole(ctx, { userId: user.id, roleKey: role });
      if (persona.team) {
        await userService.addTeamMember(ctx, serviceDesk.id, user.id, persona.team.lead);
      }
      personas[persona.key] = { userId: user.id, email: user.email, displayName: user.displayName };
    }

    const requester: TenantContext = { ...ctx, actor: { type: 'user', id: personas.employee.userId, displayName: personas.employee.displayName } };
    const ticketIds: string[] = [];
    const ticketNumbers: string[] = [];
    for (const [index, title] of TICKET_TITLES.slice(0, options.tickets ?? TICKET_TITLES.length).entries()) {
      const ticket = await withContext(requester, () =>
        ticketService.createTicket(requester, {
          type: index % 3 === 0 ? 'request' : 'incident',
          title,
          description: `${title}. Raised by the demo fixture.`,
          priority: 'P3',
          requesterId: personas.employee.userId,
          groupId: serviceDesk.id,
          orgId: org.id,
          sourceChannel: 'portal',
        }),
      );
      ticketIds.push(ticket.id);
      ticketNumbers.push(ticket.number);
    }
    return { orgId: org.id, serviceDeskTeamId: serviceDesk.id, personas, ticketIds, ticketNumbers };
  });

  const now = Date.now();
  const fixture: DemoFixture = {
    tenantId,
    slug,
    redis,
    store,
    generation: options.generation ?? 1,
    ...built,

    liveRecord(overrides = {}) {
      return {
        v: 1,
        tenantId,
        slug,
        generation: fixture.generation,
        builtAt: now,
        anchor: now,
        lastResetAt: now,
        lastResetReason: 'initial',
        personas: {
          employee: { userId: built.personas.employee.userId },
          agent: { userId: built.personas.agent.userId },
          admin: { userId: built.personas.admin.userId },
        },
        agentTeamIds: [built.serviceDeskTeamId],
        ...overrides,
      };
    },

    async publishLive(overrides = {}) {
      const record = fixture.liveRecord(overrides);
      fixture.generation = record.generation;
      await redis.set(DEMO_KEYS.live, JSON.stringify(record));
      return record;
    },

    async mintTestToken(persona) {
      const entry = demoPersona(persona);
      if (!entry) throw new RangeError(`not a demo persona: ${String(persona)}`);
      const ipb = freshBucket();
      const at = Date.now();
      const keys = [DEMO_KEYS.activeForBucket(ipb)];
      for (const window of [demoWindow('m', at), demoWindow('h', at)]) {
        keys.push(DEMO_KEYS.mintPerBucket(entry.area, persona, ipb, window), DEMO_KEYS.mintAll(window), DEMO_KEYS.mintTop(window));
      }
      trackRedisKeys(redis, keys);
      const result = await store.mint({ app: entry.area, persona, ipb, settings: DEMO_SETTING_DEFAULTS, now: at });
      if (!result.ok) throw new Error(`the demo fixture could not mint a ${persona} token: ${result.reason}`);
      trackRedisKeys(redis, [DEMO_KEYS.token(result.tokenHash)]);
      return result.token;
    },

    async forgeToken(overrides) {
      const at = Date.now();
      const record: DemoTokenRecord = {
        v: 1,
        tenantId,
        userId: built.personas.agent.userId,
        persona: 'agent',
        app: 'workbench',
        sid: newDemoSid(),
        gen: fixture.generation,
        iat: at,
        exp: at + 900_000,
        ipb: freshBucket(),
        ...overrides,
      };
      const token = newDemoToken();
      const key = DEMO_KEYS.token(demoTokenHash(token));
      trackRedisKeys(redis, [key]);
      await redis.set(key, JSON.stringify(record), 'PX', 900_000);
      return token;
    },

    track(keys) {
      trackRedisKeys(redis, keys);
    },

    async dispose() {
      await deleteTracked();
      await restoreSingletons();
      await tenantService.purgeTenant(tenantId);
      if (latest === fixture) latest = null;
      if (ownsRedis) await redis.quit().catch(() => redis.disconnect());
    },
  };

  await fixture.publishLive();
  latest = fixture;
  return fixture;
}

/** `mintTestToken(persona)` on the most recently created fixture (A3 §11.2). */
export function mintTestToken(persona: DemoPersonaKey): Promise<string> {
  if (!latest) throw new Error('createDemoFixture() has not been called');
  return latest.mintTestToken(persona);
}
