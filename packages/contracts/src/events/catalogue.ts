import { z } from 'zod';
import { defineEvent } from './envelope.js';
import { actorSchema } from '../models/common.js';

/**
 * The event catalogue for Phase 1. Names and webhook eligibility follow the
 * specification's section 6 catalogue; later phases add their own events to
 * this file through their owning module.
 */

const id = z.string().uuid();

// ---- MOD-21 Tenancy -------------------------------------------------------
export const tenantCreated = defineEvent({
  type: 'tenant.created',
  version: 1,
  aggregateType: 'tenant',
  webhook: false,
  description: 'A tenant was provisioned and is ready for configuration.',
  payload: z.object({ tenantId: id, name: z.string(), slug: z.string(), plan: z.string().nullable(), region: z.string() }),
});

export const tenantSuspended = defineEvent({
  type: 'tenant.suspended',
  version: 1,
  aggregateType: 'tenant',
  webhook: false,
  description: 'A tenant was suspended; logins and API calls are refused.',
  payload: z.object({ tenantId: id, reason: z.string().nullable() }),
});

// ---- MOD-01 Identity ------------------------------------------------------
export const userProvisioned = defineEvent({
  type: 'user.provisioned',
  version: 1,
  aggregateType: 'user',
  webhook: true,
  description: 'A user record was created, by first login (JIT), admin or import.',
  payload: z.object({ userId: id, email: z.string(), source: z.enum(['jit', 'admin', 'import', 'scim', 'seed']) }),
});

export const userUpdated = defineEvent({
  type: 'user.updated',
  version: 1,
  aggregateType: 'user',
  webhook: true,
  description: 'A user record changed.',
  payload: z.object({ userId: id, changed: z.array(z.string()) }),
});

export const userDeactivated = defineEvent({
  type: 'user.deactivated',
  version: 1,
  aggregateType: 'user',
  webhook: true,
  description: 'A user was deactivated; sessions and assignments are revoked.',
  payload: z.object({ userId: id, reason: z.string().nullable() }),
});

export const roleAssignmentChanged = defineEvent({
  type: 'role.assignment.changed',
  version: 1,
  aggregateType: 'user',
  webhook: false,
  description: 'A role assignment was granted or revoked; permission caches must drop.',
  payload: z.object({ userId: id, roleId: id, action: z.enum(['granted', 'revoked']) }),
});

export const authLoginSucceeded = defineEvent({
  type: 'auth.login.succeeded',
  version: 1,
  aggregateType: 'session',
  webhook: false,
  description: 'A session was established.',
  payload: z.object({ userId: id, sessionId: id, method: z.string(), ip: z.string().nullable() }),
});

export const authLoginFailed = defineEvent({
  type: 'auth.login.failed',
  version: 1,
  aggregateType: 'session',
  webhook: false,
  description: 'An authentication attempt was rejected.',
  payload: z.object({ subject: z.string().nullable(), reason: z.string(), ip: z.string().nullable() }),
});

export const sessionRevoked = defineEvent({
  type: 'session.revoked',
  version: 1,
  aggregateType: 'session',
  webhook: false,
  description: 'A session was revoked by the user, an administrator or deactivation.',
  payload: z.object({ userId: id, sessionId: id, by: actorSchema }),
});

// ---- MOD-04 Ticket core ---------------------------------------------------
const ticketRef = { ticketId: id, number: z.string() };

export const ticketCreated = defineEvent({
  type: 'ticket.created',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'A ticket was created through any channel.',
  payload: z.object({
    ...ticketRef,
    type: z.string(),
    channel: z.string(),
    requesterId: id.nullable(),
    priority: z.string(),
    serviceId: id.nullable(),
    categoryId: id.nullable(),
    groupId: id.nullable(),
    orgId: id.nullable(),
  }),
});

export const ticketUpdated = defineEvent({
  type: 'ticket.updated',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'One or more ticket fields changed.',
  payload: z.object({
    ...ticketRef,
    changed: z.record(z.object({ before: z.unknown(), after: z.unknown() })),
  }),
});

export const ticketStatusChanged = defineEvent({
  type: 'ticket.status.changed',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'A ticket moved to a new status.',
  payload: z.object({
    ...ticketRef,
    from: z.string(),
    to: z.string(),
    fromCategory: z.string(),
    toCategory: z.string(),
    reason: z.string().nullable(),
  }),
});

export const ticketAssigned = defineEvent({
  type: 'ticket.assigned',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'A ticket was assigned to a person or a group.',
  payload: z.object({
    ...ticketRef,
    assigneeId: id.nullable(),
    groupId: id.nullable(),
    method: z.enum(['manual', 'rule', 'round_robin', 'load_balanced', 'skills']),
  }),
});

export const ticketCommentAdded = defineEvent({
  type: 'ticket.comment.added',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'A public reply or an internal note was added.',
  payload: z.object({
    ...ticketRef,
    commentId: id,
    visibility: z.enum(['public', 'internal']),
    authorId: id.nullable(),
    channel: z.string(),
  }),
});

