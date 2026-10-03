import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Quiet tenants (A4 §2.4 Q2): while the shared demo's next generation is
 * built, `enqueue()` refuses every job for its tenant, so a service that
 * reaches for the queue during a history import fails the build instead of
 * sending something. The queue itself is faked: what is under test is the
 * decision made before the queue is touched, and that other tenants are not
 * affected by it.
 */

const added = vi.hoisted(() => [] as { queue: string; job: string; data: unknown; options: unknown }[]);
const constructed = vi.hoisted(() => [] as string[]);

vi.mock('bullmq', () => {
  class Queue {
    constructor(readonly name: string) {
      constructed.push(name);
    }
    add(job: string, data: unknown, options: { jobId?: string } = {}) {
      added.push({ queue: this.name, job, data, options });
      return Promise.resolve({ id: options.jobId ?? `job-${added.length}` });
    }
    close() {
      return Promise.resolve();
    }
  }
  class Worker {}
  return { Queue, Worker };
});

vi.mock('../redis.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../redis.js')>()),
  queueConnection: () => ({}),
}));

const { SYSTEM_PERMISSIONS, createContext } = await import('../context.js');
const { closeQueues, enqueue } = await import('../jobs.js');
const { QuietTenantError, assertNotQuiet, beginQuiet, endQuiet, isQuiet, quietRefusals } = await import('../quiet.js');
const { clearModules, isTenantModule, modules, registerModule, tenantModules } = await import('../manifest.js');
const { logger, metrics } = await import('../telemetry.js');

const BUILD = '0192f3a4-1111-7aaa-8bbb-000000000001';
const OTHER = '0192f3a4-2222-7aaa-8bbb-000000000002';

function contextFor(tenantId: string) {
  return createContext({ tenantId, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
}

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  added.length = 0;
  constructed.length = 0;
  logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  endQuiet(BUILD);
  endQuiet(OTHER);
  logged.mockRestore();
  await closeQueues();
});

describe('marking a tenant quiet', () => {
  it('is off until asked for, and off again once lifted', () => {
    expect(isQuiet(BUILD)).toBe(false);
    beginQuiet(BUILD);
    expect(isQuiet(BUILD)).toBe(true);
    endQuiet(BUILD);
    expect(isQuiet(BUILD)).toBe(false);
  });

  it('marks one tenant, not every tenant', () => {
    beginQuiet(BUILD);
    expect(isQuiet(OTHER)).toBe(false);
  });

  it('may be lifted for a tenant that was never quiet, as a finally block does', () => {
    expect(() => endQuiet(OTHER)).not.toThrow();
  });

  it('is idempotent: marking twice and lifting once leaves it lifted', () => {
    // One build, one tenant: there is no nesting to count, and a counter
    // that a crashed step forgot to decrement would keep a live tenant quiet.
    beginQuiet(BUILD);
    beginQuiet(BUILD);
    endQuiet(BUILD);
    expect(isQuiet(BUILD)).toBe(false);
  });
});

describe('enqueue() for a quiet tenant', () => {
  it('throws QuietTenantError and never touches the queue', async () => {
    beginQuiet(BUILD);
    const error = await enqueue(contextFor(BUILD), 'notify', 'status.notify', { updateId: 'u1' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuietTenantError);
    expect(error).toMatchObject({ code: 'tenant_quiet', tenantId: BUILD, queueName: 'notify', jobName: 'status.notify' });
    expect((error as Error).message).toContain('must stay quiet');
    // Not even constructed: a delayed or deduplicated job would still be a job.
    expect(constructed).toEqual([]);
    expect(added).toEqual([]);
    // Loud, with what an operator needs to find the service that did it.
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('quietly'), {
      tenantId: BUILD,
      queue: 'notify',
      job: 'status.notify',
    });
  });

  it('refuses delayed and deduplicated jobs alike', async () => {
    beginQuiet(BUILD);
    await expect(
      enqueue(contextFor(BUILD), 'webhooks', 'webhook.deliver', {}, { delay: 60_000, idempotencyKey: 'deliver-1' }),
    ).rejects.toBeInstanceOf(QuietTenantError);
    expect(added).toEqual([]);
  });

  it('still enqueues for every other tenant while one is quiet', async () => {
    beginQuiet(BUILD);
    const id = await enqueue(contextFor(OTHER), 'notify', 'status.notify', { updateId: 'u2' }, { idempotencyKey: 'n-2' });

    expect(id).toBe('n-2');
    expect(added).toEqual([
      expect.objectContaining({ queue: 'notify', job: 'status.notify', data: expect.objectContaining({ tenantId: OTHER }) }),
    ]);
  });

  it('enqueues for the same tenant once the build has lifted the mark', async () => {
    beginQuiet(BUILD);
    endQuiet(BUILD);
    await expect(enqueue(contextFor(BUILD), 'search', 'search.index', {})).resolves.toBeDefined();
    expect(added).toHaveLength(1);
  });

  it('counts each refusal, in the process and in the metric the build checks (V9)', async () => {
    const before = quietRefusals();
    const metricBefore = metrics.snapshot().counters['jobs_enqueue_refused_total{reason=quiet}'] ?? 0;
    beginQuiet(BUILD);
    await enqueue(contextFor(BUILD), 'ai', 'ai.suggest', {}).catch(() => undefined);
    expect(() => assertNotQuiet(BUILD, 'channels', 'survey.chat.post')).toThrow(QuietTenantError);

    expect(quietRefusals()).toBe(before + 2);
    expect(metrics.snapshot().counters['jobs_enqueue_refused_total{reason=quiet}']).toBe(metricBefore + 2);
  });

  it('counts nothing when the tenant is not quiet', () => {
    const before = quietRefusals();
    expect(() => assertNotQuiet(OTHER, 'notify', 'status.notify')).not.toThrow();
    expect(quietRefusals()).toBe(before);
  });
});

describe('platform modules (ModuleManifest.audience)', () => {
  const base = {
    version: '1.0.0',
    phase: 'PH-1',
    dependsOn: [],
    permissions: [],
    events: { publishes: [], consumes: [] },
    featureFlags: [],
    settings: [],
    jobs: [],
    enabledByDefault: true,
    optional: true,
  };

  afterEach(() => clearModules());

  it('counts a manifest without an audience as a tenant module, as every module before v3 is', () => {
    expect(isTenantModule({})).toBe(true);
    expect(isTenantModule({ audience: 'tenant' })).toBe(true);
    expect(isTenantModule({ audience: 'platform' })).toBe(false);
  });

  it('keeps a platform module registered, but out of the tenant modules', () => {
    registerModule({ ...base, id: 'MOD-T1', key: 'tickets', name: 'Tickets' });
    registerModule({ ...base, id: 'MOD-T2', key: 'demo', name: 'Demo', audience: 'platform', enabledByDefault: false, optional: false });

    // Registered, so the worker still schedules its jobs…
    expect(modules().map((m) => m.id)).toEqual(['MOD-T1', 'MOD-T2']);
    // …but no tenant records, lists or toggles it.
    expect(tenantModules().map((m) => m.id)).toEqual(['MOD-T1']);
  });
});
