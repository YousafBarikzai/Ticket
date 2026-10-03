import { z } from 'zod';
import { events } from '@itsm/contracts';
import { safeHrefSchema } from '@itsm/contracts/links/schemas';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  getSetting,
  metrics,
  newId,
  nextNumber,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import {
  DEFAULT_UPDATE_INTERVAL,
  REVIEW_REQUIRED,
  SEVERITIES,
  STATES,
  assertTransition,
  effectsOf,
  isIncidentState,
  type IncidentState,
  type Severity,
} from '../domain/lifecycle.js';

/**
 * Running a major incident.
 *
 * Three things here are not what a ticket does, and each exists because of a
 * specific way an incident goes wrong:
 *
 *   - **A commander is required at declaration.** The commonest way an hour is
 *     lost is that everybody assumed somebody else was in charge.
 *   - **The timeline is append-only.** It is the evidence the review is written
 *     from, and a timeline somebody can tidy afterwards cannot answer "what did
 *     we know, and when?".
 *   - **Resolved is not closed.** Closing a severe incident needs a published
 *     review, because an organisation that skips the review has the same outage
 *     twice.
 */

export const AUDIENCES = ['internal', 'stakeholders', 'public'] as const;
export const UPDATE_KINDS = ['status', 'comms', 'action', 'observation'] as const;

export const declareSchema = z.object({
  title: z.string().min(1).max(200),
  severity: z.enum(SEVERITIES),
  /** The ticket this was noticed on. Omitted when the outage was seen first. */
  ticketId: z.string().uuid().optional(),
  commanderId: z.string().uuid(),
  commsLeadId: z.string().uuid().optional(),
  scribeId: z.string().uuid().optional(),
  impactSummary: z.string().max(2000).optional(),
  affectedServiceIds: z.array(z.string().uuid()).max(50).default([]),
  customerFacing: z.boolean().default(false),
  /**
   * Everybody working the incident is shown this and clicks it under
   * pressure, so it is `https:` or `mailto:` only (D23), in every tenant:
   * `z.string().url()` took `javascript:` and `http:` alike.
   */
  bridgeUrl: safeHrefSchema.optional(),
  /** Overrides the tenant's default for this severity. */
  updateIntervalMinutes: z.number().int().min(5).max(1440).optional(),
});
export type DeclareInput = z.input<typeof declareSchema>;

/**
 * When a step on the incident happened, for a history written after the fact
 * (A4 §2.3, W2): the shared demo's past major incidents and the live one's
 * first hour. The timeline is append-only, so the instant has to be right at
 * insert — there is no going back to correct it.
 *
 * Omitted, every write is exactly what it was: the database dates the
 * timeline and the row, and the promised next update counts from now.
 */
export interface IncidentClock {
  /** When it happened. Never in the future, and never before the incident's latest timeline entry. */
  at?: Date;
}

/**
 * Declares one.
 *
 * At most one open major incident per ticket, enforced by a partial unique
 * index rather than by looking first: two people declaring the same outage
 * within the same second is not a rare case, it is the normal case, and the
 * symptom is two bridges with half the responders on each.
 */
