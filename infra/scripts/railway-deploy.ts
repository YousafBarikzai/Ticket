/**
 * Deploys the images CI built to a Railway environment (docs/architecture/16 §3–§4).
 *
 * Railway's own config-as-code is read when Railway builds from a repository.
 * These services run images this repository built, scanned with Trivy and
 * pushed to GHCR, so the settings live in `infra/railway/services.json` and are
 * applied here, through the public API, rather than in files Railway would
 * never open.
 *
 * The order is the whole point and it comes from doc 16 §4: migrations, then
 * the workers, then the API, then the web applications. Workers first so new
 * consumers exist before new events do; the API next so its readiness check can
 * confirm the migration version; the web applications last because they are the
 * only ones somebody is looking at while this happens.
 *
 * Every phase waits for the one before it to be healthy. A deploy that fired
 * all ten at once would be faster and would also, on the one occasion it went
 * wrong, leave a worker consuming events written by a schema it has never seen.
 *
 * Usage:
 *   tsx infra/scripts/railway-deploy.ts --environment staging --tag sha-abc1234
 *   tsx infra/scripts/railway-deploy.ts --environment production --tag v1.2.3 --dry-run
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = 'https://backboard.railway.com/graphql/v2';

export interface ServiceDefinition {
  readonly name: string;
  readonly target: string;
  readonly phase: number;
  readonly kind: 'service' | 'job';
  readonly public: boolean;
  readonly replicas: number;
  readonly port?: number;
  readonly subdomain?: string;
  readonly healthcheckPath?: string;
  readonly variables?: Readonly<Record<string, string>>;
  /** The environments this service runs in. Absent means all of them. */
  readonly environments?: readonly string[];
  /** Overrides the image's own CMD, for the two jobs that share one image. */
  readonly command?: string;
}

export interface Catalogue {
  readonly image: { readonly registry: string; readonly repository: string };
  /** Railway's name for the region every service instance runs in. */
  readonly region?: string;
  readonly services: readonly ServiceDefinition[];
}

export function readCatalogue(path = resolve(import.meta.dirname, '..', 'railway', 'services.json')): Catalogue {
  return JSON.parse(readFileSync(path, 'utf8')) as Catalogue;
}

/**
 * The image a service runs, for a given commit.
 *
 * One tag per commit and one image per Dockerfile target, so the thing running
 * in production can be traced back to a commit by reading its name — which is
 * the first question asked in every incident and the one that is hardest to
 * answer from a registry full of `latest`.
 */
export function imageFor(catalogue: Catalogue, service: ServiceDefinition, tag: string): string {
  const { registry, repository } = catalogue.image;
  return `${registry}/${repository}/${service.target}:${tag}`;
}

/**
 * The services an environment runs.
 *
 * A preview seeds itself and no other environment does: a production
 * environment that seeded itself would invent two tenants nobody asked for. An
 * allow-list rather than a `previewOnly` boolean, because the next thing to be
 * restricted will not be restricted to previews.
 *
 * `preview` rather than `pr-42`: every pull request environment is the same
 * kind of environment, and a list naming individual pull requests would be a
 * list nobody maintains.
 */
export function servicesFor(catalogue: Catalogue, environment: string): ServiceDefinition[] {
  const kind = /^pr-\d+$/.test(environment) ? 'preview' : environment;
  return catalogue.services.filter((service) => !service.environments || service.environments.includes(kind));
}

/**
 * The services to deploy, grouped into the phases of doc 16 §4 and ordered.
 *
 * Grouped rather than flattened because the ordering that matters is *between*
 * phases, not within one: the four workers have no relationship to each other
 * and deploying them one at a time would treble the window in which half the
 * queues are on the new code and half on the old.
 */
export function phasesOf(catalogue: Catalogue, environment = 'production'): ServiceDefinition[][] {
  const byPhase = new Map<number, ServiceDefinition[]>();
  for (const service of servicesFor(catalogue, environment)) {
    const existing = byPhase.get(service.phase);
    if (existing) existing.push(service);
    else byPhase.set(service.phase, [service]);
  }
  return [...byPhase.keys()].sort((a, b) => a - b).map((phase) => byPhase.get(phase)!);
}

