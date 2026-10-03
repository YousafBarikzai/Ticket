import { z } from 'zod';
import { NotFoundError, ValidationError, authz, metrics, newId, recordAudit, transaction, type TenantContext } from '@itsm/platform';

/**
 * In-app notifications for the shared demo (A4 §1.14, §2.3; WP-43b).
 *
 * Each persona's bell should hold what a working day leaves there — Alex
 * assigned a ticket, an SLA warning, a customer's reply, the major incident
 * declared — so a visitor sees the inbox the product actually has. These are
 * written straight into the inbox as `notification` rows, already `sent`,
 * because nothing happened to send them: no rule ran, no event was published,
 * no delivery attempt exists and no job is queued (the PROGRESS note's
 * `notification-service.ts` enqueue sites are never reached), so a tenant
 * being built can take them. `listInbox` reads these rows and nothing else.
 *
 * Every row says what it is: `eventType = 'demo.sample'`, `ruleKey =
 * 'demo-sample'`, a fresh `eventId` of its own. The row has no column for
 * the bell's tile, and an event type of `demo.sample` cannot say whether a
 * line is an approval or a breach, so a sample may name its `kind`; it is
 * kept in the template key (`demo-sample.<kind>`), and `sampleKindOf` reads
 * it back for whoever maps the inbox for the bell.
 */

export const DEMO_SAMPLE_EVENT_TYPE = 'demo.sample';
export const DEMO_SAMPLE_RULE_KEY = 'demo-sample';

/** The bell's tile kinds (`NotificationKind` in `@itsm/ui/shell`), which a sample may name. */
export const SAMPLE_KINDS = ['sla_warning', 'breach', 'approval', 'reply', 'major_incident', 'assigned', 'update'] as const;
export type SampleKind = (typeof SAMPLE_KINDS)[number];

/** The template key a sample is stored under: the rule key, with its kind when it names one. */
export function sampleTemplateKey(kind?: SampleKind): string {
  return kind ? `${DEMO_SAMPLE_RULE_KEY}.${kind}` : DEMO_SAMPLE_RULE_KEY;
}

/** The kind a stored sample names, or null for a sample that names none and for every other notification. */
export function sampleKindOf(notification: { eventType: string; templateKey: string }): SampleKind | null {
  if (notification.eventType !== DEMO_SAMPLE_EVENT_TYPE) return null;
  const prefix = `${DEMO_SAMPLE_RULE_KEY}.`;
  if (!notification.templateKey.startsWith(prefix)) return null;
  const kind = notification.templateKey.slice(prefix.length);
  return (SAMPLE_KINDS as readonly string[]).includes(kind) ? (kind as SampleKind) : null;
}

export const inAppSampleSchema = z
  .object({
    /** Whose bell it is in. */
    recipientId: z.string().uuid(),
    /** The ticket it is about, when it is about one; following it opens the ticket. */
    ticketId: z.string().uuid().optional(),
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(10_000),
    /** When it arrived. */
    createdAt: z.coerce.date(),
    /** When it was read; omitted or null, it is unread. */
    readAt: z.coerce.date().nullable().optional(),
    /** The bell's tile for it. */
    kind: z.enum(SAMPLE_KINDS).optional(),
  })
  .strict();
export type InAppSampleInput = z.input<typeof inAppSampleSchema>;

/** The most rows one call takes, so its one audit row can name each recipient. */
export const IN_APP_SAMPLES_MAX = 50;

export interface ImportInAppOptions {
  /** What the audit row calls the call, e.g. "demo g42 bells". */
  label?: string;
  /** The audit row's reason, e.g. the demo build's `DEMO_BUILD_REASON`. */
  reason?: string;
}

const optionsSchema = z
  .object({ label: z.string().min(1).max(200).optional(), reason: z.string().min(1).max(500).optional() })
  .strict();

type FieldProblem = { field: string; code: string; message: string };

function instantProblem(at: Date | null | undefined, field: string): FieldProblem | null {
  if (at === null || at === undefined) return null;
  if (Number.isNaN(at.getTime())) return { field, code: 'invalid', message: 'not a date' };
  if (at.getTime() > Date.now()) return { field, code: 'in_future', message: 'must not be later than now' };
  return null;
}

/**
 * Writes sample notifications into people's in-app inboxes (A4 §2.3), in one
 * transaction, and returns them in the order given.
 *
 * Refused, with nothing written: an instant in the future, or a reading
 * before the arrival; a recipient who is not an active person here (a live
 * rule skips them too); a ticket this tenant does not have. Needs
 * `notification.template.manage`. One audit row for the call.
 */
export async function importInApp(ctx: TenantContext, rows: InAppSampleInput[], options: ImportInAppOptions = {}) {
  const parsed = z.array(inAppSampleSchema).max(IN_APP_SAMPLES_MAX).parse(rows);
  const settings = optionsSchema.parse(options);
  authz.require(ctx, 'notification.template.manage');

  const problems: FieldProblem[] = [];
  parsed.forEach((row, index) => {
    const arrived = instantProblem(row.createdAt, `${index}.createdAt`);
    const read = instantProblem(row.readAt, `${index}.readAt`);
    for (const problem of [arrived, read]) if (problem) problems.push(problem);
    if (!arrived && !read && row.readAt && row.readAt < row.createdAt) {
      problems.push({ field: `${index}.readAt`, code: 'before_created', message: 'nobody reads a notification before it arrives' });
    }
  });
  if (problems.length > 0) throw new ValidationError('these notifications could not have happened', problems);
  if (parsed.length === 0) return [];

  return transaction(ctx, async (tx) => {
    const written = [];
    for (const [index, row] of parsed.entries()) {
      const recipient = await tx.user.findFirst({ where: { id: row.recipientId, status: 'active', deletedAt: null }, select: { id: true } });
      if (!recipient) {
        throw new ValidationError('an in-app notification goes to an active person here', [
          { field: `${index}.recipientId`, code: 'not_found', message: 'no such active person' },
        ]);
      }
      if (row.ticketId) {
        const ticket = await tx.ticket.findFirst({ where: { id: row.ticketId }, select: { id: true } });
        if (!ticket) throw new NotFoundError('ticket', row.ticketId);
      }
      written.push(
        await tx.notification.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            // Its own event id: no event was published, and the uniqueness
            // (event, recipient, rule) must not make two samples one.
            eventId: newId(),
            eventType: DEMO_SAMPLE_EVENT_TYPE,
            recipientId: row.recipientId,
            ruleKey: DEMO_SAMPLE_RULE_KEY,
            templateKey: sampleTemplateKey(row.kind),
            ticketId: row.ticketId ?? null,
            subject: row.subject,
            body: row.body,
            status: 'sent',
            readAt: row.readAt ?? null,
            createdAt: row.createdAt,
          },
        }),
      );
    }

    await recordAudit(tx, ctx, {
      action: 'notifications.inapp.imported.batch',
      targetType: 'import_batch',
      targetId: newId(),
      after: {
        label: settings.label ?? null,
        count: written.length,
        unread: written.filter((row) => row.readAt === null).length,
        recipients: [...new Set(written.map((row) => row.recipientId))],
      },
      ...(settings.reason ? { reason: settings.reason } : {}),
    });
    metrics.increment('notifications_samples_imported_total', {}, written.length);
    return written;
  });
}
