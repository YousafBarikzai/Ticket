/**
 * Deletes a preview environment (docs/architecture/16 §3, stage 4).
 *
 * A preview that outlives its pull request is a database nobody is watching on
 * a bill somebody is paying, and — because a preview holds a seeded copy of the
 * two-tenant data set and its own Keycloak realm — a login somebody could still
 * use. Tearing it down is part of the feature, not tidying afterwards.
 *
 * Refuses to delete anything that is not a preview. The environment name is
 * interpolated from a pull request number by a workflow, and the cost of that
 * going wrong once is the production environment. `pr-<digits>` and nothing
 * else.
 *
 * Usage:
 *   tsx infra/scripts/railway-teardown.ts --environment pr-42
 */
import { callApi } from './railway-deploy.js';

export const PREVIEW_NAME = /^pr-\d+$/;

/** Whether this name may be deleted at all. */
export function isPreview(environment: string): boolean {
  return PREVIEW_NAME.test(environment);
}

const ENVIRONMENTS = `
  query Environments($projectId: String!) {
    project(id: $projectId) { environments { edges { node { id name } } } }
  }`;

const DELETE = `
  mutation DeleteEnvironment($id: String!) {
    environmentDelete(id: $id)
  }`;

interface EnvironmentsShape {
  project: { environments: { edges: { node: { id: string; name: string } }[] } };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--environment');
  const environment = index >= 0 ? argv[index + 1] : undefined;
  if (!environment) throw new Error('usage: railway-teardown.ts --environment pr-<number>');
  if (!isPreview(environment)) {
    throw new Error(`refusing to delete ${environment}: only pr-<number> environments are ever torn down`);
  }

  const token = process.env.RAILWAY_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  if (!token || !projectId) throw new Error('RAILWAY_TOKEN and RAILWAY_PROJECT_ID must both be set');

  const { project } = await callApi<EnvironmentsShape>(ENVIRONMENTS, { projectId }, token);
  const match = project.environments.edges.find(({ node }) => node.name === environment);
  if (!match) {
    // Not an error: a pull request closed twice, or one that never got far
    // enough to have an environment, should not fail a workflow.
    console.log(`no environment named ${environment}; nothing to tear down`);
    return;
  }

  await callApi(DELETE, { id: match.node.id }, token);
  console.log(`deleted ${environment}`);
}

if (process.argv[1]?.endsWith('railway-teardown.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
