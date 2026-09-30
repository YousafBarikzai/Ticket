import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { highlight, highlightParts, snippetText } from '../knowledge/highlight.js';

/**
 * Search snippets (SPEC §6.3): the fallback engine marks matched words with
 * literal `<b>` and `</b>`; those become `<mark>`, and nothing else in a
 * snippet is ever markup.
 */

describe('highlightParts', () => {
  it('splits a snippet into plain and matched runs, markers removed', () => {
    expect(highlightParts('Set up the <b>VPN</b> client on <b>Windows</b>')).toEqual([
      { text: 'Set up the ', match: false },
      { text: 'VPN', match: true },
      { text: ' client on ', match: false },
      { text: 'Windows', match: true },
    ]);
  });

  it('passes a snippet with no markers through as one plain run', () => {
    expect(highlightParts('Meilisearch sends plain text')).toEqual([{ text: 'Meilisearch sends plain text', match: false }]);
    expect(highlightParts('')).toEqual([]);
  });

  it('reads the markers in any case', () => {
    expect(highlightParts('<B>vpn</B> down')).toEqual([
      { text: 'vpn', match: true },
      { text: ' down', match: false },
    ]);
  });

  it('marks an unclosed match to the end, drops a stray closing marker, and leaves no empty runs', () => {
    expect(highlightParts('the <b>printer')).toEqual([
      { text: 'the ', match: false },
      { text: 'printer', match: true },
    ]);
    expect(highlightParts('a</b> b')).toEqual([{ text: 'a b', match: false }]);
    expect(highlightParts('<b></b>x<b><b>y</b>')).toEqual([
      { text: 'x', match: false },
      { text: 'y', match: true },
    ]);
  });

  it('keeps every other tag as the characters it is', () => {
    expect(highlightParts('<i>hi</i> <script>alert(1)</script>')).toEqual([{ text: '<i>hi</i> <script>alert(1)</script>', match: false }]);
  });
});

describe('snippetText', () => {
  it('is the snippet as a person reads it', () => {
    expect(snippetText('Reset your <b>password</b> from the sign-in page')).toBe('Reset your password from the sign-in page');
  });
});

describe('highlight', () => {
  it('renders matches as mark elements and everything else as text', () => {
    expect(renderToStaticMarkup(highlight('Set up the <b>VPN</b> client'))).toBe('Set up the <mark class="app-Highlight">VPN</mark> client');
  });

  it('never turns snippet text into markup', () => {
    const html = renderToStaticMarkup(highlight('<b>x</b><img src=x onerror=alert(1)><script>steal()</script>'));
    expect(html).toBe('<mark class="app-Highlight">x</mark>&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;steal()&lt;/script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });
});
