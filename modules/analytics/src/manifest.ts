import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-12 Reporting and analytics. PH-4 delivers the projection pipeline; the
 * metrics, dashboards and scheduled reports that read it follow in E1b.
 *
 * It depends on the modules it projects, which looks like a lot of coupling
 * until you notice the direction: MOD-12 reads their events and nothing reads
 * MOD-12. Delete this module and the platform is unchanged. That is what makes
 * a reporting module safe to rebuild, and it is why the dependency list is long
 * rather than a sign of a problem.
 */
export const analyticsManifest: ModuleManifest = registerModule({
  id: 'MOD-12',
  key: 'analytics',
  name: 'Reporting and analytics',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-04', 'MOD-07', 'MOD-11', 'MOD-17'],
  permissions: [
    { key: 'analytics.read', scopes: ['team', 'any'], description: 'Read the reporting figures, dashboards and reports; keep personal dashboards.' },
    { key: 'analytics.manage', scopes: ['any'], description: 'Define metrics, shared dashboards, reports and their schedules.' },
    { key: 'analytics.admin', scopes: ['any'], description: 'Rebuild or replay a projection and see where it has drifted.' },
  ],
  events: {
    publishes: ['analytics.drift.detected', 'report.generated'],
    consumes: [
      'ticket.created',
      'ticket.updated',
      'ticket.status.changed',
      'ticket.assigned',
      'ticket.comment.added',
      'ticket.task.created',
      'ticket.task.completed',
      'sla.timer.started',
      'sla.timer.paused',
      'sla.timer.resumed',
      'sla.timer.met',
      'sla.timer.breached',
      'approval.requested',
      'approval.decided',
      'notification.queued',
      'notification.sent',
      'notification.failed',
    ],
  },
  featureFlags: [],
  settings: [],
  jobs: [
    {
      name: 'analytics.rollup.rebuild',
      queue: 'analytics',
      // Half past one, after the audit chain check and before the working day,
      // so a rebuild never competes with the morning's dashboards.
      schedule: '30 1 * * *',
      description: 'Rebuild the recent daily rollups from the facts.',
    },
    {
      name: 'analytics.drift.check',
      queue: 'analytics',
      // After the rebuild, so the check measures real drift rather than the
      // drift the rebuild was about to remove.
      schedule: '50 1 * * *',
      description: 'Compare the ticket projection with MOD-04 and raise a drift event.',
    },
    {
      name: 'analytics.report.sweep',
      queue: 'analytics',
      // Every five minutes, so a report due at 08:00 goes out by 08:05. The
      // sweep is cheap when nothing is due: one indexed read per tenant.
      schedule: '*/5 * * * *',
      description: 'Run every scheduled report whose time has come.',
    },
  ],
  enabledByDefault: true,
  optional: true,
});
