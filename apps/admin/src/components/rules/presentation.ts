import type { IconName, Tone } from '@itsm/ui';
import type { RuleRow } from '@itsm/sdk';
import { OPERATORS, fromExpression, isUnary } from '../../rules.js';
import { LEVELS, PRIORITIES, TICKET_STATUSES, factFor, valueLabel } from '../../rules/facts.js';
import { eventInfo, RULE_EVENTS } from '../../rules/events.js';
import type { RuleNames, RuleScope, RuleState, RuleView } from './types.js';

/**
 * The rules pages' words, kept pure so the list, the builder and their tests
 * read a rule the same way (SPEC §6.1 `/rules`).
 */

/* ------------------------------------------------------------------ rows */

/** The API's row as the pages' serialisable view (also what a write returns, read the same way). */
export function toRuleView(row: RuleRow): RuleView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    event: row.event,
    conditions: row.conditions ?? { always: true },
    actions: Array.isArray(row.actions) ? row.actions : [],
    order: row.order,
    mode: row.mode === 'stop' ? 'stop' : 'continue',
    status: row.status,
    version: row.version,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------------------------------------------ state */

export interface StateLook {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: IconName;
}

/**
 * Live, Draft, Unpublished changes, Archived.
 *
 * "Unpublished changes" is a rule that was live and has been edited since:
 * the API returns an edited rule to draft (R1), so it is **not running**
 * until it is published again — which the pages say beside the pill.
 */
export const RULE_STATES: Readonly<Record<RuleState, StateLook>> = {
  live: { label: 'Live', tone: 'success', icon: 'circle-check' },
  draft: { label: 'Draft', tone: 'neutral', icon: 'circle-dashed' },
  changes: { label: 'Unpublished changes', tone: 'warning', icon: 'pencil' },
  archived: { label: 'Archived', tone: 'neutral', icon: 'archive' },
};

export function ruleState(rule: Pick<RuleView, 'status' | 'publishedAt'>): RuleState {
  if (rule.status === 'published') return 'live';
  if (rule.status === 'archived') return 'archived';
  return rule.publishedAt ? 'changes' : 'draft';
}

/** Whether rules for this event are evaluated at all right now. */
export function isRunning(rule: Pick<RuleView, 'status'>): boolean {
  return rule.status === 'published';
}

/** `?status=` as a scope; the Command centre links with the API's own words (`draft`, `published`). */
export function scopeFrom(param: string | null | undefined): RuleScope {
  switch (param) {
    case 'live':
    case 'published':
      return 'live';
    case 'draft':
    case 'drafts':
      return 'draft';
    case 'archived':
      return 'archived';
    default:
      return 'all';
  }
}

export function inScope(rule: Pick<RuleView, 'status' | 'publishedAt'>, scope: RuleScope): boolean {
  const state = ruleState(rule);
  switch (scope) {
    case 'all':
      return true;
    case 'live':
      return state === 'live';
    case 'draft':
      return state === 'draft' || state === 'changes';
    case 'archived':
      return state === 'archived';
  }
}

/** "8 live · 2 drafts", for the header. */
export function headerMeta(rules: readonly Pick<RuleView, 'status' | 'publishedAt'>[]): string | undefined {
  if (rules.length === 0) return undefined;
  const live = rules.filter((rule) => ruleState(rule) === 'live').length;
  const drafts = rules.filter((rule) => rule.status === 'draft').length;
  return `${live} live · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}`;
}

/* ------------------------------------------------------------- conditions */

const OPERATOR_WORDS = new Map<string, string>(OPERATORS.map((entry) => [entry.value, entry.label]));

