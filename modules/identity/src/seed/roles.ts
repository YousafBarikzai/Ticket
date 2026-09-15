import { newId, transaction, type TenantContext, logger } from '@itsm/platform';

/**
 * System roles, seeded per tenant from the permission matrix in Appendix B of
 * the specification.
 *
 * The matrix is data rather than prose so the generated permission tests can
 * assert it directly: for each persona and each route, an expected allow or
 * deny. A tenant may compose its own roles from the same registry.
 */

export interface SystemRole {
  key: string;
  name: string;
  description: string;
  permissions: { key: string; scope: 'own' | 'team' | 'any' }[];
}

export const SYSTEM_ROLES: SystemRole[] = [
  {
    key: 'requester',
    name: 'Requester',
    description: 'An employee who raises and follows their own requests.',
    permissions: [
      { key: 'ticket.create', scope: 'own' },
      { key: 'ticket.read', scope: 'own' },
      { key: 'ticket.transition', scope: 'own' },
      { key: 'ticket.comment.public', scope: 'own' },
      { key: 'ticket.attachment.add', scope: 'own' },
      { key: 'ticket.watch', scope: 'own' },
      { key: 'sla.read', scope: 'own' },
      { key: 'search.query', scope: 'own' },
      { key: 'notification.read', scope: 'own' },
      { key: 'identity.user.read', scope: 'own' },
      { key: 'identity.session.manage', scope: 'own' },
      { key: 'approval.read', scope: 'own' },
      { key: 'approval.decide', scope: 'own' },
      { key: 'approval.delegate', scope: 'own' },
      { key: 'catalogue.read', scope: 'own' },
      { key: 'catalogue.request', scope: 'own' },
      // Self-service means reading the answer before raising the ticket.
      { key: 'knowledge.read', scope: 'own' },
      { key: 'knowledge.feedback', scope: 'own' },
    ],
  },
  {
    key: 'agent',
    name: 'Service desk agent',
    description: 'Triages and resolves work for their teams.',
    permissions: [
      { key: 'ticket.create', scope: 'any' },
      { key: 'ticket.read', scope: 'team' },
      { key: 'ticket.update', scope: 'team' },
      { key: 'ticket.transition', scope: 'team' },
      { key: 'ticket.comment.public', scope: 'team' },
      { key: 'ticket.comment.internal', scope: 'team' },
      { key: 'ticket.assign', scope: 'team' },
      { key: 'ticket.task.manage', scope: 'team' },
      { key: 'ticket.link', scope: 'team' },
      { key: 'ticket.attachment.add', scope: 'team' },
      { key: 'ticket.watch', scope: 'team' },
      { key: 'sla.read', scope: 'team' },
      { key: 'search.query', scope: 'team' },
      { key: 'notification.read', scope: 'own' },
      { key: 'identity.user.read', scope: 'team' },
      { key: 'identity.session.manage', scope: 'own' },
      { key: 'tenant.read', scope: 'any' },
      { key: 'approval.read', scope: 'own' },
      { key: 'approval.decide', scope: 'own' },
      { key: 'approval.delegate', scope: 'own' },
      { key: 'catalogue.read', scope: 'own' },
      { key: 'catalogue.request', scope: 'own' },
      // `any` rather than `own`: internal runbooks exist for agents, and an
      // agent who cannot read them has the knowledge base of a requester.
      // Writing too — an article is usually written by whoever just worked out
      // the answer. Publishing is a lead's.
      { key: 'knowledge.read', scope: 'any' },
      { key: 'knowledge.write', scope: 'any' },
      { key: 'knowledge.feedback', scope: 'own' },
      // Reading runs answers "why did this ticket go on hold?" without asking
      // an administrator. Operating them is somebody else's.
      { key: 'workflow.read', scope: 'any' },
      // An agent says whether they are available, and sees their team's rota so
      // they know who to hand a P1 to at six in the evening.
      { key: 'workload.read', scope: 'team' },
      { key: 'workload.availability.set', scope: 'own' },
      // Reads the incident room and writes to its timeline: the scribe is
      // usually whoever has their hands free. Declaring one is a lead's, because
      // it pages people.
      { key: 'incident.major.read', scope: 'any' },
      { key: 'incident.major.command', scope: 'any' },
    ],
  },
  {
    key: 'team_lead',
    name: 'Team lead',
    description: 'Runs a support group: everything an agent can do, plus SLA control.',
    permissions: [
      { key: 'ticket.create', scope: 'any' },
      { key: 'ticket.read', scope: 'team' },
      { key: 'ticket.update', scope: 'team' },
      { key: 'ticket.transition', scope: 'team' },
      { key: 'ticket.comment.public', scope: 'team' },
      { key: 'ticket.comment.internal', scope: 'team' },
      { key: 'ticket.assign', scope: 'team' },
      { key: 'ticket.task.manage', scope: 'team' },
      { key: 'ticket.link', scope: 'team' },
      { key: 'ticket.attachment.add', scope: 'team' },
      { key: 'ticket.watch', scope: 'team' },
      { key: 'sla.read', scope: 'team' },
      { key: 'sla.override', scope: 'team' },
      { key: 'search.query', scope: 'team' },
      { key: 'notification.read', scope: 'own' },
      { key: 'identity.user.read', scope: 'team' },
      { key: 'identity.session.manage', scope: 'own' },
      { key: 'tenant.read', scope: 'any' },
      { key: 'rules.rule.read', scope: 'any' },
      { key: 'approval.read', scope: 'own' },
      { key: 'approval.decide', scope: 'own' },
      { key: 'approval.delegate', scope: 'own' },
      { key: 'approval.policy.read', scope: 'any' },
      { key: 'sla.policy.read', scope: 'any' },
      { key: 'channel.account.read', scope: 'any' },
      { key: 'channel.message.read', scope: 'any' },
      { key: 'catalogue.read', scope: 'any' },
      { key: 'catalogue.request', scope: 'own' },
      { key: 'catalogue.form.read', scope: 'any' },
      // A lead publishes: somebody close to the work should be able to correct
      // an article without waiting for an administrator.
      { key: 'knowledge.read', scope: 'any' },
      { key: 'knowledge.write', scope: 'any' },
      { key: 'knowledge.publish', scope: 'any' },
      { key: 'knowledge.feedback', scope: 'own' },
      // A lead sees and unblocks runs without being able to change what they
      // do: rescuing a stuck run at 3am is operations, editing the automation
      // is a change.
      { key: 'workflow.read', scope: 'any' },
      { key: 'workflow.operate', scope: 'any' },
      // Sees why an automation stopped, and can press retry. Writing the
      // actions themselves is an administrator's: a replay repeats a call
      // somebody already approved, where authoring one is approving a new one.
      { key: 'integration.action.read', scope: 'any' },
      { key: 'integration.action.replay', scope: 'any' },
      // A lead runs the rota day to day: marks somebody as away or departed and
      // records a swap. Writing the rota itself — the cadence, the order, the
      // shift patterns — stays an administrator's, because it changes who is
      // paged for every week to come rather than for one of them.
      { key: 'workload.read', scope: 'any' },
      { key: 'workload.availability.set', scope: 'any' },
      { key: 'workload.oncall.override', scope: 'team' },
      // Declares one, runs it, and publishes the review that closes it. A lead
      // is who is available at 3am; making this an administrator's would mean
      // nobody could declare an incident until somebody senior woke up.
      { key: 'incident.major.read', scope: 'any' },
      { key: 'incident.major.declare', scope: 'any' },
      { key: 'incident.major.command', scope: 'any' },
      { key: 'incident.review.write', scope: 'any' },
      { key: 'incident.review.publish', scope: 'any' },
    ],
  },
  {
    key: 'service_owner',
    name: 'Service owner',
    description: 'Owns services and their policies. Scoped by service or organisation assignment.',
    permissions: [
      { key: 'ticket.read', scope: 'team' },
      { key: 'ticket.comment.internal', scope: 'team' },
      { key: 'sla.read', scope: 'team' },
      { key: 'search.query', scope: 'team' },
      { key: 'notification.read', scope: 'own' },
      { key: 'identity.user.read', scope: 'team' },
      { key: 'identity.session.manage', scope: 'own' },
      { key: 'admin.setting.read', scope: 'any' },
      { key: 'tenant.read', scope: 'any' },
      { key: 'knowledge.read', scope: 'any' },
      { key: 'knowledge.feedback', scope: 'own' },
      { key: 'workload.read', scope: 'any' },
      // Owns the service that broke, so writes the review; publishing it stays
      // with whoever ran the incident.
      { key: 'incident.major.read', scope: 'any' },
      { key: 'incident.review.write', scope: 'any' },
    ],
  },
  {
    key: 'administrator',
    name: 'Administrator',
    description: 'Configures the platform for this tenant.',
    permissions: [
      { key: 'ticket.create', scope: 'any' },
      { key: 'ticket.read', scope: 'any' },
      { key: 'ticket.update', scope: 'any' },
      { key: 'ticket.transition', scope: 'any' },
      { key: 'ticket.comment.public', scope: 'any' },
      { key: 'ticket.comment.internal', scope: 'any' },
      { key: 'ticket.assign', scope: 'any' },
      { key: 'ticket.task.manage', scope: 'any' },
      { key: 'ticket.link', scope: 'any' },
      { key: 'ticket.attachment.add', scope: 'any' },
      { key: 'ticket.watch', scope: 'any' },
      { key: 'ticket.config.manage', scope: 'any' },
      { key: 'sla.read', scope: 'any' },
      { key: 'sla.override', scope: 'any' },
      { key: 'sla.policy.manage', scope: 'any' },
      { key: 'search.query', scope: 'any' },
      { key: 'notification.read', scope: 'own' },
      { key: 'notification.template.manage', scope: 'any' },
      { key: 'notification.delivery.read', scope: 'any' },
      { key: 'identity.user.read', scope: 'any' },
      { key: 'identity.user.manage', scope: 'any' },
      { key: 'identity.org.read', scope: 'any' },
      { key: 'identity.org.manage', scope: 'any' },
      { key: 'identity.role.read', scope: 'any' },
      { key: 'identity.role.manage', scope: 'any' },
      { key: 'identity.session.manage', scope: 'any' },
      { key: 'identity.apikey.manage', scope: 'any' },
      { key: 'admin.setting.read', scope: 'any' },
      { key: 'admin.setting.manage', scope: 'any' },
      { key: 'admin.flag.manage', scope: 'any' },
      { key: 'admin.module.manage', scope: 'any' },
      { key: 'admin.activity.read', scope: 'any' },
      { key: 'audit.read', scope: 'any' },
      { key: 'audit.export', scope: 'any' },
      { key: 'security.alert.read', scope: 'any' },
      { key: 'security.classification.manage', scope: 'any' },
      { key: 'webhook.read', scope: 'any' },
      { key: 'webhook.manage', scope: 'any' },
      { key: 'integration.log.read', scope: 'any' },
      { key: 'tenant.read', scope: 'any' },
      { key: 'tenant.org.manage', scope: 'any' },
      { key: 'rules.rule.read', scope: 'any' },
      { key: 'rules.rule.manage', scope: 'any' },
      { key: 'rules.rule.publish', scope: 'any' },
      { key: 'approval.read', scope: 'any' },
      { key: 'approval.decide', scope: 'own' },
      { key: 'approval.delegate', scope: 'own' },
      { key: 'approval.policy.read', scope: 'any' },
      { key: 'approval.policy.manage', scope: 'any' },
      { key: 'sla.policy.read', scope: 'any' },
      { key: 'channel.account.read', scope: 'any' },
      { key: 'channel.message.read', scope: 'any' },
      { key: 'channel.account.manage', scope: 'any' },
      { key: 'channel.identity.manage', scope: 'any' },
      { key: 'catalogue.read', scope: 'any' },
      { key: 'catalogue.request', scope: 'own' },
      { key: 'catalogue.manage', scope: 'any' },
      { key: 'knowledge.read', scope: 'any' },
      { key: 'knowledge.write', scope: 'any' },
      { key: 'knowledge.publish', scope: 'any' },
      { key: 'knowledge.feedback', scope: 'own' },
      { key: 'workflow.read', scope: 'any' },
      { key: 'workflow.manage', scope: 'any' },
      { key: 'workflow.publish', scope: 'any' },
      { key: 'workflow.operate', scope: 'any' },
      { key: 'workflow.start', scope: 'any' },
      { key: 'integration.credential.read', scope: 'any' },
      { key: 'integration.credential.manage', scope: 'any' },
      { key: 'integration.action.read', scope: 'any' },
      { key: 'integration.action.manage', scope: 'any' },
      { key: 'integration.action.replay', scope: 'any' },
      { key: 'catalogue.form.read', scope: 'any' },
      { key: 'catalogue.form.manage', scope: 'any' },
      { key: 'workload.read', scope: 'any' },
      { key: 'workload.manage', scope: 'any' },
      { key: 'workload.availability.set', scope: 'any' },
      { key: 'workload.oncall.override', scope: 'any' },
      { key: 'incident.major.read', scope: 'any' },
      { key: 'incident.major.declare', scope: 'any' },
      { key: 'incident.major.command', scope: 'any' },
      { key: 'incident.review.write', scope: 'any' },
      { key: 'incident.review.publish', scope: 'any' },
    ],
  },
];

