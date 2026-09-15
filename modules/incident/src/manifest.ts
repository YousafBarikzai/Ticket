import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-08-E1 Major incident management (PH-4).
 *
 * An ordinary ticket is one person's problem. A major incident is everybody's,
 * and what makes it different is not severity but *coordination*: somebody has
 * to be in charge, somebody has to keep the organisation informed on a promise
 * it can rely on, and afterwards somebody has to be able to say what happened.
 *
 * The module is therefore mostly about three things the platform could not do
 * before: name a commander, hold a promise about how often people will hear
 * from you, and refuse to let an incident be forgotten without a review.
 */
export const incidentManifest: ModuleManifest = registerModule({
  id: 'MOD-08-E1',
  key: 'incident',
  name: 'Major incident management',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-04', 'MOD-01', 'MOD-11'],
  permissions: [
    { key: 'incident.major.read', scopes: ['any'], description: 'See major incidents and their timelines.' },
    { key: 'incident.major.declare', scopes: ['any'], description: 'Declare a major incident and stand one down.' },
    { key: 'incident.major.command', scopes: ['any'], description: 'Run a major incident: move it, post updates, resolve it.' },
    { key: 'incident.review.write', scopes: ['any'], description: 'Write a post-incident review and its actions.' },
    { key: 'incident.review.publish', scopes: ['any'], description: 'Publish a post-incident review and close the incident.' },
  ],
  events: {
    publishes: [
      'incident.major.declared',
      'incident.major.updated',
      'incident.major.resolved',
      'incident.major.closed',
      'incident.major.update.overdue',
      'incident.major.review.published',
    ],
    consumes: [],
  },
  featureFlags: [],
  settings: [
    {
      key: 'incident.updateIntervalMinutes',
      schema: z.record(z.enum(['SEV1', 'SEV2', 'SEV3']), z.number().int().min(5).max(1440)),
      default: { SEV1: 30, SEV2: 60, SEV3: 240 },
      scopes: ['tenant'],
      description: 'How often each severity owes the organisation an update, so nobody decides that at 3am.',
    },
    {
      key: 'incident.reviewDueDays',
      schema: z.number().int().min(1).max(90),
      default: 5,
      scopes: ['tenant'],
      description: 'Working days after resolution by which a post-incident review is due.',
    },
  ],
  jobs: [
    {
      name: 'incident.comms.sweep',
      queue: 'notify',
      description: 'Notice when a promised update has not been posted, and say so.',
    },
  ],
  routesPrefix: '/major-incidents',
  enabledByDefault: true,
  optional: true,
});
