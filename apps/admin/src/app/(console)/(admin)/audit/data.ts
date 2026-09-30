import 'server-only';
import type { Admin, AuditEventRow, Me } from '@itsm/sdk';
import { formatDateTime } from '@itsm/ui/format';
import {
  actionOpening,
  actorWords,
  dayKeyOf,
  dayLabel,
  seqOf,
  sentenceOf,
  type AuditRowView,
  type TargetRef,
} from '../../../../components/audit/presentation.js';
import { isPending, mayOpen, routeFor } from '../../../../navigation.js';
import { holds, holdsAny } from '../../../../permissions.js';
import { resolvePeople } from '../../../../server/people.js';
import { read } from '../../../../server/read.js';

/**
 * Names for what a page of audit events is about (SPEC §6.1 `/audit`; F8,
 * F32: "UUIDs").
 *
 * The events carry ids. The page asks each directory it may read — once,
 * and only for the kinds of target on the page — so "business_rule
 * 01a0f1ca…" reads "rule *Tag P1 tickets from email*" and links to it. A
 * directory it may not read, or one that fails, costs the names and nothing
 * else: the event still reads "Published a rule".
 *
 * Where no directory answers, a short label from the event's own record is
 * used — a ticket's number, a new team's name — read here on the server;
 * `before` and `after` themselves never leave it, except for the one event
 * whose drawer is open.
 */

type Row = AuditEventRow;

/** A link the reader may follow: a page that exists and opens for them. */
function reachable(me: Me, href: string): string | undefined {
  const route = routeFor(href);
  return route !== null && !isPending(route) && mayOpen(me, route) ? href : undefined;
}

function field(value: unknown, name: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[name];
  return typeof raw === 'string' && raw.trim() !== '' && raw.length <= 120 ? raw : null;
}

/**
 * A short name for a target from its own event: a number for a ticket,
 * otherwise a name, title or key. Never the rest of the payload, and never a
 * ticket's title — the number identifies it, and a title can carry what the
 * ticket is about.
 */
export function payloadLabel(row: Pick<Row, 'targetType' | 'before' | 'after'>): string | null {
  const sides = [row.after, row.before];
  if (row.targetType === 'ticket') {
    for (const side of sides) {
      const number = field(side, 'number');
      if (number) return number;
    }
    return null;
  }
  for (const name of ['name', 'label', 'title', 'displayName', 'key', 'ref']) {
    for (const side of sides) {
      const value = field(side, name);
      if (value) return value;
    }
  }
  return null;
}

interface Directory {
  readonly label: string;
  readonly href?: string;
}

/**
 * Every directory the page needs, keyed `type:id`, read in parallel and only
 * for the target types present.
 */
async function directories(me: Me, api: Admin, rows: readonly Row[]): Promise<Map<string, Directory>> {
  const types = new Set(rows.map((row) => row.targetType));
  const out = new Map<string, Directory>();
  const put = (type: string, id: string, label: string, href?: string): void => {
    out.set(`${type}:${id}`, { label, ...(href ? { href } : {}) });
  };

  const tasks: Promise<void>[] = [];
  if (types.has('team')) {
    tasks.push(
      read(() => api.tenant.teams()).then((teams) => {
        if (teams.ok) for (const team of teams.value) put('team', team.id, team.name, reachable(me, `/people/teams?open=team:${team.id}`));
      }),
    );
  }
  if (types.has('organisation') && holdsAny(me, ['identity.org.read', 'identity.org.manage'])) {
    tasks.push(
      read(() => api.tenant.organisations()).then((orgs) => {
        if (orgs.ok) for (const org of orgs.value) put('organisation', org.id, org.name, reachable(me, '/people/organisations'));
      }),
    );
  }
  if (types.has('business_rule') && holdsAny(me, ['rules.rule.read', 'rules.rule.manage', 'rules.rule.publish'])) {
    tasks.push(
      read(() => api.configure.rules.list()).then((rules) => {
        if (rules.ok) for (const rule of rules.value) put('business_rule', rule.id, rule.name, reachable(me, `/rules/${encodeURIComponent(rule.key)}`));
      }),
    );
  }
  if (types.has('field_definition') && holds(me, 'ticket.config.manage')) {
    tasks.push(
      read(() => api.tenant.fields(true)).then((fields) => {
        if (fields.ok) for (const entry of fields.value) put('field_definition', entry.id, entry.label, reachable(me, `/fields?open=field:${encodeURIComponent(entry.key)}`));
      }),
    );
  }
  if ((types.has('request_type') || types.has('service')) && holds(me, 'catalogue.manage')) {
    tasks.push(
      read(() => api.configure.catalogue.requestTypes()).then((kinds) => {
        if (kinds.ok) for (const kind of kinds.value) put('request_type', kind.id, kind.name, reachable(me, `/catalogue?open=request-type:${encodeURIComponent(kind.key)}`));
      }),
      read(() => api.configure.catalogue.services()).then((services) => {
        if (services.ok) for (const service of services.value) put('service', service.id, service.name, reachable(me, `/catalogue?open=service:${encodeURIComponent(service.key)}`));
      }),
    );
  }
  if (types.has('form_definition') && holdsAny(me, ['catalogue.form.read', 'catalogue.form.manage'])) {
    tasks.push(
      read(() => api.configure.catalogue.forms()).then((forms) => {
        if (forms.ok) for (const form of forms.value) put('form_definition', form.id, form.name, reachable(me, `/catalogue/forms/${encodeURIComponent(form.key)}`));
      }),
    );
  }
  await Promise.all(tasks);
  return out;
}