export async function declare(ctx: TenantContext, input: DeclareInput, clock: IncidentClock = {}) {
  authz.require(ctx, 'incident.major.declare');
  const parsed = declareSchema.parse(input);
  const at = clock.at === undefined ? undefined : pastInstant(clock.at);

  const intervals = await getSetting<Record<string, number>>(ctx, 'incident.updateIntervalMinutes');
  const interval =
    parsed.updateIntervalMinutes ?? intervals?.[parsed.severity] ?? DEFAULT_UPDATE_INTERVAL[parsed.severity];

  return transaction(ctx, async (tx) => {
    if (parsed.ticketId) {
      const ticket = await tx.ticket.findFirst({ where: { id: parsed.ticketId }, select: { id: true, createdAt: true } });
      if (!ticket) throw new NotFoundError('ticket', parsed.ticketId);
      if (at && at < ticket.createdAt) {
        throw new ValidationError('a major incident cannot be declared from a ticket before the ticket was raised', [
          { field: 'at', code: 'before_ticket', message: 'must not be earlier than the ticket it was declared from' },
        ]);
      }
    }

    const id = newId();
    const number = await nextNumber(tx, ctx, 'major_incident', 'MI', 4);
    const declaredAt = at ?? new Date();

    let incident;
    try {
      incident = await tx.majorIncident.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          number,
          ticketId: parsed.ticketId ?? null,
          title: parsed.title,
          severity: parsed.severity,
          status: 'declared',
          impactSummary: parsed.impactSummary ?? null,
          affectedServiceIds: parsed.affectedServiceIds,
          customerFacing: parsed.customerFacing,
          bridgeUrl: parsed.bridgeUrl ?? null,
          commanderId: parsed.commanderId,
          commsLeadId: parsed.commsLeadId ?? null,
          scribeId: parsed.scribeId ?? null,
          updateIntervalMinutes: interval,
          nextUpdateDueAt: new Date(declaredAt.getTime() + interval * 60_000),
          declaredAt,
          declaredBy: ctx.actor.id,
          // The row was last touched when it was declared, not when a
          // history was written into it.
          ...(at ? { updatedAt: at } : {}),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('this ticket already has an open major incident', { ticketId: parsed.ticketId });
      }
      throw error;
    }

    // The declaration is the first line of the timeline, so a review reads from
    // one place rather than from a row plus a list that starts later.
    await addUpdate(tx, ctx, incident.id, {
      kind: 'status',
      audience: 'internal',
      body: `Declared ${parsed.severity}: ${parsed.title}`,
      statusFrom: null,
      statusTo: 'declared',
      occurredAt: at,
    });

    await recordAudit(tx, ctx, {
      action: 'incident.major.declared',
      targetType: 'major_incident',
      targetId: id,
      after: { number, severity: parsed.severity, commanderId: parsed.commanderId, ticketId: parsed.ticketId ?? null },
    });
    await publish(tx, ctx, {
      definition: events.incidentMajorDeclared,
      aggregateId: id,
      payload: {
        incidentId: id,
        number,
        severity: parsed.severity,
        title: parsed.title,
        ticketId: parsed.ticketId ?? null,
        commanderId: parsed.commanderId,
        customerFacing: parsed.customerFacing,
        affectedServiceIds: parsed.affectedServiceIds,
      },
    });

    metrics.increment('incident_major_declared_total', { severity: parsed.severity });
    return incident;
  });
}

export const updateEntrySchema = z.object({
  kind: z.enum(UPDATE_KINDS).default('comms'),
  audience: z.enum(AUDIENCES).default('internal'),
  body: z.string().min(1).max(10_000),
});

/**
 * Adds a line to the timeline.
 *
 * Only a `comms` entry resets the clock. An internal observation is not an
 * update to the organisation, and letting one count would mean a team could
 * talk busily among itself for two hours while everybody outside heard nothing
 * and the platform reported the promise as kept.
 */
export async function postUpdate(ctx: TenantContext, number: string, input: z.input<typeof updateEntrySchema>, clock: IncidentClock = {}) {
  authz.require(ctx, 'incident.major.command');
  const parsed = updateEntrySchema.parse(input);
  const at = clock.at === undefined ? undefined : pastInstant(clock.at);

  return transaction(ctx, async (tx) => {
    const incident = await loadByNumber(tx, number);
    assertAudienceAllowed(incident, parsed.audience);
    if (at) await assertInOrder(tx, incident, at);

    const entry = await addUpdate(tx, ctx, incident.id, { ...parsed, statusFrom: null, statusTo: null, occurredAt: at });

    if (parsed.kind === 'comms' && STATES[stateOf(incident)].communicating) {
      await tx.majorIncident.update({
        where: { id: incident.id },
        data: {
          // The promise counts from the update that kept it.
          nextUpdateDueAt: new Date((at ? at.getTime() : Date.now()) + incident.updateIntervalMinutes * 60_000),
          ...(at ? { updatedAt: at } : {}),
        },
      });
    }

    await publishUpdate(tx, ctx, incident, entry);
    return entry;
  });
}

export const transitionSchema = z.object({
  to: z.string(),
  /** What to tell people about the move. Required, because a status change
   *  nobody explained is the update everybody asks about. */
  note: z.string().min(1).max(10_000),
  audience: z.enum(AUDIENCES).default('internal'),
});

