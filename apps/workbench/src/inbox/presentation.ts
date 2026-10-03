import { ApiError, type TimelineEventEntry } from '@itsm/sdk';
import type { IntentName, Problem, Tone } from '@itsm/ui';
import { formatDuration } from '@itsm/ui/format';

/**
 * The words and colours a ticket is shown in (successor of
 * `queue/presentation.ts`).
 *
 * Kept away from the components, and tested, because this is where a
 * workbench either helps an agent or gets in their way. Three rules:
 *
 * **Say it in English.** `pending_third_party` is a database value. An agent
 * scanning forty rows reads "Waiting on supplier" in a glance and
 * `pending_third_party` in a squint. The canonical state is still what the app
 * sends back to the API — this is a rendering, not a translation layer.
 *
 * **Never let colour be the only signal.** Every tone arrives with its word
 * (SC 1.4.1).
 *
 * **Only urgency is loud.** If P1 and P2 both shout, neither does.
 */

export const STATE_LABEL: Record<string, string> = {
  new: 'New',
  in_progress: 'In progress',
  pending_requester: 'Waiting on requester',
  pending_third_party: 'Waiting on supplier',
  pending_approval: 'Waiting for approval',
  resolved: 'Resolved',
  reopened: 'Reopened',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state.replaceAll('_', ' ');
}

/** The states that are waiting on someone other than the agent: shown as a pill, the rest as plain text (SPEC §6.2). */
export function isWaitingState(state: string): boolean {
  return state.startsWith('pending_');
}

/**
 * Categories, not states: a tenant may rename states, and the category is the
 * stable thing.
 *
 * Paused work is `hold` (D5): amber means an SLA at risk or a deadline close,
 * and a ticket waiting on somebody else is neither, so it gets the waiting
 * colour the design system keeps for exactly that.
 */
export function categoryIntent(category: string): IntentName {
  switch (category) {
    case 'open':
      return 'info';
    case 'paused':
      return 'hold';
    case 'resolved':
      return 'success';
    default:
      return 'neutral';
  }
}

/** The same, in the redesign's tone vocabulary (StatusPill, Banner). */
export function categoryTone(category: string): Tone {
  switch (category) {
    case 'open':
      return 'info';
    case 'paused':
      return 'hold';
    case 'resolved':
      return 'success';
    default:
      return 'neutral';
  }
}

/** P1 is danger and P2 `high` (D5): orange for "soon", never the amber of an SLA at risk. */
export function priorityIntent(priority: string): IntentName {
  switch (priority.toUpperCase()) {
    case 'P1':
      return 'danger';
    case 'P2':
      return 'high';
    default:
      return 'neutral';
  }
}

/** Only P1 is emphasised. Everything shouting is the same as nothing shouting. */
export function priorityEmphasis(priority: string): 'solid' | 'subtle' {
  return priority.toUpperCase() === 'P1' ? 'solid' : 'subtle';
}

