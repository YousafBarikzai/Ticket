/** MOD-08-E3 Change management (PH-4) — public interface. */
export { changeManifest } from './manifest.js';
export * as changeService from './service/change-service.js';
export * as windowService from './service/window-service.js';
export {
  approveRetrospectively,
  createChange,
  createChangeSchema,
  getChange,
  listChanges,
  owedRetrospectives,
  scheduleChange,
  scheduleSchema,
  submitChange,
  transition,
  transitionSchema,
} from './service/change-service.js';
export {
  createTemplate,
  createWindow,
  listTemplates,
  listWindows,
  publishTemplate,
  retireWindow,
  templateSchema,
  windowSchema,
} from './service/window-service.js';
export {
  CHANGE_KINDS,
  CHANGE_STATES,
  CLOSE_CODES,
  STATES,
  assertTransition,
  canTransition,
  isChangeState,
  onSubmission,
  succeeded,
  type ChangeKind,
  type ChangeState,
  type CloseCode,
} from './domain/lifecycle.js';
export { appliesTo, checkSchedule, covers, overlaps, type ScheduleVerdict, type Window } from './domain/windows.js';
import './handlers/index.js';
