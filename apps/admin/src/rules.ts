/**
 * Turning a list of rows on a screen into an `@itsm/expr` expression, and back.
 *
 * The rules engine takes a tree: `{and: [{eq: [{var: 'ticket.priority'}, 'P1']}]}`.
 * An author wants rows — field, operator, value — joined by "all of these" or
 * "any of these". This is the translation, kept pure and out of the component
 * because it is the part that can be wrong in a way nobody sees: a condition
 * that reads correctly on screen and matches nothing.
 *
 * `fromExpression` is deliberately partial and says so. The expression language
 * is a tree with `not`, nesting and twenty-one operators; this editor offers a
 * flat list of the common ones. Anything it cannot represent comes back as
 * null, and the editor shows the raw JSON read-only rather than a simplified
 * version an author might save over — which would silently delete the half it
 * could not draw.
 */

/** The operators this editor offers, of the twenty-one the language has. */
export const OPERATORS = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
  { value: 'contains', label: 'contains' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'exists', label: 'is set' },
  { value: 'empty', label: 'is empty' },
] as const;

export type Operator = (typeof OPERATORS)[number]['value'];

/** The two operators that take no right-hand side. */
const UNARY = new Set<Operator>(['exists', 'empty']);

export function isUnary(operator: Operator): boolean {
  return UNARY.has(operator);
}

export interface Condition {
  fact: string;
  operator: Operator;
  value: string;
}

export type Join = 'and' | 'or';

/**
 * A value typed into a text box, as the engine should see it.
 *
 * `true`, `false` and numbers are converted; everything else stays a string.
 * Worth doing rather than sending everything as text: `ticket.reopenCount`
 * compared against the string `"3"` raises in `@itsm/expr` rather than
 * quietly comparing wrong, which is the behaviour that module was given
 * deliberately — but it raises at run time, on a live ticket, and this turns
 * that into a comparison that simply works.
 */
export function coerce(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return raw;
}

/** The rows, as an expression the engine will accept. */
export function toExpression(conditions: readonly Condition[], join: Join): unknown {
  const usable = conditions.filter((condition) => condition.fact !== '');
  // No rows means "every time", which is what `always` says. An empty `and`
  // would be rejected by the schema, which takes `.min(1)`.
  if (usable.length === 0) return { always: true };

  const clauses = usable.map((condition) =>
    isUnary(condition.operator)
      ? { [condition.operator]: { var: condition.fact } }
      : { [condition.operator]: [{ var: condition.fact }, coerce(condition.value)] },
  );

  return clauses.length === 1 ? clauses[0] : { [join]: clauses };
}

interface Parsed {
  conditions: Condition[];
  join: Join;
}