/**
 * The public hostname a service answers on, or null for a private one.
 *
 * Derived from one domain rather than written out per service and per
 * environment: `help.example.com`, `help.staging.example.com`. Six subdomains
 * times three environments is eighteen strings to keep in step, and the one
 * that goes stale is always the redirect URI nobody tests until sign-in breaks.
 *
 * Only for a deployment that *has* a domain. Without one, Railway generates a
 * hostname per service and nothing can derive it — see `resolveHosts`.
 */
export function hostFor(service: ServiceDefinition, domain: string, environment: string): string | null {
  if (!service.public || !service.subdomain) return null;
  return environment === 'production'
    ? `${service.subdomain}.${domain}`
    : `${service.subdomain}.${environment}.${domain}`;
}

/**
 * Service name to public hostname, for a deployment with a domain of its own.
 *
 * The generated-domain case builds the same map at deploy time from what
 * Railway hands back, which is why everything downstream takes a map rather
 * than a domain: the two paths differ only in where the hostnames come from,
 * and a second code path for the variables would be a second place to get the
 * origin wrong.
 */
export function hostsFor(catalogue: Catalogue, domain: string, environment: string): Map<string, string> {
  const hosts = new Map<string, string>();
  for (const service of catalogue.services) {
    const host = hostFor(service, domain, environment);
    if (host) hosts.set(service.name, host);
  }
  return hosts;
}

/**
 * Every variable this deploy sets on one service.
 *
 * These were computed since the pipeline was written, printed in its dry run,
 * and sent nowhere. That is not a cosmetic omission. `WORKER_QUEUES` is the
 * only thing distinguishing the four worker services from one another, and its
 * default is `*` — so without it every worker consumes every family, and the
 * split that exists to stop a burst of indexing starving the outbox
 * (doc 03 §4) would have been four identical services with different names.
 * `PORTAL_ORIGIN` and its siblings are what the BFF checks a request's origin
 * against and what it builds the OIDC redirect URI from; absent, sign-in
 * returns to the wrong host.
 *
 * What is deliberately *not* here: `DATABASE_URL`, `REDIS_URL`, `OIDC_ISSUER`,
 * `SMTP_URL`, every password and every key. Those are set once per environment
 * in Railway, by a person, and this deploy must never be able to overwrite one
 * — which is why the upsert below sets these keys and leaves the rest alone
 * rather than replacing the collection.
 */
export function variablesFor(service: ServiceDefinition, hosts: ReadonlyMap<string, string>): Record<string, string> {
  const own: Record<string, string> = { portal: 'PORTAL_ORIGIN', workbench: 'WORKBENCH_ORIGIN', admin: 'ADMIN_ORIGIN' };
  const variables: Record<string, string> = { ...service.variables };

  const apiHost = hosts.get('api');
  const mine = hosts.get(service.name);

  // Its own public URL, under whichever name that application reads.
  const name = own[service.name];
  if (name && mine) variables[name] = `https://${mine}`;
  if (service.name === 'api' && mine) variables.PUBLIC_BASE_URL = `https://${mine}`;

  // Where the three web applications find the API. Server components call it
  // directly and the proxy forwards to it, so it is the same value for all
  // three and it is the public hostname rather than an internal one: the
  // browser never talks to it, but the OIDC redirect and the origin check are
  // both expressed in public terms.
  if (name && apiHost) variables.API_BASE_URL = `https://${apiHost}`;

  return variables;
}

interface GraphQlError {
  message: string;
}