/** Moves the incident, and says so on the timeline in the same transaction. */
export async function transition(ctx: TenantContext, number: string, input: z.input<typeof transitionSchema>, clock: IncidentClock = {}) {
  authz.require(ctx, 'incident.major.command');
  const parsed = transitionSchema.parse(input);
  const at = clock.at === undefined ? undefined : pastInstant(clock.at);
  if (!isIncidentState(parsed.to)) throw new ValidationError(`unknown major incident state: ${parsed.to}`);
  // Bound to a const: narrowing on a property is lost inside the transaction
  // callback, because nothing stops the object being mutated in between.
  const to = parsed.to;
  if (to === 'closed') {
    // Closing is the review's business, not a status change: it has a
    // precondition this path cannot check.
    throw new ValidationError('close a major incident through its review, so the review is not skipped');
  }

  return transaction(ctx, async (tx) => {
    const incident = await loadByNumber(tx, number);
    const from = stateOf(incident);
    assertTransition(from, to);
    assertAudienceAllowed(incident, parsed.audience);
    if (from === to) throw new ValidationError(`this incident is already ${from}`);
    if (at) await assertInOrder(tx, incident, at);

    const stamps = effectsOf(to);
    const data: Record<string, unknown> = { status: to, version: { increment: 1 } };
    const now = at ?? new Date();
    if (at) data.updatedAt = at;
    if (stamps.identifiedAt === 'now' && !incident.identifiedAt) data.identifiedAt = now;
    if (stamps.mitigatedAt === 'now' && !incident.mitigatedAt) data.mitigatedAt = now;
    if (stamps.resolvedAt === 'now') data.resolvedAt = now;
    if (stamps.resolvedAt === 'clear') data.resolvedAt = null;
    if (stamps.closedAt === 'now' && !incident.closedAt) data.closedAt = now;

    // Nothing is owed once the incident stops communicating, and the promise
    // restarts from now if it reopens.
    data.nextUpdateDueAt = STATES[to].communicating
      ? new Date(now.getTime() + incident.updateIntervalMinutes * 60_000)
      : null;

    const moved = await tx.majorIncident.update({ where: { id: incident.id }, data });
    const entry = await addUpdate(tx, ctx, incident.id, {
      kind: 'status',
      audience: parsed.audience,
      body: parsed.note,
      statusFrom: from,
      statusTo: to,
      occurredAt: at,
    });

    await recordAudit(tx, ctx, {
      action: 'incident.major.status.changed',
      targetType: 'major_incident',
      targetId: incident.id,
      before: { status: from },
      after: { status: to },
      reason: parsed.note.slice(0, 1000),
    });
    await publishUpdate(tx, ctx, moved, entry);

    if (to === 'resolved') {
      const durationMinutes = Math.max(
        0,
        Math.round((now.getTime() - incident.declaredAt.getTime()) / 60_000),
      );
      await publish(tx, ctx, {
        definition: events.incidentMajorResolved,
        aggregateId: incident.id,
        payload: {
          incidentId: incident.id,
          number: incident.number,
          severity: incident.severity,
          ticketId: incident.ticketId,
          durationMinutes,
        },
      });
      await openReview(tx, ctx, moved, durationMinutes, at);
      metrics.observe('incident_major_duration_minutes', durationMinutes, { severity: incident.severity });
    }

    if (to === 'stood_down') {
      await recordAudit(tx, ctx, {
        action: 'incident.major.stood_down',
        targetType: 'major_incident',
        targetId: incident.id,
        reason: parsed.note.slice(0, 1000),
      });
    }

    return moved;
  });
}

export const rolesSchema = z.object({
  commanderId: z.string().uuid().optional(),
  commsLeadId: z.string().uuid().nullable().optional(),
  scribeId: z.string().uuid().nullable().optional(),
  /** Why the hand-over happened, for the timeline. */
  note: z.string().max(1000).optional(),
});

/**
 * Hands a role over.
 *
 * Recorded on the timeline rather than only on the row, because "who was
 * running it at 04:10?" is a question a review asks and a current-value column
 * cannot answer. The commander may be replaced but never removed: an incident
 * with nobody in charge is the state this module exists to prevent.
 */
