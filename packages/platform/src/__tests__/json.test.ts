import { describe, expect, it } from 'vitest';
import { canonicalJson, jsonEquals } from '../json.js';

/**
 * The bug this exists to prevent has no symptom at the moment it happens.
 *
 * `JSON.stringify(a) === JSON.stringify(b)` compares writing order, and
 * PostgreSQL `jsonb` does not keep writing order. So a value read back from the
 * database compares unequal to the identical value that was written, for ever,
 * and the cost depends entirely on which way the condition runs: MOD-10-E2
 * stopped recognising proposals somebody had already rejected, and MOD-04
 * recorded a change every time a ticket's custom fields were re-sent unchanged.
 */

describe('canonicalJson', () => {
  it('is the same however the keys were ordered', () => {
    expect(canonicalJson({ name: 'a', serial: 'b' })).toBe(canonicalJson({ serial: 'b', name: 'a' }));
  });

  it('sorts nested objects, and objects inside arrays', () => {
    expect(canonicalJson({ outer: { x: 1, y: 2 }, list: [{ p: 1, q: 2 }] })).toBe(
      canonicalJson({ list: [{ q: 2, p: 1 }], outer: { y: 2, x: 1 } }),
    );
  });

  it('keeps array order, because order is information in a list', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('sorts by code point, not by locale', () => {
    // `localeCompare` would put `alpha` before `Bravo`; a hash or a comparison
    // that depended on it would disagree between two Node builds with different
    // ICU data, which is not something anybody would ever debug.
    expect(canonicalJson({ Bravo: 1, alpha: 2 })).toBe('{"Bravo":1,"alpha":2}');
  });

  it('treats an absent key and an undefined one as the same', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('reads a bare undefined as null, so it never returns undefined', () => {
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('writes a date as its instant rather than as an empty object', () => {
    expect(canonicalJson(new Date('2026-09-15T10:00:00.000Z'))).toBe('"2026-09-15T10:00:00.000Z"');
  });

  it('still tells different values apart', () => {
    expect(canonicalJson({ serial: 'SN-1' })).not.toBe(canonicalJson({ serial: 'SN-2' }));
    // A number and its text are different values, and coercing them here would
    // undo the refusals the modules make on purpose.
    expect(canonicalJson({ cpus: 8 })).not.toBe(canonicalJson({ cpus: '8' }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 1, b: 2 }));
  });
});

describe('jsonEquals', () => {
  it('is true for the same value written in another order', () => {
    expect(jsonEquals({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
  });

  it('is false for a real difference', () => {
    expect(jsonEquals({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonEquals(null, {})).toBe(false);
    expect(jsonEquals([1, 2], [2, 1])).toBe(false);
  });

  it('handles primitives and nulls without ceremony', () => {
    expect(jsonEquals(1, 1)).toBe(true);
    expect(jsonEquals('a', 'a')).toBe(true);
    expect(jsonEquals(null, null)).toBe(true);
    expect(jsonEquals(undefined, null)).toBe(true);
  });

  it('agrees with a raw stringify when the orders happen to match, and disagrees when they do not', () => {
    const written = { name: 'LAP-1', serial: 'SN-1' };
    const readBack = { serial: 'SN-1', name: 'LAP-1' };
    // This line is the whole bug: the two are the same value.
    expect(JSON.stringify(written) === JSON.stringify(readBack)).toBe(false);
    expect(jsonEquals(written, readBack)).toBe(true);
  });
});
