import { newId, transaction, type TenantContext } from '@itsm/platform';

/**
 * The rules a new tenant starts with.
 *
 * All three are published, because a tenant with an empty rules table looks
 * broken to an administrator who has just been told the platform has a rules
 * engine. They are also the three worked examples the admin UI links to, so the
 * quickest way to learn the syntax is to open one that already works.
 */
export const DEFAULT_RULES = [
  {
    key: 'major-incident-p1',
    name: 'Treat a reported outage as P1',
    description: 'A ticket whose impact and urgency are both high is a major incident and is raised to P1 immediately.',
    event: 'ticket.created',
    order: 10,
    mode: 'continue',
    conditions: {
      and: [
        { eq: [{ var: 'ticket.impact' }, 'high'] },
        { eq: [{ var: 'ticket.urgency' }, 'high'] },
      ],
    },
    actions: [
      { type: 'setPriority', priority: 'P1', reason: 'High impact and high urgency reported at creation' },
      { type: 'addTag', tag: 'major-incident' },
    ],
  },
  {
    key: 'vip-requester',
    name: 'Flag a ticket raised by a VIP',
    description: 'Tags the ticket so the workbench can surface it, without changing the priority the matrix chose.',
    event: 'ticket.created',
    order: 20,
    mode: 'continue',
    conditions: { eq: [{ var: 'requester.vip' }, true] },
    actions: [{ type: 'addTag', tag: 'vip' }],
  },
  {
    key: 'requester-replied',
    name: 'Bring a waiting ticket back to the queue',
    description:
      'When the requester replies to a ticket that was waiting on them, it goes back to in progress so it stops looking answered.',
    event: 'ticket.comment.added',
    order: 30,
    mode: 'stop',
    conditions: {
      and: [
        { eq: [{ var: 'comment.isFromRequester' }, true] },
        { eq: [{ var: 'comment.visibility' }, 'public'] },
        { eq: [{ var: 'ticket.status' }, 'pending_requester'] },
      ],
    },
    actions: [{ type: 'setStatus', status: 'in_progress', reason: 'The requester replied' }],
  },
] as const;

export async function seedDefaultRules(ctx: TenantContext): Promise<{ created: number }> {
  return transaction(ctx, async (tx) => {
    let created = 0;
    for (const rule of DEFAULT_RULES) {
      const existing = await tx.businessRule.findFirst({ where: { key: rule.key } });
      if (existing) continue;

      const record = await tx.businessRule.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          key: rule.key,
          name: rule.name,
          description: rule.description,
          event: rule.event,
          conditions: rule.conditions as never,
          actions: rule.actions as never,
          order: rule.order,
          mode: rule.mode,
          status: 'published',
          version: 1,
          publishedAt: new Date(),
        },
      });
      // A published rule always has a version row: an application must be able
      // to name the exact text that ran, including for the seeded ones.
      await tx.businessRuleVersion.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          ruleId: record.id,
          version: 1,
          snapshot: {
            key: rule.key,
            name: rule.name,
            event: rule.event,
            conditions: rule.conditions,
            actions: rule.actions,
            order: rule.order,
            mode: rule.mode,
          } as never,
        },
      });
      created += 1;
    }
    return { created };
  });
}