export async function callApi<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Railway API answered ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { data?: T; errors?: GraphQlError[] };
  // GraphQL answers 200 with an `errors` array, so a status check alone would
  // report a failed deploy as a successful one.
  if (body.errors?.length) throw new Error(`Railway API refused the call: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data) throw new Error('Railway API returned no data');
  return body.data;
}

const ENVIRONMENT_QUERY = `
  query Environments($projectId: String!) {
    project(id: $projectId) {
      environments { edges { node { id name } } }
      services { edges { node { id name } } }
    }
  }`;

const SET_IMAGE = `
  mutation SetImage($input: ServiceInstanceUpdateInput!, $serviceId: String!, $environmentId: String!) {
    serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
  }`;

const REDEPLOY = `
  mutation Redeploy($serviceId: String!, $environmentId: String!) {
    serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
  }`;

/**
 * `replace: false` is the whole safety of this call.
 *
 * Railway's upsert will delete every variable not named in the payload when
 * asked to replace, and the variables not named here are the ones that matter
 * most: the four database credentials, the Redis URL, the Keycloak issuer, the
 * SMTP password. A deploy that could remove those is a deploy that can empty
 * an environment on a typo.
 */
const SET_VARIABLES = `
  mutation SetVariables($input: VariableCollectionUpsertInput!) {
    variableCollectionUpsert(input: $input)
  }`;

const CREATE_DOMAIN = `
  mutation CreateDomain($input: CustomDomainCreateInput!) {
    customDomainCreate(input: $input) { id domain }
  }`;

/**
 * A hostname Railway invents, for a deployment that has no domain of its own.
 *
 * The hostname cannot be known in advance — Railway picks it — so unlike the
 * custom-domain path this one has to be *asked* before the origin variables
 * can be set. That is the whole reason `variablesFor` takes a map of hostnames
 * rather than a domain to derive them from.
 */
const CREATE_SERVICE_DOMAIN = `
  mutation CreateServiceDomain($input: ServiceDomainCreateInput!) {
    serviceDomainCreate(input: $input) { domain }
  }`;

/** What a service already answers on, so a second deploy reuses the first one's hostname. */
const DOMAINS_QUERY = `
  query Domains($projectId: String!, $environmentId: String!, $serviceId: String!) {
    domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
      serviceDomains { domain }
      customDomains { domain }
    }
  }`;

const CREATE_SERVICE = `
  mutation CreateService($input: ServiceCreateInput!) {
    serviceCreate(input: $input) { id }
  }`;

interface ProjectShape {
  project: {
    environments: { edges: { node: { id: string; name: string } }[] };
    services: { edges: { node: { id: string; name: string } }[] };
  };
}

function idsFrom(project: ProjectShape['project']): { environments: Map<string, string>; services: Map<string, string> } {
  return {
    environments: new Map(project.environments.edges.map(({ node }) => [node.name, node.id])),
    services: new Map(project.services.edges.map(({ node }) => [node.name, node.id])),
  };
}

interface Options {
  environment: string;
  tag: string;
  dryRun: boolean;
  /** Creates services the catalogue names and the project lacks, instead of refusing. */
  ensureServices: boolean;
}

function parseArguments(argv: readonly string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const environment = value('--environment');
  const tag = value('--tag');
  if (!environment || !tag) {
    throw new Error('usage: railway-deploy.ts --environment <name> --tag <image-tag> [--dry-run] [--ensure-services]');
  }
  return {
    environment,
    tag,
    dryRun: argv.includes('--dry-run'),
    ensureServices: argv.includes('--ensure-services'),
  };
}

/**
 * Creates a domain, and treats one that already exists as success.
 *
 * Every deploy after the first would otherwise fail on a domain it created
 * itself. Matched on the message rather than a code because Railway does not
 * give this one a code — so an unrecognised failure still throws, which is the
 * half of this worth keeping.
 */
async function ensureDomain(
  input: { projectId: string; environmentId: string; serviceId: string; domain: string; targetPort?: number },
  token: string,
): Promise<'created' | 'existed'> {
  try {
    await callApi(CREATE_DOMAIN, { input }, token);
    return 'created';
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('already exists') || message.includes('already in use') || message.includes('duplicate')) {
      return 'existed';
    }
    throw error;
  }
}

interface DomainsShape {
  domains: { serviceDomains: { domain: string }[]; customDomains: { domain: string }[] };
}

/**
 * The hostname a service answers on when nobody has bought a domain.
 *
 * Asks first and creates second, in that order and not the other way round: a
 * deploy runs many times and a service that already has a generated hostname
 * must keep it. A fresh one each deploy would change `PORTAL_ORIGIN` under a
 * live environment, which breaks the origin check and every OIDC redirect URI
 * registered against the old one.
 */
async function generatedHost(
  ids: { projectId: string; environmentId: string; serviceId: string },
  targetPort: number | undefined,
  token: string,
): Promise<string> {
  const existing = await callApi<DomainsShape>(DOMAINS_QUERY, ids, token);
  const already = existing.domains.serviceDomains[0]?.domain ?? existing.domains.customDomains[0]?.domain;
  if (already) return already;

  const created = await callApi<{ serviceDomainCreate: { domain: string } }>(
    CREATE_SERVICE_DOMAIN,
    { input: { environmentId: ids.environmentId, serviceId: ids.serviceId, ...(targetPort ? { targetPort } : {}) } },
    token,
  );
  return created.serviceDomainCreate.domain;
}

/**
 * A Railway project id, as it appears in the address bar.
 *
 * `railway.com/project/<this>`, and nothing after it: not the `?environmentId=`
 * Railway appends once you click into an environment, not a second path
 * segment, not the whole URL.
 */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Says what is wrong with an id **without printing it.**
 *
 * The value arrives from a GitHub secret. GitHub masks a secret's exact text in
 * a log and nothing else, so echoing a malformed one — which by definition is
 * not the exact text — would publish it. Every trait below is a property of the
 * value rather than the value, which is enough to recognise the mistake and not
 * enough to be the mistake.
 */
export function faultIn(projectId: string): string | null {
  if (PROJECT_ID.test(projectId)) return null;
  const traits: string[] = [`it is ${projectId.length} characters where a project id is 36`];
  if (/^https?:/i.test(projectId)) traits.push('it starts with http, so it is the whole URL rather than the id');
  if (projectId.includes('?')) traits.push("it contains '?', so the query string was copied with it");
  if (projectId.includes('/')) traits.push("it contains '/', so more of the path was copied than the id");
  if (/\s/.test(projectId)) traits.push('it contains a space or a newline');
  return `RAILWAY_PROJECT_ID is not a Railway project id: ${traits.join(', ')}.