/** What an id-valued fact is about, for "Team is a specific team" when the id has no name here. */
const ID_NOUNS: Readonly<Record<string, string>> = {
  'ticket.orgId': 'organisation',
  'ticket.serviceId': 'service',
  'ticket.categoryId': 'category',
  'ticket.groupId': 'team',
  'ticket.assigneeId': 'person',
  'ticket.requesterId': 'person',
  'ticket.affectedUserId': 'person',
  'requester.orgId': 'organisation',
  'requester.locationId': 'location',
  'comment.authorId': 'person',
};

export type ConditionSummary =
  | { readonly kind: 'every' }
  | { readonly kind: 'custom' }
  | { readonly kind: 'rows'; readonly join: 'and' | 'or'; readonly chips: readonly string[] };

/** One condition row as a chip: "Priority is P1 · Critical", "Requester is a VIP", "Assignee is set". */
export function conditionChip(row: { readonly fact: string; readonly operator: string; readonly value: string }, names?: RuleNames): string {
  const fact = factFor(row.fact);
  const operator = OPERATOR_WORDS.get(row.operator) ?? row.operator;
  if (isUnary(row.operator as never)) return `${fact.label} ${operator}`;
  if (fact.kind === 'boolean' && row.operator === 'eq') return row.value === 'false' ? `${fact.label}: no` : fact.label;
  if (fact.kind === 'id') {
    const team = row.fact === 'ticket.groupId' ? names?.teams[row.value] : undefined;
    return `${fact.label} ${operator} ${team ?? `a specific ${ID_NOUNS[row.fact] ?? 'record'}`}`;
  }
  const value = fact.kind === 'number' && fact.unit ? `${row.value} ${fact.unit}` : valueLabel(fact, row.value);
  return `${fact.label} ${operator} ${value === '' ? '(empty)' : value}`;
}

/** A stored condition as chips, "Every time", or "Custom condition" for what the builder cannot draw. */
export function conditionSummary(conditions: unknown, names?: RuleNames): ConditionSummary {
  const parsed = conditions === undefined || conditions === null ? { conditions: [], join: 'and' as const } : fromExpression(conditions);
  if (!parsed) return { kind: 'custom' };
  const rows = parsed.conditions.filter((row) => row.fact !== '');
  if (rows.length === 0) return { kind: 'every' };
  return { kind: 'rows', join: parsed.join, chips: rows.map((row) => conditionChip(row, names)) };
}

/** The same, as one line of text (search, cards, a confirmation). */
export function conditionText(conditions: unknown, names?: RuleNames): string {
  const summary = conditionSummary(conditions, names);
  if (summary.kind === 'every') return 'Every time';
  if (summary.kind === 'custom') return 'Custom condition';
  return summary.chips.join(summary.join === 'and' ? ' and ' : ' or ');
}

/* ---------------------------------------------------------------- actions */

export const STRATEGIES: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'round_robin', label: 'Round robin' },
  { value: 'least_loaded', label: 'Least loaded' },
  { value: 'skill', label: 'By skill' },
];

export const RECIPIENTS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'requester', label: 'Requester' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'group', label: 'Team' },
  { value: 'watchers', label: 'Watchers' },
];

/**
 * The notification templates a desk starts with (`modules/notifications`
 * seed), with what each says. There is no API listing templates, so a key
 * typed by hand is allowed — with a warning, because a rule naming a template
 * that does not exist sends nothing.
 */
export const TEMPLATES: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'ticket.created.requester', label: 'We’ve received your ticket' },
  { value: 'ticket.created.group', label: 'New ticket for the team' },
  { value: 'ticket.assigned.assignee', label: 'A ticket was assigned to you' },
  { value: 'ticket.comment.requester', label: 'New reply on your ticket' },
  { value: 'ticket.resolved.requester', label: 'Your ticket was resolved' },
  { value: 'sla.warning.assignee', label: 'A service level is at risk' },
  { value: 'sla.breached.lead', label: 'A service level was breached' },
];

const labelOf = (list: readonly { readonly value: string; readonly label: string }[], value: string): string =>
  list.find((entry) => entry.value === value)?.label ?? value;