export async function setRoles(ctx: TenantContext, number: string, input: z.input<typeof rolesSchema>, clock: IncidentClock = {}) {
  authz.require(ctx, 'incident.major.command');
  const parsed = rolesSchema.parse(input);
  const at = clock.at === undefined ? undefined : pastInstant(clock.at);

  return transaction(ctx, async (tx) => {
    const incident = await loadByNumber(tx, number);
    if (at) await assertInOrder(tx, incident, at);
    const changed: string[] = [];
    const data: Record<string, unknown> = {};
    if (parsed.commanderId && parsed.commanderId !== incident.commanderId) {
      data.commanderId = parsed.commanderId;
      changed.push('incident commander');
    }
    if (parsed.commsLeadId !== undefined && parsed.commsLeadId !== incident.commsLeadId) {
      data.commsLeadId = parsed.commsLeadId;
      changed.push('communications lead');
    }
    if (parsed.scribeId !== undefined && parsed.scribeId !== incident.scribeId) {
      data.scribeId = parsed.scribeId;
      changed.push('scribe');
    }
    if (changed.length === 0) return incident;
    if (at) data.updatedAt = at;

    const updated = await tx.majorIncident.update({ where: { id: incident.id }, data });
    await addUpdate(tx, ctx, incident.id, {
      kind: 'action',
      audience: 'internal',
      body: parsed.note ?? `Handed over: ${changed.join(', ')}.`,
      statusFrom: null,
      statusTo: null,
      occurredAt: at,
    });
    await recordAudit(tx, ctx, {
      action: 'incident.major.roles.changed',
      targetType: 'major_incident',
      targetId: incident.id,
      before: { commanderId: incident.commanderId, commsLeadId: incident.commsLeadId, scribeId: incident.scribeId },
      after: { commanderId: updated.commanderId, commsLeadId: updated.commsLeadId, scribeId: updated.scribeId },
    });
    return updated;
  });
}

export async function listIncidents(ctx: TenantContext, filter: { status?: string; severity?: string; open?: boolean } = {}) {
  authz.require(ctx, 'incident.major.read');
  return transaction(ctx, async (tx) =>
    tx.majorIncident.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.severity ? { severity: filter.severity } : {}),
        ...(filter.open ? { status: { notIn: ['closed', 'stood_down'] } } : {}),
      },
      orderBy: { declaredAt: 'desc' },
      take: 100,
    }),
  );
}

/**
 * One incident and its timeline.
 *
 * `audience` narrows the timeline rather than the incident: somebody who may
 * see that an incident exists is not thereby entitled to the internal note
 * naming the supplier who caused it.
 */
export async function getIncident(ctx: TenantContext, number: string, audience: 'internal' | 'stakeholders' | 'public' = 'internal') {
  authz.require(ctx, 'incident.major.read');
  return transaction(ctx, async (tx) => {
    const incident = await loadByNumber(tx, number);
    const visible = audienceAtOrBelow(audience);
    const updates = await tx.majorIncidentUpdate.findMany({
      where: { incidentId: incident.id, audience: { in: visible } },
      orderBy: { occurredAt: 'asc' },
      take: 1000,
    });
    const review = await tx.postIncidentReview.findFirst({ where: { incidentId: incident.id } });
    return { incident, updates, review };
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function loadByNumber(tx: Tx, number: string) {
  const incident = await tx.majorIncident.findFirst({ where: { number } });
  if (!incident) throw new NotFoundError('major incident', number);
  return incident;
}

function stateOf(incident: { status: string }): IncidentState {
  return isIncidentState(incident.status) ? incident.status : 'declared';
}

/** The audiences a reader at this level may see, widest first. */
function audienceAtOrBelow(audience: 'internal' | 'stakeholders' | 'public'): string[] {
  if (audience === 'public') return ['public'];
  if (audience === 'stakeholders') return ['public', 'stakeholders'];
  return ['public', 'stakeholders', 'internal'];
}

/**
 * An incident nobody outside can see has nothing to say publicly.
 *
 * Refused rather than downgraded: silently turning a public update into an
 * internal one would leave the person who wrote it believing customers had been
 * told.
 */
function assertAudienceAllowed(incident: { customerFacing: boolean }, audience: string): void {
  if (audience === 'public' && !incident.customerFacing) {
    throw new ValidationError(
      'this incident is not marked customer-facing, so it has no public audience; mark it customer-facing first',
    );
  }
}

async function addUpdate(
  tx: Tx,
  ctx: TenantContext,
  incidentId: string,
  entry: { kind: string; audience: string; body: string; statusFrom: string | null; statusTo: string | null; occurredAt?: Date | undefined },
) {
  return tx.majorIncidentUpdate.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      incidentId,
      kind: entry.kind,
      audience: entry.audience,
      body: entry.body,
      statusFrom: entry.statusFrom,
      statusTo: entry.statusTo,
      authorId: ctx.actor.id,
      // Append-only: a history's entry is dated when it happened, at insert,
      // or never. Without a clock the database dates it, as always.
      ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
    },
  });
}

