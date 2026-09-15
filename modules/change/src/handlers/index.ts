import { defineHandler, logger, publish, recordAudit } from '@itsm/platform';
import { events } from '@itsm/contracts';
import { isChangeState } from '../domain/lifecycle.js';

/**
 * The CAB's answer, coming back from MOD-17.
 *
 * The change waits in `submitted` until this arrives. Handled on the consumer's
 * own transaction, so the decision and the change's new state commit together:
 * a change approved in MOD-17 but still sitting in `submitted` here is the
 * state somebody escalates about at nine the next morning.
 */
defineHandler({
  consumer: 'change',
  moduleId: 'MOD-08-E3',
  eventType: 'approval.decided',
  required: false,
  async handle(ctx, event, tx) {
    const payload = event.payload as { subjectType: string; subjectId: string; outcome: 'approved' | 'rejected' };
    if (payload.subjectType !== 'change') return;

    const change = await tx.change.findFirst({ where: { id: payload.subjectId } });
    if (!change) {
      logger.warn('an approval was decided for a change that no longer exists', { changeId: payload.subjectId });
      return;
    }
    // Only a change still waiting takes the answer. A late or replayed decision
    // must not drag a scheduled change back to approved, or reopen a closed one.
    if (!isChangeState(change.status) || change.status !== 'submitted') return;

    const to = payload.outcome === 'approved' ? 'approved' : 'rejected';
    await tx.change.update({ where: { id: change.id }, data: { status: to, version: { increment: 1 } } });

    await recordAudit(tx, ctx, {
      action: `change.${to}`,
      targetType: 'change',
      targetId: change.id,
      before: { status: 'submitted' },
      after: { status: to, via: 'cab' },
    });

    if (to === 'approved') {
      await publish(tx, ctx, {
        definition: events.changeApproved,
        aggregateId: change.id,
        payload: { changeId: change.id, number: change.number, kind: change.kind, via: 'cab', retrospective: false },
      });
    } else {
      await publish(tx, ctx, {
        definition: events.changeRejected,
        aggregateId: change.id,
        payload: { changeId: change.id, number: change.number, kind: change.kind, reason: null },
      });
    }
  },
});
