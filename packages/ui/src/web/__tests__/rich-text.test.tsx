// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { RichBlock, RichInline } from '@itsm/contracts';
import { RichText, asRichBlocks } from '../RichText.js';
import { expectNoViolations } from './support/audit.js';
import { cleanupDocument, render } from './support/render.js';

/*
 * `RichText` and links (D23, SPEC §4.7.5). The API refuses every link that is
 * not `https:` or `mailto:` in every tenant, but a document stored before that
 * rule — or written around the API — can still hold one. The renderer is the
 * last line: an unsafe stored `href` keeps its words and loses its target, in
 * the browser and in the server's HTML alike.
 */

afterEach(() => cleanupDocument());

const LONGEST = 2048;
const tooLong = (): string => {
  const prefix = 'https://example.com/';
  return prefix + 'a'.repeat(LONGEST + 1 - prefix.length);
};

/** A3 §11.1's refusals, plus the forms a person reading the link would misjudge. */
const UNSAFE: readonly (readonly [string, string])[] = [
  ['javascript:', 'javascript:alert(1)'],
  ['JAVASCRIPT: in capitals', 'JAVASCRIPT:alert(1)'],
  ['a tab inside the scheme', 'java\tscript:alert(1)'],
  ['a leading NUL', '\u0000javascript:alert(1)'],
  ['a leading space', ' https://example.com/help'],
  ['data:', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
  ['vbscript:', 'vbscript:msgbox(1)'],
  ['http:', 'http://intranet.example/help'],
  ['protocol-relative', '//evil.example/help'],
  ['relative', '/knowledge/vpn'],
  ['https: without //', 'https:evil.example'],
  ['a user name before the host', 'https://bank.example@evil.example/'],
  ['more than 2,048 characters', tooLong()],
];

function paragraph(link: RichInline): RichBlock[] {
  return [{ type: 'paragraph', content: [{ text: 'Read ' }, link, { text: '.' }] }];
}

describe('RichText links', () => {
  it('links https: and mailto:, each with rel="noopener noreferrer"', () => {
    const { container } = render(
      <RichText
        content={[
          {
            type: 'paragraph',
            content: [
              { text: 'Read ' },
              { text: 'the guide', href: 'https://help.example.com/vpn' },
              { text: ' or write to ' },
              { text: 'the service desk', href: 'mailto:servicedesk@example.com' },
            ],
          },
        ]}
      />,
    );
    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('rel')])).toEqual([
      ['the guide', 'https://help.example.com/vpn', 'noopener noreferrer'],
      ['the service desk', 'mailto:servicedesk@example.com', 'noopener noreferrer'],
    ]);
  });

  it.each(UNSAFE)('renders a stored link with %s as its words, not a link', (_label, href) => {
    const { container } = render(<RichText content={paragraph({ text: 'the guide', href })} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[href]')).toBeNull();
    expect(container.querySelector('p')!.textContent).toBe('Read the guide.');
  });

  it.each(UNSAFE)('leaves a stored link with %s out of the server HTML', (_label, href) => {
    const html = renderToStaticMarkup(<RichText content={paragraph({ text: 'the guide', href })} />);
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
    expect(html).toContain('the guide');
  });

  it('treats a stored href that is not a string as unsafe', () => {
    // `asRichBlocks` checks block shapes, not every run, so a malformed run
    // reaches the renderer; its words survive and nothing is linked.
    const stored: unknown = [{ type: 'paragraph', content: [{ text: 'odd', href: 42 }, { text: ' empty', href: '' }] }];
    const { container } = render(<RichText content={asRichBlocks(stored)} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('odd empty');
  });

  it('refuses only the unsafe link, keeping its neighbours and their order', () => {
    const { container } = render(
      <RichText
        content={[
          {
            type: 'list',
            ordered: true,
            items: [
              [{ text: 'Open ' }, { text: 'the portal', href: 'https://portal.example.com/' }],
              [{ text: 'Not ' }, { text: 'this one', href: 'javascript:alert(document.cookie)' }],
              [{ text: 'Then ' }, { text: 'restart', bold: true }],
            ],
          },
        ]}
      />,
    );
    const items = [...container.querySelectorAll('ol > li')];
    expect(items.map((item) => item.textContent)).toEqual(['Open the portal', 'Not this one', 'Then restart']);
    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['https://portal.example.com/']);
    expect(items[2]!.querySelector('strong')!.textContent).toBe('restart');
  });

  it('checks links with the zod-free predicate the API schema is built on', () => {
    // The browser half of the rule must not drag zod into a first load
    // (Y-B2), and must be the same predicate the server's schema calls.
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'RichText.tsx'), 'utf8');
    expect(source).toMatch(/import \{ isSafeHref \} from '@itsm\/contracts\/links';/);
    expect(source).not.toContain('@itsm/contracts/links/schemas');
  });

  it('has no axe violations with a safe link and a refused one side by side', async () => {
    const { container } = render(
      <RichText
        content={[
          {
            type: 'paragraph',
            content: [
              { text: 'Read ' },
              { text: 'the guide', href: 'https://help.example.com/vpn' },
              { text: ', not ' },
              { text: 'this copy', href: 'javascript:alert(1)' },
              { text: '.' },
            ],
          },
          { type: 'list', items: [[{ text: 'Ask ', italic: true }, { text: 'the desk', href: 'mailto:desk@example.com' }]] },
        ]}
      />,
    );
    await expectNoViolations(container);
  });
});