It is the part of railway.com/project/<id> before any '?' or '/', and looks
like 0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9.`;
}

/**
 * Both credentials, trimmed and checked before the first call.
 *
 * `trim` is not defensive programming for its own sake: a value pasted into
 * GitHub's secret box with a trailing newline is stored with it, and an id with
 * a newline on the end is answered by Railway with the same `Project not found`
 * as an id that is simply wrong. The two faults are indistinguishable in a log
 * and one of them is invisible on the screen where it is made.
 */
export function credentialsFrom(env: NodeJS.ProcessEnv): { token: string; projectId: string } {
  const token = env.RAILWAY_TOKEN?.trim();
  const projectId = env.RAILWAY_PROJECT_ID?.trim();
  if (!token || !projectId) throw new Error('RAILWAY_TOKEN and RAILWAY_PROJECT_ID must both be set');
  const fault = faultIn(projectId);
  if (fault) throw new Error(fault);
  return { token, projectId };
}

/**
 * What `Project not found` actually means, which is not what it says.
 *
 * Railway answers it both when no project has that id and when the project
 * exists but this token cannot see it — a token is scoped to one workspace, so
 * a project in another is indistinguishable from a project that never existed.
 * The message names both, because the first real deploy of this pipeline failed
 * on it and the log said four words.
 */
export function explainRefusal(message: string): string {
  if (!/project not found/i.test(message)) return message;
  return `${message}

