import { describe, expect, it, vi } from 'vitest';
import { check, parseHosts, probesFor, readinessDetail } from '../post-deploy-check.js';

/**
 * The check that replaced a check that could not run.
 *
 * The deploy's smoke test used to be the walking skeleton, which boots the
 * platform in the runner's own process — so pointed at a deployed API it failed
 * on the runner's missing `DATABASE_URL_APP` without ever calling the thing it
 * was checking. It had never run, because until `RAILWAY_TOKEN` existed the
 * step was skipped, so nothing ever demonstrated that.
 *
 * Which is the case for these tests: a smoke test is the one piece of the
 * pipeline whose own failure looks exactly like the failure it exists to
 * report, and the only way to tell them apart is to exercise it against
 * answers you control.
 */

const HOSTS = {
  api: 'https://api-x.up.railway.app',
  portal: 'https://portal-x.up.railway.app',
};

function answering(status: (url: string) => number, body: (url: string) => unknown = () => ({})): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    return {
      ok: status(url) >= 200 && status(url) < 300,
      status: status(url),
      json: async () => body(url),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('what gets probed', () => {
  it('checks liveness for every public service and readiness for the API', () => {
    const probes = probesFor(HOSTS);
    expect(probes.map((one) => `${one.service}:${one.kind}`)).toEqual(['api:live', 'portal:live', 'api:ready']);
    expect(probes[0]!.url).toBe('https://api-x.up.railway.app/health/live');
    expect(probes[1]!.url).toBe('https://portal-x.up.railway.app/api/health');
    expect(probes[2]!.url).toBe('https://api-x.up.railway.app/health/ready');
  });

  it('uses the health path Railway itself calls, so the two cannot disagree', () => {
    // These are the paths in infra/railway/services.json. A service Railway
    // calls healthy and this calls broken would be a week of confusion.
    expect(probesFor({ workbench: 'https://w' })[0]!.url).toBe('https://w/api/health');
    expect(probesFor({ admin: 'https://a' })[0]!.url).toBe('https://a/api/health');
  });

  it('refuses a public service it has not been taught about', () => {
    // Skipping it would make "add a public service" a change that silently
    // shrinks what the deploy verifies — the exact class of fault this file
    // was written to fix.
    expect(() => probesFor({ ...HOSTS, status: 'https://status-x' })).toThrow(/no health path known for status/);
  });
});

describe('what it reports', () => {
  it('passes when everything answers', async () => {
    const outcomes = await check(HOSTS, answering(() => 200, () => ({ status: 'ready', checks: { database: 'ok', redis: 'ok', modules: 'ok' } })));
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
  });

  it('names the dependency that is missing rather than saying not ready', async () => {
    // The whole reason readiness is probed at all. `not-ready` sends somebody
    // to the logs; `database: failed` sends them to the variable.
    const detail = readinessDetail({ status: 'not-ready', checks: { database: 'failed', redis: 'ok', modules: 'ok' } });
    expect(detail).toBe('database: failed');
    expect(readinessDetail({ checks: { database: 'failed', redis: 'failed', modules: 'ok' } })).toBe('database: failed, redis: failed');
  });

  it('carries that detail out of a 503, which is how this deployment will first fail', async () => {
    // Exactly the state the first real deploy left behind: services running,
    // no DATABASE_URL_APP, so readiness answers 503 and says which one.
    vi.useFakeTimers();
    const promise = check(
      { api: 'https://api-x.up.railway.app' },
      answering(
        (url) => (url.endsWith('/health/ready') ? 503 : 200),
        () => ({ status: 'not-ready', checks: { database: 'failed', redis: 'failed', modules: 'ok' } }),
      ),
    );
    await vi.runAllTimersAsync();
    const outcomes = await promise;
    vi.useRealTimers();
    const ready = outcomes.find((outcome) => outcome.probe.kind === 'ready')!;
    expect(ready.ok).toBe(false);
    expect(ready.detail).toContain('database: failed');
    expect(ready.detail).toContain('redis: failed');
    // Liveness still passes: the process is up, its dependencies are not, and
    // conflating those is how a missing variable reads as a crashed service.
    expect(outcomes.find((outcome) => outcome.probe.kind === 'live')!.ok).toBe(true);
  });

  it('says how many attempts it made, so a slow start is distinguishable from a broken one', async () => {
    vi.useFakeTimers();
    const promise = check({ portal: 'https://portal-x' }, answering(() => 502));
    await vi.runAllTimersAsync();
    const [outcome] = await promise;
    vi.useRealTimers();
    expect(outcome!.ok).toBe(false);
    expect(outcome!.detail).toMatch(/after 10 attempts: 502/);
  });
});

describe('the hosts it is given', () => {
  it('reads what the deploy published', () => {
    expect(parseHosts(['--hosts', JSON.stringify(HOSTS)])).toEqual(HOSTS);
  });

  it('refuses anything that is not a set of https origins', () => {
    // `--hosts` is interpolated from a workflow output. An empty string, a
    // literal `null`, or a shell-mangled fragment must stop the run rather
    // than check nothing and report success.
    expect(() => parseHosts(['--hosts', '[]'])).toThrow(/JSON object/);
    expect(() => parseHosts(['--hosts', 'null'])).toThrow(/JSON object/);
    expect(() => parseHosts(['--hosts', '{"api":"http://api-x"}'])).toThrow(/not an https origin/);
    expect(() => parseHosts([])).toThrow(/required/);
  });

  it('passes with nothing to check only when the deploy published nothing', () => {
    // Defensible, and worth a test so it stays deliberate: `{}` means no public
    // service got a hostname, which the deploy would already have failed on.
    expect(probesFor({})).toEqual([]);
  });
});
