/** MOD-21 Tenancy, licensing and billing — public interface. */
export { tenancyManifest } from './manifest.js';
export * as tenantService from './service/tenant-service.js';
export { purgeTenant } from './service/tenant-service.js';
export { registerSeedStep, registeredSeedSteps, contextForTenant } from './service/tenant-service.js';
export * as planService from './service/plan-service.js';
export * as usageService from './service/usage-service.js';
export { planSchema, softOverrideSchema, listPlans, getPlan, savePlan, assignPlan, linesFor, setSoftLimit, type PlanInput } from './service/plan-service.js';
export {
  bumpApiCalls,
  flushApiCalls,
  measure,
  note,
  recompute,
  set as setMeter,
  tenantsAwaitingFlush,
  usageFor,
  verdictFor,
  type MeterRow,
} from './service/usage-service.js';
export {
  METERS,
  METER_CATALOGUE,
  crossings,
  describe as describeMeter,
  isMeter,
  periodFor,
  refusalMessage,
  stateFor,
  type Lines,
  type Meter,
  type State,
} from './domain/meters.js';
export { DEFAULT_PLANS, seedPlans } from './seed/plans.js';
export { invalidateVerdicts, verdictKey, VERDICT_TTL_SECONDS } from './service/verdict-cache.js';
import './handlers/index.js';
import './notifications.js';
import './jobs/index.js';
