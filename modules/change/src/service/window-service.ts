import { z } from 'zod';
import {
  type TenantContext,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { covers, type Window } from '../domain/windows.js';

/**
 * Change windows, blackouts and standard change templates.
 *
 * The administrative half of change control. Everything here exists so that the
 * decisions in `change-service` — refuse this period, inherit this approval —
 * are made against something a person wrote down rather than against a
 * convention somebody remembers.
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const windowSchema = z
  .object({
    kind: z.enum(['change', 'blackout']),
    name: z.string().min(1).max(200),
    reason: z.string().max(1000).optional(),
    timeZone: z.string().min(1).max(64),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    weekday: z.enum(WEEKDAYS).optional(),
    startTime: z.string().regex(HHMM, 'HH:MM').optional(),
    endTime: z.string().regex(HHMM, 'HH:MM').optional(),
    serviceIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .refine((value) => Boolean(value.startsAt && value.endsAt) || Boolean(value.weekday && value.startTime && value.endTime), {
    // A window that is neither absolute nor weekly covers nothing, and a
    // blackout that covers nothing is the most dangerous row in the table: it
    // looks like a control and is not one.
    message: 'give either a start and end, or a weekday with a start and end time',
  })
  .refine((value) => !(value.startsAt && value.endsAt) || value.endsAt.getTime() > value.startsAt.getTime(), {
    message: 'a window cannot end before it starts',
  });

export async function createWindow(ctx: TenantContext, input: z.input<typeof windowSchema>) {
  authz.require(ctx, 'change.manage');
  const parsed = windowSchema.parse(input);

  // Proved usable before it is stored, by asking it a question: an unreadable
  // time zone in a blackout is discovered when it fails to block something.
  try {
    covers(parsed as Window, new Date());
  } catch (error) {
    throw new ValidationError(`this window could not be read: ${(error as Error).message}`);
  }

  return transaction(ctx, async (tx) => {
    const id = newId();
    const window = await tx.changeWindow.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        kind: parsed.kind,
        name: parsed.name,
        reason: parsed.reason ?? null,
        timeZone: parsed.timeZone,
        startsAt: parsed.startsAt ?? null,
        endsAt: parsed.endsAt ?? null,
        weekday: parsed.weekday ?? null,
        startTime: parsed.startTime ?? null,
        endTime: parsed.endTime ?? null,
        serviceIds: parsed.serviceIds,
        status: 'active',
        createdBy: ctx.actor.id,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'change.window.created',
      targetType: 'change_window',
      targetId: id,
      after: { kind: parsed.kind, name: parsed.name, timeZone: parsed.timeZone },
    });
    return window;
  });
}

export async function listWindows(ctx: TenantContext, kind?: 'change' | 'blackout') {
  authz.require(ctx, 'change.read');
  return transaction(ctx, (tx) =>
    tx.changeWindow.findMany({
      where: { status: 'active', ...(kind ? { kind } : {}) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      take: 200,
    }),
  );
}

export async function retireWindow(ctx: TenantContext, id: string) {
  authz.require(ctx, 'change.manage');
  return transaction(ctx, async (tx) => {
    const window = await tx.changeWindow.findFirst({ where: { id } });
    if (!window) throw new NotFoundError('change window', id);
    const retired = await tx.changeWindow.update({ where: { id }, data: { status: 'retired' } });
    await recordAudit(tx, ctx, {
      action: 'change.window.retired',
      targetType: 'change_window',
      targetId: id,
      before: { kind: window.kind, name: window.name },
    });
    return retired;
  });
}

// ---------------------------------------------------------------------------
// Standard change templates
// ---------------------------------------------------------------------------

export const templateSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/, 'lower case, digits and hyphens'),
  name: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  implementationPlan: z.string().max(20_000).optional(),
  backoutPlan: z.string().max(20_000).optional(),
  testPlan: z.string().max(20_000).optional(),
});

export async function createTemplate(ctx: TenantContext, input: z.input<typeof templateSchema>) {
  authz.require(ctx, 'change.manage');
  const parsed = templateSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const id = newId();
    const template = await tx.standardChangeTemplate.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        risk: parsed.risk,
        implementationPlan: parsed.implementationPlan ?? null,
        backoutPlan: parsed.backoutPlan ?? null,
        testPlan: parsed.testPlan ?? null,
        status: 'draft',
        version: 1,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'change.template.created',
      targetType: 'standard_change_template',
      targetId: id,
      after: { key: parsed.key, risk: parsed.risk },
    });
    return template;
  });
}

/**
 * Publishes a template, which is the act of pre-approving every change raised
 * from it.
 *
 * A template with no back-out plan is refused. It is the one field worth
 * insisting on, because a standard change is the kind nobody looks at twice —
 * it inherits an approval rather than earning one — and the moment somebody
 * needs the back-out plan is the moment nobody is going to write one.
 */
export async function publishTemplate(ctx: TenantContext, key: string) {
  authz.require(ctx, 'change.manage');

  return transaction(ctx, async (tx) => {
    const template = await tx.standardChangeTemplate.findFirst({ where: { key } });
    if (!template) throw new NotFoundError('standard change template', key);
    if (!template.backoutPlan) {
      throw new ValidationError(
        'a standard change template needs a back-out plan: every change raised from it inherits an approval nobody will look at twice',
      );
    }

    const published = await tx.standardChangeTemplate.update({
      where: { id: template.id },
      data: {
        status: 'published',
        // A new version on each publication, so a change pinned to version 3
        // is not answerable for what version 4 says.
        version: template.status === 'published' ? template.version + 1 : template.version,
        approvedBy: ctx.actor.id,
        approvedAt: new Date(),
      },
    });
    await recordAudit(tx, ctx, {
      action: 'change.template.published',
      targetType: 'standard_change_template',
      targetId: template.id,
      after: { key, version: published.version },
    });
    return published;
  });
}

export async function listTemplates(ctx: TenantContext) {
  authz.require(ctx, 'change.read');
  return transaction(ctx, (tx) =>
    tx.standardChangeTemplate.findMany({ orderBy: { key: 'asc' }, take: 200 }),
  );
}
