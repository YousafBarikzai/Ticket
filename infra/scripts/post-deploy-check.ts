/**
 * Is the thing that was just deployed actually answering?
 *
 * This exists because the step that used to hold this place could not have
 * worked. The deploy ran `walking-skeleton.ts` against `API_BASE_URL`, and the
 * walking skeleton is not an HTTP client — it calls `bootstrapModules` and
 * boots the whole platform in the runner's own process, against the runner's
 * own database. Handed a deployed API's URL it got as far as
 * `DATABASE_URL_APP: Required` and stopped, on the runner, having never opened
 * a connection to the deployment it was supposed to be checking.
 *
 * That is worth stating plainly rather than quietly replacing: for as long as
 * `RAILWAY_TOKEN` was unset the step never ran, so a check that could only ever
 * fail sat in the pipeline looking like a check. The walking skeleton is a good
 * test and is untouched — `pnpm skeleton` still runs it against a local stack,
 * where booting the platform is the point. It is simply not a smoke test.
 *
 * What this asserts is deliberately narrow, and is the part that is true from
 * outside: every service the deploy gave a hostname to is reachable, and the
 * API says which of its own dependencies it has. It does not create a ticket.
 * An end-to-end assertion against a deployed environment needs a tenant, a
 * credential and a way to clean up after itself, and inventing one here would
 * repeat the mistake this file is fixing.
 *
 * Usage:
 *   tsx infra/scripts/post-deploy-check.ts --hosts '{"api":"https://…", …}'
 */

/** What the deploy publishes: service name to origin. */
export type Hosts = Readonly<Record<string, string>>;

export interface Probe {
  /** The service, named as the catalogue names it. */
  readonly service: string;
  readonly url: string;
  /** Readiness reports which dependencies are missing; liveness only answers. */
  readonly kind: 'live' | 'ready';
}

/**
 * The health path each application serves, from `infra/railway/services.json`.
 *
 * Kept beside the catalogue rather than read from it on purpose: this is the
 * path Railway's own health check uses, so a service that answers here is a
 * service Railway will also call healthy, and the two agreeing is the point.
 */
const PATHS: Readonly<Record<string, string>> = {
  api: '/health/live',
  portal: '/api/health',
  workbench: '/api/health',
  admin: '/api/health',
};

export function probesFor(hosts: Hosts): Probe[] {
  const probes: Probe[] = [];
  for (const [service, origin] of Object.entries(hosts)) {
    const path = PATHS[service];
    // A service with no hostname is a private one, and a hostname with no path
    // here is a service this file has not been taught about — - silently
    // skipping the second would make adding a public service a change that
    // quietly reduces what is checked.
    if (!path) throw new Error(`no health path known for ${service}; add it to PATHS in post-deploy-check.ts`);
    probes.push({ service, url: `${origin}${path}`, kind: 'live' });
  }
  // Readiness last: it is the one that says *why* something is not working,
  // and it reads best at the bottom of the output rather than the middle.
  if (hosts.api) probes.push({ service: 'api', url: `${hosts.api}/health/ready`, kind: 'ready' });
  return probes;
}

export interface Outcome {
  readonly probe: Probe;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * A deployment is not up the instant the API returns. Railway pulls an image,
 * starts a container and waits for its own health check, so the first minutes
 * of 502s mean "not yet" rather than "broken" — and a smoke test that cannot
 * tell those apart is a smoke test that fails every other deploy.
 *
 * Six minutes, because the first budget here was one and that was guesswork
 * dressed as a constant. The number to match is Railway's own: the api
 * service's failed deployment spent **4:53** in `Network > Healthcheck` before
 * Railway gave up on it. A check that stops at 55 seconds reports a verdict on
 * a deployment Railway has not finished forming an opinion about, which is not
 * a slow check, it is a check measuring the wrong thing.
 */
const ATTEMPTS = 36;
const GAP_MS = 10_000;

export function readinessDetail(body: unknown): string {
  const checks = (body as { checks?: Record<string, string> } | null)?.checks;
  if (!checks) return 'no checks reported';
  const failed = Object.entries(checks).filter(([, value]) => value !== 'ok');
  if (failed.length === 0) return 'database, redis, modules all ok';
  // Named individually, because "not ready" is the message that sent somebody
  // looking at the wrong thing for an hour. `database: failed` is a variable.
  return `${failed.map(([name, value]) => `${name}: ${value}`).join(', ')}`;
}

async function probe(one: Probe, fetcher: typeof fetch): Promise<Outcome> {
  let last = 'never answered';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetcher(one.url, { signal: AbortSignal.timeout(15_000) });
      if (one.kind === 'ready') {
        const body: unknown = await response.json().catch(() => null);
        const detail = readinessDetail(body);
        if (response.ok) return { probe: one, ok: true, detail };
        last = `${response.status} — ${detail}`;
      } else {
        if (response.ok) return { probe: one, ok: true, detail: `${response.status}` };
        last = `${response.status}`;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, GAP_MS));
  }
  return { probe: one, ok: false, detail: `after ${ATTEMPTS} attempts: ${last}` };
}

export async function check(hosts: Hosts, fetcher: typeof fetch = fetch): Promise<Outcome[]> {
  // In parallel: ten attempts six seconds apart is a minute, and four of those
  // in series is four minutes of a deploy job waiting to say the same thing.
  return Promise.all(probesFor(hosts).map((one) => probe(one, fetcher)));
}

export function parseHosts(argv: readonly string[]): Hosts {
  const index = argv.indexOf('--hosts');
  const raw = index >= 0 ? argv[index + 1] : process.env.DEPLOY_HOSTS;
  if (!raw) throw new Error('--hosts <json> is required, as published by railway-deploy.ts');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('--hosts must be a JSON object of service to origin');
  const hosts = parsed as Record<string, unknown>;
  for (const [service, origin] of Object.entries(hosts)) {
    if (typeof origin !== 'string' || !origin.startsWith('https://')) {
      throw new Error(`the host for ${service} is not an https origin`);
    }
  }
  return hosts as Hosts;
}

async function main(): Promise<void> {
  const hosts = parseHosts(process.argv.slice(2));
  const outcomes = await check(hosts);

  for (const { probe: one, ok, detail } of outcomes) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${one.service} ${one.kind} — ${detail}`);
  }

  const failed = outcomes.filter((outcome) => !outcome.ok);
  if (failed.length === 0) {
    console.log(`\nall ${outcomes.length} checks passed`);
    return;
  }
  // Exit rather than throw: a stack trace here points at this file, which is
  // never where the problem is.
  console.error(`\n${failed.length} of ${outcomes.length} checks failed`);
  process.exitCode = 1;
}

// Only when run, so the pure functions above can be imported by a test without
// needing a network or a deployment.
if (process.argv[1]?.endsWith('post-deploy-check.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
