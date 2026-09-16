import { defineJob } from '@itsm/platform';
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
