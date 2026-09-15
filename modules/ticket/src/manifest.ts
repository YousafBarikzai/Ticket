import { z } from 'zod';
import { registerModule, type ModuleManifest } from '@itsm/platform';

/**
 * MOD-04 Ticket and interaction core.
 *
 * The system of record. Every other module links to a ticket, so this module's
 * contract must stay stable as the rest of the platform grows.
 */
export const ticketManifest: ModuleManifest = registerModule({
  id: 'MOD-04',
  key: 'ticket',
  name: 'Ticket and interaction core',
  version: '1.0.0',
  phase: 'PH-1',
  dependsOn: ['MOD-01', 'MOD-21', 'MOD-14', 'MOD-15'],
  permissions: [
    { key: 'ticket.read', scopes: ['own', 'team', 'any'], description: 'Read tickets.' },
    { key: 'ticket.create', scopes: ['own', 'any'], description: 'Raise a ticket.' },
    { key: 'ticket.update', scopes: ['own', 'team', 'any'], description: 'Change ticket fields.' },
    { key: 'ticket.transition', scopes: ['own', 'team', 'any'], description: 'Move a ticket between states.' },
    { key: 'ticket.comment.public', scopes: ['own', 'team', 'any'], description: 'Reply to the requester.' },
    { key: 'ticket.comment.internal', scopes: ['team', 'any'], description: 'Add an internal note.' },
    { key: 'ticket.assign', scopes: ['team', 'any'], description: 'Assign a ticket to a person or group.' },
    { key: 'ticket.task.manage', scopes: ['team', 'any'], description: 'Create and complete ticket tasks.' },
    { key: 'ticket.link', scopes: ['team', 'any'], description: 'Link tickets to one another.' },
    { key: 'ticket.attachment.add', scopes: ['own', 'team', 'any'], description: 'Attach a file.' },
    { key: 'ticket.watch', scopes: ['own', 'team', 'any'], description: 'Watch a ticket.' },
    { key: 'ticket.config.manage', scopes: ['any'], description: 'Manage categories and field definitions.' },
  ],
  events: {
    publishes: [
      'ticket.created',
      'ticket.updated',
      'ticket.status.changed',
      'ticket.assigned',
      'ticket.comment.added',
      'ticket.attachment.added',
      'ticket.task.created',
      'ticket.task.completed',
      'ticket.linked',
    ],
    consumes: ['sla.timer.started', 'sla.timer.breached', 'user.deactivated', 'ticket.attachment.scanned'],
  },
  featureFlags: [
    {
      key: 'ticket.customFields',
      default: false,
      owner: 'core-squad',
      expires: 'PH-3',
      description: 'Validate and expose custom fields on tickets. Off until the PH-2 builders ship.',
    },
  ],
  settings: [
    {
      key: 'ticket.autoClose.days',
      schema: z.number().int().min(1).max(90),
      default: 7,
      scopes: ['tenant', 'organisation'],
      description: 'Days after resolution before a ticket closes automatically.',
    },
    {
      key: 'ticket.reopen.windowDays',
      schema: z.number().int().min(0).max(90),
      default: 14,
      scopes: ['tenant', 'organisation'],
      description: 'How long a requester may reopen a resolved ticket.',
    },
    {
      key: 'ticket.defaultPriority',
      schema: z.enum(['P1', 'P2', 'P3', 'P4']),
      default: 'P3',
      scopes: ['tenant', 'organisation'],
      description: 'Priority applied when no rule or matrix supplies one.',
    },
  ],
  jobs: [
    { name: 'ticket.autoClose', queue: 'rules', schedule: '0 * * * *', description: 'Close resolved tickets past the window.' },
  ],
  routesPrefix: '/tickets',
  enabledByDefault: true,
  optional: false,
});