export const ticketAttachmentAdded = defineEvent({
  type: 'ticket.attachment.added',
  version: 1,
  aggregateType: 'ticket',
  webhook: false,
  description: 'An attachment was registered and is awaiting a malware scan.',
  payload: z.object({ ...ticketRef, attachmentId: id, filename: z.string(), size: z.number().int() }),
});

export const ticketAttachmentScanned = defineEvent({
  type: 'ticket.attachment.scanned',
  version: 1,
  aggregateType: 'ticket',
  webhook: false,
  description: 'An attachment finished scanning and became visible or was quarantined.',
  payload: z.object({ ...ticketRef, attachmentId: id, verdict: z.enum(['clean', 'infected', 'error']) }),
});

export const ticketTaskCreated = defineEvent({
  type: 'ticket.task.created',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'A task was added to a ticket.',
  payload: z.object({ ...ticketRef, taskId: id, title: z.string(), assigneeId: id.nullable(), groupId: id.nullable() }),
});

export const ticketTaskCompleted = defineEvent({
  type: 'ticket.task.completed',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'A ticket task was completed.',
  payload: z.object({ ...ticketRef, taskId: id, key: z.string().nullable() }),
});

export const ticketLinked = defineEvent({
  type: 'ticket.linked',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'Two tickets were linked with a typed relationship.',
  payload: z.object({ sourceId: id, targetId: id, linkType: z.string() }),
});

export const ticketMerged = defineEvent({
  type: 'ticket.merged',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'A duplicate ticket was merged into a target ticket.',
  payload: z.object({ sourceId: id, sourceNumber: z.string(), targetId: id, targetNumber: z.string() }),
});

// ---- MOD-07 SLA -----------------------------------------------------------
const timerRef = { timerId: id, ticketId: id, targetType: z.string() };

export const slaTimerStarted = defineEvent({
  type: 'sla.timer.started',
  version: 1,
  aggregateType: 'sla_timer',
  webhook: true,
  description: 'An SLA timer started against a policy target.',
  payload: z.object({ ...timerRef, dueAt: z.string(), policyId: id }),
});

export const slaTimerWarning = defineEvent({
  type: 'sla.timer.warning',
  version: 1,
  aggregateType: 'sla_timer',
  webhook: true,
  description: 'An SLA timer crossed a warning threshold.',
  payload: z.object({ ...timerRef, dueAt: z.string(), threshold: z.number(), remainingMs: z.number() }),
});

export const slaTimerBreached = defineEvent({
  type: 'sla.timer.breached',
  version: 1,
  aggregateType: 'sla_timer',
  webhook: true,
  description: 'An SLA target was missed.',
  payload: z.object({ ...timerRef, dueAt: z.string() }),
});

export const slaTimerPaused = defineEvent({
  type: 'sla.timer.paused',
  version: 1,
  aggregateType: 'sla_timer',
  webhook: true,
  description: 'An SLA timer paused, for example while pending the requester.',
  payload: z.object({ ...timerRef, reason: z.string(), remainingMs: z.number() }),
});

export const slaTimerResumed = defineEvent({
  type: 'sla.timer.resumed',
  version: 1,
  aggregateType: 'sla_timer',
  webhook: true,
  description: 'A paused SLA timer resumed.',
  payload: z.object({ ...timerRef, dueAt: z.string() }),
});

export const slaTimerMet = defineEvent({
  type: 'sla.timer.met',
  version: 1,
  aggregateType: 'sla_timer',
  webhook: true,
  description: 'An SLA target was met.',
  payload: z.object({ ...timerRef, metAt: z.string() }),
});

// ---- MOD-11 Notifications -------------------------------------------------
export const notificationQueued = defineEvent({
  type: 'notification.queued',
  version: 1,
  aggregateType: 'notification',
  webhook: false,
  description: 'A notification was rendered and queued for a recipient and channel.',
  payload: z.object({ notificationId: id, recipientId: id, channel: z.string(), templateKey: z.string() }),
});

export const notificationSent = defineEvent({
  type: 'notification.sent',
  version: 1,
  aggregateType: 'notification',
  webhook: false,
  description: 'A notification was accepted by its delivery provider.',
  payload: z.object({ notificationId: id, channel: z.string(), providerRef: z.string().nullable() }),
});

export const notificationFailed = defineEvent({
  type: 'notification.failed',
  version: 1,
  aggregateType: 'notification',
  webhook: false,
  description: 'A notification could not be delivered after its retry budget.',
  payload: z.object({ notificationId: id, channel: z.string(), error: z.string() }),
});

// ---- MOD-13 Administration ------------------------------------------------
export const configPublished = defineEvent({
  type: 'config.published',
  version: 1,
  aggregateType: 'setting',
  webhook: false,
  description: 'A setting or definition version was published; caches must drop.',
  payload: z.object({ key: z.string(), scopeType: z.string(), scopeId: z.string().nullable(), version: z.number().int() }),
});

export const configRolledBack = defineEvent({
  type: 'config.rolled_back',
  version: 1,
  aggregateType: 'setting',
  webhook: false,
  description: 'A setting was rolled back to an earlier version.',
  payload: z.object({ key: z.string(), scopeType: z.string(), scopeId: z.string().nullable(), toVersion: z.number().int() }),
});

