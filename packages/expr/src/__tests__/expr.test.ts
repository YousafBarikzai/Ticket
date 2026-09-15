import { describe, expect, it } from 'vitest';
import {
  ExprError,
  ExprTypeError,
  checkExpr,
  evaluate,
  parseExpr,
  parseDuration,
  readPath,
  referencedVars,
  type Expr,
} from '../index.js';

const ticket = {
  ticket: {
    priority: 'P2',
    status: 'in_progress',
    title: 'VPN will not connect from home',
    impact: 2,
    tags: ['network', 'vpn'],
    createdAt: '2026-09-14T09:00:00.000Z',
    resolvedAt: null,
  },
  requester: { email: 'ada@acme.test', vip: true, location: 'London' },
  answers: { costCentre: 'FIN-1', amount: 4500 },
  channel: 'email',
  now: '2026-09-14T12:00:00.000Z',
};

describe('evaluate', () => {
  it('compares scalars and variables', () => {
    expect(evaluate({ eq: [{ var: 'ticket.priority' }, 'P2'] }, ticket)).toBe(true);
    expect(evaluate({ eq: [{ var: 'ticket.priority' }, 'P1'] }, ticket)).toBe(false);
    expect(evaluate({ ne: [{ var: 'channel' }, 'portal'] }, ticket)).toBe(true);
    expect(evaluate({ gt: [{ var: 'answers.amount' }, 1000] }, ticket)).toBe(true);
    expect(evaluate({ lte: [{ var: 'ticket.impact' }, 2] }, ticket)).toBe(true);
  });

  it('treats a missing value as a failed comparison rather than an error', () => {
    expect(evaluate({ eq: [{ var: 'ticket.nothing.here' }, 'x'] }, ticket)).toBe(false);
    expect(evaluate({ gt: [{ var: 'missing' }, 1] }, ticket)).toBe(false);
    expect(evaluate({ exists: { var: 'ticket.resolvedAt' } }, ticket)).toBe(false);
    expect(evaluate({ exists: { var: 'ticket.priority' } }, ticket)).toBe(true);
  });

  it('never walks the prototype chain', () => {
    expect(readPath(ticket, 'constructor.name')).toBeUndefined();
    expect(readPath(ticket, '__proto__.polluted')).toBeUndefined();
  });

  it('handles membership, text and array operators', () => {
    expect(evaluate({ in: [{ var: 'ticket.priority' }, ['P1', 'P2']] }, ticket)).toBe(true);
    expect(evaluate({ nin: [{ var: 'ticket.priority' }, ['P3', 'P4']] }, ticket)).toBe(true);
    expect(evaluate({ contains: [{ var: 'ticket.tags' }, 'vpn'] }, ticket)).toBe(true);
    expect(evaluate({ contains: [{ var: 'ticket.title' }, 'VPN'] }, ticket)).toBe(true);
    expect(evaluate({ startsWith: [{ var: 'requester.email' }, 'ada'] }, ticket)).toBe(true);
    expect(evaluate({ endsWith: [{ var: 'requester.email' }, '@acme.test'] }, ticket)).toBe(true);
    expect(evaluate({ matches: [{ var: 'answers.costCentre' }, '^FIN-\\d+$'] }, ticket)).toBe(true);
  });

  it('composes with and / or / not', () => {
    const rule: Expr = {
      and: [
        { eq: [{ var: 'channel' }, 'email'] },
        { or: [{ eq: [{ var: 'requester.vip' }, true] }, { gt: [{ var: 'answers.amount' }, 10_000] }] },
        { not: { eq: [{ var: 'ticket.status' }, 'closed'] } },
      ],
    };
    expect(evaluate(rule, ticket)).toBe(true);
  });

  it('compares instants, not strings, for dates', () => {
    expect(evaluate({ before: [{ var: 'ticket.createdAt' }, { var: 'now' }] }, ticket)).toBe(true);
    expect(evaluate({ after: [{ var: 'ticket.createdAt' }, { var: 'now' }] }, ticket)).toBe(false);
    expect(evaluate({ withinLast: [{ var: 'ticket.createdAt' }, 'PT4H'] }, ticket)).toBe(true);
    expect(evaluate({ withinLast: [{ var: 'ticket.createdAt' }, 'PT1H'] }, ticket)).toBe(false);
    expect(evaluate({ lt: [{ var: 'ticket.createdAt' }, '2026-09-15T00:00:00.000Z'] }, ticket)).toBe(true);
  });

  it('detects empty values', () => {
    expect(evaluate({ empty: { var: 'ticket.resolvedAt' } }, ticket)).toBe(true);
    expect(evaluate({ empty: { var: 'ticket.tags' } }, ticket)).toBe(false);
    expect(evaluate({ empty: [] }, ticket)).toBe(true);
  });

  it('rejects unknown operators and excessive nesting', () => {
    expect(() => evaluate({ wat: [1, 2] } as unknown as Expr, ticket)).toThrow(ExprError);
    let deep: Expr = { always: true };
    for (let i = 0; i < 25; i += 1) deep = { not: deep };
    expect(() => evaluate(deep, ticket)).toThrow(/too deeply/);
  });

  it('rejects an invalid regular expression rather than crashing the request', () => {
    expect(() => evaluate({ matches: [{ var: 'ticket.title' }, '([a-z'] }, ticket)).toThrow(ExprError);
  });
});

