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
  // `@` is the bare domain, for the public site should the owner want it
  // there rather than at `www.` (A5 §16). Outside production it still gets the
  // environment's label, so a preview never claims the production apex.
  if (service.subdomain === '@') return environment === 'production' ? domain : `${environment}.${domain}`;
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
 * The four web services — the three applications and the public site — and
 * the variable each reads its own public origin from. The BFF in each app
 * names its own (`originEnvVar`), so this is the one place the four spellings
 * are listed together.
 *
 * The site is here so every web service learns `SITE_ORIGIN` (the apps' "IT
 * Service Management home" link and the Referer rule of their `/demo` page)
 * and the site learns the three app origins its links are made of. A BFF
 * reads only its own origin, so the site's is inert to every origin check.
 */
export const WEB_ORIGINS: Readonly<Record<string, string>> = {
  portal: 'PORTAL_ORIGIN',
  workbench: 'WORKBENCH_ORIGIN',
  admin: 'ADMIN_ORIGIN',
  site: 'SITE_ORIGIN',
};

/** Deploy-wide settings that are configuration, not credentials. */
export interface DeploySettings {
  /** `PORTAL_CHANNELS` as the deploy was given it: a comma list such as `email,teams,slack`. */
  readonly portalChannels?: string | undefined;
}

/**
 * `PORTAL_CHANNELS`, tidied, or null when there is nothing to set.
 *
 * A requester cannot read the tenant's channel accounts, so the portal learns
 * which channels to mention from configuration. Lower-cased, trimmed and
 * de-duplicated so `Email, teams,,email` is `email,teams`; empty — which is
 * what an unset GitHub variable arrives as — is nothing to set. Anything that
 * is not a plain name is refused here, at deploy time, rather than rendered
 * verbatim on every requester's home page.
 */
export function portalChannels(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const names = raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  const refused = names.filter((name) => !/^[a-z][a-z0-9-]{0,31}$/.test(name));
  if (refused.length > 0) {
    throw new Error(
      `PORTAL_CHANNELS is a comma list of channel names such as email,teams,slack; not a channel name: ${refused.map((name) => JSON.stringify(name)).join(', ')}`,
    );
  }
  return names.length > 0 ? [...new Set(names)].join(',') : null;
}

/**
 * One phase, in two passes: every service's image and hostname first, then
 * every service's variables and redeploy.
 *
 * The web applications share a phase and each now carries the others'
 * origins. Without a domain of our own a hostname exists only once it has
 * been asked for, so a single pass per service would set the portal's
 * variables from whichever siblings happened to answer first — a race, won
 * differently on every deploy. Two passes make the map complete before any
 * variable is read from it, and keep the order that matters within a service:
 * the domain before the variables, the variables before the redeploy.
 */
export async function inTwoPasses<T>(
  phase: readonly ServiceDefinition[],
  prepare: (service: ServiceDefinition) => Promise<T>,
  release: (service: ServiceDefinition, prepared: T) => Promise<void>,
): Promise<void> {
  const prepared = await Promise.all(phase.map((service) => prepare(service)));
  await Promise.all(phase.map((service, index) => release(service, prepared[index] as T)));
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
export function variablesFor(
  service: ServiceDefinition,
  hosts: ReadonlyMap<string, string>,
  settings: DeploySettings = {},
): Record<string, string> {
  const variables: Record<string, string> = { ...service.variables };

  const apiHost = hosts.get('api');
  const mine = hosts.get(service.name);
  const web = Object.hasOwn(WEB_ORIGINS, service.name);

  /*
   * Every web service's origin, to every web service — not only its own. Each
   * BFF reads its own origin by name (`originEnvVar`), so the others are inert
   * to the origin check and the OIDC redirect; they are what the area
   * switcher, "Open in Service Desk", the portal links in an agent's reply and
   * every link on the public site are built from. A host that is not known
   * yet sets nothing, and the link it would have made degrades to a copyable
   * number (or, on the site, a sentence saying that part is unavailable)
   * rather than pointing at `https://undefined`.
   */
  if (web) {
    for (const [app, variable] of Object.entries(WEB_ORIGINS)) {
      const host = hosts.get(app);
      if (host) variables[variable] = `https://${host}`;
    }
  }
  if (service.name === 'api' && mine) variables.PUBLIC_BASE_URL = `https://${mine}`;

  // Where the web services find the API. The applications' server components
  // call it directly and their proxies forward to it; the site's server reads
  // the demo's public status from it. The same value for all four, and the
  // public hostname rather than an internal one: the browser never talks to
  // it, but the OIDC redirect and the origin check are both expressed in
  // public terms.
  if (web && apiHost) variables.API_BASE_URL = `https://${apiHost}`;

  // The channels the portal's "Good to know" card names. Only when the deploy
  // was given a list: absent, a value somebody set by hand in Railway stays,
  // because the upsert never removes what it does not name.
  const channels = portalChannels(settings.portalChannels);
  if (service.name === 'portal' && channels) variables.PORTAL_CHANNELS = channels;

  /*
   * The port, told to Railway in the only way Railway reads it.
   *
   * Every service here listens on a fixed port of its own — the API on 3000,
   * the workbench on 3100 — because they are also run by `docker compose` and
   * by a developer, where fixed ports are what make the addresses memorable.
   * Railway does not look at that. It routes the public domain and runs the
   * health check against `PORT`, and a service that listens somewhere else is
   * a service it cannot reach.
   *
   * Which is exactly what the first working deployment looked like: the API's
   * own log said `api listening port: 3000`, with 27 modules registered and
   * the database connected, while Railway spent 4:53 failing a health check
   * and then destroyed it. Nothing was wrong with the application, and nothing
   * in either log said the word `port` twice.
   */
  if (service.port) variables.PORT = String(service.port);

  return variables;
}

/**
 * The pre-flight: can Railway pull every image this deploy is about to set?
 *
 * GHCR creates every new package **private**, and Railway pulls anonymously
 * unless a service was given a registry credential. So the first deploy after
 * a new image target lands — the public site's, and later Keycloak's — would
 * set an image Railway cannot fetch, after the earlier phases had already
 * moved, and the smoke test would be the first thing to say so. Asked here,
 * before Railway is touched, the deploy stops with the fix instead.
 *
 * The answer only decides the deploy for a service that **does not exist yet**
 * in the project (Y-M6). An existing service may have been given a registry
 * credential rather than a public package — the runbook offers both — so an
 * image anonymous pulls cannot reach is a warning there, never a refusal: the
 * check must not block every deploy of an owner who chose the other option.
 * A new service has no credential until somebody adds one, so for it a
 * refusal is certain to fail and the deploy stops before any change.
 *
 * `DEPLOY_SKIP_PULL_CHECK=1` turns the whole check off, for the owner who
 * gave Railway a credential and does not want the warnings.
 */
export type PullVerdict = 'pullable' | 'refused' | 'unknown';

export interface PullTarget {
  /** `ghcr.io/<repository>/<target>:<tag>`, as `imageFor` names it. */
  readonly image: string;
  /** The registry path, `<repository>/<target>`. */
  readonly path: string;
  /** The catalogue services that run this image in this environment. */
  readonly services: readonly string[];
  /** Those of them the project does not have yet, which this deploy would create. */
  readonly newServices: readonly string[];
}

export interface PullCheck extends PullTarget {
  readonly verdict: PullVerdict;
  /** The answer that decided it: a status code, or why there was none. */
  readonly detail: string;
}

/** Every distinct image this environment runs, with the services behind it. */
export function pullTargets(
  catalogue: Catalogue,
  environment: string,
  tag: string,
  existing: ReadonlySet<string>,
): PullTarget[] {
  const byImage = new Map<string, { path: string; services: string[] }>();
  for (const service of servicesFor(catalogue, environment)) {
    const image = imageFor(catalogue, service, tag);
    const entry = byImage.get(image) ?? { path: `${catalogue.image.repository}/${service.target}`, services: [] };
    entry.services.push(service.name);
    byImage.set(image, entry);
  }
  return [...byImage].map(([image, { path, services }]) => ({
    image,
    path,
    services,
    newServices: services.filter((name) => !existing.has(name)),
  }));
}

/** What a registry may answer a manifest request with: a multi-platform index or a single manifest, OCI or Docker. */
export const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/** GHCR's anonymous token for pulling one package: what Railway itself would be given. */
export function pullTokenUrl(registry: string, path: string): string {
  return `https://${registry}/token?service=${encodeURIComponent(registry)}&scope=${encodeURIComponent(`repository:${path}:pull`)}`;
}

export function manifestUrl(registry: string, path: string, tag: string): string {
  return `https://${registry}/v2/${path}/manifests/${encodeURIComponent(tag)}`;
}

/**
 * A status that settles the question. 401, 403 and 404 are the three ways a
 * registry says "not to you": private, denied, or (for a private package
 * asked anonymously) indistinguishable from absent. Anything else — a 5xx, a
 * 429, a connection that failed — says nothing about the package, so it is
 * `unknown` and never stops a deploy.
 */
function refusal(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

/** Anonymously: a pull token, then the manifest with it, exactly as a pull starts. */
export async function checkPullable(
  registry: string,
  path: string,
  tag: string,
  fetcher: typeof fetch = fetch,
): Promise<{ readonly verdict: PullVerdict; readonly detail: string }> {
  try {
    const tokenResponse = await fetcher(pullTokenUrl(registry, path), { signal: AbortSignal.timeout(15_000) });
    if (!tokenResponse.ok) {
      return { verdict: refusal(tokenResponse.status) ? 'refused' : 'unknown', detail: `token ${tokenResponse.status}` };
    }
    const { token } = (await tokenResponse.json().catch(() => ({}))) as { token?: unknown };
    if (typeof token !== 'string' || token === '') return { verdict: 'unknown', detail: 'token answer had no token' };

    const manifest = await fetcher(manifestUrl(registry, path, tag), {
      method: 'HEAD',
      headers: { accept: MANIFEST_ACCEPT, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (manifest.ok) return { verdict: 'pullable', detail: `${manifest.status}` };
    return { verdict: refusal(manifest.status) ? 'refused' : 'unknown', detail: `manifest ${manifest.status}` };
  } catch (error: unknown) {
    return { verdict: 'unknown', detail: error instanceof Error ? error.message : String(error) };
  }
}

/** The GitHub package name of a registry path: `yousafbarikzai/ticket/site` → `ticket/site`. */
function packageName(path: string): string {
  return path.split('/').slice(1).join('/');
}

/** What the owner does about an image anonymous pulls cannot reach. */
export function pullFix(registry: string, path: string): string {
  return `${registry}/${path} is not publicly pullable, so Railway cannot pull it. Make it public: GitHub → your profile → Packages → ${packageName(path)} → Package settings → Change visibility → Public, then re-run this deploy. If Railway pulls with a registry credential instead, set the repository variable DEPLOY_SKIP_PULL_CHECK=1.`;
}

export interface PullOptions {
  readonly fetch?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Where the notices and warnings go; GitHub reads `::warning` lines as annotations. */
  readonly log?: (line: string) => void;
}

/**
 * Runs the pre-flight for one deploy and throws, naming every package and its
 * fix, when an image a new service needs is refused. Returns the checks it
 * made (none when skipped), for the log and for tests.
 */
export async function assertPullable(
  catalogue: Catalogue,
  environment: string,
  tag: string,
  existing: ReadonlySet<string>,
  options: PullOptions = {},
): Promise<PullCheck[]> {
  const log = options.log ?? ((line: string) => console.log(line));
  const env = options.env ?? process.env;
  if (env.DEPLOY_SKIP_PULL_CHECK === '1') {
    log('::notice title=Image pull::DEPLOY_SKIP_PULL_CHECK=1, so the images were not checked for anonymous pulls before deploying.');
    return [];
  }

  const { registry } = catalogue.image;
  const checks = await Promise.all(
    pullTargets(catalogue, environment, tag, existing).map(async (target): Promise<PullCheck> => ({
      ...target,
      ...(await checkPullable(registry, target.path, tag, options.fetch)),
    })),
  );

  const blocking: PullCheck[] = [];
  for (const check of checks) {
    if (check.verdict === 'pullable') continue;
    if (check.verdict === 'refused' && check.newServices.length > 0) {
      blocking.push(check);
      continue;
    }
    // An existing service (it may hold a registry credential), or a registry
    // that did not answer: worth a line in the run, not a stopped deploy.
    const why =
      check.verdict === 'refused'
        ? `${pullFix(registry, check.path)} (${check.services.join(', ')} already exist, so this deploy goes ahead in case they pull with a credential.)`
        : `Could not check whether ${registry}/${check.path}:${tag} is pullable (${check.detail}); deploying anyway.`;
    log(`::warning title=Image pull::${why}`);
  }

  if (blocking.length > 0) {
    throw new Error(
      [
        'The deploy stopped before changing anything in Railway:',
        ...blocking.map((check) => `  - ${pullFix(registry, check.path)} (needed by ${check.newServices.join(', ')}, which this deploy would create.)`),
      ].join('\n'),
    );
  }
  return checks;
}

interface GraphQlError {
  message: string;
}

/** `mutation SetImage(...)` → `SetImage`. Used to say *which* call failed. */
export function operationName(query: string): string {
  return /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? 'an unnamed operation';
}

/**
 * The operations it is safe to send twice.
 *
 * A connection that fails gives no answer, and no answer does not mean nothing
 * happened — the request may have been received and applied. So retrying is
 * only safe where sending the same call twice is the same as sending it once.
 *
 * The two reads are trivially safe. `SetImage` and `SetVariables` set a value
 * rather than appending one. `Redeploy` asks for a deployment of the current
 * configuration; a duplicate is a wasted deploy, not a wrong one.
 *
 * The three creates are deliberately absent, and this is the whole reason for
 * a list rather than a blanket retry: `CreateService` sent twice is two
 * services with the same name, and `CreateServiceDomain` sent twice is a second
 * hostname the environment does not know it has. A duplicate there is worse
 * than the failure it is trying to paper over.
 */
const RETRYABLE = new Set(['Environments', 'Domains', 'SetImage', 'SetVariables', 'Redeploy']);

const NETWORK_ATTEMPTS = 4;

export async function callApi<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const what = operationName(query);
  const attempts = RETRYABLE.has(what) ? NETWORK_ATTEMPTS : 1;
  let last = 'never answered';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error: unknown) {
      // The connection failed, so Railway never answered. Node words this
      // `fetch failed` and nothing else — which, in the middle of a ten-service
      // deploy, does not say which service or which call, and that is how a
      // half-applied environment gets reported in two words.
      last = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
        continue;
      }
      throw new Error(
        `Railway API unreachable during ${what}${attempts > 1 ? `, after ${attempts} attempts` : ''}: ${last}`,
      );
    }

    if (!response.ok) throw new Error(`Railway API answered ${response.status} to ${what}: ${await response.text()}`);
    const body = (await response.json()) as { data?: T; errors?: GraphQlError[] };
    // GraphQL answers 200 with an `errors` array, so a status check alone would
    // report a failed deploy as a successful one.
    if (body.errors?.length) {
      throw new Error(`Railway API refused the call: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (!body.data) throw new Error(`Railway API returned no data for ${what}`);
    return body.data;
  }

  // Unreachable: the loop either returns or throws. Here so the type holds
  // without an assertion that would outlive whatever made it true.
  throw new Error(`Railway API unreachable during ${what}: ${last}`);
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
  // Read before anything is touched, so a malformed list fails the deploy
  // before the first call rather than halfway through a phase.
  const settings: DeploySettings = { portalChannels: process.env.PORTAL_CHANNELS };
  portalChannels(settings.portalChannels);

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
        for (const [name, value] of Object.entries(variablesFor(service, planned, settings))) {
          console.log(`      ${name}=${value}`);
        }
        if (!domain && service.public) console.log('      *_ORIGIN / API_BASE_URL set once Railway has named the host');
      }
    }
    console.log('  set once per environment by a person, never by this script:');
    console.log('    DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM, REDIS_URL, OIDC_ISSUER, SMTP_URL, MEILISEARCH_*');
    console.log(
      process.env.DEPLOY_SKIP_PULL_CHECK === '1'
        ? '  pre-flight: skipped (DEPLOY_SKIP_PULL_CHECK=1)'
        : '  pre-flight: every image above checked for an anonymous pull before anything changes; a refusal stops the deploy only for a service it would create',
    );
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

  // Every service the catalogue names here, checked before the first change:
  // without --ensure-services a missing one stops the deploy, and stopping
  // now is better than after the phases before it have already moved.
  const wanted = phases.flat().map((service) => service.name);
  const missing = wanted.filter((name) => !services.has(name));
  if (missing.length > 0 && !options.ensureServices) {
    throw new Error(`no Railway service named ${missing.join(', ')} in this project; create it, or deploy with --ensure-services`);
  }

  // The pull pre-flight (Y-M6), before Railway is touched.
  await assertPullable(catalogue, options.environment, options.tag, new Set(services.keys()));

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
    await inTwoPasses(
      phase,
      async (service): Promise<string> => {
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
        return serviceId;
      },
      async (service, serviceId) => {
        // Before the redeploy, so the instance that starts already has them.
        // A worker that came up with WORKER_QUEUES unset would consume every
        // family for as long as it took the next deploy to correct it.
        const variables = variablesFor(service, hosts, settings);
        if (Object.keys(variables).length > 0) {
          await callApi(
            SET_VARIABLES,
            { input: { projectId, environmentId, serviceId, variables, replace: false } },
            token,
          );
        }

        await callApi(REDEPLOY, { serviceId, environmentId }, token);
        console.log(`  ${service.name} -> ${imageFor(catalogue, service, options.tag)}`);
      },
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
  await appendFile(output, `${hostOutputs(urls).join('\n')}\n`, 'utf8');
}

/** The services whose URL a workflow can read by name: `<service>-url`. */
const URL_OUTPUTS = ['api', 'portal', 'workbench', 'admin', 'site'] as const;

/**
 * The `GITHUB_OUTPUT` lines for a deploy's hosts: the whole map as `hosts`
 * (the smoke test and the realm read it), and one `<service>-url` per web
 * service, which is what an environment's link in GitHub can name.
 * `site-url` is the address to share, so it is what the deploy and
 * production environments link to.
 */
export function hostOutputs(urls: Readonly<Record<string, string>>): string[] {
  return [`hosts=${JSON.stringify(urls)}`, ...URL_OUTPUTS.flatMap((name) => (urls[name] ? [`${name}-url=${urls[name]}`] : []))];
}

// Only when run, so the pure functions above can be imported by a test without
// needing a token, a project or a network.
if (process.argv[1]?.endsWith('railway-deploy.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
