import { z } from 'zod';
import { exprSchema } from '@itsm/contracts';

/**
 * The workflow graph an administrator publishes (docs/architecture/11 §2).
 *
 * A closed set of node types over a JSON graph, interpreted rather than
 * generated (ADR-0009). Deliberately not a scripting language: an automation
 * engine that can run arbitrary code inherits every question about sandboxing,
 * resource limits and audit, and answers none of them well.
 */

const nodeKey = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/, 'lowercase letters, digits and hyphens');

/** `{{path}}` or a literal. Resolved against the run context at execution. */
const templated = z.string().max(2000);

const baseNode = { key: nodeKey, label: z.string().max(120).optional() };

export const nodeSchema = z.discriminatedUnion('type', [
  z.object({ ...baseNode, type: z.literal('condition'), when: exprSchema }).strict(),
  z
    .object({
      ...baseNode,
      type: z.literal('setField'),
      field: z.enum(['priority', 'impact', 'urgency', 'categoryId', 'serviceId', 'groupId', 'assigneeId']),
      value: templated,
    })
    .strict(),
  z.object({ ...baseNode, type: z.literal('assign'), groupId: z.string().uuid().optional(), assigneeId: templated.optional() }).strict(),
  z.object({ ...baseNode, type: z.literal('changeStatus'), status: z.string().min(1).max(40), reason: z.string().max(200).optional() }).strict(),
  z
    .object({
      ...baseNode,
      type: z.literal('createTask'),
      taskKey: z.string().min(1).max(60),
      title: templated,
      assigneeId: templated.optional(),
      groupId: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ ...baseNode, type: z.literal('approval'), policyKey: z.string().min(1).max(60), onTimeoutKey: nodeKey.optional() }).strict(),
  z
    .object({
      ...baseNode,
      type: z.literal('wait'),
      /** One of the two, checked below: a timer, or an event to wait for. */
      duration: z.string().regex(/^P/).optional(),
      event: z.string().min(1).max(60).optional(),
      when: exprSchema.optional(),
      timeout: z.string().regex(/^P/).optional(),
      onTimeoutKey: nodeKey.optional(),
    })
    .strict(),
  z
    .object({
      ...baseNode,
      type: z.literal('notify'),
      template: z.string().min(1).max(60),
      to: z.enum(['requester', 'assignee', 'group', 'watchers']),
    })
    .strict(),
  z
    .object({
      ...baseNode,
      type: z.literal('action'),
      action: z.string().min(1).max(120),
      input: z.record(templated).default({}),
      retry: z.object({ max: z.number().int().min(0).max(10) }).optional(),
    })
    .strict(),
  z.object({ ...baseNode, type: z.literal('end'), status: z.string().max(40).optional() }).strict(),
]);

export type WorkflowNode = z.infer<typeof nodeSchema>;
export type NodeType = WorkflowNode['type'];

export const edgeSchema = z
  .object({ from: nodeKey, to: nodeKey, when: exprSchema.optional(), label: z.string().max(80).optional() })
  .strict();
export type WorkflowEdge = z.infer<typeof edgeSchema>;

export const triggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), event: z.string().min(1).max(60), when: exprSchema.optional() }).strict(),
  z.object({ kind: z.literal('manual') }).strict(),
  z.object({ kind: z.literal('rule') }).strict(),
]);
export type WorkflowTrigger = z.infer<typeof triggerSchema>;

export const MAX_NODES = 200;

export const graphSchema = z
  .object({
    schemaVersion: z.literal(1),
    trigger: triggerSchema,
    start: nodeKey,
    nodes: z.array(nodeSchema).min(1).max(MAX_NODES),
    edges: z.array(edgeSchema).max(MAX_NODES * 4).default([]),
  })
  .strict();

export type WorkflowGraph = z.infer<typeof graphSchema>;

/**
 * Node types this phase cannot carry out, with the module that delivers them.
 *
 * Refused at publish rather than dropped at run time, the same as the rules
 * engine's action set: a workflow that silently skips a step is worse than one
 * that refuses to go live, because the administrator believes it is working
 * and the step it skipped is usually the one that mattered.
 */
export const NODES_NOT_YET_AVAILABLE: Partial<Record<NodeType, string>> = {
  // `action` was here until PH-4 delivered the integration gateway.
};

/** Node types that end a branch: nothing may follow them. */
export const TERMINAL_NODES: ReadonlySet<NodeType> = new Set<NodeType>(['end']);

/** Node types that park the run rather than completing in the same job. */
export const PARKING_NODES: ReadonlySet<NodeType> = new Set<NodeType>(['wait', 'approval']);

export function parseGraph(input: unknown): WorkflowGraph {
  return graphSchema.parse(input);
}

/**
 * The templated fields of a node, as [field, template] pairs.
 *
 * Kept next to the node schema rather than in the validator, so that adding a
 * node type with a templated field and forgetting to validate it is one edit
 * rather than two.
 */
export function placeholderFields(node: WorkflowNode): [string, string][] {
  switch (node.type) {
    case 'setField':
      return [['value', node.value]];
    case 'assign':
      return node.assigneeId ? [['assigneeId', node.assigneeId]] : [];
    case 'createTask':
      return [['title', node.title], ...(node.assigneeId ? ([['assigneeId', node.assigneeId]] as [string, string][]) : [])];
    case 'action':
      return Object.entries(node.input);
    case 'condition':
    case 'changeStatus':
    case 'approval':
    case 'wait':
    case 'notify':
    case 'end':
      return [];
  }
}
