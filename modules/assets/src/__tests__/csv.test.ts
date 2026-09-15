import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords } from '../domain/csv.js';

/**
 * The only hard part of CSV is the part a split-on-comma reader gets wrong, and
 * it gets it wrong silently: a quoted field containing a comma becomes two
 * fields, every column after it shifts by one, and the import succeeds.
 */

describe('parseCsv', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a comma inside quotes in one field', () => {
    expect(parseCsv('name,location\n"Smith, John",London')).toEqual([
      ['name', 'location'],
      ['Smith, John', 'London'],
    ]);
  });

  it('keeps a newline inside quotes in one field', () => {
    // The case that loses rows rather than shifting columns, which is worse:
    // the count comes out wrong and nothing says which record went missing.
    const rows = parseCsv('id,note\n1,"line one\nline two"\n2,plain');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(['1', 'line one\nline two']);
    expect(rows[2]).toEqual(['2', 'plain']);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('a\n"say ""hello"""')).toEqual([['a'], ['say "hello"']]);
  });

  it('handles CRLF and a lone CR', () => {
    expect(parseCsv('a,b\r\n1,2\r3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('does not invent a final empty row from a trailing newline', () => {
    expect(parseCsv('a\n1\n')).toEqual([['a'], ['1']]);
  });

  it('strips a byte-order mark, which Excel puts on everything', () => {
    expect(parseCsv('﻿serial,tag\nSN1,LAP-1')[0]).toEqual(['serial', 'tag']);
  });

  it('keeps an empty field as empty rather than dropping it', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('refuses a delimiter that is not one character', () => {
    expect(() => parseCsv('a;b', { delimiter: ';;' })).toThrow();
  });
});

describe('parseCsvRecords', () => {
  it('keys rows by the header', () => {
    expect(parseCsvRecords('serial,tag\nSN1,LAP-1')).toEqual([{ serial: 'SN1', tag: 'LAP-1' }]);
  });

  it('does not infer types: a leading zero survives', () => {
    // The serial `0012345` read as a number is `12345`, and the register then
    // disagrees with the sticker on the machine.
    expect(parseCsvRecords('serial\n0012345')[0]!.serial).toBe('0012345');
  });

  it('fills a short row with empty strings rather than undefined', () => {
    expect(parseCsvRecords('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('skips the lines a feed puts before the header', () => {
    const text = 'Exported 2026-09-15\n\nserial,tag\nSN1,LAP-1';
    expect(parseCsvRecords(text, { skipLines: 1 })).toEqual([{ serial: 'SN1', tag: 'LAP-1' }]);
  });

  it('refuses a duplicate column instead of quietly keeping one', () => {
    // Two columns called Serial mean the file is not what somebody thinks it
    // is, and keeping the second is how half a register holds the wrong column.
    expect(() => parseCsvRecords('Serial,Serial\n1,2')).toThrow(/appears twice/);
  });

  it('returns nothing for an empty file rather than failing', () => {
    expect(parseCsvRecords('')).toEqual([]);
  });
});
