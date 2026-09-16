import { describe, expect, it } from 'vitest';
import { keyFor } from '../keys.js';

/**
 * The two pieces of arithmetic and string work this console does before
 * showing somebody a number or storing a name they cannot change later.
 */

describe('deriving a field key from its label', () => {
  it('camelCases the words', () => {
    expect(keyFor('Cost centre')).toBe('costCentre');
    expect(keyFor('Purchase order number')).toBe('purchaseOrderNumber');
  });

  it('drops punctuation rather than encoding it', () => {
    expect(keyFor("Manager's approval")).toBe('managersApproval');
    expect(keyFor('Cost centre (finance)')).toBe('costCentreFinance');
  });

  it('is empty for a label with nothing in it, so the form can refuse', () => {
    expect(keyFor('   ')).toBe('');
    expect(keyFor('!!!')).toBe('');
  });

  it('gives nothing when it cannot produce a key the API would accept', () => {
    // The API's rule is `^[a-z][a-zA-Z0-9]{0,63}$`. "1st line" camelCases to
    // `1stLine`, which starts with a digit and would be refused on save — so
    // the editor asks for a different label rather than offering a key that
    // looks fine and fails. `firstLine` would be an invention and `stLine`
    // nonsense.
    expect(keyFor('1st line')).toBe('');
    expect(keyFor('2024 budget')).toBe('');
  });

  it('still accepts a digit that is not first', () => {
    expect(keyFor('Line 2 support')).toBe('line2Support');
  });

  it('never exceeds the 64 characters the column allows', () => {
    expect(keyFor('a '.repeat(80)).length).toBeLessThanOrEqual(64);
  });
});
