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
 * The actions this editor can compose, of the eleven in the closed set.
 *
 * The other six — `setField`, `setCategory`, `assignGroup`, `addWatcher`,
 * `linkDuplicate`, `startWorkflow` — all take an identifier this console has no
 * list to offer: a category id, a group id, a user id. A text box asking an
 * administrator to paste a UUID is not a builder, so they stay API-only and the
 * screen says which and why.
 */
export const ACTION_TYPES = [
  { value: 'setPriority', label: 'Set the priority' },
  { value: 'setStatus', label: 'Set the status' },
  { value: 'addTag', label: 'Add a tag' },
  { value: 'assignStrategy', label: 'Assign by strategy' },
  { value: 'sendNotification', label: 'Send a notification' },
] as const;

export type ActionType = (typeof ACTION_TYPES)[number]['value'];

export interface ActionDraft {
  type: ActionType;
  /** The single value each of these actions needs: a priority, a status, a tag, a strategy, a template. */
  value: string;
  /** Required by `setPriority`, optional on `setStatus`, unused elsewhere. */
  reason: string;
  /** `sendNotification` only. */
  to: string;
}

export function emptyAction(): ActionDraft {
  return { type: 'setPriority', value: 'P3', reason: '', to: 'requester' };
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
