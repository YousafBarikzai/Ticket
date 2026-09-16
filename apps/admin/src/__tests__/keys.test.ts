import { describe, expect, it } from 'vitest';
import { FIELD_KEY, SLUG_KEY, keyFor, slugFor } from '../keys.js';

/**
 * Two key rules, tested against the expressions the API actually enforces.
 *
 * The point of the file is that they are different. A builder that derived a
 * catalogue key with `keyFor` would produce `orderALaptop`, which is a valid
 * *field* key and an invalid *service* key, and the person who typed the name
 * would get a message about a regular expression.
 */

describe('a field key', () => {
  it('camelCases a label', () => {
    expect(keyFor('Cost centre')).toBe('costCentre');
    expect(keyFor('Purchase order number')).toBe('purchaseOrderNumber');
  });

  it('refuses what it cannot honestly guess', () => {
    // No camelCase form of "1st line" is both valid and not an invention.
    expect(keyFor('1st line')).toBe('');
    expect(keyFor('   ')).toBe('');
    expect(keyFor('!!!')).toBe('');
  });

  it('only ever returns something the API would accept', () => {
    for (const label of ['Cost centre', 'A', 'Manager’s approval', 'x'.repeat(200)]) {
      const key = keyFor(label);
      if (key !== '') expect(FIELD_KEY.test(key), `${label} -> ${key}`).toBe(true);
    }
  });
});

describe('a slug key', () => {
  it('kebab-cases a name', () => {
    expect(slugFor('Order a laptop')).toBe('order-a-laptop');
    expect(slugFor('VPN access')).toBe('vpn-access');
    expect(slugFor('Priority 1 escalation')).toBe('priority-1-escalation');
  });

  it('drops punctuation rather than encoding it', () => {
    expect(slugFor("Manager's approval")).toBe('managers-approval');
    expect(slugFor('Cost centre (finance)')).toBe('cost-centre-finance');
  });

  it('refuses a name that cannot make a valid key', () => {
    // Must start with a letter, and must be at least two characters.
    expect(slugFor('1st line')).toBe('');
    expect(slugFor('a')).toBe('');
    expect(slugFor('   ')).toBe('');
    expect(slugFor('!!!')).toBe('');
  });

  it('never leaves a trailing hyphen after truncating', () => {
    // A long name truncated at 63 can land on a separator. `...-lapt-` is
    // still a valid key, so nothing downstream would have complained.
    const long = `${'word '.repeat(20)}tail`;
    const key = slugFor(long);
    expect(key.endsWith('-')).toBe(false);
    expect(key.length).toBeLessThanOrEqual(63);
  });

  it('only ever returns something the API would accept', () => {
    const names = ['Order a laptop', 'VPN', 'a', '1st line', '', '   ', 'x'.repeat(300), 'Ünïcödé name here'];
    for (const name of names) {
      const key = slugFor(name);
      if (key !== '') expect(SLUG_KEY.test(key), `${name} -> ${key}`).toBe(true);
    }
  });

  it('is not the field rule', () => {
    // The whole reason both exist. Each output is refused by the other's rule.
    expect(SLUG_KEY.test(keyFor('Order a laptop'))).toBe(false);
    expect(FIELD_KEY.test(slugFor('Order a laptop'))).toBe(false);
  });
});
