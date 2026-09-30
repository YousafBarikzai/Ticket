import { describe, expect, it } from 'vitest';
import { exprSchema } from '@itsm/expr';
import { coerce, describeAction, emptyAction, fromAction, fromExpression, toAction, toExpression, ACTION_TYPES, type Condition } from '../rules.js';

/**
 * The translation between rows on a screen and the rules engine's expression
 * tree, checked against the engine's own schema.
 *
 * `exprSchema` is imported rather than approximated. An editor that produced
 * something the schema refuses would fail on save with a message about a union
 * type, and one that produced something the schema accepts but means differently
 * would not fail at all — it would just match the wrong tickets, quietly, on a
 * live desk.
 */

const row = (fact: string, operator: Condition['operator'], value = ''): Condition => ({ fact, operator, value });

describe('rows to an expression', () => {
  it('produces something the engine will accept', () => {
    const expression = toExpression([row('ticket.priority', 'eq', 'P1'), row('ticket.hasAssignee', 'eq', 'false')], 'and');
    expect(exprSchema.safeParse(expression).success).toBe(true);
  });

  it('means every time when there are no rows', () => {
    // An empty `and` would be refused: the schema takes `.min(1)`.
    expect(toExpression([], 'and')).toEqual({ always: true });
    expect(exprSchema.safeParse(toExpression([], 'and')).success).toBe(true);
  });

  it('does not wrap a single row in a pointless and', () => {
    expect(toExpression([row('ticket.priority', 'eq', 'P1')], 'and')).toEqual({
      eq: [{ var: 'ticket.priority' }, 'P1'],
    });
  });

  it('joins by any of these when asked', () => {
    const expression = toExpression([row('ticket.priority', 'eq', 'P1'), row('ticket.priority', 'eq', 'P2')], 'or');
    expect(expression).toHaveProperty('or');
    expect(exprSchema.safeParse(expression).success).toBe(true);
  });

  it('gives the two unary operators no right-hand side', () => {
    expect(toExpression([row('ticket.assigneeId', 'exists')], 'and')).toEqual({ exists: { var: 'ticket.assigneeId' } });
    expect(exprSchema.safeParse(toExpression([row('ticket.assigneeId', 'empty')], 'and')).success).toBe(true);
  });

  it('ignores a row whose field was never chosen', () => {
    expect(toExpression([row('', 'eq', 'P1')], 'and')).toEqual({ always: true });
  });
});

describe('typing a value', () => {
  it('sends a number as a number', () => {
    // @itsm/expr raises on a mismatched comparison rather than coercing, so a
    // reopen count compared against "3" would throw on a live ticket.
    expect(coerce('3')).toBe(3);
    expect(coerce(' 0 ')).toBe(0);
    expect(coerce('-2')).toBe(-2);
  });

  it('sends a boolean as a boolean', () => {
    expect(coerce('true')).toBe(true);
    expect(coerce('false')).toBe(false);
  });

  it('leaves anything else alone, spaces included', () => {
    expect(coerce('P1')).toBe('P1');
    expect(coerce('3 laptops')).toBe('3 laptops');
    expect(coerce(' padded ')).toBe(' padded ');
    expect(coerce('')).toBe('');
  });
});

describe('an expression back to rows', () => {
  it('round-trips what the editor produced', () => {
    const conditions = [row('ticket.priority', 'eq', 'P1'), row('ticket.reopenCount', 'gt', '2')];
    const parsed = fromExpression(toExpression(conditions, 'and'));
    expect(parsed?.join).toBe('and');
    expect(parsed?.conditions).toEqual(conditions);
  });

  it('round-trips a single row without inventing a join', () => {
    const parsed = fromExpression(toExpression([row('ticket.type', 'eq', 'incident')], 'or'));
    expect(parsed?.conditions).toHaveLength(1);
  });

  it('reads always as no rows at all', () => {
    expect(fromExpression({ always: true })).toEqual({ conditions: [], join: 'and' });
  });

  it('refuses what it cannot draw, rather than drawing half of it', () => {
    // Each of these is a valid expression the flat editor has no shape for.
    // Returning rows would mean saving them silently deleted the rest.
    expect(fromExpression({ not: { eq: [{ var: 'ticket.priority' }, 'P1'] } })).toBeNull();
    expect(fromExpression({ and: [{ or: [{ eq: [{ var: 'a' }, 1] }] }] })).toBeNull();
    expect(fromExpression({ matches: [{ var: 'ticket.title' }, '^urgent'] })).toBeNull();
    expect(fromExpression({ withinLast: [{ var: 'ticket.createdAt' }, 'P1D'] })).toBeNull();
    // A fact compared to another fact, not to a literal.
    expect(fromExpression({ eq: [{ var: 'ticket.a' }, { var: 'ticket.b' }] })).toBeNull();
    expect(fromExpression(null)).toBeNull();
    expect(fromExpression('always')).toBeNull();
  });
});

