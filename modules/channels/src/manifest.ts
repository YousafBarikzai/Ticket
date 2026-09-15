import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-03 Omnichannel — PH-2 slice: the adapter framework and the email channel.
 *
 * Slack, Teams, WhatsApp and voice arrive in PH-4 and reuse this framework
 * rather than extending it (docs/architecture/07 §5).
 */
export const channelsManifest: ModuleManifest = registerModule({
  id: 'MOD-03',
  key: 'channels',
  name: 'Omnichannel intake',
  version: '1.0.0',
  phase: 'PH-2',
  dependsOn: ['MOD-01', 'MOD-04'],
  permissions: [
    { key: 'channel.account.read', scopes: ['any'], description: 'See the channel accounts and their health.' },
    { key: 'channel.account.manage', scopes: ['any'], description: 'Add, configure and disable channel accounts.' },
    { key: 'channel.message.read', scopes: ['any'], description: 'See what arrived on a channel, including what was rejected.' },
    { key: 'channel.identity.manage', scopes: ['any'], description: 'Link or unlink a channel address to a person.' },
  ],
  events: {
    publishes: ['channel.message.received', 'channel.health.degraded'],
    consumes: ['ticket.comment.added', 'ticket.status.changed'],
  },
  featureFlags: [],
  settings: [
    {
      key: 'channel.email.maxPerSenderPerHour',
      schema: z.number().int().min(1).max(1000),
      default: 30,
      scopes: ['tenant'],
      description: 'How many messages one address may send in an hour before it is rate limited.',
    },
    {
      key: 'channel.email.transport',
      schema: z.string().min(1),
      default: 'development',
      scopes: ['tenant'],
      description: 'Which email transport this tenant sends and receives through (OD-03).',
    },
  ],
  jobs: [{ name: 'channel.inbound', queue: 'channels', description: 'Normalise and execute one accepted inbound message.' }],
  routesPrefix: '/channels',
  enabledByDefault: true,
  optional: true,
});
