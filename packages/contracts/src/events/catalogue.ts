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

// ---- MOD-05 Service catalogue (PH-2) --------------------------------------
export const catalogueItemPublished = defineEvent({
  type: 'catalogue.item.published',
  version: 1,
  aggregateType: 'request_type',
  webhook: true,
  description: 'A catalogue item became available to raise.',
  payload: z.object({ requestTypeId: id, key: z.string(), serviceId: id }),
});

export const requestSubmitted = defineEvent({
  type: 'request.submitted',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'Somebody raised a request from the service catalogue.',
  payload: z.object({
    ticketId: id,
    number: z.string(),
    requestTypeId: id,
    requestTypeKey: z.string(),
    requesterId: id,
  }),
});

// ---- MOD-09 Knowledge (PH-3) ----------------------------------------------
export const knowledgeArticleSubmitted = defineEvent({
  type: 'knowledge.article.submitted',
  version: 1,
  aggregateType: 'knowledge_article',
  webhook: true,
  description: 'An article was sent for review, which may start an approval.',
  payload: z.object({ articleId: id, key: z.string(), version: z.number().int(), authorId: id.nullable() }),
});

export const knowledgeArticlePublished = defineEvent({
  type: 'knowledge.article.published',
  version: 1,
  aggregateType: 'knowledge_article',
  webhook: true,
  description: 'A version of an article became the one readers get.',
  payload: z.object({
    articleId: id,
    key: z.string(),
    version: z.number().int(),
    audience: z.string(),
    /** Set when this publication restored an earlier version's content. */
    rolledBackFrom: z.number().int().nullable(),
  }),
});

export const knowledgeArticleRetired = defineEvent({
  type: 'knowledge.article.retired',
  version: 1,
  aggregateType: 'knowledge_article',
  webhook: true,
  description: 'An article was withdrawn and is no longer served to readers.',
  payload: z.object({ articleId: id, key: z.string(), reason: z.string().nullable() }),
});

export const knowledgeArticleFeedback = defineEvent({
  type: 'knowledge.article.feedback',
  version: 1,
  aggregateType: 'knowledge_article',
  webhook: false,
  description: 'A reader said whether an article answered their question.',
  payload: z.object({ articleId: id, userId: id, helpful: z.boolean(), comment: z.string().nullable() }),
});

// ---- MOD-06-E1 Workflow engine (PH-3) --------------------------------------
export const workflowRunStarted = defineEvent({
  type: 'workflow.run.started',
  version: 1,
  aggregateType: 'workflow_run',
  webhook: true,
  description: 'A workflow began running against a ticket or on its own.',
  payload: z.object({
    runId: id,
    definitionId: id,
    definitionKey: z.string(),
    version: z.number().int(),
    ticketId: id.nullable(),
    triggeredBy: z.string(),
  }),
});

export const workflowRunCompleted = defineEvent({
  type: 'workflow.run.completed',
  version: 1,
  aggregateType: 'workflow_run',
  webhook: true,
  description: 'A workflow reached an end step, or stopped because no branch applied.',
  payload: z.object({ runId: id, definitionId: id, ticketId: id.nullable(), status: z.string() }),
});

export const workflowRunFailed = defineEvent({
  type: 'workflow.run.failed',
  version: 1,
  aggregateType: 'workflow_run',
  webhook: true,
  description: 'A step failed after its retries; the run is paused for an operator.',
  payload: z.object({ runId: id, definitionId: id, ticketId: id.nullable(), stepKey: z.string(), error: z.string() }),
});

// ---- MOD-20 Workload and routing (PH-4) ------------------------------------
export const workloadAssignmentDeclined = defineEvent({
  type: 'workload.assignment.declined',
  version: 1,
  aggregateType: 'ticket',
  webhook: true,
  description: 'Routing found nobody able to take a ticket, and said why.',
  payload: z.object({
    ticketId: id,
    groupId: id.nullable(),
    strategy: z.string(),
    /** A sentence an administrator can act on: "4 of 6 away". */
    reason: z.string(),
    considered: z.number().int(),
  }),
});

