import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_BUILD_FAILING_FIELD, DEMO_OPS_KEY } from '@itsm/contracts/demo';
import { loadConfig, resetConfig } from '../config.js';
import {
  CONFIG_WARNINGS_INTERVAL_MS,
  CONFIG_WARNINGS_KEY,
  CONFIG_WARNINGS_TTL_SECONDS,
  DEFAULT_DEV_TOKEN_SECRET,
  configWarnings,
  readDeploymentWarnings,
  reportConfigWarnings,
  type ConfigWarningReport,
  type ConfigWarningsStore,
  type DeploymentWarningsSource,
} from '../config-warnings.js';
import { logger } from '../telemetry.js';

/**
 * D24 (SPEC v3 §6.5): a deployment signing links with the public development
 * secret is warned about loudly and never refused. These pin when the warning
 * fires, what it says and where it is recorded — and that the secret itself
 * never appears in any of it, because every one of those places is read by
 * people who should not learn it.
 */

const PRODUCTION = { NODE_ENV: 'production', DEV_TOKEN_SECRET: DEFAULT_DEV_TOKEN_SECRET } as const;
const STRONG = 'k3J9v0QmZx7RtL2pWc8YhN4sB6dF1gA5eU0iO9yT3rE7wQ2zX8cV4bN6mL1kJ5hG';

describe('configWarnings', () => {
  it('names the default secret in production as critical', () => {
    expect(configWarnings(PRODUCTION, {})).toEqual([{ code: 'dev_token_secret_default', severity: 'critical' }]);
  });

  it('says nothing outside production, where the default is the point', () => {
    expect(configWarnings({ ...PRODUCTION, NODE_ENV: 'development' }, {})).toEqual([]);
    expect(configWarnings({ ...PRODUCTION, NODE_ENV: 'test' }, {})).toEqual([]);
  });

  it('reads the secret as tokens.ts does: the environment first, the configuration after', () => {
    // Configuration says strong, the environment says default: the environment signs, so it warns.
    expect(configWarnings({ NODE_ENV: 'production', DEV_TOKEN_SECRET: STRONG }, { DEV_TOKEN_SECRET: DEFAULT_DEV_TOKEN_SECRET })).toEqual([
      { code: 'dev_token_secret_default', severity: 'critical' },
    ]);
    // And the other way round: the environment's strong value is the one in use.
    expect(configWarnings(PRODUCTION, { DEV_TOKEN_SECRET: STRONG })).toEqual([]);
  });

  it('calls a secret of 31 characters short, and one of 32 fine', () => {
    expect(configWarnings(PRODUCTION, { DEV_TOKEN_SECRET: 'x'.repeat(31) })).toEqual([{ code: 'dev_token_secret_short', severity: 'warning' }]);
    expect(configWarnings(PRODUCTION, { DEV_TOKEN_SECRET: 'x'.repeat(32) })).toEqual([]);
    // Set but empty is still what signs (`??` keeps it), and it is the shortest secret there is.
    expect(configWarnings(PRODUCTION, { DEV_TOKEN_SECRET: '' })).toEqual([{ code: 'dev_token_secret_short', severity: 'warning' }]);
  });

  it('is quiet for 64 random characters', () => {
    expect(configWarnings(PRODUCTION, { DEV_TOKEN_SECRET: STRONG })).toEqual([]);
  });

  it('reports the default as the default only, not also as short', () => {
    expect(DEFAULT_DEV_TOKEN_SECRET.length).toBeLessThan(32);
    expect(configWarnings(PRODUCTION, {}).map((warning) => warning.code)).toEqual(['dev_token_secret_default']);
  });

  it('knows the same default config.ts gives, without the two files sharing an edit', () => {
    resetConfig();
    try {
      const config = loadConfig({ DATABASE_URL_APP: 'postgres://app_user@localhost:5432/itsm' } as NodeJS.ProcessEnv);
      expect(config.DEV_TOKEN_SECRET).toBe(DEFAULT_DEV_TOKEN_SECRET);
    } finally {
      resetConfig();
    }
  });
});

