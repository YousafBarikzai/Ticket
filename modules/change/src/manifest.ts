import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-08-E3 Change management (PH-4).
 *
 * Change control's characteristic failure is not changes going wrong — it is
 * changes going unrecorded. Every control that makes recording a change more
 * expensive than not recording one buys a little safety and spends a lot of
 * coverage, and a change record with holes in it is worse than none because it
 * is trusted.
 */
export const changeManifest: ModuleManifest = registerModule({
  id: 'MOD-08-E3',
  key: 'change',
  name: 'Change management',
  version: '1.0.0',
  phase: 'PH-4',
  dependsOn: ['MOD-04', 'MOD-17', 'MOD-08-E2'],
  permissions: [
    { key: 'change.read', scopes: ['any'], description: 'See changes, windows and standard templates.' },
    { key: 'change.raise', scopes: ['any'], description: 'Raise a change and submit it.' },
    { key: 'change.implement', scopes: ['any'], description: 'Schedule, start, finish and close a change.' },
    { key: 'change.manage', scopes: ['any'], description: 'Write change windows, blackouts and standard templates.' },
    { key: 'change.approve.retrospective', scopes: ['any'], description: 'Approve an emergency change after the fact.' },
  ],
  events: {
    publishes: ['change.submitted', 'change.approved', 'change.rejected', 'change.scheduled', 'change.closed'],
    consumes: ['approval.decided'],
  },
  featureFlags: [],
  settings: [
    {
      key: 'change.retrospectiveDueHours',
      schema: z.number().int().min(1).max(720),
      default: 72,
      scopes: ['tenant'],
      description: 'Hours after an emergency change by which its retrospective approval is owed.',
    },
  ],
  jobs: [],
  routesPrefix: '/changes',
  enabledByDefault: true,
  optional: true,
});
