import { defineJob } from '@itsm/platform';
import { reviewAutoMode } from '../service/auto-service.js';
import { runTriage } from '../service/decision-service.js';
import { runSuggestionJob } from '../service/suggestion-service.js';

/**
 * One suggestion. On its own queue family, so a burst of AI work cannot starve
 * outbox publishing or SLA timers (docs/architecture/03 §4) — which matters
 * more here than anywhere else, because a provider call is the slowest thing
 * the platform does and the one most likely to hang.
 */
defineJob<{ jobId: string }>('ai', 'ai.suggest', async (payload, { ctx }) => {
  await runSuggestionJob(ctx, payload.jobId);
});

/**
 * One structured decision, run after the event that asked for it has been
 * committed. On the same queue family as suggestions, and for the same reason.
 */
defineJob<{ purpose: 'triage'; ticketId: string }>('ai', 'ai.decide', async (payload, { ctx }) => {
  await runTriage(ctx, payload.ticketId);
});

/**
 * Whether `auto` should withdraw itself, asked after a person corrects a
 * value it applied. Harmless to run twice: it steps down at most once.
 */
defineJob<{ purpose: 'triage' }>('ai', 'ai.decision.review', async (payload, { ctx }) => {
  await reviewAutoMode(ctx, payload.purpose);
});
