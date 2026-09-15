import { describe, expect, it } from 'vitest';
import { decide, effectsOf, type LoadedRule } from '../service/engine.js';
import { factsForTicket } from '../service/facts.js';
import { conflictKey, EXCLUSIVE_ACTIONS, type RuleAction } from '../domain/actions.js';

/**
 * The rules interpreter.
 *
 * `decide` is pure, so these tests are the specification for how a rule set
 * behaves: which rule wins a contested field, what `stop` stops, and what
 * happens when a condition is nonsense. The dry-run test panel calls exactly
 * this function, so a passing test here is a promise the panel keeps.
 */

const ticket = {
  id: '00000000-0000-0000-0000-0000000000aa',
  type: 'incident',
  title: 'VPN will not connect',
  description: 'It fails at the second factor.',
  status: 'new',
  statusCategory: 'open',
  priority: 'P3',
  impact: 'high',
  urgency: 'high',
  sourceChannel: 'portal',
  orgId: null,
  serviceId: null,
  categoryId: null,
  groupId: null,
  assigneeId: null,
  requesterId: '00000000-0000-0000-0000-0000000000bb',
  affectedUserId: null,
  reopenCount: 0,
  createdAt: new Date('2026-09-15T09:00:00Z'),
  custom: { site: 'london' },
};

function rule(overrides: Partial<LoadedRule> & Pick<LoadedRule, 'key' | 'actions'>): LoadedRule {
  return {
    id: `id-${overrides.key}`,
    name: overrides.key,
    event: 'ticket.created',
    conditions: { always: true },
    order: 100,
    mode: 'continue',
    version: 1,
    ...overrides,
  } as LoadedRule;
}

const setP1: RuleAction = { type: 'setPriority', priority: 'P1', reason: 'major' };
const setP2: RuleAction = { type: 'setPriority', priority: 'P2', reason: 'less major' };

describe('matching', () => {
  it('matches a rule whose condition holds', () => {
    const decision = decide(
      [rule({ key: 'a', conditions: { eq: [{ var: 'ticket.impact' }, 'high'] }, actions: [setP1] })],
      factsForTicket(ticket),
    );
    expect(decision.matched.map((m) => m.ruleKey)).toEqual(['a']);
  });

  it('leaves a rule whose condition does not hold alone', () => {
    const decision = decide(
      [rule({ key: 'a', conditions: { eq: [{ var: 'ticket.impact' }, 'low'] }, actions: [setP1] })],
      factsForTicket(ticket),
    );
    expect(decision.matched).toEqual([]);
    expect(decision.applied).toEqual([]);
  });

  it('runs rules in order, and by key when two share an order', () => {
    const decision = decide(
      [
        rule({ key: 'zebra', order: 10, actions: [{ type: 'addTag', tag: 'z' }] }),
        rule({ key: 'alpha', order: 10, actions: [{ type: 'addTag', tag: 'a' }] }),
        rule({ key: 'first', order: 5, actions: [{ type: 'addTag', tag: 'f' }] }),
      ],
      factsForTicket(ticket),
    );
    expect(decision.matched.map((m) => m.ruleKey)).toEqual(['first', 'alpha', 'zebra']);
  });
});

describe('conflicting actions', () => {
  it('gives a contested field to the first rule that claims it', () => {
    const decision = decide(
      [rule({ key: 'first', order: 1, actions: [setP1] }), rule({ key: 'second', order: 2, actions: [setP2] })],
      factsForTicket(ticket),
    );
    expect(effectsOf(decision).patch.priority).toBe('P1');
    expect(decision.skipped).toHaveLength(1);
    expect(decision.skipped[0]!.supersededBy).toBe('first');
  });

  it('lets two rules each add a tag, because tags do not conflict', () => {
    const decision = decide(
      [
        rule({ key: 'a', order: 1, actions: [{ type: 'addTag', tag: 'one' }] }),
        rule({ key: 'b', order: 2, actions: [{ type: 'addTag', tag: 'two' }] }),
      ],
      factsForTicket(ticket),
    );
    expect(effectsOf(decision).tags).toEqual(['one', 'two']);
    expect(decision.skipped).toEqual([]);
  });

  it('treats two different fields as two separate claims', () => {
    const decision = decide(
      [
        rule({ key: 'a', order: 1, actions: [{ type: 'setField', field: 'impact', value: 'low' }] }),
        rule({ key: 'b', order: 2, actions: [{ type: 'setField', field: 'urgency', value: 'low' }] }),
      ],
      factsForTicket(ticket),
    );
    expect(effectsOf(decision).patch).toEqual({ impact: 'low', urgency: 'low' });
    expect(decision.skipped).toEqual([]);
  });

  it('treats the same field set twice as one claim', () => {
    const decision = decide(
      [
        rule({ key: 'a', order: 1, actions: [{ type: 'setField', field: 'impact', value: 'low' }] }),
        rule({ key: 'b', order: 2, actions: [{ type: 'setField', field: 'impact', value: 'high' }] }),
      ],
      factsForTicket(ticket),
    );
    expect(effectsOf(decision).patch).toEqual({ impact: 'low' });
    expect(decision.skipped).toHaveLength(1);
  });
});

