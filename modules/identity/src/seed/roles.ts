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
      // Tenant-wide, where every other read an agent has is their team's.
      //
      // The narrower scope was inconsistent with the rest of the role in a way
      // that only showed up when MOD-09's AI tried to ground a reply: an agent
      // holds `knowledge.read` at `any` and could open an internal article by
      // key, while search would never list one, because an internal article's
      // ACL is reachable only at `any`. So the knowledge base was readable and
      // not findable — which, for a knowledge base, is most of the way to not
      // existing.
      //
      // What this widens beyond articles is small: a ticket's search ACL is
      // already tenant-wide for anyone at team scope or above, so the change
      // is internal articles and organisation-scoped ones. What it does not
      // touch is the *read* path: `openRequest`, `readArticle` and
      // `getTicket` each check their own permission, so finding a record still
      // does not mean being served it.
      { key: 'search.query', scope: 'any' },
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
      // Suggestions are advisory and agent-facing (ADR-0006): an agent asks
      // for one, reads the evidence beside it, and decides. Nothing they are
      // shown is anything they could not already read.
      { key: 'ai.suggest', scope: 'any' },
      { key: 'ai.read', scope: 'any' },
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
      // Reads known errors before spending an hour on something already
      // solved, and links the ticket in front of them to the problem — which
      // is the number that eventually gets the problem fixed.
      { key: 'problem.read', scope: 'any' },
      { key: 'problem.manage', scope: 'any' },
      // Raises and implements changes. Approving an emergency one after the
      // fact is deliberately not here: the person who made the change at 3am
      // is exactly the person who should not sign it off at 9am.
      { key: 'change.read', scope: 'any' },
      { key: 'change.raise', scope: 'any' },
      { key: 'change.implement', scope: 'any' },
      // Reads the CMDB during triage and says what a ticket touched. Writing
      // the register itself is not an agent's job: the value of a CMDB is that
      // its contents were decided, and a register anybody may edit mid-incident
      // stops being something anybody trusts.
      { key: 'cmdb.read', scope: 'any' },
      { key: 'cmdb.link', scope: 'any' },
      { key: 'asset.read', scope: 'any' },
      // The support number for the thing that just broke is on the contract,
      // and the person who needs it at that moment is the agent.
      { key: 'contract.read', scope: 'any' },
      // Their own time, logged and seen; nobody else's.
      { key: 'time.log', scope: 'own' },
      { key: 'time.read', scope: 'own' },
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
      { key: 'ai.suggest', scope: 'any' },
      { key: 'ai.read', scope: 'any' },
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
      // Publishing a workaround puts words in front of every agent, so it is a
      // lead's — and withdrawing one matters more, because an obsolete
      // workaround costs the reader their time twice.
      { key: 'problem.read', scope: 'any' },
      { key: 'problem.manage', scope: 'any' },
      { key: 'problem.publish', scope: 'any' },
      { key: 'change.read', scope: 'any' },
      { key: 'change.raise', scope: 'any' },
      { key: 'change.implement', scope: 'any' },
      // A lead signs off an emergency change somebody else made, which is the
      // whole value of the retrospective approval.
      { key: 'change.approve.retrospective', scope: 'any' },
      { key: 'cmdb.read', scope: 'any' },
      { key: 'cmdb.manage', scope: 'any' },
      { key: 'cmdb.link', scope: 'any' },
      // Hands out laptops and takes them back, which is a lead's day job in
      // most organisations and nobody else's.
      { key: 'asset.read', scope: 'any' },
      { key: 'asset.manage', scope: 'any' },
      // Works the discovery queue: accepting a proposal writes the register, so
      // it takes `cmdb.manage`, which a lead already has.
      { key: 'discovery.read', scope: 'any' },
      { key: 'contract.read', scope: 'any' },
      // Their own team's figures. Scoped to the team rather than the tenant,
      // because a lead comparing their numbers with another team's is a
      // conversation that should start with the other lead, not a dashboard.
      { key: 'analytics.read', scope: 'team' },
      // What their team's requesters said, and no more than that.
      { key: 'feedback.read', scope: 'team' },
      // Logs on behalf of the team and sees what the team's tickets cost.
      { key: 'time.log', scope: 'team' },
      { key: 'time.read', scope: 'team' },
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
      { key: 'problem.read', scope: 'any' },
      { key: 'change.read', scope: 'any' },
      // Owns the service being changed, so signs off an emergency change to it.
      { key: 'change.approve.retrospective', scope: 'any' },
      // Reads what their service is made of, and what would take it down.
      { key: 'cmdb.read', scope: 'any' },
      { key: 'asset.read', scope: 'any' },
      // Owns the budget the contract sits in, so sees what it costs and when
      // notice is due.
      { key: 'contract.read', scope: 'any' },
      // Across teams, because a service is delivered by more than one of them
      // and the owner is the person accountable for the whole of it.
      { key: 'analytics.read', scope: 'any' },
      // Builds the shared dashboards and the reports that go to the business:
      // the owner is who gets asked for the numbers.
      { key: 'analytics.manage', scope: 'any' },
      // Designs the survey and decides when it goes out: the owner is who is
      // judged by the answers, so the owner writes the questions.
      { key: 'feedback.read', scope: 'any' },
      { key: 'feedback.manage', scope: 'any' },
      // Sets the rates and the budgets: the owner is who answers for the cost.
      { key: 'time.read', scope: 'any' },
      { key: 'time.manage', scope: 'any' },
      // Speaks for the service in public: decides what the page says about it.
      { key: 'statuspage.read', scope: 'any' },
      { key: 'statuspage.manage', scope: 'any' },
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
      { key: 'problem.read', scope: 'any' },
      { key: 'problem.manage', scope: 'any' },
      { key: 'problem.publish', scope: 'any' },
      { key: 'change.read', scope: 'any' },
      { key: 'change.raise', scope: 'any' },
      { key: 'change.implement', scope: 'any' },
      { key: 'change.manage', scope: 'any' },
      { key: 'change.approve.retrospective', scope: 'any' },
      { key: 'cmdb.read', scope: 'any' },
      { key: 'cmdb.manage', scope: 'any' },
      { key: 'cmdb.link', scope: 'any' },
      { key: 'asset.read', scope: 'any' },
      { key: 'asset.manage', scope: 'any' },
      // Configuring a source decides what may write the register without being
      // asked, which is an administrator's decision and nobody else's.
      { key: 'discovery.read', scope: 'any' },
      { key: 'discovery.manage', scope: 'any' },
      { key: 'contract.read', scope: 'any' },
      { key: 'contract.manage', scope: 'any' },
      { key: 'analytics.read', scope: 'any' },
      { key: 'analytics.manage', scope: 'any' },
      // Rebuilding a projection and reading where it has drifted is an
      // operational act, not a reporting one: it changes what every other role
      // is looking at.
      { key: 'analytics.admin', scope: 'any' },
      { key: 'feedback.read', scope: 'any' },
      { key: 'feedback.manage', scope: 'any' },
      { key: 'time.log', scope: 'any' },
      { key: 'time.read', scope: 'any' },
      { key: 'time.manage', scope: 'any' },
      { key: 'statuspage.read', scope: 'any' },
      { key: 'statuspage.manage', scope: 'any' },
      // Bringing another tool's data in writes users, teams, services and
      // tickets in bulk: an administrator's act, and nobody else's.
      { key: 'migration.read', scope: 'any' },
      { key: 'migration.manage', scope: 'any' },
      // Installing a pack writes services, forms, workflows and policies in
      // one act, which is an administrator's and nobody else's.
      { key: 'pack.read', scope: 'any' },
      { key: 'pack.install', scope: 'any' },
      // Hands the user list to an identity provider: an administrator's act.
      { key: 'identity.scim.manage', scope: 'any' },
      // Sees what the tenant is using, and may bring its own warnings
      // forward. The hard limits are the plan's.
      { key: 'tenant.usage.read', scope: 'any' },
      { key: 'tenant.limit.manage', scope: 'any' },
      // Sets what this tenant will spend on AI, and can switch it off. The
      // prompts themselves are the deployment's and are not on this list.
      { key: 'ai.suggest', scope: 'any' },
      { key: 'ai.read', scope: 'any' },
      { key: 'ai.manage', scope: 'any' },
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