/** Idempotent: safe to re-run when a module is enabled or a tenant is repaired. */
export async function seedSystemRoles(ctx: TenantContext): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  await transaction(ctx, async (tx) => {
    for (const role of SYSTEM_ROLES) {
      let record = await tx.role.findFirst({ where: { key: role.key } });
      if (!record) {
        record = await tx.role.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            key: role.key,
            name: role.name,
            description: role.description,
            isSystem: true,
          },
        });
        created += 1;
      } else {
        updated += 1;
      }

      const existing = await tx.rolePermission.findMany({ where: { roleId: record.id } });
      const wanted = new Set(role.permissions.map((p) => `${p.key}:${p.scope}`));
      const have = new Set(existing.map((p) => `${p.permissionKey}:${p.scope}`));

      for (const permission of role.permissions) {
        if (have.has(`${permission.key}:${permission.scope}`)) continue;
        await tx.rolePermission.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            roleId: record.id,
            permissionKey: permission.key,
            scope: permission.scope,
          },
        });
      }
      // Permissions removed from the matrix are removed from the role, so the
      // seed is the single description of what a system role may do.
      for (const permission of existing) {
        if (!wanted.has(`${permission.permissionKey}:${permission.scope}`)) {
          await tx.rolePermission.delete({ where: { id: permission.id } });
        }
      }
    }
  });

  logger.info('system roles seeded', { tenantId: ctx.tenantId, created, updated });
  return { created, updated };
}
