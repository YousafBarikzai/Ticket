import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { structuralVariables, themeVariables } from '@itsm/ui';

/**
 * Every custom property this app spends is one the design system emits.
 *
 * A `var(--itsm-thing-that-does-not-exist)` is silent: the declaration is
 * dropped and the element renders with the browser default, which usually
 * looks *almost* right. `@itsm/ui` already checks its own stylesheet this way;
 * an application's stylesheet had no such check, which is how this one came to
 * be a copy of another app's — every rule valid, not one of them matching a
 * class this app renders.
 *
 * It does not check that a class is used, only that a token exists. Catching
 * the other direction needs a renderer, and that belongs in a browser test.
 */
describe('the app stylesheet and the token pipeline agree', () => {
  const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');

  it('references no variable the pipeline does not emit', () => {
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    const used = [...new Set([...css.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];

    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((variable) => !defined.has(variable))).toEqual([]);
  });
});
