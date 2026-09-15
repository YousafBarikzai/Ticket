/** MOD-20 Workload and routing (PH-4) — public interface. */
export { workloadManifest } from './manifest.js';
export * as availabilityService from './service/availability-service.js';
export * as onCallService from './service/oncall-service.js';
export * as routingService from './service/routing-service.js';
export {
  AVAILABILITY_STATUSES,
  effectiveStatus,
  onShift,
  setAvailabilitySchema,
  createShiftSchema,
  assignToShiftSchema,
  shiftPatternSchema,
  shiftStateFor,
  type AvailabilityStatus,
} from './service/availability-service.js';
export { createRotationSchema, updateRotationSchema, overrideSchema, whoIsOnCall } from './service/oncall-service.js';
export {
  chooseAssignee,
  chooseAndRecord,
  createSkillSchema,
  grantSkillSchema,
  routingPolicySchema,
  markAssigned,
  type ChooseInput,
  type ChooseResult,
  type EffectivePolicy,
} from './service/routing-service.js';
export {
  route,
  type Availability,
  type Candidate,
  type RoutingDecision,
  type RoutingRequest,
  type SkillRequirement,
  type Strategy,
} from './domain/strategies.js';
export {
  RotaError,
  isOnShift,
  onCallAt,
  periodIndex,
  upcomingHandovers,
  validateShiftPattern,
  type Override,
  type RotationDefinition,
  type ShiftPattern,
} from './domain/rota.js';
import './handlers/index.js';