const PRIORITY_WORD: Record<string, string> = { P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low' };

/** "P2 · High"; an unknown priority is shown as it came. */
export function priorityLabel(priority: string): string {
  const key = priority.toUpperCase();
  const word = PRIORITY_WORD[key];
  return word ? `${key} · ${word}` : priority;
}

/** "Priority 2", for a screen reader, where "P2" would be read as a letter and a number. */
export function prioritySpoken(priority: string): string {
  const match = /^P(\d)$/i.exec(priority);
  return match ? `Priority ${match[1]}` : `Priority ${priority}`;
}

/** Rows show a priority glyph for P1 and P2 only (SPEC §6.2): the rest is the normal case. */
export function isUrgentPriority(priority: string): boolean {
  const key = priority.toUpperCase();
  return key === 'P1' || key === 'P2';
}

const TYPE_LABEL: Record<string, string> = {
  incident: 'Incident',
  request: 'Request',
  problem: 'Problem',
  change: 'Change',
  task: 'Task',
  question: 'Question',
};

export function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

/**
 * The channel a ticket arrived by, as a word (never a brand logo, SPEC §1.8).
 * The same vocabulary as the design system's channel glyphs.
 */
const CHANNEL_LABEL: Record<string, string> = {
  portal: 'Portal',
  email: 'Email',
  slack: 'Slack',
  teams: 'Teams',
  whatsapp: 'WhatsApp',
  voice: 'Phone',
  phone: 'Phone',
  mobile: 'Mobile app',
  api: 'API',
  import: 'Import',
  system: 'Automatic',
};

export function channelLabel(channel: string): string {
  const known = CHANNEL_LABEL[channel.trim().toLowerCase()];
  if (known) return known;
  const words = channel.trim().replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The Help Portal's name, as `AREAS.portal.name` in `@itsm/contracts/areas`
 * (D1). Spelt out because this module reaches the browser on every desk
 * page and the areas module's tables would come with an import;
 * `presentation.test.ts` holds the two equal.
 */
export const HELP_PORTAL_NAME = 'Help Portal';

/**
 * What a public reply will do, said where the agent writes it (SPEC §6.2):
 * a reply to an emailed ticket is an email; one raised in the Help Portal is
 * read there.
 */
export function replyChannelLine(channel: string): string {
  return channel === 'email' ? 'Replying by email' : `Visible in the ${HELP_PORTAL_NAME}`;
}

/**
 * "2 h 15 m", for a column an agent scans rather than reads. Absolute
 * timestamps stay in the row's `title` attribute, so nothing is lost.
 */
export function ageOf(createdAt: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} m`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days} d ${hours % 24} h` : `${days} d`;
}

/* --------------------------------------------------------------------- SLA */

export type DueUrgency = 'breached' | 'soon' | 'later';

/** Within an hour is "soon": the threshold at which a row shows its deadline instead of its age (SPEC §6.2). */
export const DUE_SOON_MINUTES = 60;

export function dueUrgency(dueAt: string | null, now: number = Date.now()): DueUrgency | null {
  if (!dueAt) return null;
  const minutes = (Date.parse(dueAt) - now) / 60_000;
  if (Number.isNaN(minutes)) return null;
  if (minutes < 0) return 'breached';
  return minutes <= DUE_SOON_MINUTES ? 'soon' : 'later';
}

/** "Due in 2 h 10 min", "Overdue by 20 min" — text, never a ring in a row (X-33). */
export function dueText(dueAt: string | null, now: number = Date.now(), locale?: string): string | null {
  if (!dueAt) return null;
  const minutes = (Date.parse(dueAt) - now) / 60_000;
  if (Number.isNaN(minutes)) return null;
  const span = formatDuration(Math.abs(minutes), { maxParts: 2, ...(locale ? { locale } : {}) });
  return minutes < 0 ? `Overdue by ${span}` : `Due in ${span}`;
}

/* -------------------------------------------------------------- A row, read */

export interface RowFacts {
  readonly number: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly dueAt: string | null;
  readonly updatedAt: string;
}

/** The row link's name: "VPN keeps dropping, INC-000123, unread" (X-67). */
export function rowLabel(ticket: Pick<RowFacts, 'title' | 'number'>, unread = false): string {
  return [ticket.title, ticket.number, unread ? 'unread' : null].filter(Boolean).join(', ');
}

/** The row's description: "Priority 2, In progress, due in 2 h 10 min, updated 5 min ago". */
export function rowDescription(ticket: RowFacts, now: number = Date.now(), locale?: string): string {
  const due = dueText(ticket.dueAt, now, locale);
  const updatedMinutes = Math.max(0, (now - Date.parse(ticket.updatedAt)) / 60_000);
  const updated =
    updatedMinutes < 1 ? 'updated just now' : `updated ${formatDuration(updatedMinutes, { maxParts: 1, ...(locale ? { locale } : {}) })} ago`;
  return [
    prioritySpoken(ticket.priority),
    stateLabel(ticket.status),
    due ? due.charAt(0).toLowerCase() + due.slice(1) : null,
    Number.isNaN(updatedMinutes) ? null : updated,
  ]
    .filter(Boolean)
    .join(', ');
}

/* ------------------------------------------------------------------ People */

export interface PersonName {
  readonly name: string;
  readonly initials: string;
}

export type PeopleMap = Readonly<Record<string, PersonName>>;

/** The first eight characters of an id: enough to tell two apart, short enough to read aloud. */
export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}

