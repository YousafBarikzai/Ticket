import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  cache,
  logger,
  metrics,
  modules,
  readDeploymentWarnings,
  systemContext,
  withContext,
} from '@itsm/platform';
import { describeMeter, planService, tenantService, usageService } from '@itsm/module-tenancy';
import { evalService, formatMicros, promptService } from '@itsm/module-ai';
import { contextOf } from '../plugins/context.js';

/**
 * What an operator is told when a lifecycle or plan change names a demo
 * tenant (Y-M13; SPEC v3 §4.7.7).
 */
export const DEMO_TENANT_MANAGED =
  'this tenant is the shared demo, which its nightly build manages; use `pnpm platform demo pause` to take the demo offline';

/**
 * Refuses a lifecycle or plan change to a demo tenant: 409, before the
 * service runs (Y-M13).
 *
 * The demo tenant is the build's, not an operator's. Suspending the live
 * one makes the interlock answer every visitor `demo_reset`, and their app
 * re-mints onto the same suspended tenant until the visit ends; the next
 * swap then refuses a live tenant that is not active, backs off and freezes
 * on yesterday's data. A plan or a region change would make the demo
 * misrepresent the product until the nightly reset put it back. The
 * operator's switch for the demo is `pnpm platform demo pause`, which
 * survives deploys and undoes cleanly. Retired and building generations are
 * refused the same way: the lifecycle purges them.
 *
 * A tenant that does not exist is left to the service, which answers 404.
 */
export async function refuseDemoTenant(tenantId: string): Promise<void> {
  const tenant = await tenantService.findTenantById(tenantId);
  if (tenant?.kind !== 'demo') return;
  metrics.increment('demo_operator_refusals_total');
  logger.warn('an operator lifecycle or plan change named a demo tenant; refused', { tenantId });
  throw new ConflictError(DEMO_TENANT_MANAGED);
}

/**
 * The platform surface (`/api/platform/v1`).
 *
 * Separate from the tenant API because it is operated by a different audience
 * with a different database role, and because a later extraction routes the
 * whole prefix elsewhere without touching tenant traffic.
 */
