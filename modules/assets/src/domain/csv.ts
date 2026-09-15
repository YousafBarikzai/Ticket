import { ValidationError } from '@itsm/platform';

/**
 * A CSV reader.
 *
 * Written rather than depended on, because the only hard part of CSV is the
 * part most libraries get right and most hand-rolled readers get wrong — a
 * quoted field containing a comma, a newline, or a doubled quote — and that
 * part is thirty lines. A dependency would be thirty lines of somebody else's
 * code plus a supply-chain surface, for a parser that has to be correct on
 * exactly one grammar that has not changed since 2005.
 *
 * What it will not do is guess. No type inference, no trimming of quoted
 * values, no skipping of rows that look wrong: everything comes out as text and
 * the mapping decides what it means, so a serial number of `0012345` is still
 * `0012345` and a column of postcodes does not become a column of numbers.
 */

const BOM = '﻿';

export interface CsvOptions {
  delimiter?: string;
  /** Rows to ignore before the header, for feeds that put a title line first. */
  skipLines?: number;
  maxRows?: number;
}

const MAX_ROWS = 50_000;

/** Splits into rows of fields. Nothing is interpreted; every cell is text. */
export function parseCsv(input: string, options: CsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ',';
  if (delimiter.length !== 1) throw new ValidationError('the delimiter is a single character');
  const maxRows = Math.min(options.maxRows ?? MAX_ROWS, MAX_ROWS);

  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  const endField = () => {
    row.push(field);
    field = '';
    started = false;
  };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty field, not an empty row. Every
    // file ends with one and nobody means a final blank record by it.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          // A doubled quote inside a quoted field is one quote.
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        // Newlines inside quotes belong to the field; this is the case that
        // makes a split-on-newline reader silently lose rows.
        field += char;
      }
      continue;
    }

    if (char === '"' && !started) {
      quoted = true;
      started = true;
      continue;
    }
    if (char === delimiter) {
      endField();
      continue;
    }
    if (char === '\r') {
      // CRLF, and a lone CR from a very old exporter.
      if (text[i + 1] === '\n') i += 1;
      endRow();
      if (rows.length >= maxRows) return rows;
      continue;
    }
    if (char === '\n') {
      endRow();
      if (rows.length >= maxRows) return rows;
      continue;
    }

    field += char;
    started = true;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * The same, as records keyed by the header row.
 *
 * A duplicate header is refused rather than resolved. Two columns called
 * `Serial` mean the file is not what somebody thinks it is, and quietly keeping
 * the second is how half a register ends up holding the wrong column.
 */
export function parseCsvRecords(input: string, options: CsvOptions = {}): Record<string, string>[] {
  const rows = parseCsv(input, options);
  const body = rows.slice(options.skipLines ?? 0);
  const header = body.shift();
  if (!header) return [];

  const seen = new Set<string>();
  const columns = header.map((name) => name.trim());
  for (const name of columns) {
    if (name === '') continue;
    if (seen.has(name)) throw new ValidationError(`the column ${name} appears twice; the file is not what it looks like`);
    seen.add(name);
  }

  return body.map((cells) => {
    const record: Record<string, string> = {};
    columns.forEach((name, index) => {
      if (name === '') return;
      record[name] = cells[index] ?? '';
    });
    return record;
  });
}
