import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { booleanQuery } from '../routes/query.js';

/**
 * The boolean query helper (Q1). The integration suite proves each route uses
 * it; this proves what it means, including the spelling the old coercion got
 * backwards.
 */
describe('booleanQuery', () => {
  it('reads the two words, and false as false', () => {
    expect(booleanQuery().parse('true')).toBe(true);
    expect(booleanQuery().parse('false')).toBe(false);
  });

  it('refuses anything else rather than guessing', () => {
    for (const value of ['', '1', '0', 'yes', 'TRUE', ' true', ['true', 'false'], true]) {
      expect(booleanQuery().safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it('leaves an absent parameter undefined when optional', () => {
    const schema = z.object({ open: booleanQuery().optional() });
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ open: 'false' })).toEqual({ open: false });
  });

  it('reads an absent parameter as the fallback when given one', () => {
    const schema = z.object({ includeInactive: booleanQuery(false), includeAll: booleanQuery(true) });
    expect(schema.parse({})).toEqual({ includeInactive: false, includeAll: true });
    expect(schema.parse({ includeInactive: 'true', includeAll: 'false' })).toEqual({ includeInactive: true, includeAll: false });
    expect(schema.safeParse({ includeInactive: 'no' }).success).toBe(false);
  });

  it('works inside a strict query schema, as the routes use it', () => {
    const schema = z.object({ includeInactive: booleanQuery(false) }).strict();
    expect(schema.safeParse({ includeInactive: 'false', other: 'x' }).success).toBe(false);
  });
});