function asCondition(node: unknown): Condition | null {
  if (typeof node !== 'object' || node === null) return null;
  const entries = Object.entries(node as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [operator, operand] = entries[0]!;
  if (!OPERATORS.some((known) => known.value === operator)) return null;

  if (isUnary(operator as Operator)) {
    const variable = operand as { var?: unknown };
    if (typeof variable?.var !== 'string') return null;
    return { fact: variable.var, operator: operator as Operator, value: '' };
  }

  if (!Array.isArray(operand) || operand.length !== 2) return null;
  const [left, right] = operand as [{ var?: unknown }, unknown];
  if (typeof left?.var !== 'string') return null;
  // A right-hand side that is itself a variable is a fact-to-fact comparison,
  // which these rows cannot express.
  if (typeof right === 'object' && right !== null) return null;
  return { fact: left.var, operator: operator as Operator, value: right === null ? '' : String(right) };
}

/**
 * An expression as rows, or null when this editor cannot draw it faithfully.
 *
 * Null is the important return. Drawing a `not` or a nested tree as the flat
 * rows it partly resembles would mean saving those rows deleted the rest, and
 * the author would have no way to know: the screen would look like what they
 * meant.
 */
export function fromExpression(expression: unknown): Parsed | null {
  if (expression === null || typeof expression !== 'object') return null;

  const node = expression as Record<string, unknown>;
  if (node.always === true) return { conditions: [], join: 'and' };

  for (const join of ['and', 'or'] as const) {
    const branch = node[join];
    if (Array.isArray(branch)) {
      const conditions = branch.map(asCondition);
      if (conditions.some((condition) => condition === null)) return null;
      return { conditions: conditions as Condition[], join };
    }
  }

  const single = asCondition(node);
  return single ? { conditions: [single], join: 'and' } : null;
}

/* ------------------------------------------------------------------ actions */

/**
 * The actions the builder composes, of the eleven in the engine's closed set
 * (`modules/rules/src/domain/actions.ts`).
 *
 * Eight have a typed editor: the five that take a value a person can pick
 * from a list, plus *Start a workflow* (a workflow chosen by name, SPEC
 * §6.1), *Set impact or urgency* (`setField` on those two fields, with the
 * three levels) and *Assign to a team* (`assignGroup`, a team chosen by
 * name — offered only when the team list can be read, A6).
 *
 * The rest — `setCategory`, `addWatcher`, `linkDuplicate`, and `setField` on
 * any other field — take an identifier this console has no list for. A rule
 * that has one keeps it untouched: the builder shows it read-only as a
 * *Custom action* and saves it back exactly as it was (`fromAction` returns
 * null for it), rather than offering a box to paste a UUID into.
 */
export const ACTION_TYPES = [
  { value: 'setPriority', label: 'Set the priority' },
  { value: 'setStatus', label: 'Set the status' },
  { value: 'sendNotification', label: 'Send a notification' },
  { value: 'assignStrategy', label: 'Assign by strategy' },
  { value: 'assignGroup', label: 'Assign to a team' },
  { value: 'addTag', label: 'Add a tag' },
  { value: 'startWorkflow', label: 'Start a workflow' },
  { value: 'setField', label: 'Set impact or urgency' },
] as const;

export type ActionType = (typeof ACTION_TYPES)[number]['value'];

/** The two fields `setField` is offered for; the engine allows more, which stay custom actions. */
export const LEVEL_FIELDS = ['impact', 'urgency'] as const;
export type LevelField = (typeof LEVEL_FIELDS)[number];

export interface ActionDraft {
  type: ActionType;
  /**
   * The single value each action needs: a priority, a status, a template, a
   * strategy, a team id, a tag, a workflow key, or a level.
   */
  value: string;
  /** Required by `setPriority` (may be empty), optional on `setStatus`, unused elsewhere. */
  reason: string;
  /** `sendNotification` only: who is told. */
  to: string;
  /** `setField` only: which of impact and urgency. */
  field?: LevelField;
}

export function emptyAction(type: ActionType = 'setPriority'): ActionDraft {
  switch (type) {
    case 'setPriority':
      return { type, value: 'P3', reason: '', to: '' };
    case 'setStatus':
      return { type, value: '', reason: '', to: '' };
    case 'sendNotification':
      return { type, value: '', reason: '', to: 'requester' };
    case 'assignStrategy':
      return { type, value: 'round_robin', reason: '', to: '' };
    case 'setField':
      return { type, value: 'high', reason: '', to: '', field: 'impact' };
    default:
      return { type, value: '', reason: '', to: '' };
  }
}

/** One row, as the action the engine's closed set defines. */
export function toAction(draft: ActionDraft): Record<string, unknown> {
  switch (draft.type) {
    case 'setPriority':
      return { type: 'setPriority', priority: draft.value, reason: draft.reason.trim() };
    case 'setStatus':
      return {
        type: 'setStatus',
        status: draft.value.trim(),
        ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
      };
    case 'addTag':
      return { type: 'addTag', tag: draft.value.trim() };
    case 'assignStrategy':
      return { type: 'assignStrategy', strategy: draft.value };
    case 'sendNotification':
      return { type: 'sendNotification', template: draft.value.trim(), to: draft.to };
    case 'startWorkflow':
      return { type: 'startWorkflow', definitionKey: draft.value.trim() };
    case 'setField':
      return { type: 'setField', field: draft.field ?? 'impact', value: draft.value };
    case 'assignGroup':
      return { type: 'assignGroup', groupId: draft.value };
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A stored action as a row the builder can edit, or null when it cannot draw
 * it faithfully — the caller then keeps the stored action as it is.
 *
 * The same promise as `fromExpression`: null rather than an approximation, so
 * that saving never quietly changes an action the author could not see.
 */
export function fromAction(action: unknown): ActionDraft | null {
  if (typeof action !== 'object' || action === null || Array.isArray(action)) return null;
  const row = action as Record<string, unknown>;
  const keys = Object.keys(row);
  const only = (...allowed: string[]): boolean => keys.every((key) => key === 'type' || allowed.includes(key));
  switch (row.type) {
    case 'setPriority':
      return only('priority', 'reason') && typeof row.priority === 'string'
        ? { type: 'setPriority', value: row.priority, reason: text(row.reason), to: '' }
        : null;
    case 'setStatus':
      return only('status', 'reason') && typeof row.status === 'string'
        ? { type: 'setStatus', value: row.status, reason: text(row.reason), to: '' }
        : null;
    case 'addTag':
      return only('tag') && typeof row.tag === 'string' ? { type: 'addTag', value: row.tag, reason: '', to: '' } : null;
    case 'assignStrategy':
      return only('strategy') && typeof row.strategy === 'string' ? { type: 'assignStrategy', value: row.strategy, reason: '', to: '' } : null;
    case 'sendNotification':
      return only('template', 'to') && typeof row.template === 'string' && typeof row.to === 'string'
        ? { type: 'sendNotification', value: row.template, reason: '', to: row.to }
        : null;
    case 'startWorkflow':
      return only('definitionKey') && typeof row.definitionKey === 'string'
        ? { type: 'startWorkflow', value: row.definitionKey, reason: '', to: '' }
        : null;
    case 'setField':
      // Only impact and urgency, with a level as the value; any other field
      // takes an id or a date and stays a custom action.
      return only('field', 'value') && (LEVEL_FIELDS as readonly unknown[]).includes(row.field) && typeof row.value === 'string'
        ? { type: 'setField', value: row.value, reason: '', to: '', field: row.field as LevelField }
        : null;
    case 'assignGroup':
      return only('groupId') && typeof row.groupId === 'string' ? { type: 'assignGroup', value: row.groupId, reason: '', to: '' } : null;
    default:
      return null;
  }
}

/** A stored action as one line of English, for the list. */
export function describeAction(action: unknown): string {
  if (typeof action !== 'object' || action === null) return 'an unreadable action';
  const row = action as Record<string, unknown>;
  switch (row.type) {
    case 'setPriority':
      return `set priority to ${String(row.priority)}`;
    case 'setStatus':
      return `set status to ${String(row.status)}`;
    case 'addTag':
      return `add the tag ${String(row.tag)}`;
    case 'assignStrategy':
      return `assign by ${String(row.strategy).replace(/_/g, ' ')}`;
    case 'sendNotification':
      return `notify the ${String(row.to)} with ${String(row.template)}`;
    case 'setField':
      return `set ${String(row.field)}`;
    case 'setCategory':
      return 'set the category';
    case 'assignGroup':
      return 'assign to a group';
    case 'addWatcher':
      return 'add a watcher';
    case 'linkDuplicate':
      return 'link a duplicate';
    case 'startWorkflow':
      return `start the workflow ${String(row.definitionKey)}`;
    default:
      return `an action this console does not draw (${String(row.type)})`;
  }
}
