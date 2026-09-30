import type { AuditEventRow, AuditFilter } from '@itsm/sdk';
import { zonedInstant } from '../workforce/presentation.js';

/**
 * The audit log in words (SPEC §6.1 `/audit`, B §3.17, D13): what the query
 * string means, how an event reads as a sentence, how pages are cursored and
 * what the sequence check can honestly say. Pure and server-safe; the page
 * shapes rows on the server with these, and the client reuses them for the
 * next page and for the CSV.
 */

/** Events per page. "Showing 100 · more available" — never a total, which the API does not have. */
export const AUDIT_PAGE = 100;

/* =========================================================================
 * The query string
 * ====================================================================== */

export interface AuditQuery {
  /** Matched as a prefix by the API: `rule.` finds every rule event. */
  readonly action?: string;
  readonly actor?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  /** Calendar days where the reader is, `YYYY-MM-DD`. */
  readonly from?: string;
  readonly to?: string;
  /** The seq to page before, when it belongs to these filters. */
  readonly cursor?: string;
}

type Params = Readonly<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = /^[a-z0-9_.]{1,200}$/;
const TARGET_TYPE = /^[a-z0-9_]{1,100}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The filters and cursor from the URL — `action`, `actor`, `targetType`,
 * `targetId`, `when=<from>..<to>` (the table's date-range spelling) and
 * `cursor`. Anything the API would refuse is dropped rather than sent: a
 * mistyped person id is no filter, not a 422 in place of the log.
 *
 * The cursor carries the signature of the filters it was made for
 * (`412.k3j9`). A cursor from another filter would start the new list in the
 * middle, so it is ignored and the list starts at the newest again.
 */
export function readAuditQuery(params: Params): AuditQuery {
  const action = one(params.action)?.toLowerCase();
  const actor = one(params.actor);
  const targetType = one(params.targetType)?.toLowerCase();
  const targetId = one(params.targetId);
  const when = one(params.when);
  let from: string | undefined;
  let to: string | undefined;
  if (when) {
    const match = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/.exec(when);
    if (match) {
      from = match[1] && DAY.test(match[1]) ? match[1] : undefined;
      to = match[2] && DAY.test(match[2]) ? match[2] : undefined;
      if (from && to && from > to) [from, to] = [to, from];
    }
  }
  const filters: AuditQuery = {
    ...(action && ACTION.test(action) ? { action } : {}),
    ...(actor && UUID.test(actor) ? { actor: actor.toLowerCase() } : {}),
    ...(targetType && TARGET_TYPE.test(targetType) ? { targetType } : {}),
    ...(targetId && targetId.length <= 100 ? { targetId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const cursor = readCursor(one(params.cursor), filters);
  return cursor ? { ...filters, cursor } : filters;
}

export function isFiltered(query: AuditQuery): boolean {
  return Boolean(query.action || query.actor || query.targetType || query.targetId || query.from || query.to);
}

/**
 * A short, stable fingerprint of the filters (not the cursor): FNV-1a over
 * their canonical spelling, in base 36. Not a secret and not a security
 * check — only "was this cursor made for this list?".
 */
export function filterSignature(query: AuditQuery): string {
  const canonical = [query.action ?? '', query.actor ?? '', query.targetType ?? '', query.targetId ?? '', query.from ?? '', query.to ?? ''].join('\u0001');
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function readCursor(raw: string | undefined, filters: AuditQuery): string | undefined {
  if (!raw) return undefined;
  const match = /^(\d{1,19})\.([0-9a-z]{1,8})$/.exec(raw);
  if (!match) return undefined;
  return match[2] === filterSignature(filters) ? match[1] : undefined;
}

/** The URL value for a cursor: the seq and the signature of the filters it pages. */
export function cursorParam(seq: string, query: AuditQuery): string {
  return `${seq}.${filterSignature(query)}`;
}

/** The filters as URL parameters, in the table's own spelling (so the chips read them back). */
export function filterParams(query: AuditQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.action) params.set('action', query.action);
  if (query.actor) params.set('actor', query.actor);
  if (query.targetType) params.set('targetType', query.targetType);
  if (query.targetId) params.set('targetId', query.targetId);
  if (query.from || query.to) params.set('when', `${query.from ?? ''}..${query.to ?? ''}`);
  return params;
}

/** A page of these filters: the newest (`cursor` null) or the one before `cursor`. */
export function pageHref(pathname: string, query: AuditQuery, cursor: string | null): string {
  const params = filterParams(query);
  if (cursor) params.set('cursor', cursorParam(cursor, query));
  const text = params.toString();
  return text ? `${pathname}?${text}` : pathname;
}

/** The day after `YYYY-MM-DD`. */
function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The API's filter: the person as `actorId`, and the days as instants — the
 * start of the first day and the last moment of the last, on the reader's
 * clock (a "Today" in London is not the UTC day).
 */
export function auditFilter(query: AuditQuery, timeZone: string, limit: number = AUDIT_PAGE): AuditFilter {
  const from = query.from ? zonedInstant(query.from, '00:00', timeZone) : null;
  const end = query.to ? zonedInstant(nextDay(query.to), '00:00', timeZone) : null;
  return {
    limit,
    ...(query.action ? { action: query.action } : {}),
    ...(query.actor ? { actorId: query.actor } : {}),
    ...(query.targetType ? { targetType: query.targetType } : {}),
    ...(query.targetId ? { targetId: query.targetId } : {}),
    ...(from ? { from } : {}),
    ...(end ? { to: new Date(Date.parse(end) - 1).toISOString() } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
  };
}

/** The seq one past this one: `?cursor=` for "this event and those before it" — one event, when `limit` is 1. */
export function cursorAt(seq: string): string {
  return (BigInt(seq) + BigInt(1)).toString();
}

/** `seq` as the API sends it: a string (it is a bigint), whatever the SDK's type says. */
export function seqOf(row: Pick<AuditEventRow, 'seq'>): string {
  return String(row.seq);
}

/* =========================================================================
 * The cursor stack: Newer
 * ====================================================================== */

/**
 * Where "Newer" goes (D13). The API pages one way — older — so the page keeps
 * the cursors it has visited for this list in `sessionStorage`: the stack is
 * `[null, c1, c2, …]`, null being the newest page. Arriving at a cursor that
 * is in the stack (Newer, Back) cuts the stack there; arriving at a new one
 * (Older) pushes it. A pasted link to an older page has no stack, and gets
 * *Newest* rather than a guess.
 */
export function stepStack(stack: readonly (string | null)[], cursor: string | null): (string | null)[] {
  if (cursor === null) return [null];
  const at = stack.indexOf(cursor);
  if (at >= 0) return stack.slice(0, at + 1);
  if (stack.length === 0) return [cursor];
  return [...stack, cursor];
}

/** The cursor of the page before this one in the stack: `null` for the newest page, `undefined` when unknown. */
export function newerCursor(stack: readonly (string | null)[], cursor: string | null): string | null | undefined {
  if (cursor === null) return undefined;
  const at = stack.indexOf(cursor);
  return at > 0 ? stack[at - 1] : undefined;
}

export function stackKey(query: AuditQuery): string {
  return `itsm-audit-cursors:${filterSignature(query)}`;
}

/* =========================================================================
 * An event as a sentence
 * ====================================================================== */

/** What a target type is called in a sentence: "rule", "ticket field". */
const TARGET_NOUNS: Readonly<Record<string, string>> = {
  action_definition: 'integration action',
  ai_budget: 'AI budget',
  ai_prompt: 'AI prompt',
  ai_suggestion: 'AI suggestion',
  approval_policy: 'approval policy',
  approval_request: 'approval',
  approval_step: 'approval step',
  asset_model: 'asset model',
  business_calendar: 'business calendar',
  business_rule: 'rule',
  change_window: 'change window',
  ci_class: 'configuration item class',
  ci_relationship: 'relationship',
  configuration_item: 'configuration item',
  connector_credential: 'credential',
  error_queue_item: 'failed delivery',
  feature_flag: 'feature flag',
  field_definition: 'ticket field',
  form_definition: 'form',
  import_file: 'import file',
  import_job: 'import',
  knowledge_article: 'article',
  maintenance_window: 'maintenance window',
  major_incident: 'major incident',
  metric_definition: 'metric',
  oncall_rotation: 'on-call rota',
  pack_installation: 'pack',
  priority_matrix: 'priority matrix',
  report_definition: 'report',
  report_schedule: 'report schedule',
  request_type: 'request type',
  scim_role_mapping: 'SCIM role mapping',
  scim_token: 'SCIM token',
  sla_policy: 'SLA policy',
  sla_timer: 'SLA timer',
  standard_change_template: 'change template',
  status_component: 'status page component',
  status_incident: 'status page incident',
  status_page: 'status page',
  status_subscriber: 'status page subscriber',
  survey_definition: 'survey',
  survey_trigger: 'survey trigger',
  ticket_task: 'task',
  time_entry: 'time entry',
  usage_meter: 'usage meter',
  user: 'person',
  webhook_subscription: 'webhook',
  workflow: 'workflow',
  workflow_run: 'workflow run',
};

export function targetNoun(targetType: string): string {
  return TARGET_NOUNS[targetType] ?? targetType.replace(/_/g, ' ');
}

/** The target types a person can filter by, named. */
export function targetTypeOptions(): { value: string; label: string }[] {
  const common = [
    'ticket',
    'user',
    'team',
    'organisation',
    'business_rule',
    'workflow',
    'workflow_run',
    'field_definition',
    'request_type',
    'service',
    'form_definition',
    'sla_policy',
    'setting',
    'feature_flag',
    'connector_credential',
    'action_definition',
    'webhook_subscription',
    'configuration_item',
    'asset',
    'knowledge_article',
    'approval_request',
    'tenant',
  ];
  return common.map((value) => ({ value, label: capitalise(targetNoun(value)) }));
}

/** Past tense of an action's last word, as a sentence opens: `published` → "Published". */
const VERBS: Readonly<Record<string, string>> = {
  created: 'Created',
  updated: 'Changed',
  edited: 'Edited',
  changed: 'Changed',
  published: 'Published',
  archived: 'Archived',
  deleted: 'Deleted',
  retired: 'Retired',
  set: 'Set',
  granted: 'Granted',
  revoked: 'Revoked',
  added: 'Added',
  removed: 'Removed',
  deactivated: 'Deactivated',
  reactivated: 'Reactivated',
  provisioned: 'Added',
  opened: 'Opened',
  decided: 'Decided',
  requested: 'Requested',
  submitted: 'Submitted',
  approved: 'Approved',
  dismissed: 'Dismissed',
  replayed: 'Replayed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  rolled_back: 'Restored an earlier version of',
  assigned: 'Assigned',
  unassigned: 'Unassigned',
  stored: 'Stored',
  rotated: 'Rotated',
  scanned: 'Scanned',
  linked: 'Linked',
  unlinked: 'Unlinked',
  saved: 'Saved',
  skipped: 'Skipped',
  installed: 'Installed',
  upgraded: 'Upgraded',
  suspended: 'Suspended',
  applied: 'Applied',
  escalated: 'Escalated',
  excused: 'Excused',
  imported: 'Imported',
  uploaded: 'Uploaded',
  finished: 'Finished',
  declared: 'Declared',
  closed: 'Closed',
  stood_down: 'Stood down',
  logged: 'Logged',
  stopped: 'Stopped',
  scheduled: 'Scheduled',
  promoted: 'Promoted',
  evaluated: 'Evaluated',
  recorded: 'Recorded',
  delegated: 'Delegated',
  overridden: 'Covered',
  returned: 'Returned',
  accepted: 'Accepted',
  rejected: 'Rejected',
  replaced: 'Replaced',
  reached: 'Reached',
};

/**
 * Whole openings for actions whose last word is about something inside the
 * target — a comment on a ticket, a member of a team — so the sentence says
 * what happened to what.
 */
const OPENINGS: Readonly<Record<string, string>> = {
  'auth.login.failed': 'Failed to sign in as',
  'config.published': 'Changed setting',
  'config.rolled_back': 'Restored an earlier value of setting',
  'feature_flag.set': 'Switched feature flag',
  'user.provisioned': 'Added',
  'user.updated': 'Changed the details of',
  'user.deactivated': 'Deactivated',
  'user.reactivated': 'Reactivated',
  'user.linked_to_idp': 'Linked to the identity provider:',
  'role.assignment.granted': 'Gave a role to',
  'role.assignment.revoked': 'Removed a role from',
  'team.member.added': 'Added a member to team',
  'team.member.removed': 'Removed a member from team',
  'session.revoked': 'Ended a session of',
  'ticket.comment.added': 'Commented on ticket',
  'ticket.comments.imported': 'Imported comments into ticket',
  'ticket.attachment.added': 'Attached a file to ticket',
  'ticket.attachment.scanned': 'Scanned an attachment of ticket',
  'ticket.task.created': 'Added a task to ticket',
  'ticket.task.completed': 'Completed a task on ticket',
  'ticket.status.changed': 'Moved ticket',
  'ticket.assigned': 'Assigned ticket',
  'ticket.unassigned.deactivated_user': 'Unassigned a deactivated person from ticket',
  'request.submitted': 'Submitted request',
  'rule.applied': 'Applied a rule to',
  'approval.step.opened': 'Opened an approval step',
  'approval.step.skipped': 'Skipped an approval step',
  'approval.decided': 'Decided an approval step',
  'sla.policy.targets.changed': 'Changed the targets of SLA policy',
  'sla.matrix.changed': 'Changed the priority matrix',
  'sla.timers.rematched': 'Matched the SLA timers again for',
  'sla.breach.excused': 'Excused an SLA breach on',
  'workload.availability.set': 'Set the availability of',
  'workload.oncall.overridden': 'Covered a turn on on-call rota',
  'workload.oncall.override.removed': 'Removed cover from on-call rota',
  'workload.skill.granted': 'Gave skill',
  'workload.skill.revoked': 'Took away skill',
  'workload.shift.assigned': 'Put someone on shift',
  'workload.shift.unassigned': 'Took someone off shift',
  'workload.policy.set': 'Changed the routing of',
  'integration.error.replayed': 'Replayed a failed delivery',
  'integration.error.dismissed': 'Dismissed a failed delivery',
  'workflow.step.skipped': 'Skipped a step in workflow run',
  'knowledge.draft.saved': 'Saved a draft of article',
  'workflow.draft.saved': 'Saved a draft of workflow',
  'tenant.ai_regions.changed': 'Changed the allowed AI regions of',
  'tenant.limit.warned_at': 'Moved a usage warning for',
  'tenant.limit.reset': 'Reset a usage limit for',
  'usage.limit.reached': 'Reached a usage limit:',
  'ai.budget.set': 'Changed the AI budget',
  'ai.budget.threshold': 'Crossed an AI budget line',
  'ai.decision.stepped_down': 'Stepped AI triage down from Auto',
  'notification.preference.changed': 'Changed notification preferences of',
  'scim.role_mappings.replaced': 'Replaced the SCIM role mappings',
};

/** Openings that are the whole sentence: the target is the workspace itself, or not worth naming. */
const NO_TARGET = new Set(['sla.matrix.changed', 'ai.budget.set', 'ai.budget.threshold', 'scim.role_mappings.replaced', 'approval.step.opened', 'approval.step.skipped', 'approval.decided', 'integration.error.replayed', 'integration.error.dismissed']);

/**
 * How an event opens: "Published rule", "Commented on ticket", "Gave a role
 * to". The target's name follows it; `standalone` says the opening needs none.
 */
export function actionOpening(action: string, targetType: string): { readonly opening: string; readonly standalone: boolean } {
  const known = OPENINGS[action];
  if (known) return { opening: known, standalone: NO_TARGET.has(action) };
  const parts = action.split('.');
  const verbWord = parts.length > 1 ? parts[parts.length - 1]! : '';
  const verb = VERBS[verbWord];
  const noun = targetNoun(targetType);
  if (verb) {
    // Nouns that stand alone read without an article: "Changed the priority matrix" comes from OPENINGS;
    // everything else is verb + noun: "Published rule", "Retired article".
    return { opening: `${verb} ${noun}`, standalone: false };
  }
  // A shape nobody wrote a sentence for: say it plainly rather than guess at grammar.
  return { opening: `${capitalise(action.replace(/[._]+/g, ' '))} on ${noun}`, standalone: false };
}

/** The action as the Action filter lists it: "Rule published" for `rule.published`, "Rule — all events" for `rule.`. */
export function actionLabel(action: string): string {
  if (action.endsWith('.')) {
    const prefix = action.slice(0, -1);
    return `${capitalise(prefix.replace(/[._]+/g, ' '))} — every event`;
  }
  return capitalise(action.replace(/[._]+/g, ' '));
}

/** The actions the modules record (the Action filter's catalogue; the API also takes any prefix). */
export const KNOWN_ACTIONS: readonly string[] = [
  'ai.budget.set',
  'ai.decision.stepped_down',
  'approval.decided',
  'approval.policy.published',
  'auth.login.failed',
  'catalogue.item.created',
  'catalogue.item.published',
  'catalogue.item.updated',
  'catalogue.service.created',
  'config.published',
  'config.rolled_back',
  'feature_flag.set',
  'form.created',
  'form.published',
  'form.updated',
  'integration.credential.deleted',
  'integration.credential.rotated',
  'integration.credential.stored',
  'integration.error.dismissed',
  'integration.error.replayed',
  'knowledge.article.published',
  'organisation.created',
  'request.submitted',
  'role.assignment.granted',
  'role.assignment.revoked',
  'rule.archived',
  'rule.created',
  'rule.published',
  'rule.updated',
  'session.revoked',
  'sla.calendar.created',
  'sla.matrix.changed',
  'sla.policy.created',
  'sla.policy.targets.changed',
  'team.created',
  'team.member.added',
  'tenant.ai_regions.changed',
  'ticket.assigned',
  'ticket.created',
  'ticket.field.created',
  'ticket.field.deactivated',
  'ticket.field.reactivated',
  'ticket.field.updated',
  'ticket.status.changed',
  'ticket.updated',
  'user.deactivated',
  'user.provisioned',
  'user.reactivated',
  'user.updated',
  'webhook.subscription.created',
  'webhook.subscription.deleted',
  'workflow.published',
  'workflow.run.cancelled',
  'workload.availability.set',
  'workload.oncall.overridden',
];

/** Prefixes worth offering: "every rule event" is one pick. */
export const ACTION_PREFIXES: readonly string[] = ['ticket.', 'rule.', 'workflow.', 'user.', 'role.', 'team.', 'config.', 'integration.', 'catalogue.', 'sla.', 'form.', 'knowledge.', 'approval.', 'ai.'];

/** Filter options for what was typed: the typed text itself first (the API matches it as a prefix), then known actions containing it. */
export function actionOptions(typed: string): { value: string; label: string }[] {
  const needle = typed.trim().toLowerCase();
  const known = [...ACTION_PREFIXES, ...KNOWN_ACTIONS];
  const matches = needle === '' ? known : known.filter((action) => action.includes(needle) || actionLabel(action).toLowerCase().includes(needle));
  const own = needle !== '' && ACTION.test(needle) && !known.includes(needle) ? [{ value: needle, label: `Starts with “${needle}”` }] : [];
  return [...own, ...matches.slice(0, 40).map((action) => ({ value: action, label: actionLabel(action) }))];
}

/** Who did it, when no person did: the platform itself, SCIM, an API key. */
export function actorWords(actorType: string): string {
  switch (actorType) {
    case 'system':
      return 'The platform';
    case 'scim':
      return 'The identity provider';
    case 'api_key':
    case 'apikey':
    case 'service':
      return 'An API key';
    case 'anonymous':
      return 'Someone signed out';
    default:
      return 'The platform';
  }
}

/* =========================================================================
 * Rows for the client
 * ====================================================================== */

/** A target the page could name, and where it lives in the console. */
export interface TargetRef {
  readonly label: string;
  readonly href?: string;
  /** A key rather than a name (settings, flags): drawn monospaced. */
  readonly technical?: boolean;
}

/**
 * One event as the list shows it — without `before` and `after`. Those stay
 * on the server except for the one event whose drawer is open (B §3.17): a
 * page of a hundred payloads would turn a list of activity into a bulk
 * disclosure of whatever the changes were about.
 */
export interface AuditRowView extends Record<string, unknown> {
  readonly id: string;
  readonly seq: string;
  /** `YYYY-MM-DD` where the reader is: the group the row sits in. */
  readonly day: string;
  readonly dayLabel: string;
  readonly occurredAt: string;
  /** "14:03", on the reader's clock, worked out once on the server. */
  readonly timeLabel: string;
  readonly actorType: string;
  readonly actorId: string | null;
  /** The person's name, or the words for a non-person actor ("The platform"). */
  readonly actorName: string;
  readonly actorKnown: boolean;
  readonly action: string;
  readonly opening: string;
  readonly target: TargetRef | null;
  /** Where an unnamed target lives, when the reader may go there (a workflow run has an address, not a name). */
  readonly targetHref?: string;
  /** The whole sentence as text: search, CSV, the drawer's title. */
  readonly sentence: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly reason: string | null;
  readonly correlationId: string | null;
}

/** An event's before and after, for the one open drawer. */
export interface AuditChange {
  readonly seq: string;
  readonly before: unknown;
  readonly after: unknown;
}

function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

/**
 * The whole sentence: "Published rule VIP requester" when the target has a
 * name, "Published a rule" when it has none — the noun the opening already
 * carries takes an article rather than being said twice.
 */
export function sentenceOf(opening: string, standalone: boolean, target: TargetRef | null, targetType: string): string {
  if (standalone) return opening;
  if (target) return `${opening} ${target.label}`;
  const noun = targetNoun(targetType);
  if (opening.endsWith(` ${noun}`)) return `${opening.slice(0, opening.length - noun.length)}${withArticle(noun)}`;
  return `${opening} ${withArticle(noun)}`;
}

/* ---- Dates ------------------------------------------------------------- */

/** `YYYY-MM-DD` of an instant where the reader is. */
export function dayKeyOf(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** A day's heading: "Today", "Yesterday", else "Monday 28 September" (the year only when it is not this one). */
export function dayLabel(day: string, today: string, locale: string): string {
  if (day === today) return 'Today';
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return 'Yesterday';
  const date = new Date(`${day}T12:00:00Z`);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })
      .format(date)
      .replace(',', '');
  } catch {
    return day;
  }
}

/* =========================================================================
 * The sequence check
 * ====================================================================== */

export interface SequenceCheck {
  readonly state: 'ok' | 'warning';
  readonly text: string;
}

/**
 * What the page can honestly say about the numbers it shows (SPEC: "sequence
 * check").
 *
 * Every event's `seq` comes from one sequence shared by every workspace on
 * the platform, so a workspace's own numbers have gaps by design — another
 * workspace's events, and numbers a rolled-back transaction used, fall
 * between them. A gap is therefore *not* evidence of tampering, and this
 * check never calls one a warning. What would be wrong is order: newest first
 * means every number is smaller than the one above it, with no repeats. The
 * tamper evidence proper is the hash chain, which the platform verifies
 * nightly and reports as a security alert (shown beside this when readable).
 */
export function sequenceCheck(seqs: readonly string[]): SequenceCheck | null {
  if (seqs.length === 0) return null;
  const numbers = seqs.map((seq) => BigInt(seq));
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index]! >= numbers[index - 1]!) {
      return { state: 'warning', text: `Out of order: #${seqs[index]} is listed after #${seqs[index - 1]}` };
    }
  }
  const first = seqs[seqs.length - 1]!;
  const last = seqs[0]!;
  return { state: 'ok', text: seqs.length === 1 ? `In sequence · #${last}` : `In sequence on this page · #${first} to #${last}` };
}

