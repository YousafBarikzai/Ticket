import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-06-E1 Workflow engine (PH-3), the sibling of the PH-2 rules engine.
 *
 * The two share an expression language, a versioned-definition lifecycle and a
 * ticket write path. What the workflow engine adds is *time*: a rule decides
 * something inside one event's transaction, and a workflow waits for an
 * approval, a task or five days without losing its place (ADR-0009).
 */
export const workflowManifest: ModuleManifest = registerModule({
  id: 'MOD-06-E1',
  key: 'workflow',
  name: 'Workflow engine',
  version: '1.0.0',
  phase: 'PH-3',
  dependsOn: ['MOD-06', 'MOD-04', 'MOD-17', 'MOD-11'],
  permissions: [
    { key: 'workflow.read', scopes: ['any'], description: 'See workflows and their runs.' },
    { key: 'workflow.manage', scopes: ['any'], description: 'Write and edit workflow drafts.' },
    { key: 'workflow.publish', scopes: ['any'], description: 'Publish, roll back and retire workflows.' },
    { key: 'workflow.operate', scopes: ['any'], description: 'Retry, skip and cancel runs.' },
    { key: 'workflow.start', scopes: ['any'], description: 'Start a manual workflow.' },
  ],
  events: {
    publishes: ['workflow.run.started', 'workflow.run.completed', 'workflow.run.failed'],
    consumes: [
      'ticket.created',
      'ticket.updated',
      'ticket.status.changed',
      'ticket.comment.added',
      'ticket.task.completed',
      'request.submitted',
      'approval.decided',
      'sla.timer.breached',
    ],
  },
  featureFlags: [],
  settings: [
    {
      key: 'workflow.maxActiveRuns',
      schema: z.number().int().min(10).max(100_000),
      default: 10_000,
      scopes: ['tenant'],
      description: 'Soft limit on runs in flight before an alert is raised.',
    },
  ],
  jobs: [
    { name: 'workflow.advance', queue: 'workflow', description: 'Run one step of one workflow run.' },
    { name: 'workflow.resume', queue: 'workflow', description: 'Carry on from a step whose wait was satisfied.' },
    { name: 'workflow.timers', queue: 'workflow', description: 'Fire waits whose time has come, after a Redis loss included.' },
  ],
  routesPrefix: '/workflows',
  enabledByDefault: true,
  optional: true,
});
