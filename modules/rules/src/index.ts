/**
 * MOD-06 Workflow and rules (PH-2 business rules slice) — public interface.
 *
 * Other modules may import from here and nowhere else inside this package
 * (docs/architecture/04 §3).
 */
export { rulesManifest } from './manifest.js';
export * as ruleService from './service/rule-service.js';
export { decide, effectsOf, type Decision, type LoadedRule, type RuleEffects } from './service/engine.js';
export { factsForTicket, FACT_PATHS, type TicketFacts } from './service/facts.js';
export {
  RULE_EVENTS,
  SETTABLE_FIELDS,
  EXCLUSIVE_ACTIONS,
  ACTIONS_NOT_YET_AVAILABLE,
  actionSchema,
  ruleDefinitionSchema,
  conflictKey,
  type RuleAction,
  type RuleDefinition,
  type RuleEvent,
} from './domain/actions.js';
export { seedDefaultRules } from './seed/default-rules.js';
import './handlers/index.js';
