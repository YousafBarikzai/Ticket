'use server';

import { refresh } from 'next/cache';
import type { Problem } from '@itsm/ui';
import { holds } from '../../../permissions.js';
import { problemFrom } from '../../../problem.js';
import { loadActor, type Actor } from '../../../server/session.js';

/**
 * The platform's writes, as Server Actions (SPEC §3.6 rule 7, §6.1 `/tenants`).
 *
 * Server Actions because `/api/platform/v1/*` is not reachable from the
 * browser — the BFF proxy forwards `/api/v1` only — and the operator's token
 * never leaves the server. Each action **checks again** that the caller is a
 * platform operator: an action is a POST endpoint that anyone holding its id
 * can call, whatever page they found it on, so the `(platform)` layout's
 * 404 protects the pages and nothing else. The API refuses these calls
 * without `platform.tenant.manage` too; this is the console not relaying them.
 *
 * Every argument is checked here as well, for the same reason: it arrives
 * from a request, not from the page that was meant to send it.
 */

export type PlatformActionResult = { readonly ok: true } | { readonly ok: false; readonly problem: Problem };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const REGION = /^[a-z][a-z0-9-]{1,30}$/;

/** Not found, not forbidden: the same answer the section's pages give a non-operator. */
const NOT_FOUND: PlatformActionResult = { ok: false, problem: { status: 404, title: 'Not found' } };

function invalid(detail: string): PlatformActionResult {
  return { ok: false, problem: { status: 422, title: 'Check what was entered', detail } };
}

/** The caller, when they are a platform operator now — asked of the API afresh, not remembered from the page. */
async function operator(): Promise<Actor | null> {
  const load = await loadActor();
  if (load.kind !== 'ok' || !holds(load.me, 'platform.tenant.manage')) return null;
  return load;
}

async function run(write: (actor: Actor) => Promise<unknown>): Promise<PlatformActionResult> {
  const actor = await operator();
  if (!actor) return NOT_FOUND;
  try {
    await write(actor);
  } catch (error) {
    return { ok: false, problem: problemFrom(error) };
  }
  refresh();
  return { ok: true };
}

export async function suspendTenant(tenantId: string, reason: string): Promise<PlatformActionResult> {
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return NOT_FOUND;
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why === '' || why.length > 1000) return invalid('Give a reason of up to 1,000 characters.');
  return run((actor) => actor.api.platform.suspendTenant(tenantId, why));
}

export async function resumeTenant(tenantId: string): Promise<PlatformActionResult> {
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return NOT_FOUND;
  return run((actor) => actor.api.platform.resumeTenant(tenantId));
}

export async function changePlan(tenantId: string, planKey: string): Promise<PlatformActionResult> {
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return NOT_FOUND;
  if (typeof planKey !== 'string' || !PLAN_KEY.test(planKey)) return invalid('Choose a plan.');
  return run((actor) => actor.api.platform.assignPlan(tenantId, planKey));
}

export async function setAiRegions(tenantId: string, regions: readonly string[]): Promise<PlatformActionResult> {
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return NOT_FOUND;
  if (!Array.isArray(regions) || regions.length > 10 || regions.some((region) => typeof region !== 'string' || !REGION.test(region))) {
    return invalid('List at most 10 regions, each in lower-case letters, digits and hyphens.');
  }
  return run((actor) => actor.api.platform.setAiRegions(tenantId, [...regions]));
}
