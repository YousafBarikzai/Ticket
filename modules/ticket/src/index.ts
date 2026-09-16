/**
 * MOD-04 Ticket and interaction core — public interface.
 *
 * Other modules may import from here and nowhere else inside this package
 * (docs/architecture/04 §3). Anything not exported is internal and may change
 * without notice to other squads.
 */
export { ticketManifest } from './manifest.js';
export * as ticketService from './service/ticket-service.js';
export * as fieldService from './service/field-service.js';
export {
  fieldSchema,
  CLASSIFICATIONS,
  FIELD_TYPES,
  type Classification,
  type FieldInput,
  type FieldRow,
  type FieldType,
  type Reader,
} from './service/field-service.js';
export {
  STATES,
  CANONICAL_STATES,
  allowedTransitions,
  assertTransition,
  canTransition,
  categoryOf,
  effectsOf,
  isRequesterTransition,
  requiresAdministratorOverride,
  type StateDefinition,
  type TransitionEffects,
} from './domain/state-machine.js';
export { importTicketSchema, importCommentSchema, importTicket, importComments, type ImportTicketInput, type ImportCommentInput } from './service/ticket-service.js';
export type {
  ChannelTicketInput,
  AutomatedChange,
  AutomationOutcome,
  AutomationProvenance,
} from './service/ticket-service.js';
export type { TicketRow, ListFilter } from './repo/ticket-repo.js';
import './handlers/index.js';
