import { newId, transaction, type TenantContext } from '@itsm/platform';

/**
 * The approval policy a tenant starts with.
 *
 * One worked example, published: a request needs the requester's line manager.
 * It is the policy most tenants want first, and it is the one that demonstrates
 * the two things people get wrong when writing their own — resolving an approver
 * by relationship rather than by name, and the requester being excluded from
 * their own approval.
 */
export const DEFAULT_POLICIES = [
  {
    key: 'manager-approval',
    name: 'Line manager approves',
    description: "A request is approved by the requester's line manager. The requester can never approve their own.",
    subjectType: 'request',
    match: { always: true },
    specificity: 0,
    steps: [
      {
        name: 'Line manager',
        approvers: [{ kind: 'manager', levels: 1 }],
        quorum: 1,
        timeout: 'P2D',
        onTimeout: 'escalate',
      },
    ],
  },
] as const;

export async function seedApprovalDefaults(ctx: TenantContext): Promise<{ created: number }> {
  return transaction(ctx, async (tx) => {
    let created = 0;
    for (const policy of DEFAULT_POLICIES) {
      const existing = await tx.approvalPolicy.findFirst({ where: { key: policy.key } });
      if (existing) continue;

      const record = await tx.approvalPolicy.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          key: policy.key,
          name: policy.name,
          description: policy.description,
          subjectType: policy.subjectType,
          match: policy.match as never,
          specificity: policy.specificity,
          steps: policy.steps as never,
          status: 'published',
          version: 1,
          publishedAt: new Date(),
        },
      });
      await tx.approvalPolicyVersion.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          policyId: record.id,
          version: 1,
          snapshot: { steps: policy.steps, match: policy.match, name: policy.name } as never,
        },
      });
      created += 1;
    }
    return { created };
  });
}