/**
 * A person's name, or an honest placeholder (F8): "Unknown person · 1a2b3c4d".
 * Never a bare UUID, which reads as a fault; never blank, which reads as
 * nobody.
 */
export function personName(id: string | null | undefined, people: PeopleMap = {}, me?: string | null): string {
  if (!id) return 'Nobody';
  if (me && id === me) return 'You';
  return people[id]?.name ?? `Unknown person · ${shortId(id)}`;
}

/* ------------------------------------------------------- A history, in words */

export interface EventLine {
  /** One sentence, actor first: "Jo moved it from New to In progress". */
  readonly text: string;
  /** A quoted reason or a qualifier, shown under the line. */
  readonly detail?: string;
}

const METHOD_WORD: Record<string, string> = {
  rule: 'by rule',
  round_robin: 'by rota',
  load_balanced: 'by workload',
  skills: 'by skills',
};

const FIELD_WORD: Record<string, string> = {
  title: 'the title',
  description: 'the description',
  priority: 'the priority',
  impact: 'the impact',
  urgency: 'the urgency',
  type: 'the type',
  categoryId: 'the category',
  serviceId: 'the service',
  affectedUserId: 'the affected person',
  requesterId: 'the requester',
  dueAt: 'the due date',
  custom: 'a custom field',
  tags: 'the tags',
};

