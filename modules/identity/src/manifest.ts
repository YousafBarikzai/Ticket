import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/** MOD-01 Identity, organisations and access. Every module trusts this one for who the actor is. */
export const identityManifest: ModuleManifest = registerModule({
  id: 'MOD-01',
  key: 'identity',
  name: 'Identity, organisations and access',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: ['MOD-21'],
  permissions: [
    { key: 'identity.user.read', scopes: ['own', 'team', 'any'], description: 'Read user records.' },
    { key: 'identity.user.manage', scopes: ['any'], description: 'Create, update and deactivate users.' },
    { key: 'identity.org.read', scopes: ['own', 'any'], description: 'Read the organisation structure.' },
    { key: 'identity.org.manage', scopes: ['any'], description: 'Manage organisations, teams and locations.' },
    { key: 'identity.role.read', scopes: ['any'], description: 'Read roles and assignments.' },
    { key: 'identity.role.manage', scopes: ['any'], description: 'Grant and revoke roles.' },
    { key: 'identity.session.manage', scopes: ['own', 'any'], description: 'List and revoke sessions.' },
    { key: 'identity.apikey.manage', scopes: ['any'], description: 'Create and revoke API keys.' },
    { key: 'identity.impersonate', scopes: ['any'], phase: 'PH-4', description: 'Act as another user, with a reason.' },
    { key: 'identity.scim.manage', scopes: ['any'], phase: 'PH-4', description: 'Issue and rotate the SCIM token and set which groups grant which roles.' },
  ],
  events: {
    publishes: [
      'user.provisioned',
      'user.updated',
      'user.deactivated',
      'role.assignment.changed',
      'auth.login.succeeded',
      'auth.login.failed',
      'session.revoked',
    ],
    consumes: ['tenant.created'],
  },
  featureFlags: [],
  settings: [
    {
      key: 'auth.session.idleMinutes',
      schema: z.number().int().min(5).max(1440),
      default: 60,
      scopes: ['tenant'],
      description: 'Idle timeout before a session must be refreshed.',
    },
    {
      key: 'auth.session.absoluteHours',
      schema: z.number().int().min(1).max(720),
      default: 12,
      scopes: ['tenant'],
      description: 'Absolute session lifetime regardless of activity.',
    },
    {
      key: 'auth.requiredAcr',
      schema: z.string(),
      default: '',
      scopes: ['tenant'],
      description: 'Authentication context the identity provider must assert, e.g. an MFA level. Empty accepts any.',
    },
  ],
  jobs: [],
  routesPrefix: '/users',
  enabledByDefault: true,
  optional: false,
});