export const workloadOnCallOverridden = defineEvent({
  type: 'workload.oncall.overridden',
  version: 1,
  aggregateType: 'oncall_rotation',
  webhook: true,
  description: 'Somebody was recorded as covering an on-call rotation.',
  payload: z.object({
    rotationId: id,
    rotationKey: z.string(),
    userId: id,
    startsAt: z.string(),
    endsAt: z.string(),
  }),
});

// ---- MOD-08-E1 Major incidents (PH-4) --------------------------------------
const incidentRef = { incidentId: id, number: z.string(), severity: z.string() };

export const incidentMajorDeclared = defineEvent({
  type: 'incident.major.declared',
  version: 1,
  aggregateType: 'major_incident',
  webhook: true,
  description: 'A major incident was declared and somebody was put in charge of it.',
  payload: z.object({
    ...incidentRef,
    title: z.string(),
    ticketId: id.nullable(),
    commanderId: id,
    customerFacing: z.boolean(),
    affectedServiceIds: z.array(id),
  }),
});

export const incidentMajorUpdated = defineEvent({
  type: 'incident.major.updated',
  version: 1,
  aggregateType: 'major_incident',
  webhook: true,
  description: 'An entry was added to a major incident\'s timeline, with or without a status change.',
  payload: z.object({
    ...incidentRef,
    updateId: id,
    kind: z.string(),
    /** internal | stakeholders | public. A consumer must honour it. */
    audience: z.string(),
    body: z.string(),
    statusFrom: z.string().nullable(),
    statusTo: z.string().nullable(),
  }),
});

export const incidentMajorResolved = defineEvent({
  type: 'incident.major.resolved',
  version: 1,
  aggregateType: 'major_incident',
  webhook: true,
  description: 'Service was restored. The review is still owed.',
  payload: z.object({ ...incidentRef, ticketId: id.nullable(), durationMinutes: z.number().int() }),
});

export const incidentMajorClosed = defineEvent({
  type: 'incident.major.closed',
  version: 1,
  aggregateType: 'major_incident',
  webhook: true,
  description: 'Resolved, reviewed, and the review published.',
  payload: z.object({ ...incidentRef, reviewPublished: z.boolean() }),
});

export const incidentMajorUpdateOverdue = defineEvent({
  type: 'incident.major.update.overdue',
  version: 1,
  aggregateType: 'major_incident',
  webhook: true,
  description: 'An update the organisation was promised has not been posted.',
  payload: z.object({ ...incidentRef, dueAt: z.string(), overdueMinutes: z.number().int(), commanderId: id }),
});

export const incidentMajorReviewPublished = defineEvent({
  type: 'incident.major.review.published',
  version: 1,
  aggregateType: 'major_incident',
  webhook: true,
  description: 'A post-incident review was published, with the actions somebody owns.',
  payload: z.object({ ...incidentRef, reviewId: id, actionCount: z.number().int() }),
});

// ---- MOD-08-E2 Problem management (PH-4) -----------------------------------
const problemRef = { problemId: id, number: z.string() };

export const problemCreated = defineEvent({
  type: 'problem.created',
  version: 1,
  aggregateType: 'problem',
  webhook: true,
  description: 'A problem was raised, from a major incident, a ticket trend or by hand.',
  payload: z.object({
    ...problemRef,
    title: z.string(),
    priority: z.string(),
    raisedFrom: z.string(),
    majorIncidentId: id.nullable(),
    serviceId: id.nullable(),
  }),
});

export const knownErrorPublished = defineEvent({
  type: 'knownerror.published',
  version: 1,
  aggregateType: 'problem',
  webhook: true,
  description: 'A workaround was published, so the next person to hit this does not lose an hour.',
  payload: z.object({
    ...problemRef,
    symptom: z.string(),
    workaround: z.string(),
    articleKey: z.string().nullable(),
    /** How many tickets are already linked, which is what makes it worth reading. */
    linkedTickets: z.number().int(),
  }),
});

