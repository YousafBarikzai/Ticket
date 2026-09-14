import { newId, transaction, type TenantContext } from '@itsm/platform';
import type { AudienceDescriptor } from '../service/notification-service.js';

/**
 * The default notification pack for every Phase 1 event, in English with
 * localisation keys ready for the PH-2 translations (MOD-11 definition of done).
 *
 * Requester-facing templates deliberately reference only public fields: a
 * contract test asserts an internal note can never reach a requester.
 */

interface TemplateSeed {
  key: string;
  subject: string;
  body: string;
}

interface RuleSeed {
  key: string;
  eventType: string;
  templateKey: string;
  audience: AudienceDescriptor[];
  channels: string[];
  conditions?: unknown;
  isEmergency?: boolean;
}

export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  {
    key: 'ticket.created.requester',
    subject: 'We have your request {{ticket.number}}',
    body: 'Hello {{recipient.displayName}},\n\nWe have logged your request {{ticket.number}}: {{ticket.title}}.\n\nWe will update you as soon as there is progress.',
  },
  {
    key: 'ticket.created.group',
    subject: 'New {{ticket.priority}} ticket {{ticket.number}}',
    body: '{{ticket.number}} ({{ticket.priority}}) has arrived in your queue: {{ticket.title}}.',
  },
  {
    key: 'ticket.assigned.assignee',
    subject: '{{ticket.number}} is now yours',
    body: 'You have been assigned {{ticket.number}}: {{ticket.title}}. Priority {{ticket.priority}}.',
  },
  {
    key: 'ticket.comment.requester',
    subject: 'Update on {{ticket.number}}',
    body: 'There is a new reply on your request {{ticket.number}}: {{ticket.title}}.',
  },
  {
    key: 'ticket.resolved.requester',
    subject: '{{ticket.number}} has been resolved',
    body: 'Hello {{recipient.displayName}},\n\nWe believe {{ticket.number}} is resolved. If it is not, you can reopen it from the portal.',
  },
  {
    key: 'sla.warning.assignee',
    subject: '{{ticket.number}} is approaching its target',
    body: '{{ticket.number}} has reached a warning threshold on its {{payload.targetType}} target.',
  },
  {
    key: 'sla.breached.lead',
    subject: '{{ticket.number}} has missed its target',
    body: 'The {{payload.targetType}} target for {{ticket.number}} has been missed.',
  },
];

export const DEFAULT_RULES: RuleSeed[] = [
  {
    key: 'ticket.created.requester',
    eventType: 'ticket.created',
    templateKey: 'ticket.created.requester',
    audience: [{ kind: 'requester' }],
    channels: ['inapp', 'email'],
  },
  {
    key: 'ticket.created.group',
    eventType: 'ticket.created',
    templateKey: 'ticket.created.group',
    audience: [{ kind: 'group' }],
    channels: ['inapp'],
  },
  {
    key: 'ticket.assigned.assignee',
    eventType: 'ticket.assigned',
    templateKey: 'ticket.assigned.assignee',
    audience: [{ kind: 'assignee' }],
    channels: ['inapp', 'email'],
  },
  {
    key: 'ticket.comment.requester',
    eventType: 'ticket.comment.added',
    templateKey: 'ticket.comment.requester',
    audience: [{ kind: 'requester' }],
    channels: ['inapp', 'email'],
    // Internal notes must never reach the requester; the rule refuses them as
    // well as the template, so neither alone is the only safeguard.
    conditions: { eq: [{ var: 'payload.visibility' }, 'public'] },
  },
  {
    key: 'ticket.resolved.requester',
    eventType: 'ticket.status.changed',
    templateKey: 'ticket.resolved.requester',
    audience: [{ kind: 'requester' }],
    channels: ['inapp', 'email'],
    conditions: { eq: [{ var: 'payload.to' }, 'resolved'] },
  },
  {
    key: 'sla.warning.assignee',
    eventType: 'sla.timer.warning',
    templateKey: 'sla.warning.assignee',
    audience: [{ kind: 'assignee' }, { kind: 'group' }],
    channels: ['inapp'],
  },
  {
    key: 'sla.breached.lead',
    eventType: 'sla.timer.breached',
    templateKey: 'sla.breached.lead',
    audience: [{ kind: 'assignee' }, { kind: 'group' }],
    channels: ['inapp', 'email'],
    isEmergency: true,
  },
];

export async function seedNotificationDefaults(ctx: TenantContext): Promise<{ templates: number; rules: number }> {
  let templates = 0;
  let rules = 0;

  await transaction(ctx, async (tx) => {
    for (const template of DEFAULT_TEMPLATES) {
      for (const channel of ['inapp', 'email']) {
        const existing = await tx.notificationTemplate.findFirst({
          where: { key: template.key, channel, locale: 'en-GB' },
        });
        if (existing) continue;
        await tx.notificationTemplate.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            key: template.key,
            channel,
            locale: 'en-GB',
            subject: template.subject,
            body: template.body,
          },
        });
        templates += 1;
      }
    }

    for (const rule of DEFAULT_RULES) {
      const existing = await tx.notificationRule.findFirst({ where: { key: rule.key } });
      if (existing) continue;
      await tx.notificationRule.create({
        data: {
          id: newId(),
          tenantId: ctx.tenantId,
          key: rule.key,
          eventType: rule.eventType,
          templateKey: rule.templateKey,
          audience: rule.audience as never,
          channels: rule.channels,
          conditions: (rule.conditions ?? null) as never,
          isEmergency: rule.isEmergency ?? false,
        },
      });
      rules += 1;
    }
  });

  return { templates, rules };
}