const LINK_WORD: Record<string, string> = {
  relates_to: 'Linked it to',
  duplicates: 'Marked it a duplicate of',
  duplicated_by: 'Marked it duplicated by',
  blocks: 'Marked it as blocking',
  blocked_by: 'Marked it blocked by',
  caused_by: 'Linked it as caused by',
  causes: 'Linked it as the cause of',
  parent_of: 'Made it the parent of',
  child_of: 'Made it a child of',
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Who did it: a person's name, "An automation" for a rule or workflow, "The AI" for triage, "The system" otherwise. */
function actorOf(entry: TimelineEventEntry, people: PeopleMap, me?: string | null): string {
  if (entry.actorType === 'ai') return 'AI triage';
  if (entry.actorType === 'workflow' || entry.actorType === 'rule') return 'An automation';
  if (!entry.actorId || entry.actorType === 'system' || entry.actorType === 'service') return 'The system';
  return personName(entry.actorId.toLowerCase(), people, me);
}

/**
 * An event's type in the catalogue's spelling (`ticket.status.changed`).
 *
 * The ticket timeline stores the short form (`status.changed`, `assigned`,
 * `updated` — `insertTicketEvent` writes them so) while the event catalogue,
 * the live stream and these words name them in full. Both are read as the full
 * one, so a caller never has to know which it was handed.
 */
export function ticketEventType(type: string): string {
  return type.startsWith('ticket.') ? type : `ticket.${type}`;
}

/**
 * A ticket event in words (F22), or `null` for one that is not worth a line.
 *
 * `comment.added` is dropped: the comment itself is already in the
 * conversation, and a second line saying it was added is the duplicate the
 * old timeline showed. An event this does not know is still shown — as its
 * type in plain words — rather than hidden, because a missing line in a
 * history reads as nothing having happened.
 *
 * It takes the timeline's entry as the API sends it: the short type
 * (`status.changed`) or the full one (`ticket.status.changed`), ids in any
 * case.
 */
export function describeEvent(entry: TimelineEventEntry, people: PeopleMap = {}, me?: string | null): EventLine | null {
  const payload = entry.payload ?? {};
  const actor = actorOf(entry, people, me);
  const reason = text(payload.reason);
  const withReason = (line: string): EventLine => (reason ? { text: line, detail: `“${reason}”` } : { text: line });
  const type = ticketEventType(entry.type);

  switch (type) {
    case 'ticket.comment.added':
      return null;
    case 'ticket.created': {
      const channel = text(payload.channel);
      return { text: `${actor} raised it${channel ? ` · ${channelLabel(channel)}` : ''}` };
    }
    case 'ticket.imported':
      return { text: `${actor} imported it` };
    case 'ticket.status.changed': {
      const from = text(payload.from);
      const to = text(payload.to);
      if (!to) return withReason(`${actor} changed the status`);
      return withReason(from ? `${actor} moved it from ${stateLabel(from)} to ${stateLabel(to)}` : `${actor} moved it to ${stateLabel(to)}`);
    }
    case 'ticket.assigned': {
      // Ids are compared with the directory's lower-case keys, whatever case the payload used.
      const assignee = text(payload.assigneeId)?.toLowerCase() ?? null;
      const method = METHOD_WORD[text(payload.method) ?? ''];
      const who = assignee ? personName(assignee, people, me) : null;
      const line = who ? (who === actor ? `${actor} took it` : `${actor} assigned it to ${who}`) : `${actor} unassigned it`;
      return method ? { text: line, detail: method.charAt(0).toUpperCase() + method.slice(1) } : { text: line };
    }
    case 'ticket.updated': {
      const changed = payload.changed && typeof payload.changed === 'object' ? Object.keys(payload.changed as object) : [];
      const fields = changed.map((field) => FIELD_WORD[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
      if (fields.length === 0) return withReason(`${actor} edited it`);
      const list = fields.length === 1 ? fields[0]! : `${fields.slice(0, -1).join(', ')} and ${fields[fields.length - 1]}`;
      return withReason(`${actor} changed ${list}`);
    }
    case 'ticket.task.created':
      return { text: `${actor} added a task${text(payload.title) ? `: ${text(payload.title)}` : ''}` };
    case 'ticket.task.completed':
      return { text: `${actor} completed a task` };
    case 'ticket.linked': {
      const phrase = LINK_WORD[text(payload.linkType) ?? ''] ?? 'Linked it to';
      return { text: `${actor} ${phrase.charAt(0).toLowerCase() + phrase.slice(1)} another ticket` };
    }
    case 'ticket.attachment.added':
      return { text: `${actor} attached ${text(payload.filename) ?? 'a file'}` };
    default: {
      const words = type.replace(/^ticket\./, '').replaceAll('.', ' ').replaceAll('_', ' ');
      return { text: `${actor} · ${words}` };
    }
  }
}

/* --------------------------------------------------------------- Problems */

/**
 * Any failure as the design system's `Problem`, for `ProblemState`, banners
 * and toasts. An `ApiError` keeps its status and code (`tenant_suspended`
 * becomes a suspended workspace, not a permission error); anything else that
 * reached here without an answer is the network.
 */
export function problemOf(error: unknown): Problem {
  if (error instanceof ApiError) {
    const type = error.problem?.type ?? '';
    const code = type.includes('/problems/') ? type.slice(type.lastIndexOf('/') + 1) : undefined;
    const fieldErrors = error.fieldErrors;
    return {
      status: error.status,
      ...(code ? { code } : {}),
      ...(error.problem?.title ? { title: error.problem.title } : {}),
      ...(error.problem?.detail ? { detail: error.problem.detail } : {}),
      // A demo cap (429 demo_limit) does not lift with time, so waiting and
      // trying again cannot help, though every other 429 may be retried.
      retryable: code === 'demo_limit' ? false : error.retryable,
      ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    };
  }
  return { status: 0, retryable: true };
}

/** Whether a failure is the workspace being suspended (SPEC §4.10): a full-screen state, not an error. */
export function isTenantSuspended(error: unknown): boolean {
  const problem = problemOf(error);
  return problem.status === 403 && problem.code === 'tenant_suspended';
}