describe('ordering across types', () => {
  it('refuses to order two present values of different kinds', () => {
    // The Phase 2 delivery record's one open decision, closed in Phase 3. This
    // used to be true, because "V" sorts after "5".
    expect(() => evaluate({ gt: [{ var: 'ticket.title' }, 5] }, ticket)).toThrow(ExprTypeError);
    expect(() => evaluate({ gt: [{ var: 'ticket.title' }, 5] }, ticket)).toThrow(
      'cannot compare string with number using gt',
    );
    expect(() => evaluate({ lte: [{ var: 'requester.vip' }, 3] }, ticket)).toThrow(ExprTypeError);
  });

  it('still treats a missing value as a failed comparison, not a type error', () => {
    // Absent is not wrong. An optional field nobody filled in must not report
    // its rule as broken, or every rule touching a custom field would be.
    expect(evaluate({ gt: [{ var: 'nothing.here' }, 5] }, ticket)).toBe(false);
    expect(evaluate({ lt: [{ var: 'ticket.resolvedAt' }, { var: 'now' }] }, ticket)).toBe(false);
  });

  it('orders values of the same kind as it always did', () => {
    expect(evaluate({ gt: [{ var: 'answers.amount' }, 1000] }, ticket)).toBe(true);
    expect(evaluate({ gt: [{ var: 'ticket.priority' }, 'P1'] }, ticket)).toBe(true);
    expect(evaluate({ gte: [{ var: 'requester.vip' }, true] }, ticket)).toBe(true);
  });

  it('lets a Date meet the ISO string the same value becomes over JSON', () => {
    // Load-bearing, not a convenience: the server holds a Date from the
    // database and the browser holds the string it became over the wire. If
    // these disagreed, the dry-run panel would disagree with the live path.
    const server = { ticket: { createdAt: new Date('2026-09-14T09:00:00.000Z') }, now: '2026-09-14T12:00:00.000Z' };
    const browser = { ticket: { createdAt: '2026-09-14T09:00:00.000Z' }, now: '2026-09-14T12:00:00.000Z' };
    const condition: Expr = { lt: [{ var: 'ticket.createdAt' }, { var: 'now' }] };
    expect(evaluate(condition, server)).toBe(true);
    expect(evaluate(condition, browser)).toBe(true);
    expect(evaluate(condition, server)).toBe(evaluate(condition, browser));
  });

  it('compares two ISO instants as instants even across time zones', () => {
    const ctx = { a: '2026-01-02T09:00:00.000Z', b: '2026-01-02T10:00:00+01:00' };
    // Same instant: neither is greater, though they differ as strings.
    expect(evaluate({ gt: [{ var: 'a' }, { var: 'b' }] }, ctx)).toBe(false);
    expect(evaluate({ lt: [{ var: 'a' }, { var: 'b' }] }, ctx)).toBe(false);
  });

  it('refuses to order a value that is not a scalar at all', () => {
    expect(() => evaluate({ gt: [{ var: 'ticket.tags' }, 5] }, ticket)).toThrow(ExprError);
  });
});

describe('checkExpr', () => {
  const types = { 'ticket.title': 'string', 'ticket.impact': 'number', 'ticket.createdAt': 'date' } as const;

  it('finds a mismatched comparison before the definition is published', () => {
    const conflicts = checkExpr({ gt: [{ var: 'ticket.title' }, 5] }, types);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ path: 'ticket.title', operator: 'gt', left: 'string', right: 'number' });
    expect(conflicts[0]!.message).toBe('ticket.title (string) cannot be compared with the right-hand number using gt');
  });

  it('accepts a sound comparison, and a date against an ISO literal', () => {
    expect(checkExpr({ gt: [{ var: 'ticket.impact' }, 2] }, types)).toEqual([]);
    expect(checkExpr({ lt: [{ var: 'ticket.createdAt' }, '2026-09-15T00:00:00.000Z'] }, types)).toEqual([]);
  });

  it('says nothing about a path it has no type for', () => {
    // Custom fields and form answers are tenant-defined, so they cannot be
    // enumerated at build time. The runtime error stays the backstop for those.
    expect(checkExpr({ gt: [{ var: 'fields.anything' }, 5] }, types)).toEqual([]);
  });

  it('descends into and / or / not', () => {
    const conflicts = checkExpr(
      { and: [{ eq: [{ var: 'ticket.title' }, 'x'] }, { not: { lt: [{ var: 'ticket.impact' }, 'high'] } }] },
      types,
    );
    expect(conflicts.map((c) => c.path)).toEqual(['ticket.impact']);
  });
});

describe('parseExpr', () => {
  it('accepts a valid expression and rejects a malformed one', () => {
    expect(parseExpr({ eq: [{ var: 'a' }, 1] })).toEqual({ eq: [{ var: 'a' }, 1] });
    expect(() => parseExpr({ eq: [{ var: 'a' }] })).toThrow();
    expect(() => parseExpr({ and: [] })).toThrow();
    expect(() => parseExpr({ eval: 'process.exit(1)' })).toThrow();
  });
});

describe('referencedVars', () => {
  it('lists every path an expression reads, for builder validation', () => {
    const rule: Expr = {
      and: [{ eq: [{ var: 'ticket.priority' }, 'P1'] }, { in: [{ var: 'channel' }, ['email', 'portal']] }],
    };
    expect(referencedVars(rule)).toEqual(['channel', 'ticket.priority']);
  });
});

describe('parseDuration', () => {
  it('parses the supported ISO-8601 subset', () => {
    expect(parseDuration('PT30M')).toBe(1_800_000);
    expect(parseDuration('PT4H')).toBe(14_400_000);
    expect(parseDuration('P5D')).toBe(432_000_000);
    expect(parseDuration('P1DT2H30M')).toBe(95_400_000);
    expect(() => parseDuration('5 days')).toThrow(ExprError);
  });
});
