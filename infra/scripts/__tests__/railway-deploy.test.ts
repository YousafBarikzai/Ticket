import { describe, expect, it, vi } from 'vitest';
import { callApi, credentialsFrom, explainRefusal, faultIn, hostFor, hostsFor, imageFor, phasesOf, readCatalogue, operationName, variablesFor, type Catalogue, type ServiceDefinition } from '../railway-deploy.js';
import { isPreview } from '../railway-teardown.js';

/**
 * The deploy plan, tested without a Railway account.
 *
 * Everything here is the part of a deployment that can be got wrong silently:
 * an order that looks fine until the one deploy where it is not, a hostname
 * that is right in production and wrong in staging, an image tag that resolves
 * to something plausible and unrelated. None of it needs a network, and all of
 * it would otherwise be discovered by deploying.
 */

const catalogue = readCatalogue();

function named(name: string): ServiceDefinition {
  const service = catalogue.services.find((one) => one.name === name);
  if (!service) throw new Error(`the catalogue has no service named ${name}`);
  return service;
}

describe('what gets deployed, and when', () => {
  it('runs migrations before anything that could read the schema', () => {
    const phases = phasesOf(catalogue);
    expect(phases[0]!.map((service) => service.name)).toEqual(['migrate']);
  });

  it('deploys every worker before the API, and the API before any web application', () => {
    const phases = phasesOf(catalogue);
    const phaseOf = (name: string): number => phases.findIndex((phase) => phase.some((service) => service.name === name));

    // Doc 16 §4, as an assertion rather than a paragraph: new consumers exist
    // before new events do, and the API is up before the applications that
    // call it.
    for (const worker of ['worker-events', 'worker-engine', 'worker-comms', 'worker-data']) {
      expect(phaseOf(worker)).toBeLessThan(phaseOf('api'));
    }
    for (const app of ['portal', 'workbench', 'admin']) {
      expect(phaseOf('api')).toBeLessThan(phaseOf(app));
    }
  });

  it('puts the four workers in one phase, so they are never half-upgraded for longer than they must be', () => {
    const phases = phasesOf(catalogue);
    const workers = phases.find((phase) => phase.some((service) => service.name === 'worker-events'));
    expect(workers?.map((service) => service.name).sort()).toEqual(['worker-comms', 'worker-data', 'worker-engine', 'worker-events']);
  });

  it('orders phases numerically rather than by the order the file happens to list them', () => {
    const shuffled: Catalogue = {
      image: catalogue.image,
      services: [...catalogue.services].reverse(),
    };
    expect(phasesOf(shuffled)[0]!.map((service) => service.name)).toEqual(['migrate']);
  });

  it('gives every service a phase and a replica count', () => {
    for (const service of catalogue.services) {
      expect(Number.isInteger(service.phase), service.name).toBe(true);
      expect(service.replicas, service.name).toBeGreaterThan(0);
    }
  });

  it('gives every public service a health check, and asks for none from the workers', () => {
    for (const service of catalogue.services) {
      if (service.public) expect(service.healthcheckPath, service.name).toBeTruthy();
      // A worker has no HTTP surface, so a health check on one would fail for
      // the reason it has nothing to answer with.
      else expect(service.healthcheckPath, service.name).toBeUndefined();
    }
  });
});

describe('what each service runs', () => {
  it('names one image per target, tagged by commit', () => {
    expect(imageFor(catalogue, named('api'), 'sha-abc1234')).toBe('ghcr.io/yousafbarikzai/ticket/api:sha-abc1234');
    expect(imageFor(catalogue, named('portal'), 'v1.2.3')).toBe('ghcr.io/yousafbarikzai/ticket/portal:v1.2.3');
  });

  it('runs all four workers from the one worker image, distinguished only by their queue', () => {
    const workers = catalogue.services.filter((service) => service.target === 'worker');
    expect(workers).toHaveLength(4);
    expect([...new Set(workers.map((service) => imageFor(catalogue, service, 'sha-1')))]).toEqual([
      'ghcr.io/yousafbarikzai/ticket/worker:sha-1',
    ]);
    // ADR-0001's line, enforced: the same module code from different entry
    // points. A worker family that differed by image could differ in rules.
    expect(new Set(workers.map((service) => service.variables?.WORKER_QUEUES)).size).toBe(4);
  });
});

