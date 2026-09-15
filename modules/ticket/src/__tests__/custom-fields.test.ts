import { describe, expect, it } from 'vitest';
import { ValidationError } from '@itsm/platform';
import { appliesToType, isRequired, validateCustom, visibleCustom, type FieldRow } from '../service/field-service.js';

/**
 * Custom fields, which until now were a table nothing read.
 *
 * `field_definition` has existed since Phase 1 carrying a comment promising
 * that "the ticket API validates `custom` against them from the start". It did
 * not: `custom` was `z.record(z.unknown())`, so a ticket could hold anything a
 * caller sent under any key at all. These tests are what make the comment true.
 */

function field(overrides: Partial<FieldRow> = {}): FieldRow {
  return {
    id: 'f-1',
    key: 'costCentre',
    label: 'Cost centre',
    type: 'text',
    options: [],
    appliesTo: { types: [] },
    requiredWhen: null,
    visibleTo: [],
    classification: 'internal',
    order: 0,
    isActive: true,
    ...overrides,
  };
}

const anyone = { worksTheDesk: true, holds: () => true };
const requester = { worksTheDesk: false, holds: () => false };

describe('which fields apply', () => {
  it('applies to every type when it names none', () => {
    expect(appliesToType(field(), 'incident')).toBe(true);
    expect(appliesToType(field(), 'change')).toBe(true);
  });

  it('applies only to the types it names', () => {
    const scoped = field({ appliesTo: { types: ['change'] } });
    expect(appliesToType(scoped, 'change')).toBe(true);
    expect(appliesToType(scoped, 'incident')).toBe(false);
  });
});

