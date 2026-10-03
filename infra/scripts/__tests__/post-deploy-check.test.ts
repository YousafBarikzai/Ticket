import { describe, expect, it, vi } from 'vitest';
import { anchorsIn, check, parseHosts, probesFor, readinessDetail, readinessWarnings, siteLinkWarnings } from '../post-deploy-check.js';

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
    expect(probesFor({ site: 'https://s' })[0]!.url).toBe('https://s/api/health');
  });

  it('probes the public site\'s liveness with the applications', () => {
    const probes = probesFor({ ...HOSTS, site: 'https://site-x.up.railway.app' });
    expect(probes.map((one) => `${one.service}:${one.kind}`)).toEqual(['api:live', 'portal:live', 'site:live', 'api:ready']);
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

  it('retries for longer than Railway spends deciding, so a slow start is not called broken', async () => {
    vi.useFakeTimers();
    const promise = check({ portal: 'https://portal-x' }, answering(() => 502));
    await vi.runAllTimersAsync();
    const [outcome] = await promise;
    vi.useRealTimers();
    expect(outcome!.ok).toBe(false);
    expect(outcome!.detail).toMatch(/after 36 attempts: 502/);
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

describe('the readiness warnings (D24)', () => {
  it('turns the default signing secret into an annotation that names the runbook', () => {
    expect(readinessWarnings({ status: 'ready', checks: { database: 'ok' }, warnings: ['dev_token_secret_default'] })).toEqual([
      '::warning title=Signing secret::DEV_TOKEN_SECRET is the public development default on the API. See docs/runbooks/first-production-deploy.md, "The signing secret".',
    ]);
    expect(readinessWarnings({ warnings: ['dev_token_secret_short'] })[0]).toMatch(/shorter than 32 characters/);
  });

  it('says nothing when there are no warnings, and never interprets what it does not know', () => {
    expect(readinessWarnings({ status: 'ready', checks: { database: 'ok' } })).toEqual([]);
    expect(readinessWarnings(null)).toEqual([]);
    expect(readinessWarnings({ warnings: 'dev_token_secret_default' })).toEqual([]);
    // An unknown code is named, with anything that could write the log masked.
    expect(readinessWarnings({ warnings: ['new_code', { code: 'x::error::y' }, 42] })).toEqual([
      '::warning title=Readiness::The API reports a configuration warning: new_code.',
      '::warning title=Readiness::The API reports a configuration warning: x??error??y.',
    ]);
  });

  it('never fails the check: a 200 with warnings is a passing deployment', async () => {
    const outcomes = await check(
      { api: 'https://api-x.up.railway.app' },
      answering(() => 200, () => ({ status: 'ready', checks: { database: 'ok', redis: 'ok', modules: 'ok' }, warnings: ['dev_token_secret_default'] })),
    );
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const ready = outcomes.find((outcome) => outcome.probe.kind === 'ready')!;
    expect(readinessWarnings(ready.body)).toHaveLength(1);
  });
});

describe('the public site\'s links (warn-only)', () => {
  const ORIGINS = {
    site: 'https://www.example.com',
    portal: 'https://help.example.com',
    workbench: 'https://desk.example.com',
    admin: 'https://admin.example.com',
  };

  /** A chooser page as React renders it: attributes quoted, `&` written as `&amp;`. */
  function chooser({ demo = true, missing = [] as string[], rel = 'nofollow' } = {}): string {
    const apps = [
      ['portal', 'employee'],
      ['workbench', 'agent'],
      ['admin', 'admin'],
    ] as const;
    const links = apps
      .filter(([app]) => !missing.includes(app))
      .flatMap(([app, persona]) => [
        `<a href="${ORIGINS[app]}/api/session/login?account=1&amp;redirectTo=%2Fresume" class="app-AreaRow">x</a>`,
        ...(demo ? [`<a rel="${rel}" data-persona="${persona}" href="${ORIGINS[app]}/demo?persona=${persona}&amp;demo=1">y</a>`] : []),
      ]);
    return `<!doctype html><html lang="en-GB" data-demo="${demo ? 'on' : 'off'}"><body><main>${links.join('')}</main></body></html>`;
  }

  function serving(html: string, status = 200): typeof fetch {
    return vi.fn(async () => ({ ok: status === 200, status, text: async () => html }) as Response) as unknown as typeof fetch;
  }

  it('reads the chooser at /sign-in?start=demo', async () => {
    const fetcher = serving(chooser());
    expect(await siteLinkWarnings(ORIGINS, fetcher)).toEqual([]);
    expect(vi.mocked(fetcher).mock.calls[0]![0]).toBe('https://www.example.com/sign-in?start=demo');
  });

  it('is silent when every app has its sign-in row and its role button', async () => {
    expect(await siteLinkWarnings(ORIGINS, serving(chooser()))).toEqual([]);
    expect(await siteLinkWarnings(ORIGINS, serving(chooser({ demo: false })))).toEqual([]);
  });

  it('names the origin the site is missing', async () => {
    const warnings = await siteLinkWarnings(ORIGINS, serving(chooser({ missing: ['workbench'] })));
    expect(warnings).toEqual([
      '::warning title=Site links::The site has no sign-in link to the Service Desk (https://desk.example.com/api/session/login?account=1&redirectTo=%2Fresume). Is WORKBENCH_ORIGIN set on the site service?',
      '::warning title=Site links::The demo is on but the site has no role button into the Service Desk (https://desk.example.com/demo?persona=agent&demo=1). Is WORKBENCH_ORIGIN set on the site service?',
    ]);
  });

  it('flags a role button that would drop the Referer or invite a crawler', async () => {
    const noreferrer = await siteLinkWarnings(ORIGINS, serving(chooser({ rel: 'nofollow noreferrer' })));
    expect(noreferrer).toHaveLength(3);
    expect(noreferrer[0]).toMatch(/rel="noreferrer", which stops \/demo from opening in one click/);
    const followed = await siteLinkWarnings(ORIGINS, serving(chooser({ rel: '' })));
    expect(followed.every((line) => line.includes('missing rel="nofollow"'))).toBe(true);
    expect(followed).toHaveLength(3);
  });

  it('checks only the apps the deploy published, and nothing without a site', async () => {
    expect(await siteLinkWarnings({ site: ORIGINS.site, portal: ORIGINS.portal }, serving(chooser({ missing: ['workbench', 'admin'] })))).toEqual([]);
    const fetcher = serving('');
    expect(await siteLinkWarnings({ api: 'https://api.example.com' }, fetcher)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('warns, and never throws, when the page is not there to read', async () => {
    expect(await siteLinkWarnings(ORIGINS, serving('', 404))).toEqual([
      "::warning title=Site links::https://www.example.com/sign-in?start=demo answered 404, so the site's links into the product were not checked.",
    ]);
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect((await siteLinkWarnings(ORIGINS, down))[0]).toMatch(/did not answer \(fetch failed\)/);
  });

  it('reads anchors the way a browser reads the attributes', () => {
    expect(anchorsIn(`<a class="x" href="https://h/a?b=1&amp;c=2" rel="nofollow NoReferrer">t</a><a href='/x'>u</a><a name="n">v</a><A HREF=/y>w</A>`)).toEqual([
      { href: 'https://h/a?b=1&c=2', rel: ['nofollow', 'noreferrer'] },
      { href: '/x', rel: [] },
      { href: '/y', rel: [] },
    ]);
  });
});
