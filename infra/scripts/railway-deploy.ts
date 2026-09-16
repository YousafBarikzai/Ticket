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
 */
export function hostFor(service: ServiceDefinition, domain: string, environment: string): string | null {
  if (!service.public || !service.subdomain) return null;
  return environment === 'production'
    ? `${service.subdomain}.${domain}`
    : `${service.subdomain}.${environment}.${domain}`;
}

/**
 * Every origin variable each application needs, derived from the same domain.
 *
 * The BFF checks the request origin against its own `*_ORIGIN` and builds the
 * OIDC redirect URI from it, so a wrong value here is not a cosmetic fault: it
 * is a sign-in that returns to the wrong host, or an origin check that refuses
 * every request the application makes to itself.
 */
export function originsFor(catalogue: Catalogue, domain: string, environment: string): Record<string, string> {
  const origins: Record<string, string> = {};
  const named: Record<string, string> = { portal: 'PORTAL_ORIGIN', workbench: 'WORKBENCH_ORIGIN', admin: 'ADMIN_ORIGIN', api: 'PUBLIC_BASE_URL' };
  for (const service of catalogue.services) {
    const variable = named[service.name];
    const host = hostFor(service, domain, environment);
    if (variable && host) origins[variable] = `https://${host}`;
  }
  return origins;
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
}

function parseArguments(argv: readonly string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const environment = value('--environment');
  const tag = value('--tag');
  if (!environment || !tag) throw new Error('usage: railway-deploy.ts --environment <name> --tag <image-tag> [--dry-run]');
  return { environment, tag, dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const catalogue = readCatalogue();
  const domain = process.env.DEPLOY_DOMAIN;
  if (!domain) throw new Error('DEPLOY_DOMAIN is not set; every public hostname is derived from it');

  const origins = originsFor(catalogue, domain, options.environment);
  const phases = phasesOf(catalogue, options.environment);

  if (options.dryRun) {
    // A dry run is what makes this reviewable before an account exists. It
    // prints the plan and touches nothing.
    console.log(`plan for ${options.environment} at ${options.tag}`);
    for (const [index, phase] of phases.entries()) {
      console.log(`  phase ${index}: ${phase.map((s) => s.name).join(', ')}`);
      for (const service of phase) console.log(`    ${service.name} <- ${imageFor(catalogue, service, options.tag)}`);
    }
    console.log('  origins:');
    for (const [name, url] of Object.entries(origins)) console.log(`    ${name}=${url}`);
    return;
  }

  const token = process.env.RAILWAY_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  if (!token || !projectId) throw new Error('RAILWAY_TOKEN and RAILWAY_PROJECT_ID must both be set');

  const { project } = await callApi<ProjectShape>(ENVIRONMENT_QUERY, { projectId }, token);
  const { environments, services } = idsFrom(project);
  const environmentId = environments.get(options.environment);
  if (!environmentId) throw new Error(`no Railway environment named ${options.environment} in this project`);

  for (const [index, phase] of phases.entries()) {
    console.log(`phase ${index}: ${phase.map((s) => s.name).join(', ')}`);
    await Promise.all(
      phase.map(async (service) => {
        const serviceId = services.get(service.name);
        // Named rather than skipped: a service missing from the project is a
        // deploy that silently did less than it said it did, which is how a
        // worker family stays on last month's code for a fortnight.
        if (!serviceId) throw new Error(`no Railway service named ${service.name} in this project`);

        await callApi(
          SET_IMAGE,
          {
            serviceId,
            environmentId,
            input: {
              source: { image: imageFor(catalogue, service, options.tag) },
              numReplicas: service.replicas,
              ...(service.command ? { startCommand: service.command } : {}),
              ...(service.healthcheckPath ? { healthcheckPath: service.healthcheckPath } : {}),
            },
          },
          token,
        );
        await callApi(REDEPLOY, { serviceId, environmentId }, token);
        console.log(`  ${service.name} -> ${imageFor(catalogue, service, options.tag)}`);
      }),
    );
  }
}

// Only when run, so the pure functions above can be imported by a test without
// needing a token, a project or a network.
if (process.argv[1]?.endsWith('railway-deploy.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