describe('where each service answers', () => {
  it('puts production on the bare domain and every other environment under its own label', () => {
    expect(hostFor(named('portal'), 'example.com', 'production')).toBe('help.example.com');
    expect(hostFor(named('portal'), 'example.com', 'staging')).toBe('help.staging.example.com');
    expect(hostFor(named('workbench'), 'example.com', 'pr-42')).toBe('desk.pr-42.example.com');
  });

  it('gives a private service no hostname at all', () => {
    expect(hostFor(named('worker-events'), 'example.com', 'production')).toBeNull();
  });

  it('maps only the public services, by name', () => {
    const hosts = hostsFor(catalogue, 'example.com', 'production');
    expect(hosts.get('portal')).toBe('help.example.com');
    expect(hosts.get('api')).toBe('api.example.com');
    // A private service must not appear: `variablesFor` reads this map, and a
    // worker with an origin variable would be a worker claiming a public URL.
    expect(hosts.has('worker-events')).toBe(false);
    expect(hosts.has('migrate')).toBe(false);
  });
});

describe('tearing a preview down', () => {
  it('deletes a preview environment', () => {
    expect(isPreview('pr-1')).toBe(true);
    expect(isPreview('pr-4218')).toBe(true);
  });

  it('refuses every environment that is not one', () => {
    // The name is interpolated from a pull request number by a workflow. The
    // cost of that going wrong once is the production environment, so the
    // guard is a whitelist rather than a blacklist of the three names somebody
    // thought of.
    for (const name of ['production', 'staging', 'pr-', 'pr-1x', 'PR-1', 'pr-1/production', '', 'preview']) {
      expect(isPreview(name), name).toBe(false);
    }
  });
});

describe('the image path is one a registry will accept', () => {
  it('is entirely lowercase', () => {
    // What actually broke the first run of this pipeline. `github.repository`
    // is `Owner/Repo` with the case the owner typed, and an OCI repository
    // name must be lowercase — `invalid tag "ghcr.io/YousafBarikzai/Ticket/api:
    // sha-18fa925": repository name must be lowercase`, on every one of the six
    // image jobs, before a layer was built.
    expect(catalogue.image.registry).toBe(catalogue.image.registry.toLowerCase());
    expect(catalogue.image.repository).toBe(catalogue.image.repository.toLowerCase());
    for (const service of catalogue.services) {
      const reference = imageFor(catalogue, service, 'sha-abc1234');
      expect(reference, service.name).toBe(reference.toLowerCase());
    }
  });

  it('is a reference a registry can parse at all', () => {
    // host[:port]/path/segments:tag, each segment lowercase alphanumerics with
    // separators between them. Narrower than the OCI grammar on purpose: this
    // is the shape this pipeline produces, and anything else is a mistake
    // rather than an unusual choice.
    const reference = /^[a-z0-9.-]+(:\d+)?(\/[a-z0-9]+([._-][a-z0-9]+)*)+:[A-Za-z0-9][\w.-]*$/;
    for (const service of catalogue.services) {
      expect(imageFor(catalogue, service, 'sha-abc1234'), service.name).toMatch(reference);
      expect(imageFor(catalogue, service, 'v1.2.3'), service.name).toMatch(reference);
    }
  });
});