/**
 * A supplied clock, once it is known to be a real instant that has already
 * happened. A history records the past; an update dated after now would be a
 * promise kept before anybody made it.
 */
function pastInstant(at: Date): Date {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new ValidationError('the time given is not a date', [{ field: 'at', code: 'invalid', message: 'not a date' }]);
  }
  if (at.getTime() > Date.now()) {
    throw new ValidationError('a major incident cannot be dated in the future', [
      { field: 'at', code: 'in_future', message: 'must not be later than now' },
    ]);
  }
  return at;
}

/**
 * Refuses a step dated before the incident's latest timeline entry, or before
 * it was declared. The timeline is the evidence a review is written from and
 * it cannot be edited afterwards, so a history must be written oldest first;
 * a step slotted in behind a later one would also leave the stamps and the
 * promised next update computed from the wrong moment.
 */
async function assertInOrder(tx: Tx, incident: { id: string; declaredAt: Date }, at: Date): Promise<void> {
  const latest = await tx.majorIncidentUpdate.findFirst({
    where: { incidentId: incident.id },
    orderBy: { occurredAt: 'desc' },
    select: { occurredAt: true },
  });
  const floor = latest && latest.occurredAt > incident.declaredAt ? latest.occurredAt : incident.declaredAt;
  if (at < floor) {
    throw new ValidationError('the timeline only runs forwards', [
      { field: 'at', code: 'out_of_order', message: `must not be earlier than ${floor.toISOString()}, the incident's latest entry` },
    ]);
  }
}

async function publishUpdate(
  tx: Tx,
  ctx: TenantContext,
  incident: { id: string; number: string; severity: string },
  entry: { id: string; kind: string; audience: string; body: string; statusFrom: string | null; statusTo: string | null },
) {
  await publish(tx, ctx, {
    definition: events.incidentMajorUpdated,
    aggregateId: incident.id,
    payload: {
      incidentId: incident.id,
      number: incident.number,
      severity: incident.severity,
      updateId: entry.id,
      kind: entry.kind,
      audience: entry.audience,
      body: entry.body,
      statusFrom: entry.statusFrom,
      statusTo: entry.statusTo,
    },
  });
}

/**
 * Opens the review the moment the incident resolves.
 *
 * Created here rather than waiting for somebody to start one, because a review
 * that has to be remembered is a review that is not written. It starts as a
 * draft with a due date and an empty body, which is a thing a queue can hold.
 */
async function openReview(
  tx: Tx,
  ctx: TenantContext,
  incident: { id: string; severity: string },
  durationMinutes: number,
  at?: Date,
): Promise<void> {
  const existing = await tx.postIncidentReview.findFirst({ where: { incidentId: incident.id } });
  if (existing) {
    // Reopened and resolved again: keep the review and its actions, refresh the
    // duration, which is now measured to the later resolution.
    await tx.postIncidentReview.update({ where: { id: existing.id }, data: { durationMinutes, ...(at ? { updatedAt: at } : {}) } });
    return;
  }

  const dueDays = (await getSetting<number>(ctx, 'incident.reviewDueDays')) ?? 5;
  await tx.postIncidentReview.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      incidentId: incident.id,
      status: 'draft',
      durationMinutes,
      // Due so many days after the resolution, which in a history is when it
      // happened rather than when the history was written.
      dueOn: new Date((at ? at.getTime() : Date.now()) + dueDays * 86_400_000),
      ...(at ? { createdAt: at, updatedAt: at } : {}),
    },
  });
}

export function reviewRequiredFor(severity: string): boolean {
  return REVIEW_REQUIRED[severity as Severity] ?? false;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