/* =========================================================================
 * Export page
 * ====================================================================== */

/** One CSV cell: quoted, quotes doubled, and a leading formula character defused so a spreadsheet shows it as text. */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS = ['Sequence', 'When (UTC)', 'Who', 'Person id', 'What', 'Action', 'Target type', 'Target', 'Target id', 'Reason', 'Correlation id'];

/**
 * The page as CSV — the rows on screen, never their before and after (SPEC:
 * "Export page … without before/after"). UTF-8 with a byte-order mark and
 * CRLF line ends, which is what a spreadsheet opened by double-click expects.
 */
export function auditCsv(rows: readonly AuditRowView[]): string {
  const lines = [CSV_COLUMNS.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.seq,
        row.occurredAt,
        row.actorName,
        row.actorId,
        row.sentence,
        row.action,
        targetNoun(row.targetType),
        row.target?.label ?? '',
        row.targetId,
        row.reason,
        row.correlationId,
      ]
        .map((value) => csvCell(value))
        .join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** `audit-log-acme-2026-09-30-from-412.csv`: the workspace, the reader's day and the page's first event. */
export function csvFileName(workspace: string, day: string, firstSeq: string | undefined): string {
  const slug =
    workspace
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace';
  return `audit-log-${slug}-${day}${firstSeq ? `-from-${firstSeq}` : ''}.csv`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