describe('what each service is actually given', () => {
  const domain = 'example.com';

  /*
   * These exist because the deploy computed the origins, printed them in its
   * dry run, and sent none of them. Every assertion below is a thing that
   * would have been wrong in the first real environment and would have looked
   * like something else: a queue that does not drain, a sign-in that returns
   * to the wrong host, four workers that are secretly one.
   */

  it('gives each worker the one variable that makes it different from the others', () => {
    const queues = ['worker-events', 'worker-engine', 'worker-comms', 'worker-data'].map(
      (name) => variablesFor(named(name), hostsFor(catalogue, domain, 'production')).WORKER_QUEUES,
    );

    // Unset, WORKER_QUEUES defaults to `*` and every worker consumes every
    // family — so a burst of indexing starves outbox publishing and the SLA
    // timers, which is the exact failure doc 03 §4 splits them to avoid.
    expect(queues).toEqual(['events', 'engine', 'comms', 'data']);
    expect(new Set(queues).size).toBe(4);
  });

  it('tells each web application its own origin and where the API is', () => {
    for (const [name, variable] of [
      ['portal', 'PORTAL_ORIGIN'],
      ['workbench', 'WORKBENCH_ORIGIN'],
      ['admin', 'ADMIN_ORIGIN'],
    ] as const) {
      const variables = variablesFor(named(name), hostsFor(catalogue, domain, 'production'));
      // The BFF checks a request's origin against this and builds the OIDC
      // redirect URI from it. Wrong, and sign-in returns to the wrong host.
      expect(variables[variable], name).toBe(`https://${named(name).subdomain}.${domain}`);
      expect(variables.API_BASE_URL, name).toBe(`https://api.${domain}`);
    }
  });

  it('gives the API its own public base URL and no origin it does not own', () => {
    const variables = variablesFor(named('api'), hostsFor(catalogue, domain, 'production'));
    expect(variables.PUBLIC_BASE_URL).toBe(`https://api.${domain}`);
    expect(variables.PORTAL_ORIGIN).toBeUndefined();
  });

  it('carries the environment into every hostname outside production', () => {
    const variables = variablesFor(named('portal'), hostsFor(catalogue, domain, 'staging'));
    expect(variables.PORTAL_ORIGIN).toBe(`https://help.staging.${domain}`);
    expect(variables.API_BASE_URL).toBe(`https://api.staging.${domain}`);
  });

  it('never sets a credential', () => {
    // This deploy upserts without replacing, and these are the keys a person
    // sets once per environment. If one ever appears here, the deploy has
    // become something that can overwrite a database password.
    const forbidden = /^(DATABASE_URL|DATABASE_URL_APP|DATABASE_URL_PLATFORM|DATABASE_URL_READONLY|REDIS_URL|OIDC_ISSUER|SMTP_URL|MEILISEARCH_API_KEY|ANTHROPIC_API_KEY|DEV_TOKEN_SECRET)$/;
    for (const service of catalogue.services) {
      for (const name of Object.keys(variablesFor(service, hostsFor(catalogue, domain, 'production')))) {
        expect(name, `${service.name} sets ${name}`).not.toMatch(forbidden);
      }
    }
  });

  it('names a region, so the environment does not land wherever Railway defaults to', () => {
    // Decision D-01 option A and the residency commitment in doc 19. This was
    // a sentence in a README while nothing sent a region at all, and the first
    // project stood up under this pipeline came up in US West.
    //
    // `ams` and not `europe-west4`: both name Amsterdam, but the Google-style
    // spelling is Railway's legacy one and its own tooling reads it as a
    // different region — planning a destructive move of any attached volume to
    // get there. Asserted by value rather than by "is set" for that reason.
    expect(catalogue.region).toBe('ams');
  });

  it('gives every public service a port to send its domain at', () => {
    // A custom domain with no target port is a domain Railway cannot route.
    for (const service of catalogue.services) {
      if (!service.public) continue;
      expect(service.subdomain, service.name).toBeTruthy();
      expect(Number.isInteger(service.port), service.name).toBe(true);
    }
  });
});

