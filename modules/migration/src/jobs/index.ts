import { defineJob } from '@itsm/platform';
import { runJob } from '../service/job-service.js';

/**
 * Runs one import job. Queued by `createJob` on the `imports` queue, where a
 * fifty-thousand-row file holds up other imports and nothing else.
 */
defineJob<{ jobId: string }>('imports', 'import.run', async (payload, { ctx }) => {
  await runJob(ctx, payload.jobId);
});
