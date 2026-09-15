import { type TenantContext, newId, transaction } from '@itsm/platform';
import type { WorkflowGraph } from '../domain/definition.js';

/**
 * Reference workflows a tenant starts with (docs/architecture/11 §7).
 *
 * Published rather than draft, because a draft nobody publishes is a feature
 * nobody uses — and each one is chosen to be obviously safe: they chase, remind
 * and close, and none of them can send anything to a customer or touch another
 * system. A seeded workflow that emailed people on day one would be the last
 * time anybody trusted the seed.
 *
 * They also serve as the engine's acceptance tests: each exercises a different
 * node type, so a tenant that provisions successfully has proved the engine
 * parses, validates and publishes every shape it supports.
 */

interface ReferenceWorkflow {
  key: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
}

export const REFERENCE_WORKFLOWS: ReferenceWorkflow[] = [
  {
    key: 'auto-close-resolved',
    name: 'Close a resolved ticket nobody came back about',
    description:
      'Waits after resolution and closes the ticket if the requester has not reopened it. The wait is the point: closing immediately denies somebody the chance to say it is not fixed.',
    graph: {
      schemaVersion: 1,
      trigger: {
        kind: 'event',
        event: 'ticket.status.changed',
        when: { eq: [{ var: 'to' }, 'resolved'] },
      },
      start: 'settle',
      nodes: [
        { key: 'settle', type: 'wait', label: 'Give the requester time to reopen', duration: 'P5D' },
        { key: 'still-resolved', type: 'condition', label: 'Is it still resolved?', when: { eq: [{ var: 'ticket.status' }, 'resolved'] } },
        { key: 'close', type: 'changeStatus', label: 'Close it', status: 'closed', reason: 'Closed automatically after five days with no reply' },
        { key: 'done', type: 'end' },
      ],
      edges: [
        { from: 'settle', to: 'still-resolved' },
        { from: 'still-resolved', to: 'close', when: { eq: [{ var: 'still-resolved.result' }, true] }, label: 'still resolved' },
        { from: 'still-resolved', to: 'done', when: { ne: [{ var: 'still-resolved.result' }, true] }, label: 'reopened' },
        { from: 'close', to: 'done' },
      ],
    },
  },
  {
    key: 'vip-escalation',
    name: 'Raise a VIP incident and tell the lead',
    description:
      'A VIP raising an incident gets the priority the tier entitles them to, and the team is told rather than left to notice.',
    graph: {
      schemaVersion: 1,
      trigger: {
        kind: 'event',
        event: 'ticket.created',
        when: { and: [{ eq: [{ var: 'type' }, 'incident'] }, { eq: [{ var: 'requesterVip' }, true] }] },
      },
      start: 'raise',
      nodes: [
        { key: 'raise', type: 'setField', label: 'Raise the priority', field: 'priority', value: 'P1' },
        { key: 'tell-them', type: 'notify', label: 'Tell the assignee', template: 'ticket.assigned', to: 'assignee' },
        { key: 'done', type: 'end' },
      ],
      edges: [
        { from: 'raise', to: 'tell-them' },
        { from: 'tell-them', to: 'done' },
      ],
    },
  },
  {
    key: 'request-fulfilment',
    name: 'Fulfil an approved request',
    description:
      'The shape most fulfilment workflows take: ask whoever must approve, do the work if they say yes, and tell the requester either way. It exercises the approval node, which is the one that makes a workflow wait for a person.',
    graph: {
      schemaVersion: 1,
      trigger: { kind: 'rule' },
      start: 'approve',
      nodes: [
        { key: 'approve', type: 'approval', label: 'Ask for approval', policyKey: 'request-approval', onTimeoutKey: 'give-up' },
        { key: 'do-the-work', type: 'createTask', label: 'Raise the fulfilment task', taskKey: 'fulfil', title: 'Fulfil the approved request' },
        { key: 'tell-requester', type: 'notify', label: 'Tell the requester', template: 'ticket.updated', to: 'requester' },
        { key: 'give-up', type: 'changeStatus', label: 'Nobody approved in time', status: 'on_hold', reason: 'Waiting for an approval that did not arrive' },
        { key: 'done', type: 'end' },
      ],
      edges: [
        { from: 'approve', to: 'do-the-work', when: { eq: [{ var: 'approve.decision' }, 'approved'] }, label: 'approved' },
        { from: 'approve', to: 'tell-requester', when: { eq: [{ var: 'approve.decision' }, 'rejected'] }, label: 'rejected' },
        { from: 'approve', to: 'do-the-work', when: { eq: [{ var: 'approve.decision' }, 'not_required'] }, label: 'no policy applies' },
        { from: 'do-the-work', to: 'tell-requester' },
        { from: 'tell-requester', to: 'done' },
        { from: 'give-up', to: 'done' },
      ],
    },
  },
];

export async function seedWorkflowDefaults(ctx: TenantContext): Promise<void> {
  await transaction(ctx, async (tx) => {
    for (const reference of REFERENCE_WORKFLOWS) {
      const existing = await tx.workflowDefinition.findFirst({ where: { key: reference.key } });
      if (existing) continue;

      const definitionId = newId();
      const versionId = newId();
      const now = new Date();

      await tx.workflowDefinition.create({
        data: {
          id: definitionId,
          tenantId: ctx.tenantId,
          key: reference.key,
          name: reference.name,
          description: reference.description,
          status: 'published',
          currentVersionId: versionId,
        },
      });

      await tx.workflowVersion.create({
        data: {
          id: versionId,
          tenantId: ctx.tenantId,
          definitionId,
          version: 1,
          graph: reference.graph as never,
          status: 'published',
          changeNote: 'Shipped with the platform',
          publishedAt: now,
        },
      });
    }
  });
}