export const moduleEnabled = defineEvent({
  type: 'module.enabled',
  version: 1,
  aggregateType: 'module',
  webhook: false,
  description: 'A module was enabled for a tenant.',
  payload: z.object({ moduleId: z.string(), version: z.string() }),
});

export const moduleDisabled = defineEvent({
  type: 'module.disabled',
  version: 1,
  aggregateType: 'module',
  webhook: false,
  description: 'A module was disabled for a tenant; its routes now return 404.',
  payload: z.object({ moduleId: z.string() }),
});

// ---- MOD-15 Security ------------------------------------------------------
export const securityAlertRaised = defineEvent({
  type: 'security.alert.raised',
  version: 1,
  aggregateType: 'security_alert',
  webhook: false,
  description: 'A security signal needs attention (break-glass use, audit chain break, login bursts).',
  payload: z.object({ alertId: id, alertType: z.string(), severity: z.enum(['low', 'medium', 'high', 'critical']), details: z.record(z.unknown()) }),
});

// ---- MOD-14 Integrations --------------------------------------------------
export const webhookDeliveryFailed = defineEvent({
  type: 'integration.webhook.delivery.failed',
  version: 1,
  aggregateType: 'webhook_subscription',
  webhook: false,
  description: 'A webhook delivery exhausted its retries and was dead-lettered.',
  payload: z.object({ subscriptionId: id, eventId: id, attempts: z.number().int(), lastStatus: z.number().int().nullable() }),
});

// ---- MOD-09 Search --------------------------------------------------------
export const searchDocumentIndexed = defineEvent({
  type: 'search.document.indexed',
  version: 1,
  aggregateType: 'search_document',
  webhook: false,
  description: 'A search projection row was written; used to measure index freshness.',
  payload: z.object({ entityType: z.string(), entityId: id, lagMs: z.number().int() }),
});

// ---- MOD-06 Workflow and rules (PH-2) -------------------------------------
export const ruleApplied = defineEvent({
  type: 'rule.applied',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'A business rule matched an event and changed a ticket.',
  payload: z.object({
    ruleId: id,
    ruleKey: z.string(),
    ruleVersion: z.number().int(),
    event: z.string(),
    ticketId: id.nullable(),
    actions: z.array(z.string()),
  }),
});

// ---- MOD-17 Approvals (PH-2) ----------------------------------------------
export const approvalRequested = defineEvent({
  type: 'approval.requested',
  version: 1,
  aggregateType: 'approval_request',
  webhook: true,
  description: 'An approval was opened and is waiting on its first step.',
  payload: z.object({
    requestId: id,
    subjectType: z.string(),
    subjectId: id,
    ticketId: id.nullable(),
    policyKey: z.string(),
  }),
});

export const approvalDecided = defineEvent({
  type: 'approval.decided',
  version: 1,
  aggregateType: 'approval_request',
  webhook: true,
  description: 'An approval reached a final outcome.',
  payload: z.object({
    requestId: id,
    subjectType: z.string(),
    subjectId: id,
    ticketId: id.nullable(),
    outcome: z.enum(['approved', 'rejected']),
  }),
});

// ---- MOD-03 Omnichannel (PH-2) --------------------------------------------
export const channelMessageReceived = defineEvent({
  type: 'channel.message.received',
  version: 1,
  aggregateType: 'inbound_message',
  webhook: false,
  description: 'A message arrived on a channel and was accepted for processing.',
  payload: z.object({
    messageId: id,
    channel: z.string(),
    accountId: id,
    fromAddress: z.string(),
    ticketId: id.nullable(),
  }),
});

export const channelHealthDegraded = defineEvent({
  type: 'channel.health.degraded',
  version: 1,
  aggregateType: 'channel_account',
  webhook: true,
  description: 'A channel account is failing or has gone quiet, and needs an administrator.',
  payload: z.object({ accountId: id, channel: z.string(), reason: z.string(), failureCount: z.number().int() }),
});

export const eventCatalogue = [
  tenantCreated, tenantSuspended,
  userProvisioned, userUpdated, userDeactivated, roleAssignmentChanged,
  authLoginSucceeded, authLoginFailed, sessionRevoked,
  ticketCreated, ticketUpdated, ticketStatusChanged, ticketAssigned, ticketCommentAdded,
  ticketAttachmentAdded, ticketAttachmentScanned, ticketTaskCreated, ticketTaskCompleted,
  ticketLinked, ticketMerged,
  slaTimerStarted, slaTimerWarning, slaTimerBreached, slaTimerPaused, slaTimerResumed, slaTimerMet,
  notificationQueued, notificationSent, notificationFailed,
  configPublished, configRolledBack, moduleEnabled, moduleDisabled,
  securityAlertRaised, webhookDeliveryFailed, searchDocumentIndexed,
  ruleApplied,
  approvalRequested, approvalDecided,
  channelMessageReceived, channelHealthDegraded,
] as const;

export const eventTypes = eventCatalogue.map((e) => e.type);
export type EventType = (typeof eventCatalogue)[number]['type'];

export function findEvent(type: string) {
  return eventCatalogue.find((e) => e.type === type);
}
