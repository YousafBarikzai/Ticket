import { describe, expect, it } from 'vitest';
import {
  demoBackoffSchema,
  demoBuildSchema,
  demoCooldownSchema,
  demoEventSchema,
  demoLiveSchema,
  demoPausedSchema,
  demoStatusSchema,
  demoTokenSchema,
  parseDemoRecord,
} from '../demo-schemas.js';
import { computeDemoStatus, DEMO_KEYS, demoWindow, isDemoKey } from '../demo.js';
import type {
  DemoBackoff,
  DemoBuildState,
  DemoCooldown,
  DemoEvent,
  DemoLiveRecord,
  DemoPausedRecord,
  DemoTokenRecord,
} from '../demo.js';

// Every sample is typed as its record, with every field, so the compiler
// proves the sample is complete and a strict parse proves the schema knows
// every field the type has. Together they keep type and schema in step.
const now = Date.parse('2026-10-02T12:00:00.000Z');
const tenantId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const userId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const teamId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';

const live: DemoLiveRecord = {
  v: 1,
  tenantId,
  slug: 'demo',
  generation: 41,
  builtAt: now - 3_600_000,
  anchor: now - 3_600_000,
  lastResetAt: now - 3_500_000,
  lastResetReason: 'scheduled',
  personas: { employee: { userId }, agent: { userId }, admin: { userId } },
  agentTeamIds: [teamId],
};

const token: DemoTokenRecord = {
  v: 1,
  tenantId,
  userId,
  persona: 'agent',
  app: 'workbench',
  sid: 'demo-3f2b8c1e-7a4d-4e5f-9a0b-1c2d3e4f5a6b',
  gen: 41,
  iat: now,
  exp: now + 900_000,
  ipb: '0123456789abcdef',
};

const build: DemoBuildState = {
  v: 1,
  state: 'building',
  generation: 42,
  reason: 'manual',
  startedAt: now - 60_000,
  step: 'history',
  stepIndex: 7,
  steps: 11,
  etaSec: 210,
};

const backoff: DemoBackoff = { v: 1, failures: 1, retryAt: now + 300_000, step: 'checks' };
const cooldown: DemoCooldown = { at: now - 60_000, generation: 41, reason: 'manual' };
const paused: DemoPausedRecord = { by: 'operator', at: now, reason: 'Investor demo at 14:00' };

