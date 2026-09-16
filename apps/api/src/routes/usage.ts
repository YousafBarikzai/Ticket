import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authz } from '@itsm/platform';
import { METERS, METER_CATALOGUE, describeMeter, linesFor, planService, setSoftLimit, usageService } from '@itsm/module-tenancy';
import { contextOf } from '../plugins/context.js';

/**
 * What this tenant is using, and the one thing it may change about its own
 * limits.
 *
 * The plan itself is read-only here: a tenant sees which plan it is on and
 * what that allows, and moving between plans is the platform console's
 * (ADR-0038). Everything is reported in both the raw figure and a form a
 * person can read, because "53687091200" is not an answer to "how much
 * storage am I using".
 */
export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/usage', async (request) => {
    const ctx = contextOf(request);
    authz.require(ctx, 'tenant.usage.read');
    const usage = await usageService.usageFor(ctx);
    const plan = usage.planKey === 'none' ? null : await planService.getPlan(usage.planKey).catch(() => null);

    return {
      plan: plan ? { key: plan.key, name: plan.name, description: plan.description } : null,
      meters: usage.meters.map((meter) => ({
        meter: meter.meter,
        description: METER_CATALOGUE[meter.meter].description,
        unit: METER_CATALOGUE[meter.meter].unit,
        shape: METER_CATALOGUE[meter.meter].shape,
        period: meter.periodKey,
        value: Number(meter.value),
        display: describeMeter(meter.meter, meter.value),
        state: meter.state,
        soft: meter.lines.soft === null ? null : Number(meter.lines.soft),
        hard: meter.lines.hard === null ? null : Number(meter.lines.hard),
      })),
    };
  });

  /**
   * Brings a warning forward, or pushes it back as far as the hard line.
   * Refused above it, because a warning nobody can reach before the refusal
   * is a warning that does not exist.
   */
  app.put('/usage/limits/:meter', async (request) => {
    const ctx = contextOf(request);
    const { meter } = z.object({ meter: z.enum(METERS) }).parse(request.params);
    const body = z.object({ soft: z.number().int().min(0).nullable() }).strict().parse(request.body);
    await setSoftLimit(ctx, { meter, soft: body.soft });
    const { lines, planKey } = await linesFor(ctx.tenantId);
    return { meter, planKey, soft: lines[meter].soft === null ? null : Number(lines[meter].soft), hard: lines[meter].hard === null ? null : Number(lines[meter].hard) };
  });
}