/** A Redis double that records what was written, and can be told to fail. */
function store(options: { fail?: boolean } = {}): ConfigWarningsStore & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record = (name: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push([name, ...args]);
      if (options.fail) throw new Error('READONLY You can\'t write against a read only replica.');
      return 1;
    });
  return { calls, hset: record('hset'), hdel: record('hdel'), expire: record('expire') } as unknown as ConfigWarningsStore & { calls: unknown[][] };
}

describe('reportConfigWarnings', () => {
  const reports: ConfigWarningReport[] = [];
  const report = async (...args: Parameters<typeof reportConfigWarnings>): Promise<ConfigWarningReport> => {
    const result = await reportConfigWarnings(...args);
    reports.push(result);
    return result;
  };

  afterEach(() => {
    for (const one of reports.splice(0)) one.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('logs the default once, as an error with the risk and the fix, and records the service', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const redis = store();
    const result = await report('itsm-api', { config: PRODUCTION, env: {}, store: redis, now: () => new Date('2026-10-02T09:00:00Z') });

    expect(result.warnings).toEqual([{ code: 'dev_token_secret_default', severity: 'critical' }]);
    expect(error).toHaveBeenCalledTimes(1);
    const [message, fields] = error.mock.calls[0]!;
    expect(message).toBe('CONFIGURATION WARNING: DEV_TOKEN_SECRET is the public development default');
    expect(fields).toMatchObject({ code: 'dev_token_secret_default', service: 'itsm-api' });
    expect(String(fields?.risk)).toMatch(/forged/);
    expect(String(fields?.fix)).toContain('api, worker-events, worker-engine, worker-comms and worker-data');
    expect(String(fields?.fix)).toContain('docs/runbooks/first-production-deploy.md');

    expect(redis.calls).toEqual([
      ['hset', CONFIG_WARNINGS_KEY, 'itsm-api', JSON.stringify({ codes: ['dev_token_secret_default'], at: '2026-10-02T09:00:00.000Z' })],
      ['expire', CONFIG_WARNINGS_KEY, CONFIG_WARNINGS_TTL_SECONDS],
    ]);
    expect(CONFIG_WARNINGS_TTL_SECONDS).toBe(93_600);
  });

  it('logs a short secret at warn, not error', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await report('itsm-worker-comms', { config: PRODUCTION, env: { DEV_TOKEN_SECRET: 'short-but-set' }, store: store() });
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('CONFIGURATION WARNING: DEV_TOKEN_SECRET is shorter than 32 characters', expect.objectContaining({ code: 'dev_token_secret_short' }));
  });

  it('removes its own field when it is clean, and logs nothing', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const redis = store();
    const result = await report('itsm-worker-data', { config: PRODUCTION, env: { DEV_TOKEN_SECRET: STRONG }, store: redis });
    expect(result.warnings).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(redis.calls).toEqual([['hdel', CONFIG_WARNINGS_KEY, 'itsm-worker-data']]);
  });

  it('swallows a Redis failure with a warning: the log line is the warning, the record a convenience', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await expect(report('itsm-api', { config: PRODUCTION, env: {}, store: store({ fail: true }) })).resolves.toMatchObject({
      warnings: [{ code: 'dev_token_secret_default' }],
    });
    expect(warn).toHaveBeenCalledWith('configuration warnings could not be shared through Redis', expect.objectContaining({ service: 'itsm-api' }));
  });

  it('stops waiting for a Redis that never answers, so a boot is not held up by the record', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const silent = { hset: () => new Promise(() => undefined), hdel: () => new Promise(() => undefined), expire: async () => 1 } as unknown as ConfigWarningsStore;
    const result = await report('itsm-api', { config: PRODUCTION, env: {}, store: silent, storeTimeoutMs: 20 });
    expect(result.warnings).toEqual([{ code: 'dev_token_secret_default', severity: 'critical' }]);
    expect(warn).toHaveBeenCalledWith(
      'configuration warnings could not be shared through Redis',
      expect.objectContaining({ service: 'itsm-api', error: 'Redis did not answer within 20 ms' }),
    );
  });

  it('repeats every six hours on a timer that never holds the process open', async () => {
    vi.useFakeTimers();
    const unref = vi.fn();
    const realSetInterval = globalThis.setInterval;
    const intervals: number[] = [];
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((handler: () => void, ms: number) => {
      intervals.push(ms);
      const timer = realSetInterval(handler, ms);
      const originalUnref = timer.unref.bind(timer);
      timer.unref = () => {
        unref();
        return originalUnref();
      };
      return timer;
    }) as typeof setInterval);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const redis = store();

    await report('itsm-api', { config: PRODUCTION, env: {}, store: redis });
    expect(intervals).toEqual([CONFIG_WARNINGS_INTERVAL_MS]);
    expect(CONFIG_WARNINGS_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CONFIG_WARNINGS_INTERVAL_MS);
    expect(error).toHaveBeenCalledTimes(2);
    expect(redis.calls.filter(([name]) => name === 'hset')).toHaveLength(2);
  });

  it('keeps one repeat per service however often it is called, and stops it', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const first = await report('itsm-api', { config: PRODUCTION, env: {}, store: store() });
    await report('itsm-api', { config: PRODUCTION, env: {}, store: store() });
    expect(error).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CONFIG_WARNINGS_INTERVAL_MS);
    expect(error).toHaveBeenCalledTimes(3);
    first.stop();
    for (const one of reports.splice(0)) one.stop();
    await vi.advanceTimersByTimeAsync(CONFIG_WARNINGS_INTERVAL_MS * 2);
    expect(error).toHaveBeenCalledTimes(3);
  });

  it('never puts the secret value in any log argument or any record', async () => {
    const secret = 'short-secret-value-XYZ';
    const lines: unknown[] = [];
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => void lines.push(args));
    }
    const redis = store();
    await report('itsm-api', { config: PRODUCTION, env: { DEV_TOKEN_SECRET: secret }, store: redis });
    await report('itsm-worker-events', { config: PRODUCTION, env: {}, store: redis });
    await report('itsm-worker-engine', { config: { ...PRODUCTION, DEV_TOKEN_SECRET: secret }, env: {}, store: store({ fail: true }) });

    expect(lines.length).toBeGreaterThanOrEqual(3);
    const everything = JSON.stringify([lines, redis.calls]);
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain(DEFAULT_DEV_TOKEN_SECRET);
  });
});

