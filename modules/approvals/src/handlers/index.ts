import { defineHandler, logger } from '@itsm/platform';
import { applyDelegations } from '../service/approver-resolver.js';

/**
 * MOD-17 reacts to the identity lifecycle.
 *
 * Approvals outlive the people named on them. Someone leaves the organisation
 * while three changes wait on their decision, and without this those changes
 * wait forever: the step is open, its approver can no longer sign in, and
 * nothing says so.
 */

defineHandler({
  consumer: 'approvals',
  moduleId: 'MOD-17',
  eventType: 'user.deactivated',
  required: true,
  async handle(ctx, event, tx) {
    const { userId } = event.payload as { userId: string };

    const steps = await tx.approvalStep.findMany({ where: { status: 'open', approverIds: { has: userId } } });
    for (const step of steps) {
      const remaining = step.approverIds.filter((id) => id !== userId);
      // Their delegate inherits the decision where one is in force; otherwise
      // the step carries on with whoever is left.
      const { approverIds } = await applyDelegations(tx, [userId]);
      const inherited = approverIds.filter((id) => id !== userId && !remaining.includes(id));
      const next = [...remaining, ...inherited];

      await tx.approvalStep.update({
        where: { id: step.id },
        data: {
          approverIds: next,
          // The quorum cannot exceed the people who can still decide, or the
          // step becomes unsatisfiable and blocks forever.
          quorum: Math.max(1, Math.min(step.quorum, next.length || 1)),
          // A step nobody can decide is flagged rather than left open pretending.
          status: next.length === 0 ? 'blocked' : step.status,
        },
      });

      if (next.length === 0) {
        logger.warn('an approval step lost its last approver', { stepId: step.id, requestId: step.requestId });
      }
    }
  },
});