Railway says this when the id names no project *and* when the token cannot see
the one it names. Both are worth checking:

  - The id. Open the project in Railway; the address bar reads
    railway.com/project/<id>. Copy only the id, with no '?' or '/' after it.
  - The token's workspace. A token created under Account Settings -> Tokens
    belongs to the workspace picked beside its name, and reaches only the
    projects in that workspace. If the project sits in a different one, the
    token is the thing to replace, not the id.`;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const catalogue = readCatalogue();
  // Optional, and the two paths differ only in where a hostname comes from.
  // With a domain, every host is derived and claimed as a custom domain.
  // Without one, Railway invents a host per public service and the deploy has
  // to ask for it before it can tell the applications their own origin.
  const domain = process.env.DEPLOY_DOMAIN;

  const phases = phasesOf(catalogue, options.environment);

  if (options.dryRun) {
    // A dry run is what makes this reviewable before an account exists. It
    // prints the plan and touches nothing — and it prints the *whole* plan,
    // which it did not: it used to list the origins it had computed under a
    // heading, while the deploy below sent none of them. A dry run that shows
    // more than the real thing does is worse than no dry run, because it is
    // read as evidence.
    const planned = domain ? hostsFor(catalogue, domain, options.environment) : new Map<string, string>();
    console.log(`plan for ${options.environment} at ${options.tag}`);
    console.log(`  region: ${catalogue.region ?? '(Railway default)'}`);
    console.log(`  domains: ${domain ? `derived from ${domain}` : 'generated by Railway, so the hostnames below are not knowable until it runs'}`);
    for (const [index, phase] of phases.entries()) {
      console.log(`  phase ${index}: ${phase.map((one) => one.name).join(', ')}`);
      for (const service of phase) {
        console.log(`    ${service.name} <- ${imageFor(catalogue, service, options.tag)}`);
        const host = planned.get(service.name);
        if (host) console.log(`      domain https://${host}${service.port ? ` -> :${service.port}` : ''}`);
        else if (service.public) console.log(`      domain <generated>${service.port ? ` -> :${service.port}` : ''}`);
        for (const [name, value] of Object.entries(variablesFor(service, planned))) {
          console.log(`      ${name}=${value}`);
        }
        if (!domain && service.public) console.log('      *_ORIGIN / API_BASE_URL set once Railway has named the host');
      }
    }
    console.log('  set once per environment by a person, never by this script:');
    console.log('    DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM, REDIS_URL, OIDC_ISSUER, SMTP_URL, MEILISEARCH_*');
    return;
  }

  const { token, projectId } = credentialsFrom(process.env);

  const { project } = await callApi<ProjectShape>(ENVIRONMENT_QUERY, { projectId }, token).catch(
    (error: unknown) => {
      throw new Error(explainRefusal(error instanceof Error ? error.message : String(error)));
    },
  );
  const { environments, services } = idsFrom(project);
  const environmentId = environments.get(options.environment);
  if (!environmentId) {
    // The names it does have, because the alternative is guessing at a project
    // you cannot see. A Railway project starts with one environment called
    // `production`, and this pipeline deploys `main` to `staging` — so the
    // first deploy into a fresh project fails here, and the fix is a name.
    const existing = [...environments.keys()].sort();
    throw new Error(
      `no Railway environment named ${options.environment} in this project. It has: ${existing.join(', ') || '(none)'}.
Create one named exactly ${options.environment} in Railway, or deploy to one of the above.`,
    );
  }

  /*
   * Filled as the deploy goes, phase by phase.
   *
   * With a domain it is known up front. Without one it cannot be, and the
   * phase order carries it: the API is phase 2 and the three web applications
   * are phase 3, so by the time any of them needs `API_BASE_URL` the API's
   * hostname has been asked for and answered. That ordering was already there
   * for a different reason — the API must be up before the applications that
   * call it — and this is the second thing it buys.
   */
  const hosts = domain ? hostsFor(catalogue, domain, options.environment) : new Map<string, string>();

  for (const [index, phase] of phases.entries()) {
    console.log(`phase ${index}: ${phase.map((one) => one.name).join(', ')}`);
    await Promise.all(
      phase.map(async (service) => {
        let serviceId = services.get(service.name);

        if (!serviceId) {
          // Named rather than skipped: a service missing from the project is a
          // deploy that silently did less than it said it did, which is how a
          // worker family stays on last month's code for a fortnight.
          //
          // `--ensure-services` creates it instead, and that is not the same
          // concession: creating a service the catalogue names is doing what
          // was asked, where skipping one is doing less. Ten services made by
          // hand is ten chances to mistype a name the deploy then refuses.
          if (!options.ensureServices) throw new Error(`no Railway service named ${service.name} in this project`);
          const created = await callApi<{ serviceCreate: { id: string } }>(
            CREATE_SERVICE,
            { input: { projectId, name: service.name } },
            token,
          );
          serviceId = created.serviceCreate.id;
          console.log(`  ${service.name} created`);
        }

        await callApi(
          SET_IMAGE,
          {
            serviceId,
            environmentId,
            input: {
              source: { image: imageFor(catalogue, service, options.tag) },
              numReplicas: service.replicas,
              // Applied, not described. The README said EU West for a release
              // while nothing sent a region at all, and the first project
              // stood up under this pipeline landed in US West.
              ...(catalogue.region ? { region: catalogue.region } : {}),
              ...(service.command ? { startCommand: service.command } : {}),
              ...(service.healthcheckPath ? { healthcheckPath: service.healthcheckPath } : {}),
            },
          },
          token,
        );

        // The domain before the variables, and the variables before the
        // redeploy. Without a domain of our own the hostname does not exist
        // until it is asked for, and the origin variables are made of it — so
        // an order that set the variables first would set them from nothing.
        if (service.public) {
          if (domain) {
            const host = hosts.get(service.name)!;
            const outcome = await ensureDomain(
              { projectId, environmentId, serviceId, domain: host, ...(service.port ? { targetPort: service.port } : {}) },
              token,
            );
            console.log(`  ${service.name} at https://${host} (${outcome})`);
          } else {
            const host = await generatedHost({ projectId, environmentId, serviceId }, service.port, token);
            hosts.set(service.name, host);
            console.log(`  ${service.name} at https://${host} (Railway generated)`);
          }
        }

        // Before the redeploy, so the instance that starts already has them.
        // A worker that came up with WORKER_QUEUES unset would consume every
        // family for as long as it took the next deploy to correct it.
        const variables = variablesFor(service, hosts);
        if (Object.keys(variables).length > 0) {
          await callApi(
            SET_VARIABLES,
            { input: { projectId, environmentId, serviceId, variables, replace: false } },
            token,
          );
        }

        await callApi(REDEPLOY, { serviceId, environmentId }, token);
        console.log(`  ${service.name} -> ${imageFor(catalogue, service, options.tag)}`);
      }),
    );
  }

  await publishHosts(hosts);
}

