import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/** MOD-07 SLA. PH-1 delivered the timer engine; PH-2 adds policies, calendars and escalations. */
export const slaManifest: ModuleManifest = registerModule({
  id: 'MOD-07',
  key: 'sla',
  name: 'SLA, OLA and entitlement management',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: ['MOD-04', 'MOD-01', 'MOD-11'],
  permissions: [
    { key: 'sla.read', scopes: ['own', 'team', 'any'], description: 'See SLA status on a ticket.' },
    { key: 'sla.policy.read', scopes: ['any'], description: 'See the SLA policies, calendars and priority matrix.' },
    { key: 'sla.policy.manage', scopes: ['any'], description: 'Manage policies, targets, calendars and escalations.' },
    { key: 'sla.override', scopes: ['team', 'any'], description: 'Pause, resume or excuse a timer with a reason.' },
  ],
  events: {
    publishes: ['sla.timer.started', 'sla.timer.warning', 'sla.timer.breached', 'sla.timer.paused', 'sla.timer.resumed', 'sla.timer.met', 'sla.timer.restarted', 'sla.timer.cancelled'],
    consumes: ['ticket.created', 'ticket.status.changed', 'ticket.comment.added', 'ticket.updated', 'ticket.classified'],
  },
  featureFlags: [],
  settings: [
    {
      // Read by the analytics module and returned with every `sla.attainment`
      // answer (A8 S1), so a gauge or bullet never draws a target a page typed
      // in, and nobody needs `admin.setting.read` to see what they are aiming
      // at. Below 50 % is not a target anyone sets on purpose.
      key: 'sla.attainment.target',
      schema: z.number().min(50).max(100),
      default: 90,
      scopes: ['tenant'],
      description: 'The share of SLA targets the desk aims to meet, in per cent. Drawn as the target on attainment gauges and bullets.',
    },
  ],
  jobs: [
    { name: 'sla.tick', queue: 'sla', schedule: '* * * * *', description: 'Fire due warnings and breaches for one partition.' },
  ],
  routesPrefix: '/sla-policies',
  enabledByDefault: true,
  optional: false,
});

/**
 * The scheduler scans one partition per tick job, so a large tenant's timers
 * spread across worker replicas instead of queueing behind one another.
 */
export const TIMER_PARTITIONS = 16;

export function partitionFor(ticketId: string): number {
  let hash = 0;
  for (let i = 0; i < ticketId.length; i += 1) {
    hash = (hash * 31 + ticketId.charCodeAt(i)) >>> 0;
  }
  return hash % TIMER_PARTITIONS;
}
