import { type TenantContext, type Tx, logger } from '@itsm/platform';
import type { ApproverRule } from '../domain/policy.js';

/**
 * Turns a step's approver rules into the people who must decide.
 *
 * Two things make this more than a lookup.
 *
 * **Segregation of duties** (docs/architecture/09 §3): whoever the approval is
 * *for* is removed from the list. Someone who can approve their own request has
 * no approval at all, and the most common way that happens is not malice but a
 * manager raising a request for themselves.
 *
 * **Delegation**: an approver who is away has their decisions redirected to
 * their delegate, and the decision records both — the person who owed the
 * decision and the person who actually made it.
 */

export interface ResolutionContext {
  /** Whoever the approval is about; never allowed to approve it. */
  subjectUserId: string | null;
  serviceId: string | null;
}

export interface ResolvedApprovers {
  approverIds: string[];
  /** Why the list ended up as it did, for the audit entry and the admin UI. */
  explanation: string[];
}

export async function resolveApprovers(
  tx: Tx,
  ctx: TenantContext,
  rules: ApproverRule[],
  subject: ResolutionContext,
): Promise<ResolvedApprovers> {
  const found = new Set<string>();
  const explanation: string[] = [];

  for (const rule of rules) {
    switch (rule.kind) {
      case 'manager': {
        if (!subject.subjectUserId) {
          explanation.push('manager: no subject user, so nobody to walk up from');
          break;
        }
        let current = await tx.user.findFirst({ where: { id: subject.subjectUserId } });
        let climbed = 0;
        // Walk up the requested number of levels, stopping at the top rather
        // than looping: a cycle in the manager chain must not hang the request.
        const visited = new Set<string>([subject.subjectUserId]);
        while (current?.managerId && climbed < rule.levels) {
          if (visited.has(current.managerId)) {
            logger.warn('manager chain loops; stopping the walk', { userId: current.id });
            break;
          }
          visited.add(current.managerId);
          current = await tx.user.findFirst({ where: { id: current.managerId } });
          climbed += 1;
        }
        if (current && climbed > 0 && current.id !== subject.subjectUserId) {
          found.add(current.id);
          explanation.push(`manager: ${current.displayName} (${climbed} level(s) up)`);
        } else {
          explanation.push('manager: nobody found up the chain');
        }
        break;
      }

      case 'user': {
        found.add(rule.userId);
        explanation.push(`user: named directly`);
        break;
      }

      case 'role': {
        const role = await tx.role.findFirst({ where: { key: rule.roleKey } });
        if (!role) {
          explanation.push(`role ${rule.roleKey}: no such role`);
          break;
        }
        const assignments = await tx.roleAssignment.findMany({ where: { roleId: role.id } });
        assignments.forEach((assignment) => found.add(assignment.userId));
        explanation.push(`role ${rule.roleKey}: ${assignments.length} holder(s)`);
        break;
      }

      case 'team': {
        const members = await tx.teamMembership.findMany({ where: { teamId: rule.teamId } });
        // A team's lead approves for the team where there is one; everyone
        // otherwise, so a team without a lead still has someone accountable.
        const leads = members.filter((member) => member.isLead);
        const chosen = leads.length > 0 ? leads : members;
        chosen.forEach((member) => found.add(member.userId));
        explanation.push(`team: ${chosen.length} ${leads.length > 0 ? 'lead(s)' : 'member(s)'}`);
        break;
      }

      case 'serviceOwner': {
        // The service catalogue is MOD-05 and arrives later in this phase, so
        // there is no owner to look up yet. Publishing a policy that uses this
        // rule is refused (APPROVERS_NOT_YET_AVAILABLE), so reaching here means
        // a policy predates that check: say so rather than resolve to nobody.
        explanation.push('serviceOwner: the service catalogue is not available yet');
        break;
      }
    }
  }

  // Segregation of duties, applied last so it cannot be undone by a later rule.
  if (subject.subjectUserId && found.delete(subject.subjectUserId)) {
    explanation.push('removed the subject: nobody approves their own request');
  }

  const withDelegates = await applyDelegations(tx, [...found]);
  if (withDelegates.redirected.length > 0) {
    explanation.push(...withDelegates.redirected.map((r) => `delegated: ${r.from} → ${r.to}`));
  }

  // A delegate who is also the subject is removed for the same reason.
  const finalIds = withDelegates.approverIds.filter((id) => id !== subject.subjectUserId);

  return { approverIds: finalIds, explanation };
}

/** Swaps an approver for their active delegate, where one is in force today. */
export async function applyDelegations(
  tx: Tx,
  approverIds: string[],
): Promise<{ approverIds: string[]; redirected: { from: string; to: string }[] }> {
  if (approverIds.length === 0) return { approverIds: [], redirected: [] };

  const now = new Date();
  const delegations = await tx.approvalDelegation.findMany({
    where: { fromUserId: { in: approverIds }, startsAt: { lte: now }, endsAt: { gte: now } },
  });
  if (delegations.length === 0) return { approverIds, redirected: [] };

  const byFrom = new Map(delegations.map((d) => [d.fromUserId, d.toUserId]));
  const redirected: { from: string; to: string }[] = [];
  const result = new Set<string>();

  for (const id of approverIds) {
    const to = byFrom.get(id);
    if (to && to !== id) {
      result.add(to);
      redirected.push({ from: id, to });
    } else {
      result.add(id);
    }
  }
  return { approverIds: [...result], redirected };
}

/**
 * Whether this person may decide this step, and on whose behalf.
 *
 * Returns the approver slot they are filling, which is not always themselves: a
 * delegate decides in the delegator's name, and the decision row records both.
 */
export async function approverSlotFor(
  tx: Tx,
  stepApproverIds: string[],
  userId: string,
): Promise<{ approverId: string; actedById: string | null } | null> {
  if (stepApproverIds.includes(userId)) return { approverId: userId, actedById: null };

  const now = new Date();
  const delegation = await tx.approvalDelegation.findFirst({
    where: { toUserId: userId, fromUserId: { in: stepApproverIds }, startsAt: { lte: now }, endsAt: { gte: now } },
  });
  if (delegation) return { approverId: delegation.fromUserId, actedById: userId };
  return null;
}
