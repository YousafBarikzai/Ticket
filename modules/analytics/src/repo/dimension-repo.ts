import type { Tx } from '@itsm/platform';
import { newId } from '@itsm/platform';
import { isoWeek } from '../domain/durations.js';

/**
 * The dimension tables, kept current as facts are written.
 *
 * Dimensions are filled from the tables the owning modules maintain, read
 * through the projector's transaction. That is a deliberate exception to "a
 * module reads its own tables": the alternative is a fact row that stores a
 * display name copied from an event payload, and event payloads carry
 * identifiers rather than names precisely so that a rename does not have to be
 * published to everyone who once saw the old one.
 *
 * Every function here is a no-op when nothing has changed, because they run on
 * the hot path of every projected event.
 */

/** A date row, created on demand. Shared across tenants: a Tuesday is a Tuesday. */
export async function ensureDate(tx: Tx, date: Date): Promise<void> {
  const existing = await tx.dimDate.findUnique({ where: { date } });
  if (existing) return;

  const { week, year: isoYear } = isoWeek(date);
  const dayOfWeek = date.getUTCDay();
  await tx.dimDate.create({
    data: {
      date,
      year: date.getUTCFullYear(),
      quarter: Math.floor(date.getUTCMonth() / 3) + 1,
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      isoWeek: week,
      isoYear,
      dayOfWeek,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    },
  });
}

/**
 * Fills the date dimension for a span, so a report over a quiet period still
 * has a row for every day in it rather than a gap where nothing happened.
 */
export async function ensureDateRange(tx: Tx, from: Date, to: Date): Promise<number> {
  let created = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());

  while (cursor.getTime() <= last) {
    const before = await tx.dimDate.findUnique({ where: { date: cursor } });
    if (!before) {
      await ensureDate(tx, new Date(cursor));
      created += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return created;
}

export async function ensureTeam(tx: Tx, tenantId: string, teamId: string | null): Promise<void> {
  if (!teamId) return;
  const team = await tx.team.findFirst({ where: { id: teamId }, select: { id: true, name: true, orgId: true } });
  if (!team) return;

  const existing = await tx.dimTeam.findFirst({ where: { teamId } });
  if (existing) {
    if (existing.name === team.name && existing.orgId === team.orgId) return;
    await tx.dimTeam.update({ where: { id: existing.id }, data: { name: team.name, orgId: team.orgId } });
    return;
  }
  await tx.dimTeam.create({ data: { id: newId(), tenantId, teamId, name: team.name, orgId: team.orgId } });
}

export async function ensureService(tx: Tx, tenantId: string, serviceId: string | null): Promise<void> {
  if (!serviceId) return;
  const service = await tx.service.findFirst({ where: { id: serviceId }, select: { id: true, name: true, ownerId: true } });
  if (!service) return;

  const existing = await tx.dimService.findFirst({ where: { serviceId } });
  if (existing) {
    if (existing.name === service.name && existing.ownerId === service.ownerId) return;
    await tx.dimService.update({ where: { id: existing.id }, data: { name: service.name, ownerId: service.ownerId } });
    return;
  }
  await tx.dimService.create({ data: { id: newId(), tenantId, serviceId, name: service.name, ownerId: service.ownerId } });
}

export async function ensureCategory(tx: Tx, tenantId: string, categoryId: string | null): Promise<void> {
  if (!categoryId) return;
  const category = await tx.category.findFirst({ where: { id: categoryId }, select: { id: true, name: true, parentId: true } });
  if (!category) return;

  const parent = category.parentId
    ? await tx.category.findFirst({ where: { id: category.parentId }, select: { name: true } })
    : null;

  const existing = await tx.dimCategory.findFirst({ where: { categoryId } });
  if (existing) {
    if (existing.name === category.name && existing.parentName === (parent?.name ?? null)) return;
    await tx.dimCategory.update({
      where: { id: existing.id },
      data: { name: category.name, parentName: parent?.name ?? null },
    });
    return;
  }
  await tx.dimCategory.create({
    data: { id: newId(), tenantId, categoryId, name: category.name, parentName: parent?.name ?? null },
  });
}

export async function ensureChannel(tx: Tx, tenantId: string, key: string | null): Promise<void> {
  if (!key) return;
  const existing = await tx.dimChannel.findFirst({ where: { key } });
  if (existing) return;
  await tx.dimChannel.create({ data: { id: newId(), tenantId, key, name: channelName(key) } });
}

/** A readable label for a channel key, so a chart legend does not read `whatsapp`. */
function channelName(key: string): string {
  const known: Record<string, string> = {
    api: 'API',
    portal: 'Portal',
    email: 'Email',
    slack: 'Slack',
    teams: 'Microsoft Teams',
    whatsapp: 'WhatsApp',
    voice: 'Voice',
    sms: 'SMS',
    web: 'Web',
  };
  return known[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * A person, as they are now.
 *
 * Slowly changing (type 2): when a fact about a person changes, the current row
 * is closed and a new one opened rather than overwritten, so a ticket closed
 * last year still reports the team the closer was in at the time. Overwriting
 * would silently rewrite history — the single most common way a reporting
 * module ends up disagreeing with the ticket it is reporting on.
 */
export async function ensureUser(tx: Tx, tenantId: string, userId: string | null, at: Date): Promise<void> {
  if (!userId) return;
  const user = await tx.user.findFirst({
    where: { id: userId },
    select: { id: true, displayName: true, primaryOrgId: true },
  });
  if (!user) return;

  const membership = await tx.teamMembership.findFirst({
    where: { userId, validTo: null },
    select: { teamId: true },
    orderBy: [{ isLead: 'desc' }, { validFrom: 'asc' }],
  });
  const team = membership
    ? await tx.team.findFirst({ where: { id: membership.teamId }, select: { id: true, name: true } })
    : null;

  const current = await tx.dimUser.findFirst({ where: { userId, validTo: null } });
  const next = {
    displayName: user.displayName,
    teamId: team?.id ?? null,
    teamName: team?.name ?? null,
    orgId: user.primaryOrgId,
  };

  if (
    current &&
    current.displayName === next.displayName &&
    current.teamId === next.teamId &&
    current.teamName === next.teamName &&
    current.orgId === next.orgId
  ) {
    return;
  }

  if (current) {
    // A version that would be closed at the instant it opened is a clock
    // problem, not a change; leave the existing row alone rather than create a
    // zero-length one no query could ever select.
    if (at <= current.validFrom) return;
    await tx.dimUser.update({ where: { id: current.id }, data: { validTo: at } });
  }

  await tx.dimUser.create({ data: { id: newId(), tenantId, userId, validFrom: at, validTo: null, ...next } });
}

/** The version of a person that was current at an instant, for a historical report. */
export async function userAt(tx: Tx, userId: string, at: Date) {
  return tx.dimUser.findFirst({
    where: { userId, validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gt: at } }] },
    orderBy: { validFrom: 'desc' },
  });
}
