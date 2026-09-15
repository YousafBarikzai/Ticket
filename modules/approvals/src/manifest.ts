import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/** MOD-17 Approvals (PH-2). */
export const approvalsManifest: ModuleManifest = registerModule({
  id: 'MOD-17',
  key: 'approvals',
  name: 'Approvals',
  version: '1.0.0',
  phase: 'PH-2',
  dependsOn: ['MOD-01', 'MOD-04'],
  permissions: [
    { key: 'approval.read', scopes: ['own', 'any'], description: 'See approvals you are party to.' },
    { key: 'approval.decide', scopes: ['own'], description: 'Approve or reject an approval you are named on.' },
    { key: 'approval.delegate', scopes: ['own'], description: 'Hand your approvals to someone else while you are away.' },
    { key: 'approval.policy.read', scopes: ['any'], description: 'See the approval policies configured for this tenant.' },
    { key: 'approval.policy.manage', scopes: ['any'], description: 'Write, publish and delegate approval policies.' },
  ],
  events: {
    publishes: ['approval.requested', 'approval.decided'],
    consumes: ['ticket.created', 'user.deactivated'],
  },
  featureFlags: [],
  settings: [
    {
      key: 'approval.reminder.hours',
      schema: z.number().int().min(1).max(168),
      default: 24,
      scopes: ['tenant'],
      description: 'How long an approver has before they are reminded.',
    },
  ],
  jobs: [{ name: 'approval.reminders', queue: 'workflow', description: 'Remind approvers and apply step timeouts.' }],
  routesPrefix: '/approvals',
  enabledByDefault: true,
  optional: true,
});
