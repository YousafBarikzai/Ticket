import { registerModule, type ModuleManifest } from '@itsm/platform';

/** MOD-07 SLA. PH-1 delivers the timer engine; policies and reporting follow in PH-2. */
export const slaManifest: ModuleManifest = registerModule({
  id: 'MOD-07',
  key: 'sla',
  name: 'SLA, OLA and entitlement management',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: ['MOD-04', 'MOD-01', 'MOD-11'],
  permissions: [
    { key: 'sla.read', scopes: ['own', 'team', 'any'], description: 'See SLA status on a ticket.' },
    { key: 'sla.policy.manage', scopes: ['any'], description: 'Manage policies, targets and calendars.' },
    { key: 'sla.override', scopes: ['team', 'any'], description: 'Pause, resume or excuse a timer with a reason.' },
  ],
  events: {
    publishes: ['sla.timer.started', 'sla.timer.warning', 'sla.timer.breached', 'sla.timer.paused', 'sla.timer.resumed', 'sla.timer.met'],
    consumes: ['ticket.created', 'ticket.status.changed', 'ticket.comment.added', 'ticket.updated'],
  },
  featureFlags: [],
  settings: [],
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