describe('actions', () => {
  it('composes what the closed set defines', () => {
    expect(toAction({ type: 'setPriority', value: 'P1', reason: 'Major incident', to: '' })).toEqual({
      type: 'setPriority',
      priority: 'P1',
      reason: 'Major incident',
    });
    expect(toAction({ type: 'addTag', value: ' vip ', reason: '', to: '' })).toEqual({ type: 'addTag', tag: 'vip' });
  });

  it('omits an optional reason rather than sending an empty one', () => {
    expect(toAction({ type: 'setStatus', value: 'triage', reason: '  ', to: '' })).toEqual({
      type: 'setStatus',
      status: 'triage',
    });
  });

  it('describes every action in the closed set, including the six it cannot compose', () => {
    // The list shows rules written through the API too, so an action this
    // editor does not offer still has to read as something.
    expect(describeAction({ type: 'setPriority', priority: 'P2' })).toContain('P2');
    expect(describeAction({ type: 'assignGroup', groupId: 'x' })).toBe('assign to a group');
    expect(describeAction({ type: 'startWorkflow', definitionKey: 'joiner' })).toContain('joiner');
    expect(describeAction({ type: 'invented' })).toContain('does not draw');
    expect(describeAction(null)).toBe('an unreadable action');
  });
});

describe('the actions the builder adds (SPEC §3.8)', () => {
  const blank = { reason: '', to: '' };

  it('starts a workflow by its key', () => {
    expect(toAction({ type: 'startWorkflow', value: ' request-fulfilment ', ...blank })).toEqual({ type: 'startWorkflow', definitionKey: 'request-fulfilment' });
  });

  it('sets impact or urgency with a level, as setField', () => {
    expect(toAction({ type: 'setField', field: 'impact', value: 'high', ...blank })).toEqual({ type: 'setField', field: 'impact', value: 'high' });
    expect(toAction({ type: 'setField', field: 'urgency', value: 'low', ...blank })).toEqual({ type: 'setField', field: 'urgency', value: 'low' });
    // A draft that never chose a field is impact, which is what the editor shows first.
    expect(toAction({ type: 'setField', value: 'medium', ...blank })).toEqual({ type: 'setField', field: 'impact', value: 'medium' });
  });

  it('assigns to a team by its id', () => {
    expect(toAction({ type: 'assignGroup', value: '0190aaaa-0000-7000-8000-000000000001', ...blank })).toEqual({
      type: 'assignGroup',
      groupId: '0190aaaa-0000-7000-8000-000000000001',
    });
  });

  it('offers eight kinds of action, each with a starting value', () => {
    expect(ACTION_TYPES.map((type) => type.value)).toEqual(['setPriority', 'setStatus', 'sendNotification', 'assignStrategy', 'assignGroup', 'addTag', 'startWorkflow', 'setField']);
    for (const { value } of ACTION_TYPES) expect(emptyAction(value).type).toBe(value);
    expect(emptyAction('setField')).toMatchObject({ field: 'impact', value: 'high' });
    expect(emptyAction('sendNotification').to).toBe('requester');
  });
});

describe('a stored action back into the builder', () => {
  const round = (action: Record<string, unknown>): unknown => {
    const draft = fromAction(action);
    return draft ? toAction(draft) : null;
  };

  it('round-trips every action it draws', () => {
    for (const action of [
      { type: 'setPriority', priority: 'P1', reason: 'High impact and high urgency reported at creation' },
      { type: 'setStatus', status: 'in_progress', reason: 'The requester replied' },
      { type: 'setStatus', status: 'resolved' },
      { type: 'addTag', tag: 'vip' },
      { type: 'assignStrategy', strategy: 'least_loaded' },
      { type: 'sendNotification', template: 'ticket.created.group', to: 'group' },
      { type: 'startWorkflow', definitionKey: 'joiner' },
      { type: 'setField', field: 'urgency', value: 'high' },
      { type: 'assignGroup', groupId: '0190aaaa-0000-7000-8000-000000000001' },
    ]) {
      expect(round(action), JSON.stringify(action)).toEqual(action);
    }
  });

  it('refuses what it would change by drawing — the builder keeps those as they are', () => {
    // setField on a field that takes an id or a date is not impact/urgency.
    expect(fromAction({ type: 'setField', field: 'categoryId', value: '0190aaaa-0000-7000-8000-000000000001' })).toBeNull();
    expect(fromAction({ type: 'setField', field: 'impact', value: 3 })).toBeNull();
    expect(fromAction({ type: 'setCategory', categoryId: 'x' })).toBeNull();
    expect(fromAction({ type: 'addWatcher', userId: 'x' })).toBeNull();
    expect(fromAction({ type: 'linkDuplicate', of: 'x' })).toBeNull();
    // A field the builder has no control for would be dropped on save.
    expect(fromAction({ type: 'addTag', tag: 'vip', note: 'kept by the API' })).toBeNull();
    expect(fromAction({ type: 'invented' })).toBeNull();
    expect(fromAction(null)).toBeNull();
    expect(fromAction(['setPriority'])).toBeNull();
  });
});
