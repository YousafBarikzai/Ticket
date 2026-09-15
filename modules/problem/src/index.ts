/** MOD-08-E2 Problem management (PH-4) — public interface. */
export { problemManifest } from './manifest.js';
export * as problemService from './service/problem-service.js';
export * as knownErrorService from './service/known-error-service.js';
export {
  RAISED_FROM,
  createProblem,
  createProblemIn,
  createProblemSchema,
  getProblem,
  linkSchema,
  linkTickets,
  listProblems,
  retireWorkaround,
  transition,
  transitionSchema,
  unlinkTicket,
  workaroundLive,
} from './service/problem-service.js';
export {
  listKnownErrors,
  publishKnownError,
  publishSchema,
  retireKnownError,
} from './service/known-error-service.js';
export {
  PROBLEM_STATES,
  RECURRENCE_THRESHOLD,
  STATES,
  assertTransition,
  canTransition,
  isProblemState,
  retiresWorkaround,
  type ProblemState,
  type StateDefinition,
} from './domain/lifecycle.js';
export { findRecurrences, type Recurrence } from './jobs/recurrence-sweep.js';
import './handlers/index.js';
import './jobs/recurrence-sweep.js';