/** The person ids a page names: whoever acted, and people who were the target. */
function personIds(rows: readonly Row[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.actorId) ids.push(row.actorId);
    if (row.targetType === 'user' && row.targetId) ids.push(row.targetId);
  }
  return ids;
}

/** A target by name where the page could find one, with a link where the reader may follow it. */
function targetOf(me: Me, row: Row, people: Map<string, { name: string | null }>, named: Map<string, Directory>): TargetRef | null {
  if (row.targetType === 'user') {
    const name = people.get(row.targetId)?.name ?? payloadLabel(row);
    if (!name) return null;
    const href = reachable(me, `/people?open=person:${row.targetId}`);
    return { label: name, ...(href ? { href } : {}) };
  }
  if (row.targetType === 'tenant') return { label: 'this workspace' };
  if (row.targetType === 'setting' || row.targetType === 'feature_flag') {
    const href = reachable(me, row.targetType === 'setting' ? `/settings?q=${encodeURIComponent(row.targetId)}` : '/settings/features');
    return { label: row.targetId, technical: true, ...(href ? { href } : {}) };
  }
  const known = named.get(`${row.targetType}:${row.targetId}`);
  if (known) return { label: known.label, ...(known.href ? { href: known.href } : {}) };
  const label = payloadLabel(row);
  if (row.targetType === 'ticket' && label) {
    const href = reachable(me, `/tickets?open=ticket:${encodeURIComponent(label)}`);
    return { label, ...(href ? { href } : {}) };
  }
  return label ? { label } : null;
}

/** An address for a target that has none of the above but can still be opened: a workflow run. */
function unnamedHref(me: Me, row: Row): string | undefined {
  if (row.targetType === 'workflow_run') return reachable(me, `/workflows/runs?open=run:${encodeURIComponent(row.targetId)}`);
  return undefined;
}

/**
 * The page's rows for the client: names resolved, sentences written, times
 * and day headings on the reader's clock (worked out here, once, so the
 * browser's render cannot disagree with the server's), and no payloads.
 */
export async function auditRows(me: Me, api: Admin, events: readonly Row[], now: Date = new Date()): Promise<AuditRowView[]> {
  const [people, named] = await Promise.all([resolvePeople(api, personIds(events)), directories(me, api, events)]);
  const timeZone = me.timeZone || 'UTC';
  const locale = me.locale || 'en-GB';
  const today = dayKeyOf(now.toISOString(), timeZone);

  return events.map((row) => {
    const seq = seqOf(row);
    const { opening, standalone } = actionOpening(row.action, row.targetType);
    const target = standalone ? null : targetOf(me, row, people, named);
    const targetHref = target ? undefined : unnamedHref(me, row);
    const day = dayKeyOf(row.occurredAt, timeZone);
    const person = row.actorId ? people.get(row.actorId) : undefined;
    const actorName = row.actorType === 'user' || row.actorId ? (person?.name ?? 'Unknown person') : actorWords(row.actorType);
    return {
      id: row.id,
      seq,
      day,
      dayLabel: dayLabel(day, today, locale),
      occurredAt: row.occurredAt,
      timeLabel: formatDateTime(row.occurredAt, { locale, timeZone, style: 'time' }),
      actorType: row.actorType,
      actorId: row.actorId,
      actorName,
      actorKnown: row.actorId ? Boolean(person?.name) : true,
      action: row.action,
      opening,
      target,
      ...(targetHref ? { targetHref } : {}),
      sentence: sentenceOf(opening, standalone, target, row.targetType),
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      correlationId: row.correlationId,
    };
  });
}
