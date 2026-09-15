import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-08-E2 Problem management (PH-4).
 *
 * The practice with a reputation for being the one nobody does. The usual
 * reason is that it is built around its least useful moment — finding the root
 * cause, weeks later, when everybody has moved on — so this module is built
 * around the workaround instead, which is available within hours and is the
 * only output anybody outside the team benefits from.
 */
export const problemManifest: ModuleManifest = registerModule({
  id: 'MOD-08-E2',
  key: 'problem',
  name: 'Problem management',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-04', 'MOD-08-E1', 'MOD-09'],
  permissions: [
    { key: 'problem.read', scopes: ['any'], description: 'See problems and their known errors.' },
    { key: 'problem.manage', scopes: ['any'], description: 'Raise problems, link tickets and move them.' },
    { key: 'problem.publish', scopes: ['any'], description: 'Publish and retire a known error.' },
  ],
  events: {
    publishes: ['problem.created', 'knownerror.published', 'knownerror.retired', 'problem.resolved'],
    consumes: ['incident.major.review.published'],
  },
  featureFlags: [],
  settings: [
    {
      key: 'problem.recurrenceThreshold',
      schema: z.object({ tickets: z.number().int().min(2).max(500), withinDays: z.number().int().min(1).max(365) }),
      default: { tickets: 5, withinDays: 30 },
      scopes: ['tenant'],
      description: 'How many tickets on one category, over how long, before a problem is suggested.',
    },
  ],
  jobs: [
    {
      name: 'problem.recurrence.sweep',
      queue: 'analytics',
      description: 'Suggest a problem where the same category keeps coming back. Suggests; never creates.',
    },
  ],
  routesPrefix: '/problems',
  enabledByDefault: true,
  optional: true,
});
