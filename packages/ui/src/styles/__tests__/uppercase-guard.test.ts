import { describe, expect, it } from 'vitest';
import { uiStylesheet } from '../index.js';

/**
 * Uppercase is allowed in five places and nowhere else (D6, SPEC-v3 §2.7).
 *
 * The kicker over a hero, a banner and the landing page's sections is drawn
 * in capitals; section headings, sidebar group labels, menu heads and table
 * headers are sentence case. The capitals come only from `text-transform`, so
 * the text underneath is written in sentence case and a screen reader reads
 * words, not letters. This scans the whole design-system stylesheet, so an
 * overline added to any component fails here, not in a screenshot.
 */

/** The rules allowed to uppercase. The site's landing rules are guarded by the site's own test. */
const allowed = new Set([
  '.itsm-text-kicker',
  '.itsm-HeroCard__kicker',
  '.itsm-HeroCard__asideKicker',
  '.itsm-Banner__kicker',
  '.itsm-GlobalBanner__kicker',
]);

/**
 * The selector list of every rule that sets `text-transform: uppercase`.
 *
 * The sheet is plain CSS without nesting, so the rule a declaration belongs to
 * opens at the nearest `{` before it, and its selector runs back from there to
 * the end of the previous rule or the opening of an enclosing at-rule.
 */
function uppercaseSelectors(sheet: string): string[][] {
  const text = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[][] = [];
  for (const match of text.matchAll(/text-transform\s*:\s*uppercase/gi)) {
    const open = text.lastIndexOf('{', match.index);
    const start = Math.max(text.lastIndexOf('}', open), text.lastIndexOf('{', open - 1), text.lastIndexOf(';', open)) + 1;
    selectors.push(
      text
        .slice(start, open)
        .split(',')
        .map((selector) => selector.trim())
        .filter(Boolean),
    );
  }
  return selectors;
}

describe('the uppercase guard', () => {
  it('finds the selector of each uppercase rule, inside layers and media queries', () => {
    const sheet = `@layer itsm.components {
.a { color: red; }
/* a comment { } */
.b, .c:hover {
  text-transform: uppercase;
}
@media (min-width: 48rem) {
  .d { text-transform:uppercase }
}
}`;
    expect(uppercaseSelectors(sheet)).toEqual([['.b', '.c:hover'], ['.d']]);
  });

  it('allows uppercase only on the kicker rules', () => {
    const offenders = uppercaseSelectors(uiStylesheet())
      .flat()
      .filter((selector) => !allowed.has(selector));
    expect(offenders).toEqual([]);
  });

  it('draws the kicker utility in capitals', () => {
    expect(uppercaseSelectors(uiStylesheet()).flat()).toContain('.itsm-text-kicker');
  });
});