describe('what a value may be', () => {
  it('refuses a key that is not a field, rather than storing it', () => {
    // The whole point. A misspelled key used to land in a JSONB column that
    // nothing would ever read back, and a tenant would discover six months
    // later that half its tickets say costCentre and half say cost_center.
    expect(() => validateCustom([field()], 'incident', { cost_centre: 'X' }, {})).toThrow(ValidationError);
    expect(() => validateCustom([field()], 'incident', { cost_centre: 'X' }, {})).toThrow(/not a field/);
  });

  it('names what it does take, so the mistake is fixable from the message', () => {
    expect(() => validateCustom([field()], 'incident', { nope: 1 }, {})).toThrow(/costCentre/);
  });

  it('checks the type', () => {
    expect(() => validateCustom([field({ type: 'number' })], 'incident', { costCentre: 'twelve' }, {})).toThrow(/a number/);
    expect(() => validateCustom([field({ type: 'checkbox' })], 'incident', { costCentre: 'yes' }, {})).toThrow(/true or false/);
    expect(() => validateCustom([field({ type: 'date' })], 'incident', { costCentre: 'soon' }, {})).toThrow(/a date/);
  });

  it('accepts a good value of each type', () => {
    expect(validateCustom([field({ type: 'number' })], 'incident', { costCentre: 12 }, {})).toEqual({ costCentre: 12 });
    expect(validateCustom([field({ type: 'checkbox' })], 'incident', { costCentre: true }, {})).toEqual({ costCentre: true });
    expect(validateCustom([field()], 'incident', { costCentre: 'FIN-1' }, {})).toEqual({ costCentre: 'FIN-1' });
  });

  it('refuses a select value that is not an option', () => {
    const select = field({ type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    expect(() => validateCustom([select], 'incident', { costCentre: 'c' }, {})).toThrow(/not an option/);
    expect(validateCustom([select], 'incident', { costCentre: 'b' }, {})).toEqual({ costCentre: 'b' });
  });

  it('de-duplicates a multiselect rather than storing the same choice twice', () => {
    const multi = field({ type: 'multiselect', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
    expect(validateCustom([multi], 'incident', { costCentre: ['a', 'b', 'a'] }, {})).toEqual({ costCentre: ['a', 'b'] });
  });

  it('ignores a field that does not apply to this type, by refusing it', () => {
    const changeOnly = field({ appliesTo: { types: ['change'] } });
    expect(() => validateCustom([changeOnly], 'incident', { costCentre: 'X' }, {})).toThrow(/not a field on a incident/);
  });

  it('refuses a new value for a deactivated field, and says why', () => {
    expect(() => validateCustom([field({ isActive: false })], 'incident', { costCentre: 'X' }, {})).toThrow(/no longer in use/);
  });

  it('lets null through, because that is how a value is cleared', () => {
    expect(validateCustom([field()], 'incident', { costCentre: null }, {})).toEqual({ costCentre: null });
  });
});

describe('when a field is required', () => {
  const requiredForHardware = field({
    requiredWhen: { eq: [{ var: 'categoryId' }, 'hardware'] },
  });

  it('is not required when the condition does not hold', () => {
    expect(isRequired(requiredForHardware, { categoryId: 'software' })).toBe(false);
    expect(validateCustom([requiredForHardware], 'incident', {}, { categoryId: 'software' })).toEqual({});
  });

  it('is required when it does', () => {
    expect(isRequired(requiredForHardware, { categoryId: 'hardware' })).toBe(true);
    expect(() => validateCustom([requiredForHardware], 'incident', {}, { categoryId: 'hardware' })).toThrow(/is required/);
  });

  it('is satisfied by a value the ticket already holds', () => {
    // The case that makes an update usable: changing the priority must not be
    // refused because this request did not mention a required field that was
    // filled in last week.
    expect(
      validateCustom([requiredForHardware], 'incident', {}, { categoryId: 'hardware' }, { costCentre: 'FIN-1' }),
    ).toEqual({});
  });

  it('is not satisfied by an explicit clear', () => {
    expect(() =>
      validateCustom([requiredForHardware], 'incident', { costCentre: null }, { categoryId: 'hardware' }, { costCentre: 'FIN-1' }),
    ).toThrow(/is required/);
  });

  it('treats a condition it cannot evaluate as not required, rather than blocking the desk', () => {
    // A malformed row must not make every ticket unsaveable. `saveField`
    // parses the expression, so this is a row that predates it.
    const broken = field({ requiredWhen: { nonsense: true } as never });
    expect(isRequired(broken, {})).toBe(false);
  });
});

describe('who sees a value', () => {
  const publicField = field({ key: 'siteCode', classification: 'public' });
  const internalField = field({ key: 'costCentre', classification: 'internal' });
  const restricted = field({ key: 'salaryBand', classification: 'restricted', visibleTo: ['ticket.comment.internal'] });
  const all = [publicField, internalField, restricted];
  const values = { siteCode: 'LON', costCentre: 'FIN-1', salaryBand: 'C' };

  it('shows a requester only what is public', () => {
    expect(visibleCustom(all, values, requester)).toEqual({ siteCode: 'LON' });
  });

  it('shows the desk everything it is entitled to', () => {
    expect(visibleCustom(all, values, anyone)).toEqual(values);
  });

  it('withholds a restricted field from somebody without the permission it names', () => {
    const lead = { worksTheDesk: true, holds: (permission: string) => permission === 'ticket.assign' };
    expect(visibleCustom(all, values, lead)).toEqual({ siteCode: 'LON', costCentre: 'FIN-1' });
  });

  it('strips rather than blanks, because a null still says the field exists', () => {
    const result = visibleCustom(all, values, requester);
    expect('salaryBand' in result).toBe(false);
  });

  it('shows a value with no definition to the desk and not to a requester', () => {
    // Migrated in, or left behind by a definition somebody removed directly.
    // The desk should not lose data; a requester should not be shown something
    // nobody has classified.
    expect(visibleCustom([], { legacy: 'x' }, anyone)).toEqual({ legacy: 'x' });
    expect(visibleCustom([], { legacy: 'x' }, requester)).toEqual({});
  });
});
