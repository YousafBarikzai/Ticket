import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MAX_SAFE_HREF_LENGTH,
  SAFE_LINK_PROTOCOLS,
  UNSAFE_LINK_MESSAGE,
  findUnsafeLinks,
  isSafeHref,
} from '../links.js';
import { refineSafeLinks, safeHrefSchema } from '../links-schemas.js';

describe('isSafeHref', () => {
  it('allows https: and mailto: only', () => {
    expect(SAFE_LINK_PROTOCOLS).toEqual(['https:', 'mailto:']);
  });

  // A3 §11.1: the list every rich-text and link field must refuse.
  const refused: [string, string][] = [
    ['javascript:', 'javascript:alert(1)'],
    ['JAVASCRIPT:', 'JAVASCRIPT:alert(1)'],
    ['java\\tscript:', 'java\tscript:alert(1)'],
    ['\\u0000javascript:', '\u0000javascript:alert(1)'],
    ['a leading space', ' https://x.example'],
    ['data:', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['http:', 'http://intranet.example/'],
    ['protocol-relative', '//evil.example'],
    ['relative', '/relative'],
    ['2,049 characters', `https://x.example/${'a'.repeat(MAX_SAFE_HREF_LENGTH - 'https://x.example/'.length + 1)}`],
  ];

  for (const [name, href] of refused) {
    it(`refuses ${name}`, () => {
      expect(isSafeHref(href)).toBe(false);
    });
  }

  it('refuses the tricks browsers forgive', () => {
    for (const href of [
      'https://x.example/\n',
      'https://x.example/a b',
      'https://x.example/\u200b',
      'https:\\\\evil.example',
      'https:evil.example',
      'https:/evil.example',
      'https://bank.example@evil.example/',
      'https://user:pass@x.example/',
      'mailto:',
      'ftp://files.example/',
      'file:///etc/passwd',
      'blob:https://x.example/0',
      '',
      'about:blank',
      'x',
    ]) {
      expect(isSafeHref(href), JSON.stringify(href)).toBe(false);
    }
    for (const value of [null, undefined, 42, {}, ['https://x.example']]) {
      expect(isSafeHref(value)).toBe(false);
    }
  });

  it('accepts https: and mailto: links', () => {
    for (const href of [
      'https://x.example',
      'https://northwind.example/policies/travel?lang=en#claims',
      'HTTPS://X.EXAMPLE/',
      'https://例え.テスト/',
      'mailto:a@b.example',
      'mailto:service.desk@northwind.example?subject=VPN',
    ]) {
      expect(isSafeHref(href), href).toBe(true);
    }
  });

  it('accepts exactly 2,048 characters', () => {
    const href = `https://x.example/${'a'.repeat(MAX_SAFE_HREF_LENGTH - 'https://x.example/'.length)}`;
    expect(href).toHaveLength(2048);
    expect(isSafeHref(href)).toBe(true);
  });
});

describe('findUnsafeLinks', () => {
  const body = [
    { type: 'paragraph', content: [{ text: 'See ' }, { text: 'the policy', href: 'https://northwind.example/p' }] },
    {
      type: 'list',
      items: [[{ text: 'one', href: 'javascript:alert(1)' }], [{ text: 'two', href: 'mailto:a@b.example' }]],
    },
    { type: 'paragraph', content: [{ text: 'old', href: 'http://intranet.example' }, { text: 'odd', href: 42 }] },
  ];

  it('finds nested hrefs and reports their paths in document order', () => {
    expect(findUnsafeLinks(body)).toEqual([
      { path: '1.items.0.0.href', segments: [1, 'items', 0, 0, 'href'], href: 'javascript:alert(1)' },
      { path: '2.content.0.href', segments: [2, 'content', 0, 'href'], href: 'http://intranet.example' },
      { path: '2.content.1.href', segments: [2, 'content', 1, 'href'], href: '42' },
    ]);
  });

  it('reports a parent link before the links inside it, whatever the key order', () => {
    const value = { children: [{ href: 'data:x' }], href: 'vbscript:x' };
    expect(findUnsafeLinks(value).map((link) => link.path)).toEqual(['children.0.href', 'href']);
  });

  it('finds nothing in a clean or link-free value', () => {
    expect(findUnsafeLinks(body.slice(0, 1))).toEqual([]);
    expect(findUnsafeLinks(null)).toEqual([]);
    expect(findUnsafeLinks('javascript:alert(1)')).toEqual([]);
    expect(findUnsafeLinks({ url: 'javascript:alert(1)' })).toEqual([]);
  });

  it('walks a very deep document without overflowing the stack', () => {
    let deep: unknown = { href: 'javascript:alert(1)' };
    for (let index = 0; index < 50_000; index += 1) deep = { child: deep };
    const found = findUnsafeLinks(deep);
    expect(found).toHaveLength(1);
    expect(found[0]?.segments).toHaveLength(50_001);
  });
});

describe('the link schemas', () => {
  it('refuses an unsafe link field with the author-facing message', () => {
    const result = safeHrefSchema.safeParse('javascript:alert(1)');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(UNSAFE_LINK_MESSAGE);
    expect(UNSAFE_LINK_MESSAGE).toBe('Links must start with https:// or mailto:');
    expect(safeHrefSchema.parse('https://x.example')).toBe('https://x.example');
  });

  it('puts one issue at each refused link inside a document field', () => {
    const schema = z.object({ body: z.array(z.unknown()).superRefine(refineSafeLinks) });
    const result = schema.safeParse({
      body: [{ type: 'paragraph', content: [{ text: 'x', href: 'javascript:1' }, { text: 'y', href: 'https://ok.example' }] }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['body.0.content.0.href', UNSAFE_LINK_MESSAGE],
    ]);
  });
});
