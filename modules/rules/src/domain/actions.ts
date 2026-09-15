import { z } from 'zod';
import { exprSchema } from '@itsm/expr';

/**
 * The closed action set (docs/architecture/11 §1).
 *
 * "Closed" is the security property, not a simplification: a rule is written by
 * a tenant administrator through the admin UI, so the engine must not be able to
 * express anything that administrator should not already be allowed to do. A
 * rule cannot run code, call an arbitrary URL or read another tenant's data,
 * because there is no action in this list that does any of those things.
 *
 * Adding an action here is therefore a deliberate act with a permission
 * consequence, which is why the set lives in its own file with its own tests
 * rather than inline in the engine.
 */

export const RULE_EVENTS = [
  'ticket.created',
  'ticket.updated',
  'ticket.comment.added',
  'ticket.status.changed',
  'request.submitted',
  'schedule.tick',
] as const;
export type RuleEvent = (typeof RULE_EVENTS)[number];

/** Fields a rule may set directly. Deliberately not every column. */
export const SETTABLE_FIELDS = [
  'impact',
  'urgency',
  'categoryId',
  'subcategoryId',
  'serviceId',
  'orgId',
  'locationId',
  'dueAt',
] as const;

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setField'), field: z.enum(SETTABLE_FIELDS), value: scalar }),
  z.object({ type: z.literal('setCategory'), categoryId: z.string().uuid(), subcategoryId: z.string().uuid().optional() }),
  z.object({ type: z.literal('setPriority'), priority: z.enum(['P1', 'P2', 'P3', 'P4']), reason: z.string().max(200) }),
  z.object({ type: z.literal('setStatus'), status: z.string(), reason: z.string().max(200).optional() }),
  z.object({ type: z.literal('assignGroup'), groupId: z.string().uuid() }),
  z.object({ type: z.literal('assignStrategy'), strategy: z.enum(['round_robin', 'least_loaded', 'skill']) }),
  z.object({ type: z.literal('addWatcher'), userId: z.string().uuid() }),
  z.object({ type: z.literal('addTag'), tag: z.string().min(1).max(40) }),
  z.object({ type: z.literal('sendNotification'), template: z.string().min(1), to: z.enum(['requester', 'assignee', 'group', 'watchers']) }),
  z.object({ type: z.literal('linkDuplicate'), of: z.string().uuid() }),
  z.object({ type: z.literal('startWorkflow'), definitionKey: z.string().min(1) }),
]);
export type RuleAction = z.infer<typeof actionSchema>;
export type ActionType = RuleAction['type'];

/**
 * Actions the schema accepts but this phase cannot carry out, with the module
 * that will deliver them.
 *
 * They are rejected at publish rather than dropped at run time: a rule that
 * silently does nothing is worse than one that refuses to go live, because the
 * administrator believes it is working.
 */
export const ACTIONS_NOT_YET_AVAILABLE: Partial<Record<ActionType, string>> = {
  assignStrategy: 'MOD-20 Workload and routing (PH-4)',
  // `startWorkflow` was here until PH-3 delivered the engine.
};

/**
 * Action types that are mutually exclusive across rules: once one rule has set
 * the ticket's priority, a later rule's `setPriority` is recorded as skipped
 * rather than applied (docs/architecture/11 §1, "the first matching rule per
 * action type wins").
 *
 * Additive actions — watchers, tags, notifications — are not in this map,
 * because two rules each adding a watcher is not a conflict.
 */
export const EXCLUSIVE_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'setField',
  'setCategory',
  'setPriority',
  'setStatus',
  'assignGroup',
  'assignStrategy',
]);

export const ruleDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/, 'lower case, digits and hyphens'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  event: z.enum(RULE_EVENTS),
  conditions: exprSchema,
  actions: z.array(actionSchema).min(1).max(20),
  order: z.number().int().min(0).max(10_000).default(100),
  mode: z.enum(['stop', 'continue']).default('continue'),
  orgId: z.string().uuid().nullable().optional(),
});
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;

/**
 * The key an exclusive action competes on. Two `setField` actions only conflict
 * when they set the same field, so the field is part of the key.
 */
export function conflictKey(action: RuleAction): string {
  return action.type === 'setField' ? `setField:${action.field}` : action.type;
}
