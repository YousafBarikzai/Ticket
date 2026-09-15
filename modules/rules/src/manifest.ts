import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-06 Workflow and rules — PH-2 slice: the business rules engine.
 *
 * The durable workflow engine (MOD-06-E1) is PH-3 and ships as a sibling in
 * this package, sharing this module's expression language and versioned
 * definition lifecycle (docs/architecture/11).
 */
export const rulesManifest: ModuleManifest = registerModule({
  id: 'MOD-06',
  key: 'rules',
  name: 'Business rules and workflow',
  version: '1.0.0',
  phase: 'PH-2',
  dependsOn: ['MOD-04', 'MOD-11', 'MOD-14'],
  permissions: [
    { key: 'rules.rule.read', scopes: ['any'], description: 'See the business rules configured for this tenant.' },
    { key: 'rules.rule.manage', scopes: ['any'], description: 'Write and test business rules as drafts.' },
    { key: 'rules.rule.publish', scopes: ['any'], description: 'Publish a business rule so it affects live tickets, and roll one back.' },
  ],
  events: {
    publishes: ['rule.applied'],
    consumes: ['ticket.created', 'ticket.updated', 'ticket.comment.added', 'ticket.status.changed'],
  },
  featureFlags: [
    {
      key: 'rules.engine.enabled',
      default: true,
      owner: 'catalogue-workflow-squad',
      expires: 'permanent',
      description: 'Evaluate business rules on ticket events.',
    },
  ],
  settings: [
    {
      key: 'rules.test.sampleSize',
      schema: z.number().int().min(1).max(500),
      default: 100,
      scopes: ['tenant'],
      description: 'How many recent tickets the rule test panel replays.',
    },
  ],
  jobs: [],
  routesPrefix: '/rules',
  enabledByDefault: true,
  optional: false,
});