describe('a deployment with no domain of its own', () => {
  /*
   * Railway names each public service itself, and the name is not knowable
   * until it exists. Everything downstream therefore reads a map of hostnames
   * rather than deriving them, and these are the properties that has to keep.
   */

  it('builds the same variables from discovered hostnames as from derived ones', () => {
    // What the deploy collects as it goes, in the shape Railway hands back.
    const discovered = new Map([
      ['api', 'itsm-api-production-7f3a.up.railway.app'],
      ['portal', 'itsm-portal-production-91bc.up.railway.app'],
    ]);

    const portal = variablesFor(named('portal'), discovered);
    expect(portal.PORTAL_ORIGIN).toBe('https://itsm-portal-production-91bc.up.railway.app');
    expect(portal.API_BASE_URL).toBe('https://itsm-api-production-7f3a.up.railway.app');
    // The queue split survives the other path too — it has nothing to do with
    // hostnames, and a refactor that lost it would be silent.
    expect(variablesFor(named('worker-comms'), discovered).WORKER_QUEUES).toBe('comms');
  });

  it('sets no origin for a service whose host is not known yet', () => {
    // Phase order is what makes this safe: the API is deployed before the web
    // applications, so by the time one of them needs API_BASE_URL the API has
    // a hostname. Before that point the map is empty, and an empty map must
    // produce no variable rather than `https://undefined`.
    const nothing = new Map<string, string>();
    const portal = variablesFor(named('portal'), nothing);
    expect(portal.PORTAL_ORIGIN).toBeUndefined();
    expect(portal.API_BASE_URL).toBeUndefined();
    expect(portal.OTEL_SERVICE_NAME).toBe('itsm-portal');
  });

  it('never invents an origin for a private service', () => {
    // A generated host is only ever asked for where `public` is true, so a
    // worker cannot acquire one — but if it ever did, this is what would
    // notice before the deploy handed it a URL it has no business holding.
    const hosts = new Map([['worker-events', 'somehow.up.railway.app']]);
    expect(variablesFor(named('worker-events'), hosts)).toEqual({
      WORKER_QUEUES: 'events',
      OTEL_SERVICE_NAME: 'itsm-worker-events',
    });
  });
});

describe('the credentials, checked before the first call', () => {
  const GOOD = '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';

  /*
   * This block exists because of one run.
   *
   * The first deploy of this pipeline against a real account failed on its
   * first call with `Railway API refused the call: Project not found`, and
   * that was the entire log. Four words, no indication whether the id was
   * wrong, the token was scoped elsewhere, or a newline had ridden along on a
   * paste. Two of those three are now caught here, before any network call,
   * and the third is explained rather than reported.
   */

  it('accepts a project id and strips what a paste brings with it', () => {
    expect(credentialsFrom({ RAILWAY_TOKEN: ' tok ', RAILWAY_PROJECT_ID: `${GOOD}\n` })).toEqual({
      token: 'tok',
      projectId: GOOD,
    });
  });

  it('refuses the whole URL, the query string and a second path segment', () => {
    expect(faultIn(`https://railway.com/project/${GOOD}`)).toMatch(/whole URL/);
    expect(faultIn(`${GOOD}?environmentId=${GOOD}`)).toMatch(/query string/);
    expect(faultIn(`${GOOD}/service/${GOOD}`)).toMatch(/more of the path/);
    expect(faultIn(GOOD)).toBeNull();
  });

  it('names the fault without printing the value, because a log is not private', () => {
    // GitHub masks a secret's exact text and nothing else, so a malformed id
    // echoed back is a malformed id published. Every message is about the
    // value rather than made of it.
    const secret = `${GOOD}?environmentId=deadbeef-0000-0000-0000-000000000000`;
    const fault = faultIn(secret)!;
    expect(fault).not.toContain(secret);
    expect(fault).not.toContain('deadbeef');
    expect(fault).toContain('characters');
  });

  it('still insists both are present', () => {
    expect(() => credentialsFrom({ RAILWAY_PROJECT_ID: GOOD })).toThrow(/must both be set/);
    expect(() => credentialsFrom({ RAILWAY_TOKEN: 'tok' })).toThrow(/must both be set/);
    // A value that is only whitespace is absent, not present and blank.
    expect(() => credentialsFrom({ RAILWAY_TOKEN: '  ', RAILWAY_PROJECT_ID: GOOD })).toThrow(/must both be set/);
  });

  it('explains Project not found as the two things it actually means', () => {
    const explained = explainRefusal('Railway API refused the call: Project not found');
    expect(explained).toContain('Project not found');
    expect(explained).toMatch(/workspace/);
    expect(explained).toMatch(/railway\.com\/project/);
  });

  it('leaves every other refusal exactly as Railway worded it', () => {
    // A guess bolted onto an error nobody has diagnosed is how a wrong cause
    // becomes the first thing the next person reads.
    expect(explainRefusal('Not Authorized')).toBe('Not Authorized');
  });
});

