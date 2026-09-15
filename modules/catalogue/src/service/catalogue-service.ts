import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { events, exprSchema, type FormDefinition, type FormValues } from '@itsm/contracts';
import { ticketService } from '@itsm/module-ticket';
import { approvalService } from '@itsm/module-approvals';
import { isEntitled, type RequesterFacts } from '../domain/entitlement.js';
import { currentVersion, validateSubmission } from './form-service.js';

/**
 * MOD-05 service catalogue and request fulfilment.
 *
 * Submitting a request is the one place in the platform where an unprivileged
 * person's input becomes a ticket with a service, a group and a priority
 * attached — so every one of those comes from the published catalogue item,
 * never from the request body. A requester who could name their own group
 * could route work anywhere; one who could name their own priority could make
 * everything a P1.
 */

export const serviceSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  orgId: z.string().uuid().nullable().optional(),
});

export const requestTypeSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  serviceKey: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  shortSummary: z.string().max(200).optional(),
  formKey: z.string().min(1).optional(),
  entitlement: exprSchema.nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).default('P3'),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function createService(ctx: TenantContext, input: unknown) {
  authz.require(ctx, 'catalogue.manage');
  const parsed = serviceSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const existing = await tx.service.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a service with the key ${parsed.key} already exists`);

    const service = await tx.service.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        orgId: parsed.orgId ?? null,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        ownerId: parsed.ownerId ?? null,
        groupId: parsed.groupId ?? null,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'catalogue.service.created',
      targetType: 'service',
      targetId: service.id,
      after: { key: service.key, name: service.name },
    });
    return service;
  });
}

export async function createRequestType(ctx: TenantContext, input: unknown) {
  authz.require(ctx, 'catalogue.manage');
  const parsed = requestTypeSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const service = await tx.service.findFirst({ where: { key: parsed.serviceKey } });
    if (!service) throw new NotFoundError('that service does not exist');

    const existing = await tx.requestType.findFirst({ where: { key: parsed.key } });
    if (existing) throw new ConflictError(`a request type with the key ${parsed.key} already exists`);

    // A tile pointing at a form nobody published shows an empty page.
    if (parsed.formKey) {
      const form = await currentVersion(tx, parsed.formKey);
      if (!form) {
        throw new ValidationError(
          `the form ${parsed.formKey} is not published, so this request could not be filled in`,
          [{ field: 'formKey', code: 'not_published', message: parsed.formKey }],
        );
      }
    }

    const requestType = await tx.requestType.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        serviceId: service.id,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        shortSummary: parsed.shortSummary ?? null,
        formKey: parsed.formKey ?? null,
        entitlement: (parsed.entitlement ?? null) as never,
        groupId: parsed.groupId ?? null,
        priority: parsed.priority,
        sortOrder: parsed.sortOrder,
        status: 'draft',
      },
    });
    await recordAudit(tx, ctx, {
      action: 'catalogue.item.created',
      targetType: 'request_type',
      targetId: requestType.id,
      after: { key: requestType.key, serviceKey: parsed.serviceKey },
    });
    return requestType;
  });
}

export async function publishRequestType(ctx: TenantContext, key: string) {
  authz.require(ctx, 'catalogue.manage');
  return transaction(ctx, async (tx) => {
    const requestType = await tx.requestType.findFirst({ where: { key } });
    if (!requestType) throw new NotFoundError('request type not found');

    if (requestType.formKey) {
      const form = await currentVersion(tx, requestType.formKey);
      if (!form) {
        throw new ValidationError(`the form ${requestType.formKey} is not published`, [
          { field: 'formKey', code: 'not_published', message: requestType.formKey },
        ]);
      }
    }

    const published = await tx.requestType.update({
      where: { id: requestType.id },
      data: { status: 'published', publishedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: 'catalogue.item.published',
      targetType: 'request_type',
      targetId: requestType.id,
      before: { status: requestType.status },
      after: { status: 'published' },
    });
    await publish(tx, ctx, {
      definition: events.catalogueItemPublished,
      aggregateId: requestType.id,
      payload: { requestTypeId: requestType.id, key: requestType.key, serviceId: requestType.serviceId },
    });
    return published;
  });
}

// ---------------------------------------------------------------------------
// The requester's view
// ---------------------------------------------------------------------------

/** The facts an entitlement is evaluated against, for the signed-in person. */
export async function factsFor(tx: Tx, ctx: TenantContext): Promise<RequesterFacts> {
  const userId = ctx.actor.id;
  const user = userId ? await tx.user.findFirst({ where: { id: userId } }) : null;

  const memberships = userId ? await tx.teamMembership.findMany({ where: { userId } }) : [];
  const teams = memberships.length
    ? await tx.team.findMany({ where: { id: { in: memberships.map((m) => m.teamId) } } })
    : [];
  const assignments = userId ? await tx.roleAssignment.findMany({ where: { userId } }) : [];
  const roles = assignments.length
    ? await tx.role.findMany({ where: { id: { in: assignments.map((a) => a.roleId) } } })
    : [];

  return {
    userId,
    orgId: ctx.organisationIds[0] ?? user?.primaryOrgId ?? null,
    primaryOrgId: user?.primaryOrgId ?? null,
    teamKeys: teams.map((team) => team.key),
    roleKeys: roles.map((role) => role.key),
    vip: user?.vip ?? false,
    tier: user?.tier ?? null,
    isExternal: user?.isExternal ?? false,
  };
}

/**
 * The catalogue as this person may see it.
 *
 * Filtered by entitlement, not merely marked: an item somebody cannot raise
 * must not appear, because its name alone can disclose that the thing exists
 * and who is likely to have one.
 */
export async function browse(ctx: TenantContext) {
  authz.require(ctx, 'catalogue.read');

  return transaction(ctx, async (tx) => {
    const facts = await factsFor(tx, ctx);
    const items = await tx.requestType.findMany({
      where: { status: 'published' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const entitled = items.filter((item) => isEntitled(item.entitlement as never, facts));

    const services = entitled.length
      ? await tx.service.findMany({ where: { id: { in: entitled.map((item) => item.serviceId) } } })
      : [];
    const byId = new Map(services.map((service) => [service.id, service]));

    return entitled.map((item) => ({
      key: item.key,
      name: item.name,
      description: item.description,
      shortSummary: item.shortSummary,
      formKey: item.formKey,
      service: byId.get(item.serviceId)?.name ?? null,
      serviceKey: byId.get(item.serviceId)?.key ?? null,
    }));
  });
}

/** The item and the form to render, if this person is entitled to it. */
export async function openRequest(ctx: TenantContext, key: string) {
  authz.require(ctx, 'catalogue.read');

  return transaction(ctx, async (tx) => {
    const item = await tx.requestType.findFirst({ where: { key, status: 'published' } });
    // 404, not 403: an item somebody is not entitled to must not be
    // distinguishable from one that does not exist.
    if (!item) throw new NotFoundError('request type not found');

    const facts = await factsFor(tx, ctx);
    if (!isEntitled(item.entitlement as never, facts)) throw new NotFoundError('request type not found');

    const form = item.formKey ? await currentVersion(tx, item.formKey) : null;
    return {
      key: item.key,
      name: item.name,
      description: item.description,
      form: form ? (form.version.document as unknown as FormDefinition) : null,
    };
  });
}

export interface SubmitResult {
  ticketId: string;
  ticketNumber: string;
  submissionId: string;
  approvalId: string | null;
}

/**
 * Raises a request from a catalogue item.
 *
 * The entitlement is checked again here. Filtering the catalogue is a
 * presentation decision; this is the control, and without it anybody who
 * guessed a key could raise anything.
 */
export async function submitRequest(
  ctx: TenantContext,
  key: string,
  answers: FormValues,
): Promise<SubmitResult> {
  authz.require(ctx, 'catalogue.request');
  const requesterId = ctx.actor.id;
  if (!requesterId) throw new ForbiddenError('catalogue.request', 'only a person can raise a request');

  return transaction(ctx, async (tx) => {
    const item = await tx.requestType.findFirst({ where: { key, status: 'published' } });
    if (!item) throw new NotFoundError('request type not found');

    const facts = await factsFor(tx, ctx);
    if (!isEntitled(item.entitlement as never, facts)) throw new NotFoundError('request type not found');

    let accepted: FormValues = {};
    let formVersionId: string | null = null;

    if (item.formKey) {
      const form = await currentVersion(tx, item.formKey);
      if (!form) throw new ValidationError('the form for this request is no longer published');

      const definition = form.version.document as unknown as FormDefinition;
      const outcome = validateSubmission(definition, answers, { user: facts as never });
      if (!outcome.ok) {
        throw new ValidationError(
          'some answers need attention',
          Object.entries(outcome.errors).map(([field, message]) => ({ field, code: 'invalid', message })),
        );
      }
      accepted = outcome.accepted;
      formVersionId = form.version.id;
    }

    // Everything that routes or prioritises the ticket comes from the item, not
    // from the request body.
    const service = await tx.service.findFirst({ where: { id: item.serviceId } });
    const ticket = await ticketService.createRequestFromCatalogue(ctx, tx, {
      title: item.name,
      description: describeAnswers(accepted),
      requesterId,
      serviceId: item.serviceId,
      groupId: item.groupId ?? service?.groupId ?? null,
      priority: item.priority,
      answers: accepted as Record<string, unknown>,
    });

    const submissionId = newId();
    if (formVersionId) {
      await tx.formSubmission.create({
        data: {
          id: submissionId,
          tenantId: ctx.tenantId,
          requestTypeId: item.id,
          formVersionId,
          ticketId: ticket.id,
          submittedBy: requesterId,
          answers: accepted as never,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: 'request.submitted',
      targetType: 'ticket',
      targetId: ticket.id,
      after: { requestType: item.key, number: ticket.number },
    });
    await publish(tx, ctx, {
      definition: events.requestSubmitted,
      aggregateId: ticket.id,
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        requestTypeId: item.id,
        requestTypeKey: item.key,
        requesterId,
      },
    });

    // An approval policy for `request` subjects opens here, in the same
    // transaction, so a request that needs one is never briefly approved.
    const approval = await approvalService.requestApproval(ctx, tx, {
      subjectType: 'request',
      subjectId: ticket.id,
      ticketId: ticket.id,
      subjectUserId: requesterId,
      serviceId: item.serviceId,
      facts: { requestType: { key: item.key }, answers: accepted },
    });

    return {
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      submissionId: formVersionId ? submissionId : '',
      approvalId: approval?.id ?? null,
    };
  });
}

/** A readable summary of the answers, for the ticket description. */
function describeAnswers(answers: FormValues): string {
  const entries = Object.entries(answers);
  if (entries.length === 0) return 'Raised from the service catalogue.';
  return entries
    .map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(', ') : String(value ?? '')}`)
    .join('\n');
}