export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request) => {
    const ctx = contextOf(request);
    // Platform operations are never available to an ordinary tenant role.
    if (!ctx.permissions.has('platform.tenant.manage', 'any')) {
      throw new ForbiddenError('platform.tenant.manage');
    }
  });

  app.get('/tenants', async () => {
    const tenants = await tenantService.listTenants();
    return {
      data: tenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        region: tenant.region,
        createdAt: tenant.createdAt.toISOString(),
        // Additive: the console's tenant list shows the plan and the drawer
        // the AI regions without a call per tenant.
        planKey: tenant.planKey ?? null,
        aiAllowedRegions: tenant.aiAllowedRegions,
        suspendedAt: tenant.suspendedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post('/tenants', async (request, reply) => {
    const input = tenantService.provisionTenantSchema.strict().parse(request.body);
    // A demo tenant is made only by the demo build (A4), as a `seeding`
    // generation it then swaps in. One made here would belong to nobody: no
    // demo token names it, and it refuses every other kind of token (D25).
    if (input.kind === 'demo') {
      throw new ValidationError('demo tenants are created by the demo build, never through this route', [
        { field: 'kind', code: 'demo_managed', message: 'Demo tenants are created by the demo build.' },
      ]);
    }
    const result = await tenantService.provisionTenant(input);
    reply.status(201);
    return result;
  });

  /**
   * Where a tenant's prompts may be processed.
   *
   * A platform door, not a tenant one. Residency is a contractual term, and a
   * tenant that could widen its own would be a control it could remove; a
   * tenant that could narrow it could lock itself out of every configured
   * provider and have no way to say why.
   */
  app.put('/tenants/:id/ai-regions', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const regions = tenantService.aiRegionsSchema.strict().parse(request.body);
    await refuseDemoTenant(id);
    return tenantService.setAiRegions(id, regions);
  });

  app.post('/tenants/:id/suspend', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ reason: z.string().max(1000).optional() }).parse(request.body ?? {});
    await refuseDemoTenant(id);
    await tenantService.suspendTenant(id, body.reason);
    return { id, status: 'suspended' };
  });

  app.post('/tenants/:id/resume', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await refuseDemoTenant(id);
    await tenantService.resumeTenant(id);
    return { id, status: 'active' };
  });

  app.get('/modules', async () => ({
    data: modules().map((module) => ({
      id: module.id,
      key: module.key,
      name: module.name,
      version: module.version,
      phase: module.phase,
      dependsOn: module.dependsOn,
      optional: module.optional,
      permissions: module.permissions.length,
      publishes: module.events.publishes.length,
      consumes: module.events.consumes.length,
    })),
  }));

  // ---- Plans ---------------------------------------------------------------
  //
  // Plans are the deployment's, not a tenant's: defined here, read by every
  // tenant, and changed by nobody else (ADR-0038).

  const shape = (plan: {
    key: string;
    name: string;
    description: string | null;
    features: string[];
    pricePerAgentMicros: bigint | null;
    currency: string;
    isRetired: boolean;
    sortOrder: number;
    limits: { meter: string; soft: bigint | null; hard: bigint | null }[];
  }) => ({
    key: plan.key,
    name: plan.name,
    description: plan.description,
    features: plan.features,
    // A string, like every other micro-pence amount this API returns: a
    // bigint does not survive JSON, and a number would silently lose precision
    // on an annual figure for a large tenant.
    pricePerAgentMicros: plan.pricePerAgentMicros === null ? null : plan.pricePerAgentMicros.toString(),
    currency: plan.currency,
    isRetired: plan.isRetired,
    sortOrder: plan.sortOrder,
    limits: plan.limits
      .map((limit) => ({ meter: limit.meter, soft: limit.soft === null ? null : Number(limit.soft), hard: limit.hard === null ? null : Number(limit.hard) }))
      .sort((a, b) => a.meter.localeCompare(b.meter)),
  });

  app.get('/plans', async () => ({ data: (await planService.listPlans()).map(shape) }));

  app.put('/plans/:key', async (request) => {
    const ctx = contextOf(request);
    const { key } = z.object({ key: z.string().min(1).max(40) }).parse(request.params);
    const saved = await planService.savePlan(ctx, { ...(request.body as object), key } as never);
    return shape(saved);
  });

  app.put('/tenants/:id/plan', async (request) => {
    const ctx = contextOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ planKey: z.string().min(1).max(40) }).strict().parse(request.body);
    await refuseDemoTenant(id);
    const tenant = await planService.assignPlan(ctx, id, body.planKey);
    return { id, planKey: tenant?.planKey ?? null };
  });

  /** What one tenant is using, for a support conversation about a refusal. */
  app.get('/tenants/:id/usage', async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const tenant = await tenantService.findTenantById(id);
    if (!tenant) throw new NotFoundError('tenant', id);
    const ctx = systemContext(tenant.id, { region: tenant.region });
    const usage = await withContext(ctx, () => usageService.usageFor(ctx));
    return {
      planKey: usage.planKey,
      meters: usage.meters.map((meter) => ({
        meter: meter.meter,
        value: Number(meter.value),
        display: describeMeter(meter.meter, meter.value),
        state: meter.state,
        period: meter.periodKey,
        soft: meter.lines.soft === null ? null : Number(meter.lines.soft),
        hard: meter.lines.hard === null ? null : Number(meter.lines.hard),
      })),
    };
  });

  // ---- MOD-09 prompts and evaluations ---------------------------------------
  //
  // Here rather than on the tenant API because prompts are the deployment's: a
  // tenant that could rewrite its own prompt could rewrite its way past every
  // threshold the release gate depends on (ADR-0040).

  const promptKey = z.object({ key: z.string().min(1).max(60) });
  const promptVersion = z.object({ key: z.string().min(1).max(60), version: z.coerce.number().int().min(1) });

  app.get('/ai/prompts', async () => {
    const prompts = await promptService.listPrompts();
    return {
      data: prompts.map((prompt) => ({
        key: prompt.key,
        capability: prompt.capability,
        name: prompt.name,
        currentVersion: prompt.currentVersion,
        versions: prompt.versions.map((version) => ({
          version: version.version,
          status: version.status,
          score: version.score,
          evaluatedAt: version.evaluatedAt?.toISOString() ?? null,
          changeNote: version.changeNote,
        })),
      })),
    };
  });

  app.get('/ai/prompts/:key', async (request) => {
    const { key } = promptKey.parse(request.params);
    return promptService.getPrompt(key);
  });

  app.post('/ai/prompts/:key/versions', async (request, reply) => {
    const ctx = contextOf(request);
    const { key } = promptKey.parse(request.params);
    const created = await promptService.savePromptVersion(ctx, key, promptService.promptVersionSchema.strict().parse(request.body));
    reply.code(201);
    return { key, version: created.version, status: created.status };
  });

  /** Runs the version against its dataset. Costs money, and says how much. */
  app.post('/ai/prompts/:key/versions/:version/evaluate', async (request) => {
    const ctx = contextOf(request);
    const { key, version } = promptVersion.parse(request.params);
    const run = await evalService.runEvaluation(ctx, key, version);
    return {
      key,
      version,
      score: run.score,
      threshold: run.threshold,
      passed: run.passed,
      cost: formatMicros(run.costMicros),
      cases: run.cases,
    };
  });

  app.post('/ai/prompts/:key/versions/:version/promote', async (request) => {
    const ctx = contextOf(request);
    const { key, version } = promptVersion.parse(request.params);
    return promptService.promotePrompt(ctx, key, version);
  });

  app.get('/ai/prompts/:key/runs', async (request) => {
    const { key } = promptKey.parse(request.params);
    const runs = await evalService.listRuns(key);
    return {
      data: runs.map((run) => ({
        id: run.id,
        datasetKey: run.datasetKey,
        model: run.model,
        score: run.score,
        threshold: run.threshold,
        passed: run.passed,
        cost: formatMicros(run.costMicros),
        createdAt: run.createdAt.toISOString(),
      })),
    };
  });

  app.get('/ai/datasets', async () => ({ data: await evalService.listDatasets() }));

  app.get('/metrics-snapshot', async () => metrics.snapshot());

  /**
   * What is wrong with this deployment that nobody would otherwise see (D24,
   * Y-M7; SPEC v3 §6.5): every service still signing with the public
   * development secret, or with a short one, from `ops:config-warnings`, and
   * the nightly demo build failing three times running, from `ops:demo`.
   * `{ data: [{ service, codes, at, failure? }] }`, sorted by service; empty
   * when all is well. The console's platform layout shows it as banners.
   *
   * Behind the same hook as everything here: the list names services and
   * failures, which is operator business, never a tenant's.
   */
  app.get('/deployment-warnings', async () => ({ data: await readDeploymentWarnings(cache()) }));
}