export const knownErrorRetired = defineEvent({
  type: 'knownerror.retired',
  version: 1,
  aggregateType: 'problem',
  webhook: true,
  description: 'A workaround was withdrawn, because following an obsolete one costs the time twice.',
  payload: z.object({ ...problemRef, reason: z.string(), articleKey: z.string().nullable() }),
});

export const problemResolved = defineEvent({
  type: 'problem.resolved',
  version: 1,
  aggregateType: 'problem',
  webhook: true,
  description: 'A problem was permanently fixed.',
  payload: z.object({
    ...problemRef,
    rootCause: z.string().nullable(),
    linkedTickets: z.number().int(),
    openDays: z.number().int(),
  }),
});

// ---- MOD-08-E3 Change management (PH-4) ------------------------------------
const changeRef = { changeId: id, number: z.string(), kind: z.string() };

export const changeSubmitted = defineEvent({
  type: 'change.submitted',
  version: 1,
  aggregateType: 'change',
  webhook: true,
  description: 'A change was submitted; how it is approved depends on its kind.',
  payload: z.object({
    ...changeRef,
    title: z.string(),
    risk: z.string(),
    serviceId: id.nullable(),
    /** False for a standard change, whose template carried the approval, and
     *  for an emergency change, which owes one afterwards. */
    needsApproval: z.boolean(),
  }),
});

export const changeApproved = defineEvent({
  type: 'change.approved',
  version: 1,
  aggregateType: 'change',
  webhook: true,
  description: 'A change was approved, by a policy, by a template, or after the fact.',
  payload: z.object({ ...changeRef, via: z.string(), retrospective: z.boolean() }),
});

export const changeRejected = defineEvent({
  type: 'change.rejected',
  version: 1,
  aggregateType: 'change',
  webhook: true,
  description: 'A change was refused.',
  payload: z.object({ ...changeRef, reason: z.string().nullable() }),
});

export const changeScheduled = defineEvent({
  type: 'change.scheduled',
  version: 1,
  aggregateType: 'change',
  webhook: true,
  description: 'A change was booked into a period outside every blackout.',
  payload: z.object({
    ...changeRef,
    plannedStartAt: z.string(),
    plannedEndAt: z.string(),
    serviceId: id.nullable(),
    inWindows: z.array(z.string()),
    /** True when the tenant defines change windows and this falls outside them. */
    outsideWindows: z.boolean(),
  }),
});

export const changeClosed = defineEvent({
  type: 'change.closed',
  version: 1,
  aggregateType: 'change',
  webhook: true,
  description: 'A change was closed with an outcome.',
  payload: z.object({
    ...changeRef,
    closeCode: z.string(),
    succeeded: z.boolean(),
    /** Null for an emergency change nobody ever came back to approve, which is
     *  the number worth watching. */
    retrospectiveApprovedAt: z.string().nullable(),
  }),
});

// ---- MOD-10-E1 Assets and the CMDB (PH-4) ----------------------------------
const ciRef = { ciId: id, name: z.string() };

export const ciRegistered = defineEvent({
  type: 'ci.registered',
  version: 1,
  aggregateType: 'configuration_item',
  webhook: true,
  description: 'A configuration item was added to the register.',
  payload: z.object({
    ...ciRef,
    classKey: z.string(),
    criticality: z.string(),
    serviceId: id.nullable(),
    /** manual | import | discovery — a subscriber may well care which. */
    source: z.string(),
  }),
});

export const ciStatusChanged = defineEvent({
  type: 'ci.status.changed',
  version: 1,
  aggregateType: 'configuration_item',
  webhook: true,
  description: 'A configuration item went down, degraded, or came back.',
  payload: z.object({
    ...ciRef,
    from: z.string(),
    to: z.string(),
    criticality: z.string(),
    serviceId: id.nullable(),
    note: z.string().nullable(),
  }),
});