export function statusLabel(status: string): string {
  return labelOf(TICKET_STATUSES, status);
}

export function templateLabel(template: string): string {
  return labelOf(TEMPLATES, template);
}

export function isKnownTemplate(template: string): boolean {
  return TEMPLATES.some((entry) => entry.value === template);
}

const priorityWord = (priority: string): string => labelOf(PRIORITIES, priority);
const levelWord = (level: string): string => labelOf(LEVELS, level);

export interface ActionChip {
  readonly label: string;
  readonly icon: IconName;
  /** Not one the builder draws: shown, never changed. */
  readonly custom?: boolean;
}

/** A stored action as a chip: "Set priority → P1 · Critical", "Notify the requester". */
export function actionChip(action: unknown, names?: RuleNames): ActionChip {
  if (typeof action !== 'object' || action === null) return { label: 'Custom action', icon: 'settings-2', custom: true };
  const row = action as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === 'string' ? value : String(value ?? ''));
  switch (row.type) {
    case 'setPriority':
      return { label: `Set priority → ${priorityWord(text(row.priority))}`, icon: 'flag' };
    case 'setStatus':
      return { label: `Set status → ${statusLabel(text(row.status))}`, icon: 'circle-dashed' };
    case 'addTag':
      return { label: `Add tag “${text(row.tag)}”`, icon: 'tag' };
    case 'assignStrategy':
      return { label: `Assign by ${labelOf(STRATEGIES, text(row.strategy)).toLowerCase()}`, icon: 'people' };
    case 'sendNotification':
      return { label: `Notify the ${labelOf(RECIPIENTS, text(row.to)).toLowerCase()}`, icon: 'bell' };
    case 'startWorkflow': {
      const workflow = names?.workflows[text(row.definitionKey)];
      return { label: `Start “${workflow?.name ?? text(row.definitionKey)}”`, icon: 'workflow' };
    }
    case 'setField':
      if (row.field === 'impact' || row.field === 'urgency') {
        return { label: `Set ${row.field} → ${levelWord(text(row.value))}`, icon: 'sliders-horizontal' };
      }
      return { label: 'Set a field', icon: 'settings-2', custom: true };
    case 'assignGroup':
      return { label: `Assign to ${names?.teams[text(row.groupId)] ?? 'a team'}`, icon: 'people' };
    case 'setCategory':
      return { label: 'Set the category', icon: 'settings-2', custom: true };
    case 'addWatcher':
      return { label: 'Add a watcher', icon: 'settings-2', custom: true };
    case 'linkDuplicate':
      return { label: 'Link a duplicate', icon: 'settings-2', custom: true };
    default:
      return { label: 'Custom action', icon: 'settings-2', custom: true };
  }
}

/* ------------------------------------------------------------------ order */

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

type Ordered = Pick<RuleView, 'key' | 'name' | 'event' | 'order' | 'status'>;

const byOrder = (a: Ordered, b: Ordered): number => a.order - b.order || a.name.localeCompare(b.name);

/**
 * Where each rule stands for its event, among those that are not archived:
 * the `#` column. Archived rules have no place.
 */
export function positions(rules: readonly Ordered[]): Map<string, { readonly position: number; readonly total: number }> {
  const result = new Map<string, { position: number; total: number }>();
  const byEvent = new Map<string, Ordered[]>();
  for (const rule of rules) {
    if (rule.status === 'archived') continue;
    const list = byEvent.get(rule.event) ?? [];
    list.push(rule);
    byEvent.set(rule.event, list);
  }
  for (const list of byEvent.values()) {
    list.sort(byOrder);
    list.forEach((rule, index) => result.set(rule.key, { position: index + 1, total: list.length }));
  }
  return result;
}

