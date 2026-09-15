import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-20 Workload and routing (PH-4).
 *
 * Answers the question every other module has been asking and none could
 * answer: *who should do this?* Until now a rule could put a ticket on a
 * queue; it could not put it on a person, because nothing knew who was at
 * work, what they could do, or how much they were already holding.
 *
 * It costs a tenant nothing until they use it. Nothing routes unless a rule
 * asks for it, and a tenant that has described no shifts, no rota and no skills
 * gets the sensible remainder: the least loaded member of the team, and a
 * refusal — with its reason — when there is nobody.
 */
export const workloadManifest: ModuleManifest = registerModule({
  id: 'MOD-20',
  key: 'workload',
  name: 'Workload and routing',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-01', 'MOD-04', 'MOD-21'],
  permissions: [
    { key: 'workload.read', scopes: ['team', 'any'], description: 'See who is available, on shift and on call.' },
    { key: 'workload.manage', scopes: ['any'], description: 'Write shifts, rotations, skills and routing policy.' },
    { key: 'workload.availability.set', scopes: ['own', 'any'], description: 'Say whether you are available for work.' },
    { key: 'workload.oncall.override', scopes: ['team', 'any'], description: 'Record a swap on an on-call rotation.' },
  ],
  events: {
    publishes: ['workload.assignment.declined', 'workload.oncall.changed'],
    consumes: ['ticket.assigned'],
  },
  featureFlags: [],
  settings: [
    {
      key: 'workload.defaultCapacity',
      schema: z.number().int().min(1).max(1000),
      default: 10,
      scopes: ['tenant', 'organisation'],
      description: 'Open tickets one agent will hold before routing stops adding to their queue.',
    },
    {
      key: 'workload.defaultStrategy',
      schema: z.enum(['round_robin', 'least_loaded', 'skill']),
      default: 'least_loaded',
      scopes: ['tenant', 'organisation'],
      description: 'How work is shared out when a team has not said otherwise.',
    },
  ],
  // No jobs. Who is on shift and who is on call are computed from a pattern and
  // the clock, so there is nothing to sweep: a worker that had not run for an
  // hour could not leave the rota an hour out of date.
  jobs: [],
  routesPrefix: '/workload',
  enabledByDefault: true,
  optional: true,
});