describe('stop', () => {
  it('stops the rules that come after it', () => {
    const decision = decide(
      [
        rule({ key: 'stopper', order: 1, mode: 'stop', actions: [{ type: 'addTag', tag: 'one' }] }),
        rule({ key: 'later', order: 2, actions: [{ type: 'addTag', tag: 'two' }] }),
      ],
      factsForTicket(ticket),
    );
    expect(decision.matched.map((m) => m.ruleKey)).toEqual(['stopper']);
    expect(decision.notReached).toEqual(['later']);
    expect(effectsOf(decision).tags).toEqual(['one']);
  });

  it('does not stop anything when it did not match', () => {
    const decision = decide(
      [
        rule({ key: 'stopper', order: 1, mode: 'stop', conditions: { eq: [{ var: 'ticket.priority' }, 'P1'] }, actions: [] }),
        rule({ key: 'later', order: 2, actions: [{ type: 'addTag', tag: 'two' }] }),
      ],
      factsForTicket(ticket),
    );
    expect(decision.notReached).toEqual([]);
    expect(effectsOf(decision).tags).toEqual(['two']);
  });
});

describe('a rule that cannot be evaluated', () => {
  it('is reported without taking the other rules down with it', () => {
    // An unbalanced bracket in a pattern is the realistic case: the schema
    // accepts it, because it is a valid string, and only the regex engine finds
    // out. The person who raised the ticket must not see a rule author's typo.
    const decision = decide(
      [
        rule({ key: 'broken', order: 1, conditions: { matches: [{ var: 'ticket.title' }, '([unclosed'] }, actions: [setP1] }),
        rule({ key: 'sound', order: 2, actions: [{ type: 'addTag', tag: 'ok' }] }),
      ],
      factsForTicket(ticket),
    );
    expect(decision.errors.map((e) => e.ruleKey)).toEqual(['broken']);
    expect(decision.errors[0]!.message).toMatch(/invalid pattern/);
    expect(effectsOf(decision).tags).toEqual(['ok']);
    expect(effectsOf(decision).patch.priority).toBeUndefined();
  });

  it('refuses a mismatched comparison rather than matching everything', () => {
    // Until Phase 3 this was true rather than an error: the language compared a
    // string to a number as strings, so "VPN will not connect" > 5 held because
    // "V" sorts after "5", and the rule matched every ticket while reporting
    // nothing. It now fails the one rule and says why (docs/architecture/22 §2).
    const decision = decide(
      [
        rule({ key: 'mismatched', order: 1, conditions: { gt: [{ var: 'ticket.title' }, 5] }, actions: [setP1] }),
        rule({ key: 'sound', order: 2, actions: [{ type: 'addTag', tag: 'ok' }] }),
      ],
      factsForTicket(ticket),
    );
    expect(decision.errors).toEqual([{ ruleKey: 'mismatched', message: 'cannot compare string with number using gt' }]);
    expect(decision.matched.map((m) => m.ruleKey)).toEqual(['sound']);
    // The rest of the rule set still runs: one broken rule is not an outage.
    expect(effectsOf(decision).tags).toEqual(['ok']);
    expect(effectsOf(decision).patch.priority).toBeUndefined();
  });

  it('does not treat a blank optional field as a mismatch', () => {
    // The distinction that makes the change safe: absent is not wrong. A rule
    // reading a custom field nobody filled in fails its comparison quietly, as
    // it always has, rather than being reported to its author as broken.
    const decision = decide(
      [rule({ key: 'blank', conditions: { gt: [{ var: 'fields.costCentre' }, 5] }, actions: [setP1] })],
      factsForTicket(ticket),
    );
    expect(decision.errors).toEqual([]);
    expect(decision.matched).toEqual([]);
  });
});

describe('facts', () => {
  it('offers the convenience facts a rule author reaches for', () => {
    const facts = factsForTicket(ticket, { now: new Date('2026-09-15T10:30:00Z') }) as Record<string, never>;
    expect(facts.ticket).toMatchObject({ hasAssignee: false, hasGroup: false, ageMinutes: 90 });
  });

  it('knows whether a comment came from the requester', () => {
    const facts = factsForTicket(ticket, {
      comment: { visibility: 'public', authorId: ticket.requesterId },
    }) as Record<string, never>;
    expect(facts.comment).toMatchObject({ isFromRequester: true });
  });

  it('exposes custom field values under fields', () => {
    const facts = factsForTicket(ticket) as Record<string, never>;
    expect(facts.fields).toEqual({ site: 'london' });
  });
});

describe('the action set', () => {
  it('keys a field claim by the field, and everything else by its type', () => {
    expect(conflictKey({ type: 'setField', field: 'impact', value: 'low' })).toBe('setField:impact');
    expect(conflictKey(setP1)).toBe('setPriority');
  });

  it('treats additive actions as non-exclusive', () => {
    // Two rules each adding a watcher is not a conflict; two each setting the
    // priority is. If this ever inverts, rules start silently dropping effects.
    expect(EXCLUSIVE_ACTIONS.has('addWatcher')).toBe(false);
    expect(EXCLUSIVE_ACTIONS.has('addTag')).toBe(false);
    expect(EXCLUSIVE_ACTIONS.has('sendNotification')).toBe(false);
    expect(EXCLUSIVE_ACTIONS.has('setPriority')).toBe(true);
    expect(EXCLUSIVE_ACTIONS.has('assignGroup')).toBe(true);
  });
});