export interface Placement {
  /** 1-based, among the event's rules that are not archived, this one included. */
  readonly position: number;
  readonly total: number;
  readonly before: Ordered | null;
  readonly after: Ordered | null;
  /** Another rule with the same order number: which runs first is not fixed. */
  readonly tie: Ordered | null;
  /** The order that puts this rule one place earlier, or null when it is first. */
  readonly earlier: number | null;
  readonly later: number | null;
}

const MIN_ORDER = 0;
const MAX_ORDER = 10_000;
const STEP = 10;

/**
 * "Runs 3rd of 5 for this event", its neighbours, and the order numbers that
 * move it one place either way (SPEC §6.1 *Advanced*). The numbers keep a gap
 * where they can (between 10 and 20 goes 15), so the neighbours keep theirs:
 * moving one rule never renumbers another — which would edit, and so take
 * offline (R1), a rule nobody meant to touch.
 */
export function placement(rules: readonly Ordered[], event: string, selfKey: string | null, order: number, name: string): Placement {
  const others = rules.filter((rule) => rule.event === event && rule.status !== 'archived' && rule.key !== selfKey).sort(byOrder);
  const self: Ordered = { key: selfKey ?? '', name, event, order, status: 'draft' };
  const index = others.filter((rule) => byOrder(rule, self) < 0).length;
  const before = others[index - 1] ?? null;
  const after = others[index] ?? null;
  const tie = others.find((rule) => rule.order === order) ?? null;

  let earlier: number | null = null;
  if (before) {
    const floor = others[index - 2]?.order ?? null;
    if (floor === null) earlier = Math.max(MIN_ORDER, before.order - STEP);
    else earlier = before.order - floor >= 2 ? Math.floor((floor + before.order) / 2) : Math.max(MIN_ORDER, before.order - 1);
  }
  let later: number | null = null;
  if (after) {
    const ceiling = others[index + 1]?.order ?? null;
    if (ceiling === null) later = Math.min(MAX_ORDER, after.order + STEP);
    else later = ceiling - after.order >= 2 ? Math.floor((after.order + ceiling) / 2) : Math.min(MAX_ORDER, after.order + 1);
  }

  return { position: index + 1, total: others.length + 1, before, after, tie, earlier, later };
}

/** The order a new rule takes: last for its event. */
export function lastOrder(rules: readonly Ordered[], event: string): number {
  const orders = rules.filter((rule) => rule.event === event && rule.status !== 'archived').map((rule) => rule.order);
  if (orders.length === 0) return 100;
  return Math.min(MAX_ORDER, Math.max(...orders) + STEP);
}

/** "Runs 2nd of 3 for this event — after “A”, before “B”." */
export function placementSentence(place: Placement): string {
  if (place.total === 1) return 'The only rule for this event.';
  const parts = [`Runs ${ordinal(place.position)} of ${place.total} for this event`];
  const around = [place.before ? `after “${place.before.name}”` : null, place.after ? `before “${place.after.name}”` : null].filter(Boolean);
  return `${parts[0]} — ${around.join(', ')}.`;
}

/* ------------------------------------------------------------- dry runs */

