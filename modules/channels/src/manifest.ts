import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-03 Omnichannel.
 *
 * PH-2 built the adapter framework and the email channel. PH-4 (E2) adds Slack
 * and Teams on that same framework rather than beside it: they implement the
 * same verify/parse/send interface, and the inbound path cannot tell a chat
 * message from an email once it is parsed.
 *
 * What chat genuinely needed that email did not is a guard of its own — chat
 * has no RFC 3834 headers and an entirely different set of ways to go wrong —
 * and a middle state for identity, because a workspace can vouch for an email
 * in a way an anonymous sender cannot (ADR-0030).
 */
export const channelsManifest: ModuleManifest = registerModule({
  id: 'MOD-03',
  key: 'channels',
  name: 'Omnichannel intake',
  version: '1.1.0',
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
    {
      key: 'channel.chat.maxBytes',
      schema: z.number().int().min(1_000).max(1_000_000),
      default: 64 * 1024,
      scopes: ['tenant'],
      description:
        'How large a chat message may be before it is dropped. Far smaller than the email limit: a novel pasted into a channel should not become a ticket.',
    },
  ],
  jobs: [{ name: 'channel.inbound', queue: 'channels', description: 'Normalise and execute one accepted inbound message.' }],
  routesPrefix: '/channels',
  enabledByDefault: true,
  optional: true,
});