/**
 * Where the deployment actually ended up, for whatever runs next.
 *
 * The smoke test needs the API's URL, and with a generated domain no workflow
 * expression can spell it — it is whatever Railway named it, discovered in the
 * middle of this run. So it is written out rather than derived a second time,
 * which also removes the four places the workflow spelled a hostname of its
 * own and could disagree with the deploy about it.
 */
async function publishHosts(hosts: ReadonlyMap<string, string>): Promise<void> {
  const urls = Object.fromEntries([...hosts].map(([name, host]) => [name, `https://${host}`]));
  console.log('hosts:');
  for (const [name, url] of Object.entries(urls)) console.log(`  ${name}=${url}`);

  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  const { appendFile } = await import('node:fs/promises');
  const lines = [
    `hosts=${JSON.stringify(urls)}`,
    ...(urls.api ? [`api-url=${urls.api}`] : []),
    ...(urls.portal ? [`portal-url=${urls.portal}`] : []),
    ...(urls.workbench ? [`workbench-url=${urls.workbench}`] : []),
    ...(urls.admin ? [`admin-url=${urls.admin}`] : []),
  ];
  await appendFile(output, `${lines.join('\n')}\n`, 'utf8');
}

// Only when run, so the pure functions above can be imported by a test without
// needing a token, a project or a network.
if (process.argv[1]?.endsWith('railway-deploy.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