export const ciRetired = defineEvent({
  type: 'ci.retired',
  version: 1,
  aggregateType: 'configuration_item',
  webhook: true,
  description: 'A configuration item was taken out of service; the record stays.',
  payload: z.object({
    ...ciRef,
    reason: z.string(),
    serviceId: id.nullable(),
    /** How many things still pointed at it. Rarely zero, and worth a look when
     *  it is not: either stale rows, or a machine that is still load-bearing. */
    dependants: z.number().int(),
  }),
});

export const assetAssigned = defineEvent({
  type: 'asset.assigned',
  version: 1,
  aggregateType: 'asset',
  webhook: true,
  description: 'An asset was handed to somebody, or put somewhere.',
  payload: z.object({
    assetId: id,
    tag: z.string(),
    userId: id.nullable(),
    location: z.string().nullable(),
    ciId: id.nullable(),
  }),
});

export const assetRetired = defineEvent({
  type: 'asset.retired',
  version: 1,
  aggregateType: 'asset',
  webhook: true,
  description: 'An asset left the estate.',
  payload: z.object({
    assetId: id,
    tag: z.string(),
    reason: z.string(),
    /** True where it was disposed of rather than shelved. */
    disposed: z.boolean(),
    ciId: id.nullable(),
  }),
});

// ---- MOD-10-E2 Discovery, reconciliation and contracts (PH-4) ---------------

export const discoveryRunCompleted = defineEvent({
  type: 'discovery.run.completed',
  version: 1,
  aggregateType: 'discovery_run',
  webhook: true,
  description: 'A discovery source was pulled; what it found is waiting to be confirmed.',
  payload: z.object({
    runId: id,
    sourceId: id,
    status: z.string(),
    seen: z.number().int(),
    proposed: z.number().int(),
    /** Fields a reconciliation rule says the source owns, written without asking. */
    applied: z.number().int(),
    /** Records the mapping could not read. Rising is the signal worth watching:
     *  a feed whose shape changed rejects everything and reports it here. */
    rejected: z.number().int(),
    error: z.string().nullable(),
  }),
});

export const discoveryProposalDecided = defineEvent({
  type: 'discovery.proposal.decided',
  version: 1,
  aggregateType: 'discovery_proposal',
  webhook: true,
  description: 'Somebody accepted or rejected what discovery suggested.',
  payload: z.object({
    proposalId: id,
    sourceId: id,
    kind: z.string(),
    outcome: z.string(),
    ciId: id.nullable(),
    reason: z.string().nullable(),
  }),
});

export const contractExpiring = defineEvent({
  type: 'contract.expiring',
  version: 1,
  aggregateType: 'contract',
  webhook: true,
  description: 'A contract is inside its notice period, or about to end.',
  payload: z.object({
    contractId: id,
    reference: z.string(),
    name: z.string(),
    supplier: z.string(),
    endsOn: z.string(),
    /** Days until notice must be given. Negative means the window has closed
     *  and renewal is no longer a choice — the number people act on. */
    daysToNotice: z.number().int().nullable(),
    daysToEnd: z.number().int(),
    autoRenews: z.boolean(),
  }),
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
  catalogueItemPublished, requestSubmitted,
  knowledgeArticleSubmitted, knowledgeArticlePublished, knowledgeArticleRetired, knowledgeArticleFeedback,
  workflowRunStarted, workflowRunCompleted, workflowRunFailed,
  workloadAssignmentDeclined, workloadOnCallOverridden,
  incidentMajorDeclared, incidentMajorUpdated, incidentMajorResolved, incidentMajorClosed,
  incidentMajorUpdateOverdue, incidentMajorReviewPublished,
  problemCreated, knownErrorPublished, knownErrorRetired, problemResolved,
  changeSubmitted, changeApproved, changeRejected, changeScheduled, changeClosed,
  ciRegistered, ciStatusChanged, ciRetired, assetAssigned, assetRetired,
  discoveryRunCompleted, discoveryProposalDecided, contractExpiring,
] as const;

export const eventTypes = eventCatalogue.map((e) => e.type);
export type EventType = (typeof eventCatalogue)[number]['type'];

export function findEvent(type: string) {
  return eventCatalogue.find((e) => e.type === type);
}
