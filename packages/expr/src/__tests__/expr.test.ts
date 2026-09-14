import { describe, expect, it } from 'vitest';
import { ExprError, evaluate, parseExpr, parseDuration, readPath, referencedVars, type Expr } from '../index.js';

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
