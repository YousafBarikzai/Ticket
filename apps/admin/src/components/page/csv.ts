/**
 * Tables on screen as CSV, for "Download CSV" (`ExportMenu`) and "Download
 * data (CSV)" (`CardCsv`).
 *
 * Both read what is rendered — a register's table, a chart's table twin —
 * rather than asking the API again, so a download is exactly what the person
 * is looking at, in the words they see, and costs no request. UTF-8 with a
 * byte-order mark and CRLF line ends, which is what a spreadsheet opened by
 * double-click expects (the audit log's export does the same).
 */

/** One CSV cell: quoted, quotes doubled, and a leading formula character defused so a spreadsheet shows it as text. */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Rows of cells as one CSV document. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/**
 * A cell's text as a person reads it: whitespace collapsed, and without what
 * is drawn for the eye only (`aria-hidden`) — a count's digits beside its
 * spoken form, an icon's glyph — so a cell is not written twice.
 */
function cellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"], button, [data-csv="skip"]')) hidden.remove();
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The rows of an HTML table, header rows first, as plain text. A row marked
 * `data-csv="skip"` (a "Load more" row, a group heading) is left out, and so
 * is a table with no rows at all (`[]`).
 */
export function tableRows(table: HTMLTableElement): string[][] {
  const rows: string[][] = [];
  for (const row of table.rows) {
    if (row.getAttribute('data-csv') === 'skip') continue;
    const cells = [...row.cells].map(cellText);
    if (cells.some((cell) => cell !== '')) rows.push(cells);
  }
  return rows;
}

/** A file name that is safe on every system: `rules-2026-10-02.csv`. */
export function csvFileName(name: string): string {
  const base = name
    .replace(/\.csv$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'export'}.csv`;
}

/** Hands a CSV document to the browser as a download. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = csvFileName(filename);
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Downloads the first table inside the element `selector` names (or the
 * element itself, when it is the table), and answers how many data rows went
 * out — `null` when there was no table to read, so the caller can say so
 * instead of handing over an empty file.
 */
export function exportTable(selector: string, filename: string, root: ParentNode = document): number | null {
  const host = root.querySelector(selector);
  const table = host instanceof HTMLTableElement ? host : host?.querySelector('table');
  if (!table) return null;
  const rows = tableRows(table);
  if (rows.length === 0) return null;
  downloadCsv(filename, toCsv(rows));
  return dataRowCount(table);
}

/** Rows that carry data: not in the head, not made only of header cells, not skipped. */
function dataRowCount(table: HTMLTableElement): number {
  let count = 0;
  for (const row of table.rows) {
    if (row.getAttribute('data-csv') === 'skip') continue;
    if (row.parentElement?.tagName === 'THEAD') continue;
    if (row.cells.length > 0 && [...row.cells].every((cell) => cell.tagName === 'TH')) continue;
    count += 1;
  }
  return count;
}
