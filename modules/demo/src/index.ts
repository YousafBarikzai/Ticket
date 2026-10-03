/**
 * MOD-25 The shared demo — public interface.
 *
 * Deliberately small and light. The API and the worker both import this
 * module through `@itsm/runtime`, and only the worker's build job may load
 * the planner, the parts and the content library — lazily, from the job
 * handler (A4 §2.2). So nothing below reaches `plan/plan.ts`, `plan/library.ts`
 * or `content/**`; the planner's types are exported as types only, which the
 * compiler erases.
 */
export { demoManifest, DEMO_JOB_NAMES, type DemoPurgeJobPayload, type DemoResetJobPayload } from './manifest.js';
export { DEMO_GENERATOR_VERSION, demoConfig, demoConfigFrom, type DemoConfig } from './config.js';
import './jobs.js';