/** A JSON round trip, as the records travel through Redis. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('the record schemas', () => {
  const cases = [
    ['demo:live', demoLiveSchema, live],
    ['demo:tok', demoTokenSchema, token],
    ['demo:build', demoBuildSchema, build],
    ['demo:reset:backoff', demoBackoffSchema, backoff],
    ['demo:reset:cooldown', demoCooldownSchema, cooldown],
    ['demo:paused', demoPausedSchema, paused],
  ] as const;

  for (const [name, schema, sample] of cases) {
    it(`reads a complete ${name} record`, () => {
      expect(schema.parse(wire(sample))).toEqual(sample);
    });

    it(`refuses a ${name} record with a field it does not know`, () => {
      expect(schema.safeParse({ ...(wire(sample) as object), extra: true }).success).toBe(false);
    });

    it(`refuses a ${name} record with any field missing`, () => {
      for (const key of Object.keys(sample)) {
        const partial = wire(sample) as Record<string, unknown>;
        delete partial[key];
        expect(schema.safeParse(partial).success, key).toBe(false);
      }
    });
  }

  it('requires version 1 of every versioned record', () => {
    for (const [schema, sample] of [
      [demoLiveSchema, live],
      [demoTokenSchema, token],
      [demoBuildSchema, build],
      [demoBackoffSchema, backoff],
    ] as const) {
      expect(schema.safeParse({ ...sample, v: 2 }).success).toBe(false);
    }
  });

  it('refuses a live record for a slug the interlock would refuse', () => {
    expect(demoLiveSchema.safeParse({ ...live, slug: 'northwind' }).success).toBe(false);
    expect(demoLiveSchema.safeParse({ ...live, slug: 'demo-eu' }).success).toBe(true);
  });

  it('refuses a live record without the agent team ids or with a missing persona', () => {
    const { agentTeamIds: _omit, ...withoutTeams } = live;
    expect(demoLiveSchema.safeParse(withoutTeams).success).toBe(false);
    expect(demoLiveSchema.safeParse({ ...live, personas: { employee: { userId }, agent: { userId } } }).success).toBe(false);
    expect(demoLiveSchema.safeParse({ ...live, generation: 0 }).success).toBe(false);
  });

  it('refuses a token that pairs an app with another area’s persona', () => {
    expect(demoTokenSchema.safeParse({ ...token, app: 'portal' }).success).toBe(false);
    expect(demoTokenSchema.safeParse({ ...token, app: 'admin', persona: 'admin' }).success).toBe(true);
  });

  it('refuses a token with a malformed visit id, IP bucket or lifetime', () => {
    expect(demoTokenSchema.safeParse({ ...token, sid: 'demo-1' }).success).toBe(false);
    expect(demoTokenSchema.safeParse({ ...token, ipb: '203.0.113.7' }).success).toBe(false);
    expect(demoTokenSchema.safeParse({ ...token, ipb: 'unknown' }).success).toBe(true);
    expect(demoTokenSchema.safeParse({ ...token, exp: token.iat }).success).toBe(false);
    expect(demoTokenSchema.safeParse({ ...token, tenantId: 'not-a-uuid' }).success).toBe(false);
  });

  it('refuses a build state from another step list', () => {
    expect(demoBuildSchema.safeParse({ ...build, step: 'seeding' }).success).toBe(false);
    expect(demoBuildSchema.safeParse({ ...build, steps: 12 }).success).toBe(false);
    expect(demoBuildSchema.safeParse({ ...build, stepIndex: 12 }).success).toBe(false);
  });
});

describe('the event schema', () => {
  const events: DemoEvent[] = [
    { type: 'swapped', generation: 42, previousGeneration: 41, previousTenantId: tenantId, reason: 'manual', at: now },
    { type: 'swapped', generation: 1, previousGeneration: null, previousTenantId: null, reason: 'initial', at: now },
    { type: 'build-started', at: now, reason: 'scheduled' },
    { type: 'build-failed', at: now, reason: 'checks' },
    { type: 'paused', at: now },
    { type: 'resumed', at: now },
  ];

  it('reads every event the channel carries', () => {
    for (const event of events) expect(demoEventSchema.parse(wire(event))).toEqual(event);
  });

  it('refuses an event it does not know', () => {
    expect(demoEventSchema.safeParse({ type: 'flushed', at: now }).success).toBe(false);
    expect(demoEventSchema.safeParse({ type: 'paused', at: now, by: 'x' }).success).toBe(false);
  });
});

describe('the status schema', () => {
  it('reads every status computeDemoStatus produces', () => {
    const variants = [
      computeDemoStatus({ live: null, build: null, cooldown: null, paused: false, backoff: null }, now),
      computeDemoStatus({ live, build, cooldown, paused: false, backoff }, now),
      computeDemoStatus({ live, build: null, cooldown: null, paused: true, backoff: null }, now),
    ];
    for (const status of variants) expect(demoStatusSchema.parse(wire(status))).toEqual(status);
  });

  it('refuses a status that names a tenant', () => {
    const status = computeDemoStatus({ live, build: null, cooldown: null, paused: false, backoff: null }, now);
    expect(demoStatusSchema.safeParse({ ...status, tenantId }).success).toBe(false);
    expect(demoStatusSchema.safeParse({ ...status, uploads: true }).success).toBe(false);
  });
});

describe('parseDemoRecord', () => {
  it('parses a stored value and treats anything unreadable as absent', () => {
    expect(parseDemoRecord(demoLiveSchema, JSON.stringify(live))).toEqual(live);
    expect(parseDemoRecord(demoLiveSchema, null)).toBeNull();
    expect(parseDemoRecord(demoLiveSchema, undefined)).toBeNull();
    expect(parseDemoRecord(demoLiveSchema, '{not json')).toBeNull();
    expect(parseDemoRecord(demoLiveSchema, JSON.stringify({ ...live, v: 2 }))).toBeNull();
    expect(parseDemoRecord(demoTokenSchema, JSON.stringify(live))).toBeNull();
  });

  it('agrees with the key builders about where each record lives', () => {
    expect(isDemoKey(DEMO_KEYS.live)).toBe(true);
    expect(isDemoKey(DEMO_KEYS.mintAll(demoWindow('m', now)))).toBe(true);
  });
});