describe('when Railway does not answer', () => {
  /*
   * A real deploy, run 35243639500: phase 1 printed `fetch failed` and exited,
   * having updated three of the four workers. Two words, no service named, an
   * environment left half on the new image and half on the old.
   */

  it('names the call that failed, because the log is all anybody gets', () => {
    expect(operationName('\n  mutation SetImage($input: X!) {')).toBe('SetImage');
    expect(operationName('\n  query Environments($projectId: String!) {')).toBe('Environments');
    expect(operationName('{ nothing }')).toBe('an unnamed operation');
  });

  it('retries a call that can be sent twice', async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('fetch failed');
      return { ok: true, status: 200, json: async () => ({ data: { ok: true } }) } as Response;
    });
    vi.stubGlobal('fetch', fetcher);
    vi.useFakeTimers();
    const promise = callApi('mutation SetImage($x: Int) { a }', {}, 'tok');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ ok: true });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    expect(calls).toBe(3);
  });

  it('never retries a create, because twice is two services rather than one', async () => {
    // The reason this is a list and not a blanket retry. A connection that
    // fails gives no answer, and no answer does not mean nothing happened —
    // so a second CreateService is a duplicate with the same name.
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    }));
    await expect(callApi('mutation CreateService($x: Int) { a }', {}, 'tok')).rejects.toThrow(
      /unreachable during CreateService: fetch failed/,
    );
    vi.unstubAllGlobals();
    expect(calls).toBe(1);
  });

  it('does not retry a refusal, which would fail identically four times', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'Project not found' }] }),
    }) as Response));
    await expect(callApi('query Environments($x: Int) { a }', {}, 'tok')).rejects.toThrow(/Project not found/);
    vi.unstubAllGlobals();
  });
});

describe('telling Railway which port to knock on', () => {
  /*
   * The last thing between a working deployment and a reachable one.
   *
   * The API's own log read `api listening port: 3000`, 27 modules registered,
   * database connected — and Railway failed its health check for 4:53 and tore
   * the container down, because Railway routes and probes `PORT` and nothing
   * had ever told it that number.
   */

  it('sets PORT to the port the service actually listens on', () => {
    const hosts = new Map([['api', 'api-x.up.railway.app']]);
    expect(variablesFor(named('api'), hosts).PORT).toBe('3000');
    expect(variablesFor(named('portal'), hosts).PORT).toBe('3200');
    expect(variablesFor(named('workbench'), hosts).PORT).toBe('3100');
    expect(variablesFor(named('admin'), hosts).PORT).toBe('3300');
  });

  it('agrees with the port the domain forwards to, which is the same number', () => {
    // These come from one field in the catalogue, so they cannot drift — and
    // this asserts that the deploy keeps reading that one field rather than
    // growing a second list of ports beside it.
    for (const service of catalogue.services.filter((one) => one.public)) {
      expect(variablesFor(service, new Map()).PORT, service.name).toBe(String(service.port));
    }
  });

  it('gives a worker no PORT, because it has nothing to listen with', () => {
    // A worker that advertised a port would be a worker Railway would health
    // check, and it has no HTTP surface to answer with.
    expect(variablesFor(named('worker-events'), new Map()).PORT).toBeUndefined();
    expect(variablesFor(named('migrate'), new Map()).PORT).toBeUndefined();
  });
});