/** What the engine reported one matching ticket would get (`effectsOf`), as chips. */
export function effectChips(effects: unknown, names?: RuleNames): string[] {
  if (Array.isArray(effects)) return effects.map((action) => actionChip(action, names).label);
  if (typeof effects !== 'object' || effects === null) return [];
  const row = effects as {
    patch?: Record<string, unknown>;
    status?: { status?: string };
    tags?: readonly string[];
    watchers?: readonly string[];
    notifications?: readonly { to?: string }[];
    links?: readonly unknown[];
    workflows?: readonly { definitionKey?: string }[];
    assignStrategy?: string;
  };
  const chips: string[] = [];
  for (const [field, value] of Object.entries(row.patch ?? {})) {
    const text = String(value ?? '');
    if (field === 'priority') chips.push(`Priority → ${priorityWord(text)}`);
    else if (field === 'impact' || field === 'urgency') chips.push(`${field === 'impact' ? 'Impact' : 'Urgency'} → ${levelWord(text)}`);
    else if (field === 'groupId') chips.push(`Team → ${names?.teams[text] ?? 'a team'}`);
    else chips.push(`Sets ${field.replace(/Id$/, '')}`);
  }
  if (row.status?.status) chips.push(`Status → ${statusLabel(row.status.status)}`);
  if (row.assignStrategy) chips.push(`Assign by ${labelOf(STRATEGIES, row.assignStrategy).toLowerCase()}`);
  for (const tag of row.tags ?? []) chips.push(`Tag “${tag}”`);
  for (const notification of row.notifications ?? []) chips.push(`Notify the ${labelOf(RECIPIENTS, notification.to ?? '').toLowerCase()}`);
  for (const workflow of row.workflows ?? []) chips.push(`Start “${names?.workflows[workflow.definitionKey ?? '']?.name ?? workflow.definitionKey ?? 'a workflow'}”`);
  if ((row.watchers ?? []).length > 0) chips.push(row.watchers!.length === 1 ? 'Add a watcher' : `Add ${row.watchers!.length} watchers`);
  if ((row.links ?? []).length > 0) chips.push('Link a duplicate');
  return chips;
}

/** "Would change 7 of the last 100 tickets" — or, neutrally, that it would change none. */
export function testSummary(result: { readonly sampled: number; readonly wouldChange: readonly unknown[] }): string {
  const tickets = result.sampled === 1 ? 'ticket' : 'tickets';
  if (result.sampled === 0) return 'There are no tickets to test on yet.';
  if (result.wouldChange.length === 0) return `Wouldn’t change any of the last ${result.sampled} ${tickets}.`;
  return `Would change ${result.wouldChange.length} of the last ${result.sampled} ${tickets}.`;
}

/**
 * Where a field error from the API belongs in the builder: `actions.2.tag`
 * on the third action card, `conditions…` on *If*. The dry run nests the
 * definition under `definition.`, which is dropped first.
 */
export type ErrorTarget =
  | { readonly kind: 'action'; readonly index: number }
  | { readonly kind: 'actions' }
  | { readonly kind: 'conditions' }
  | { readonly kind: 'event' }
  | { readonly kind: 'field'; readonly field: 'name' | 'key' | 'description' | 'order' | 'mode' }
  | { readonly kind: 'other' };

export function errorTarget(path: string): ErrorTarget {
  const field = path.replace(/^definition\./, '');
  const action = /^actions\.(\d+)(\.|$)/.exec(field);
  if (action) return { kind: 'action', index: Number(action[1]) };
  if (field === 'actions') return { kind: 'actions' };
  if (field === 'conditions' || field.startsWith('conditions.')) return { kind: 'conditions' };
  if (field === 'event') return { kind: 'event' };
  if (field === 'name' || field === 'key' || field === 'description' || field === 'order' || field === 'mode') return { kind: 'field', field };
  return { kind: 'other' };
}

/* ------------------------------------------------------------- last fired */

/**
 * When each rule last did something, from the audit trail's `rule.applied`
 * entries (newest first): the first entry naming a rule is its latest.
 */
export function lastFiredByKey(entries: readonly { readonly after: unknown; readonly occurredAt: string }[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const key = (entry.after as { ruleKey?: unknown } | null)?.ruleKey;
    if (typeof key === 'string' && !(key in result)) result[key] = entry.occurredAt;
  }
  return result;
}

/** The list's group order: the events in the builder's order, then any the file does not know. */
export function eventRank(event: string): number {
  const index = RULE_EVENTS.findIndex((entry) => entry.value === event);
  return index === -1 ? RULE_EVENTS.length : index;
}

/** A group header: "When a ticket is created · run in this order". */
export function groupHeading(event: string): string {
  const info = eventInfo(event);
  return info.runs ? `${info.heading} · run in this order` : `${info.heading} · not evaluated yet`;
}
