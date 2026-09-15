/** MOD-08-E1 Major incident management (PH-4) — public interface. */
export { incidentManifest } from './manifest.js';
export * as majorIncidentService from './service/major-incident-service.js';
export * as reviewService from './service/review-service.js';
export {
  AUDIENCES,
  UPDATE_KINDS,
  declare,
  declareSchema,
  getIncident,
  listIncidents,
  postUpdate,
  reviewRequiredFor,
  rolesSchema,
  setRoles,
  transition,
  transitionSchema,
  updateEntrySchema,
  type DeclareInput,
} from './service/major-incident-service.js';
export {
  actionSchema,
  actionUpdateSchema,
  addAction,
  closeWithoutReview,
  getReview,
  publishAndClose,
  reviewSchema,
  saveReview,
  updateAction,
} from './service/review-service.js';
export {
  DEFAULT_UPDATE_INTERVAL,
  INCIDENT_STATES,
  REVIEW_REQUIRED,
  SEVERITIES,
  STATES,
  assertTransition,
  canTransition,
  effectsOf,
  isIncidentState,
  type IncidentState,
  type Severity,
  type StateDefinition,
} from './domain/lifecycle.js';
export { sweepOverdueComms } from './jobs/comms-sweep.js';
import './jobs/comms-sweep.js';
