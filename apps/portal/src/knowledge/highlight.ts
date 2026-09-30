import { createElement, Fragment, type ReactNode } from 'react';

/**
 * Search snippets, highlighted without ever becoming HTML (SPEC §6.3, C §3.8).
 *
 * The search fallback (PostgreSQL's `ts_headline`) marks the words it matched
 * with literal `<b>` and `</b>` in otherwise plain text; Meilisearch sends
 * plain text. The old results page printed those markers as they came —
 * "the <b>VPN</b> client" — and the tempting fix, `dangerouslySetInnerHTML`,
 * would hand every article author (and anybody who can get text into an
 * article) a way to run script in every reader's session.
 *
 * So the two markers are the only markup this understands, and they become
 * `<mark>` elements; everything else stays text, which React escapes. A
 * `<script>` in a snippet reads as the characters `<script>`. An unclosed
 * `<b>` marks to the end; a stray `</b>` is dropped; empty marks vanish.
 */

export interface SnippetPart {
  readonly text: string;
  /** A word the search matched. */
  readonly match: boolean;
}

const MARKER = /<(\/?)b>/gi;

/** The snippet as runs of plain and matched text, markers removed. */
export function highlightParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let open = false;
  let last = 0;
  const push = (text: string, match: boolean): void => {
    if (text === '') return;
    const previous = parts.at(-1);
    if (previous && previous.match === match) parts[parts.length - 1] = { text: previous.text + text, match };
    else parts.push({ text, match });
  };
  for (const found of snippet.matchAll(MARKER)) {
    push(snippet.slice(last, found.index), open);
    last = found.index + found[0].length;
    // `<b>` opens and `</b>` closes; a repeat of the state it is already in is noise.
    open = found[1] !== '/';
  }
  push(snippet.slice(last), open);
  return parts;
}

/** The snippet as plain text: what a screen reader, a `title` or a palette row reads. */
export function snippetText(snippet: string): string {
  return highlightParts(snippet)
    .map((part) => part.text)
    .join('');
}

/**
 * The snippet as React nodes: text, with each matched run in a `<mark>`.
 * Server-safe (no hooks), so a results page renders it on the server.
 */
export function highlight(snippet: string): ReactNode {
  return createElement(
    Fragment,
    null,
    ...highlightParts(snippet).map((part, index) => (part.match ? createElement('mark', { key: index, className: 'app-Highlight' }, part.text) : part.text)),
  );
}
