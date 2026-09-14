import { registerModule, type ModuleManifest } from '@itsm/platform';

/** MOD-15 Security, privacy, audit and resilience. Cross-cutting, not optional. */
export const securityManifest: ModuleManifest = registerModule({
  id: 'MOD-15',
  key: 'security',
  name: 'Security, privacy, audit and resilience',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: ['MOD-01'],
  permissions: [
    { key: 'audit.read', scopes: ['any'], description: 'Search the audit trail.' },
    { key: 'audit.export', scopes: ['any'], description: 'Export audit events with a signed manifest.' },
    { key: 'security.alert.read', scopes: ['any'], description: 'See security alerts.' },
    { key: 'security.classification.manage', scopes: ['any'], description: 'Change data-classification labels.' },
  ],
  events: {
    publishes: ['security.alert.raised', 'ticket.attachment.scanned'],
    consumes: ['auth.login.failed', 'role.assignment.changed', 'ticket.attachment.added'],
  },
  featureFlags: [],
  settings: [],
  jobs: [
    { name: 'audit.verifyChain', queue: 'retention', schedule: '0 2 * * *', description: 'Verify every tenant audit chain nightly.' },
    { name: 'attachment.scan', queue: 'scan', description: 'Scan an uploaded attachment before it becomes visible.' },
  ],
  routesPrefix: '/audit-events',
  enabledByDefault: true,
  optional: false,
});
