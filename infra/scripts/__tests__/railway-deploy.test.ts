import { describe, expect, it } from 'vitest';
import { hostFor, imageFor, originsFor, phasesOf, readCatalogue, type Catalogue, type ServiceDefinition } from '../railway-deploy.js';
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

  it('derives every origin variable the applications read from the one domain', () => {
    // These four names are not decorative: the BFF checks the request origin
    // against its own and builds the OIDC redirect URI from it, so a wrong
    // value is a sign-in that returns to the wrong host.
    expect(originsFor(catalogue, 'example.com', 'staging')).toEqual({
      PORTAL_ORIGIN: 'https://help.staging.example.com',
      WORKBENCH_ORIGIN: 'https://desk.staging.example.com',
      ADMIN_ORIGIN: 'https://admin.staging.example.com',
      PUBLIC_BASE_URL: 'https://api.staging.example.com',
    });
  });

  it('gives the three applications and the API four distinct hosts', () => {
    const origins = Object.values(originsFor(catalogue, 'example.com', 'production'));
    expect(new Set(origins).size).toBe(origins.length);
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