/** A read-only Redis double holding the two hashes. */
function source(config: Record<string, string>, demo: string | null = null): DeploymentWarningsSource & { asked: unknown[][] } {
  const asked: unknown[][] = [];
  return {
    asked,
    hgetall: vi.fn(async (key: string) => {
      asked.push(['hgetall', key]);
      return key === CONFIG_WARNINGS_KEY ? config : {};
    }),
    hget: vi.fn(async (key: string, field: string) => {
      asked.push(['hget', key, field]);
      return key === DEMO_OPS_KEY && field === DEMO_BUILD_FAILING_FIELD ? demo : null;
    }),
  } as unknown as DeploymentWarningsSource & { asked: unknown[][] };
}

describe('readDeploymentWarnings', () => {
  const NOW = new Date('2026-10-02T12:00:00Z');
  const entry = (codes: unknown, at: unknown = '2026-10-02T09:00:00.000Z'): string => JSON.stringify({ codes, at });

  it('reads both hashes, by the names the demo contracts give them', async () => {
    const redis = source({});
    expect(await readDeploymentWarnings(redis, NOW)).toEqual([]);
    expect(redis.asked).toEqual([
      ['hgetall', CONFIG_WARNINGS_KEY],
      ['hget', DEMO_OPS_KEY, DEMO_BUILD_FAILING_FIELD],
    ]);
    expect(CONFIG_WARNINGS_KEY).toBe('ops:config-warnings');
  });

  it('answers one row per service, sorted by service, with the demo build under worker-data', async () => {
    const redis = source(
      {
        'itsm-worker-comms': entry(['dev_token_secret_default']),
        'itsm-api': entry(['dev_token_secret_default'], '2026-10-02T08:00:00Z'),
        'itsm-worker-data': entry(['dev_token_secret_short']),
      },
      JSON.stringify({ since: '2026-10-01T00:05:00Z', failures: 3, step: 'checks', check: 'V3 attainment bands' }),
    );
    expect(await readDeploymentWarnings(redis, NOW)).toEqual([
      { service: 'itsm-api', codes: ['dev_token_secret_default'], at: '2026-10-02T08:00:00.000Z' },
      { service: 'itsm-worker-comms', codes: ['dev_token_secret_default'], at: '2026-10-02T09:00:00.000Z' },
      {
        service: 'itsm-worker-data',
        codes: ['demo_build_failing'],
        at: '2026-10-01T00:05:00.000Z',
        failure: { step: 'checks', check: 'V3 attainment bands', failures: 3 },
      },
      { service: 'itsm-worker-data', codes: ['dev_token_secret_short'], at: '2026-10-02T09:00:00.000Z' },
    ]);
  });

  it('takes the demo build’s start as epoch milliseconds too, and tolerates missing parts', async () => {
    const since = Date.parse('2026-10-01T00:05:00Z');
    const [row] = await readDeploymentWarnings(source({}, JSON.stringify({ since, failures: 'three', step: '  tickets\n' })), NOW);
    expect(row).toEqual({
      service: 'itsm-worker-data',
      codes: ['demo_build_failing'],
      at: '2026-10-01T00:05:00.000Z',
      failure: { step: 'tickets', check: null, failures: null },
    });
  });

  it('leaves out what it cannot read rather than failing the whole answer', async () => {
    const redis = source(
      {
        'itsm-api': '{not json',
        'itsm-worker-events': entry('dev_token_secret_default'),
        'itsm-worker-engine': entry(['something_from_a_later_release']),
        'itsm-worker-comms': entry(['dev_token_secret_default'], 'yesterday-ish'),
        '<script>': entry(['dev_token_secret_default']),
        'itsm-worker-data': entry(['dev_token_secret_default', 'dev_token_secret_default', 'later_code']),
      },
      JSON.stringify({ failures: 3 }),
    );
    expect(await readDeploymentWarnings(redis, NOW)).toEqual([
      { service: 'itsm-worker-data', codes: ['dev_token_secret_default'], at: '2026-10-02T09:00:00.000Z' },
    ]);
  });

  it('drops a field nobody has refreshed for 26 hours: a service that no longer exists cannot clear its own', async () => {
    const fresh = new Date(NOW.getTime() - CONFIG_WARNINGS_TTL_SECONDS * 1000).toISOString();
    const stale = new Date(NOW.getTime() - CONFIG_WARNINGS_TTL_SECONDS * 1000 - 1).toISOString();
    const rows = await readDeploymentWarnings(
      source({ 'itsm-api': entry(['dev_token_secret_default'], fresh), 'itsm-old-worker': entry(['dev_token_secret_default'], stale) }),
      NOW,
    );
    expect(rows.map((row) => row.service)).toEqual(['itsm-api']);
  });

  it('bounds the step and check it passes on, since they reach a page', async () => {
    const [row] = await readDeploymentWarnings(source({}, JSON.stringify({ since: NOW.toISOString(), step: 'x'.repeat(500), check: '' })), NOW);
    expect(row?.failure?.step?.length).toBe(120);
    expect(row?.failure?.check).toBeNull();
  });

  it('lets a Redis error through, for the caller to answer', async () => {
    const broken = { hgetall: async () => Promise.reject(new Error('ECONNREFUSED')), hget: async () => null } as unknown as DeploymentWarningsSource;
    await expect(readDeploymentWarnings(broken, NOW)).rejects.toThrow('ECONNREFUSED');
  });
});
