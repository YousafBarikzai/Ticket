/**
 * CSV, written carefully.
 *
 * Two things a naive `join(',')` gets wrong, both of which have bitten real
 * service desks. A value containing a comma, a quote or a newline has to be
 * quoted, or a ticket titled "Laptop, broken" becomes two columns. And a value
 * beginning with `=`, `+`, `-`, `@` or a tab is a formula when the file is
 * opened in a spreadsheet — which means a requester who types `=HYPERLINK(…)`
 * as a ticket title gets it executed on an analyst's machine. Those are
 * prefixed with a quote, which spreadsheets show as text.
 */

export interface Column {
  key: string;
  header: string;
}

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  // A number is the platform's, not a person's: -30 minutes early is a
  // number, and prefixing it would turn every margin into text.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTING.test(text) || text.startsWith("'") ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: Column[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column.key])).join(','));
  }
  // CRLF: the one line ending every spreadsheet on every platform agrees on.
  return `${lines.join('\r\n')}\r\n`;
}
