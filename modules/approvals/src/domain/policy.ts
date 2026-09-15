import { z } from 'zod';
import { exprSchema } from '@itsm/expr';

/**
 * The shape of an approval policy (docs/architecture/05 §8, 09 §3).
 *
 * A step names *how* to find its approvers rather than naming people, because a
 * policy written in March must still find the right approver in November. The
 * resolution runs when the step opens, so it reflects the organisation as it is
 * on the day of the decision, not as it was on the day of the policy.
 */

// `workflow_run` joined the list in PH-3: an approval node parks its run on an
// approval, and the subject is the run rather than the ticket it is attached to
// — a run may have several approvals, and one may not be about a ticket at all.
export const SUBJECT_TYPES = ['request', 'change', 'knowledge', 'config', 'ticket', 'workflow_run'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const approverRuleSchema = z.discriminatedUnion('kind', [
  /** The requester's line manager, walking up until someone is found. */
  z.object({ kind: z.literal('manager'), levels: z.number().int().min(1).max(5).default(1) }),
  z.object({ kind: z.literal('user'), userId: z.string().uuid() }),
  z.object({ kind: z.literal('role'), roleKey: z.string().min(1) }),
  z.object({ kind: z.literal('team'), teamId: z.string().uuid() }),
  /** The named owner of the service the subject belongs to. */
  z.object({ kind: z.literal('serviceOwner') }),
]);
export type ApproverRule = z.infer<typeof approverRuleSchema>;

export const stepSchema = z.object({
  name: z.string().min(1).max(120),
  approvers: z.array(approverRuleSchema).min(1).max(10),
  /**
   * How many resolved approvers must approve. `all` is stored as 0 and resolved
   * against the actual approver count when the step opens, because the count is
   * not known when the policy is written.
   */
  quorum: z.union([z.number().int().min(1).max(50), z.literal('all')]).default(1),
  /** ISO-8601 duration; the step is escalated or auto-decided when it expires. */
  timeout: z.string().regex(/^P(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/).optional(),
  onTimeout: z.enum(['escalate', 'approve', 'reject']).default('escalate'),
  /** Only open this step when the condition holds against the subject. */
  when: exprSchema.optional(),
});
export type PolicyStep = z.infer<typeof stepSchema>;

export const policyDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/, 'lower case, digits and hyphens'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  subjectType: z.enum(SUBJECT_TYPES),
  match: exprSchema.default({ always: true }),
  specificity: z.number().int().min(0).max(1000).default(0),
  steps: z.array(stepSchema).min(1).max(10),
  orgId: z.string().uuid().nullable().optional(),
});
export type PolicyDefinition = z.infer<typeof policyDefinitionSchema>;

/**
 * Approver kinds the schema accepts but this phase cannot resolve, with the
 * module that will deliver them. Rejected at publish rather than resolving to
 * an empty list, because an approval step with no approvers either blocks
 * forever or waves everything through — both worse than refusing to go live.
 */
export const APPROVERS_NOT_YET_AVAILABLE: Partial<Record<ApproverRule['kind'], string>> = {
  serviceOwner: 'MOD-05 Service catalogue',
};

export const DECISIONS = ['approved', 'rejected'] as const;
export type Decision = (typeof DECISIONS)[number];

/**
 * Works out whether a step is settled, given its quorum and the decisions so
 * far.
 *
 * One rejection settles a step, whatever the quorum: an approval chain is a
 * series of vetoes, not a vote. Making that explicit here rather than inline in
 * the service is what stops a later change turning "three approvers, quorum two"
 * into something that can be approved over a rejection.
 */
export function settleStep(
  quorum: number,
  approverCount: number,
  decisions: { decision: string }[],
): { status: 'waiting' | 'approved' | 'rejected'; reason?: string } {
  if (decisions.some((d) => d.decision === 'rejected')) {
    return { status: 'rejected', reason: 'an approver rejected it' };
  }
  const approvals = decisions.filter((d) => d.decision === 'approved').length;
  const needed = Math.min(quorum, approverCount);
  if (approvals >= needed) return { status: 'approved' };

  // Nobody left who could still approve: the step can never reach its quorum.
  const undecided = approverCount - decisions.length;
  if (approvals + undecided < needed) {
    return { status: 'rejected', reason: 'not enough approvers remain to reach the quorum' };
  }
  return { status: 'waiting' };
}

/** `all` means everyone who was actually resolved, not a number chosen in advance. */
export function resolveQuorum(quorum: number | 'all', approverCount: number): number {
  return quorum === 'all' ? Math.max(approverCount, 1) : Math.min(quorum, Math.max(approverCount, 1));
}
