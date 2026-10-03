import { describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_QUERY_CACHE_SECONDS,
  assertPullable,
  callApi,
  checkPullable,
  credentialsFrom,
  explainRefusal,
  faultIn,
  hostFor,
  hostOutputs,
  hostsFor,
  imageFor,
  inTwoPasses,
  manifestUrl,
  MANIFEST_ACCEPT,
  phasesOf,
  portalChannels,
  pullTargets,
  pullTokenUrl,
  readCatalogue,
  operationName,
  variablesFor,
  WEB_ORIGINS,
  type Catalogue,
  type ServiceDefinition,
} from '../railway-deploy.js';
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
    for (const app of ['portal', 'workbench', 'admin', 'site']) {
      expect(phaseOf('api')).toBeLessThan(phaseOf(app));
    }
  });

  it('deploys the public site with the applications, so all four learn each other\'s origins in one two-pass phase', () => {
    const phases = phasesOf(catalogue);
    const web = phases.find((phase) => phase.some((service) => service.name === 'site'));
    expect(web?.map((service) => service.name).sort()).toEqual(['admin', 'portal', 'site', 'workbench']);
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

  it('puts the public site at www., in production and under each environment\'s label', () => {
    expect(hostFor(named('site'), 'example.com', 'production')).toBe('www.example.com');
    expect(hostFor(named('site'), 'example.com', 'pr-42')).toBe('www.pr-42.example.com');
    expect(hostsFor(catalogue, 'example.com', 'production').get('site')).toBe('www.example.com');
  });

  it('reads @ as the bare domain, which a preview never claims', () => {
    // The owner's later choice for the site (A5 §16); nothing uses it yet.
    const apex: ServiceDefinition = { ...named('site'), subdomain: '@' };
    expect(hostFor(apex, 'example.com', 'production')).toBe('example.com');
    expect(hostFor(apex, 'example.com', 'pr-42')).toBe('pr-42.example.com');
    expect(hostFor(apex, 'example.com', 'staging')).toBe('staging.example.com');
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
      ['site', 'SITE_ORIGIN'],
    ] as const) {
      const variables = variablesFor(named(name), hostsFor(catalogue, domain, 'production'));
      // The BFF checks a request's origin against this and builds the OIDC
      // redirect URI from it. Wrong, and sign-in returns to the wrong host.
      expect(variables[variable], name).toBe(`https://${named(name).subdomain}.${domain}`);
      expect(variables.API_BASE_URL, name).toBe(`https://api.${domain}`);
    }
  });

  it('tells every web service where the others are', () => {
    // C1: the area switcher, "Open in Service Desk" and the portal links in an
    // agent's reply are built from these, and so is every link on the public
    // site. Each BFF reads only its own by name, so the others cannot move
    // sign-in.
    const hosts = hostsFor(catalogue, domain, 'production');
    for (const app of ['portal', 'workbench', 'admin', 'site']) {
      const variables = variablesFor(named(app), hosts);
      expect(variables.PORTAL_ORIGIN, app).toBe(`https://help.${domain}`);
      expect(variables.WORKBENCH_ORIGIN, app).toBe(`https://desk.${domain}`);
      expect(variables.ADMIN_ORIGIN, app).toBe(`https://admin.${domain}`);
      expect(variables.SITE_ORIGIN, app).toBe(`https://www.${domain}`);
      expect(variables.API_BASE_URL, app).toBe(`https://api.${domain}`);
    }
    // One list, and it names exactly the web services the catalogue has.
    const web = catalogue.services.filter((service) => Object.hasOwn(WEB_ORIGINS, service.name)).map((service) => service.name);
    expect(web.sort()).toEqual(['admin', 'portal', 'site', 'workbench']);
  });

  it('gives the public site no credential and nothing a person must set by hand', () => {
    // A5 §3.6: the site has no session, no database and no secret, so the
    // deploy's variables are everything it reads.
    const variables = variablesFor(named('site'), hostsFor(catalogue, domain, 'production'));
    expect(Object.keys(variables).sort()).toEqual([
      'ADMIN_ORIGIN',
      'API_BASE_URL',
      'DEMO_MODE',
      'OTEL_SERVICE_NAME',
      'PORT',
      'PORTAL_ORIGIN',
      'SITE_ORIGIN',
      'WORKBENCH_ORIGIN',
    ]);
    expect(variables.OTEL_SERVICE_NAME).toBe('itsm-site');
  });

  it('sets DEMO_MODE, all to one value, on exactly the six services that read it', () => {
    // SPEC v3 §4.9: the API (verification and policy), worker-data (the
    // nightly build), the three applications (minting) and the site (the
    // role buttons). Anywhere else it would be a variable nothing reads, and
    // a kill switch with one more place to forget.
    const mentioned = catalogue.services.filter((service) => service.variables && 'DEMO_MODE' in service.variables).map((service) => service.name);
    expect(mentioned.sort()).toEqual(['admin', 'api', 'portal', 'site', 'workbench', 'worker-data']);
    // One switch: a half-on demo (minting with no API policy, or role buttons
    // with nothing to mint) is worse than either state.
    const values = new Set(catalogue.services.filter((service) => service.variables && 'DEMO_MODE' in service.variables).map((service) => service.variables?.DEMO_MODE));
    expect(values.size).toBe(1);
  });

  it('ships the v3 release with the one-click demo switched off', () => {
    // The owner's release decision: the demo generator lands in a later wave,
    // so no service may mint a demo session or show a role button yet.
    const on = catalogue.services.filter((service) => service.variables?.DEMO_MODE === 'on').map((service) => service.name);
    expect(on).toEqual([]);
  });

  it('turns the metric answer cache on for the API, and for nothing else', () => {
    // A8 R4c: the cache is off in code so tests and development always read
    // fresh facts; the deploy turns it on where the shared demo's dashboards
    // are answered. On a worker or an application it would be a variable
    // nothing reads.
    const hosts = hostsFor(catalogue, domain, 'production');
    expect(variablesFor(named('api'), hosts).ANALYTICS_QUERY_CACHE_SECONDS).toBe('120');
    expect(ANALYTICS_QUERY_CACHE_SECONDS).toBe(120);
    const others = catalogue.services.filter((service) => service.name !== 'api');
    expect(others.length).toBeGreaterThan(5);
    for (const service of others) {
      expect('ANALYTICS_QUERY_CACHE_SECONDS' in variablesFor(service, hosts), service.name).toBe(false);
    }
    // Even before the API has a domain: it is a setting, not an address.
    expect(variablesFor(named('api'), new Map()).ANALYTICS_QUERY_CACHE_SECONDS).toBe('120');
  });

  it('gives the API its own public base URL and no origin it does not own', () => {
    const variables = variablesFor(named('api'), hostsFor(catalogue, domain, 'production'));
    expect(variables.PUBLIC_BASE_URL).toBe(`https://api.${domain}`);
    expect(variables.PORTAL_ORIGIN).toBeUndefined();
    expect(variables.WORKBENCH_ORIGIN).toBeUndefined();
    expect(variables.ADMIN_ORIGIN).toBeUndefined();
    expect(variables.SITE_ORIGIN).toBeUndefined();
  });

  it('tells the portal which channels to mention, and only the portal', () => {
    // C3: a requester cannot read the tenant's channel accounts, so the
    // portal's "Good to know" line is configuration.
    const hosts = hostsFor(catalogue, domain, 'production');
    const settings = { portalChannels: ' Email, teams,,slack ,email ' };
    expect(variablesFor(named('portal'), hosts, settings).PORTAL_CHANNELS).toBe('email,teams,slack');
    for (const other of ['workbench', 'admin', 'api', 'worker-comms']) {
      expect(variablesFor(named(other), hosts, settings).PORTAL_CHANNELS, other).toBeUndefined();
    }
  });

  it('leaves PORTAL_CHANNELS alone when the deploy was not given one', () => {
    // An unset GitHub variable arrives as an empty string. Setting nothing,
    // rather than an empty list, keeps a value somebody set in Railway by hand
    // — the upsert never removes a key it does not name.
    const hosts = hostsFor(catalogue, domain, 'production');
    expect('PORTAL_CHANNELS' in variablesFor(named('portal'), hosts)).toBe(false);
    expect('PORTAL_CHANNELS' in variablesFor(named('portal'), hosts, { portalChannels: '' })).toBe(false);
    expect('PORTAL_CHANNELS' in variablesFor(named('portal'), hosts, { portalChannels: ' , ' })).toBe(false);
  });

  it('refuses a channel list that is not a list of names', () => {
    // Refused at deploy time, before the first call, rather than rendered
    // verbatim on every requester's home page.
    expect(portalChannels(undefined)).toBeNull();
    expect(portalChannels('email')).toBe('email');
    expect(() => portalChannels('email,<script>')).toThrow(/not a channel name: "<script>"/);
    expect(() => portalChannels('email;teams')).toThrow(/PORTAL_CHANNELS/);
    expect(() => portalChannels('microsoft teams')).toThrow(/"microsoft teams"/);
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
    const forbidden = /^(DATABASE_URL|DATABASE_URL_APP|DATABASE_URL_PLATFORM|DATABASE_URL_READONLY|REDIS_URL|OIDC_ISSUER|SMTP_URL|MEILISEARCH_API_KEY|ANTHROPIC_API_KEY|JEV_API_KEY|DEV_TOKEN_SECRET)$/;
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
    // A sibling whose host is not known sets nothing, never `https://undefined`.
    expect('WORKBENCH_ORIGIN' in portal).toBe(false);
    expect('ADMIN_ORIGIN' in portal).toBe(false);
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

describe('one phase, deployed in two passes', () => {
  /*
   * The three web applications share a phase and each carries the others'
   * origins. Without a domain of our own a hostname exists only once it has
   * been asked for, so every hostname in the phase has to be known before any
   * service's variables are computed — or the portal gets whichever siblings
   * happened to answer first.
   */
  const web = ['portal', 'workbench', 'admin'].map(named);

  it('knows every hostname in the phase before it sets anyone\'s variables', async () => {
    const hosts = new Map([['api', 'api.up.railway.app']]);
    const seen: Record<string, string>[] = [];
    await inTwoPasses(
      web,
      async (service) => {
        // Answers arrive in a different order from the requests.
        await new Promise((resolve) => setTimeout(resolve, service.name === 'portal' ? 20 : 1));
        hosts.set(service.name, `${service.name}.up.railway.app`);
        return service.name;
      },
      async (service) => {
        seen.push(variablesFor(service, hosts));
      },
    );
    expect(seen).toHaveLength(3);
    for (const variables of seen) {
      expect(variables.PORTAL_ORIGIN).toBe('https://portal.up.railway.app');
      expect(variables.WORKBENCH_ORIGIN).toBe('https://workbench.up.railway.app');
      expect(variables.ADMIN_ORIGIN).toBe('https://admin.up.railway.app');
    }
  });

  it('hands each service what its own first pass returned', async () => {
    const released: string[] = [];
    await inTwoPasses(
      web,
      async (service) => `id-of-${service.name}`,
      async (service, id) => {
        released.push(`${service.name}:${id}`);
      },
    );
    expect(released.sort()).toEqual(['admin:id-of-admin', 'portal:id-of-portal', 'workbench:id-of-workbench']);
  });

  it('redeploys nothing in a phase whose first pass failed', async () => {
    // Better a phase that stopped before any redeploy than one where two of
    // three applications came up with the new origins and one did not.
    const release = vi.fn(async () => undefined);
    await expect(
      inTwoPasses(
        web,
        async (service) => {
          if (service.name === 'admin') throw new Error('no Railway service named admin in this project');
          return service.name;
        },
        release,
      ),
    ).rejects.toThrow(/admin/);
    expect(release).not.toHaveBeenCalled();
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
    expect(variablesFor(named('site'), hosts).PORT).toBe('3400');
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

describe('what the deploy hands the workflow', () => {
  it('publishes every host, and a URL per web service a GitHub environment can link to', () => {
    const lines = hostOutputs({
      api: 'https://api.example.com',
      portal: 'https://help.example.com',
      workbench: 'https://desk.example.com',
      admin: 'https://admin.example.com',
      site: 'https://www.example.com',
    });
    expect(lines[0]).toBe(
      'hosts={"api":"https://api.example.com","portal":"https://help.example.com","workbench":"https://desk.example.com","admin":"https://admin.example.com","site":"https://www.example.com"}',
    );
    expect(lines.slice(1)).toEqual([
      'api-url=https://api.example.com',
      'portal-url=https://help.example.com',
      'workbench-url=https://desk.example.com',
      'admin-url=https://admin.example.com',
      // The address to share: the deploy and production environments link here.
      'site-url=https://www.example.com',
    ]);
  });

  it('leaves out the URL of a service that got no host, rather than writing an empty one', () => {
    expect(hostOutputs({ api: 'https://api.example.com' })).toEqual(['hosts={"api":"https://api.example.com"}', 'api-url=https://api.example.com']);
  });
});

describe('the pull pre-flight (Y-M6)', () => {
  /*
   * GHCR makes every new package private, and Railway pulls anonymously
   * unless a service holds a registry credential. The first deploy after the
   * site's image appears would otherwise set an image Railway cannot fetch —
   * after the workers and the API had already moved. These pin when that
   * stops the deploy (a service it would create) and when it only warns (one
   * that exists, which may pull with a credential), with the registry mocked.
   */
  const everyone = new Set(catalogue.services.map((service) => service.name));
  const withoutSite = new Set([...everyone].filter((name) => name !== 'site'));

  type Answer = { status: number; body?: unknown } | Error;

  /** A registry that answers per path, and records every request it was sent. */
  function registry(answer: (path: string, kind: 'token' | 'manifest') => Answer) {
    const requests: { url: string; method: string; headers: Record<string, string> }[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET', headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
      const isToken = url.includes('/token?');
      const path = isToken
        ? decodeURIComponent(/scope=([^&]+)/.exec(url)![1]!).replace(/^repository:/, '').replace(/:pull$/, '')
        : /\/v2\/(.+)\/manifests\//.exec(url)![1]!;
      const result = answer(path, isToken ? 'token' : 'manifest');
      if (result instanceof Error) throw result;
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => result.body ?? (isToken ? { token: 'anonymous' } : {}),
      } as Response;
    }) as unknown as typeof fetch;
    return { fetcher, requests };
  }

  const publicRegistry = () => registry(() => ({ status: 200 }));
  /** Every package public except the site's, which GHCR created private. */
  const privateSite = () => registry((path) => (path.endsWith('/site') ? { status: 401 } : { status: 200 }));

  it('checks each image once, however many services run it', () => {
    const targets = pullTargets(catalogue, 'production', 'sha-1', everyone);
    const images = targets.map((target) => target.image);
    expect(new Set(images).size).toBe(images.length);
    expect(images).toContain('ghcr.io/yousafbarikzai/ticket/site:sha-1');
    expect([...(targets.find((target) => target.path.endsWith('/worker'))?.services ?? [])].sort()).toEqual([
      'worker-comms',
      'worker-data',
      'worker-engine',
      'worker-events',
    ]);
    // `seed` runs only in previews, so production never asks about it twice.
    expect([...(targets.find((target) => target.path.endsWith('/migrate'))?.services ?? [])].sort()).toEqual(['bootstrap', 'migrate']);
  });

  it('asks as an anonymous puller would: GHCR\'s pull token, then the manifest with it', async () => {
    const { fetcher, requests } = publicRegistry();
    await expect(checkPullable('ghcr.io', 'yousafbarikzai/ticket/site', 'sha-abc1234', fetcher)).resolves.toEqual({ verdict: 'pullable', detail: '200' });
    expect(requests[0]).toMatchObject({
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository:yousafbarikzai/ticket/site:pull',
      method: 'GET',
    });
    expect(requests[1]).toMatchObject({
      url: 'https://ghcr.io/v2/yousafbarikzai/ticket/site/manifests/sha-abc1234',
      method: 'HEAD',
      headers: { accept: MANIFEST_ACCEPT, authorization: 'Bearer anonymous' },
    });
    expect(pullTokenUrl('ghcr.io', 'o/r/site')).toBe('https://ghcr.io/token?service=ghcr.io&scope=repository:o/r/site:pull');
    expect(manifestUrl('ghcr.io', 'o/r/site', 'v1.2.3')).toBe('https://ghcr.io/v2/o/r/site/manifests/v1.2.3');
    // An index first: a multi-platform image answers with one.
    expect(MANIFEST_ACCEPT.split(', ')[0]).toBe('application/vnd.oci.image.index.v1+json');
  });

  it('reads 401, 403 and 404 as refused, and anything else as unknown', async () => {
    for (const status of [401, 403, 404]) {
      const { fetcher } = registry((_path, kind) => (kind === 'manifest' ? { status } : { status: 200 }));
      expect((await checkPullable('ghcr.io', 'o/r/site', 't', fetcher)).verdict, `manifest ${status}`).toBe('refused');
      const denied = registry((_path, kind) => (kind === 'token' ? { status } : { status: 200 }));
      expect((await checkPullable('ghcr.io', 'o/r/site', 't', denied.fetcher)).verdict, `token ${status}`).toBe('refused');
    }
    for (const answer of [{ status: 500 }, { status: 429 }, new TypeError('fetch failed')] as Answer[]) {
      const { fetcher } = registry(() => answer);
      expect((await checkPullable('ghcr.io', 'o/r/site', 't', fetcher)).verdict).toBe('unknown');
    }
    const tokenless = registry((_path, kind) => (kind === 'token' ? { status: 200, body: {} } : { status: 200 }));
    expect((await checkPullable('ghcr.io', 'o/r/site', 't', tokenless.fetcher)).verdict).toBe('unknown');
  });

  it('stops the deploy, naming the package and the fix, when a service it would create cannot pull its image', async () => {
    const { fetcher } = privateSite();
    const log = vi.fn();
    const failure = assertPullable(catalogue, 'production', 'sha-1', withoutSite, { fetch: fetcher, env: {}, log });
    await expect(failure).rejects.toThrow(/stopped before changing anything in Railway/);
    await expect(assertPullable(catalogue, 'production', 'sha-1', withoutSite, { fetch: fetcher, env: {}, log })).rejects.toThrow(
      'ghcr.io/yousafbarikzai/ticket/site is not publicly pullable, so Railway cannot pull it. Make it public: GitHub → your profile → Packages → ticket/site → Package settings → Change visibility → Public, then re-run this deploy.',
    );
    await expect(assertPullable(catalogue, 'production', 'sha-1', withoutSite, { fetch: fetcher, env: {}, log })).rejects.toThrow(
      /DEPLOY_SKIP_PULL_CHECK=1[\s\S]*needed by site, which this deploy would create/,
    );
  });

  it('tells a missing tag from a private package, because the fixes differ', async () => {
    // Against GHCR: a private or unknown package refuses the token (403); a
    // readable package without this tag answers the manifest with 404.
    const untagged = registry((path, kind) => (path.endsWith('/site') && kind === 'manifest' ? { status: 404 } : { status: 200 }));
    await expect(assertPullable(catalogue, 'production', 'sha-1', withoutSite, { fetch: untagged.fetcher, env: {}, log: vi.fn() })).rejects.toThrow(
      'ghcr.io/yousafbarikzai/ticket/site:sha-1 does not exist: the registry has no image with that tag, so Railway cannot pull it. Check that this commit\'s image build for site pushed it, then re-run this deploy.',
    );
    const denied = registry((path, kind) => (path.endsWith('/site') && kind === 'token' ? { status: 403 } : { status: 200 }));
    await expect(assertPullable(catalogue, 'production', 'sha-1', withoutSite, { fetch: denied.fetcher, env: {}, log: vi.fn() })).rejects.toThrow(
      /ticket\/site is not publicly pullable/,
    );
  });

  it('only warns for a service that already exists, which may pull with a registry credential', async () => {
    // The owner who chose the runbook's second option gets a green deploy and
    // a warning, never a red one (Y-M6: an existing service with a 401 → exit 0).
    const { fetcher } = privateSite();
    const log = vi.fn();
    const checks = await assertPullable(catalogue, 'production', 'sha-1', everyone, { fetch: fetcher, env: {}, log });
    expect(checks.find((check) => check.path.endsWith('/site'))?.verdict).toBe('refused');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatch(/^::warning title=Image pull::ghcr\.io\/yousafbarikzai\/ticket\/site is not publicly pullable/);
    expect(log.mock.calls[0]![0]).toMatch(/site already exist/);
  });

  it('never stops a deploy because the registry did not answer', async () => {
    const { fetcher } = registry(() => new TypeError('fetch failed'));
    const log = vi.fn();
    await expect(assertPullable(catalogue, 'production', 'sha-1', withoutSite, { fetch: fetcher, env: {}, log })).resolves.toHaveLength(
      pullTargets(catalogue, 'production', 'sha-1', withoutSite).length,
    );
    expect(log.mock.calls.every(([line]) => String(line).startsWith('::warning title=Image pull::Could not check'))).toBe(true);
  });

  it('passes quietly when every image is public', async () => {
    const { fetcher } = publicRegistry();
    const log = vi.fn();
    const checks = await assertPullable(catalogue, 'production', 'sha-1', withoutSite, { fetch: fetcher, env: {}, log });
    expect(checks.every((check) => check.verdict === 'pullable')).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it('is skipped entirely by DEPLOY_SKIP_PULL_CHECK=1, and says so', async () => {
    const { fetcher } = privateSite();
    const log = vi.fn();
    await expect(
      assertPullable(catalogue, 'production', 'sha-1', withoutSite, { fetch: fetcher, env: { DEPLOY_SKIP_PULL_CHECK: '1' }, log }),
    ).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(log.mock.calls[0]![0]).toMatch(/^::notice title=Image pull::DEPLOY_SKIP_PULL_CHECK=1/);
    // Only the exact value: a typo checks rather than silently skipping.
    await expect(
      assertPullable(catalogue, 'production', 'sha-1', withoutSite, { fetch: fetcher, env: { DEPLOY_SKIP_PULL_CHECK: 'true' }, log }),
    ).rejects.toThrow(/not publicly pullable/);
  });
});
