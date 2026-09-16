import { describe, expect, it } from 'vitest';
import { componentStylesheet } from '../stylesheet.js';
import { renderTokenStylesheet, structuralVariables, themeVariables } from '../../tokens/css.js';
import { themeNames } from '../../tokens/tokens.js';

/**
 * Every `var(--itsm-…)` the components reference is a variable the tokens emit.
 *
 * This is the one mistake in a stylesheet that produces no error anywhere. A
 * misspelled custom property resolves to nothing, the declaration is dropped,
 * and the element renders with whatever it inherited — so a hover state that
 * was supposed to lift simply does not, and looks exactly like a hover state
 * nobody wrote. No build step, no test and no browser warning catches it; a
 * person notices, eventually, or does not.
 *
 * Cheap to check, because both halves are strings this package produces.
 */

const emitted = new Set<string>([
  ...Object.keys(structuralVariables()),
  ...themeNames.flatMap((theme) => Object.keys(themeVariables(theme))),
]);

/** Every `--itsm-*` referenced through `var()`, with any fallback stripped. */
function referenced(css: string): string[] {
  const found = new Set<string>();
  for (const match of css.matchAll(/var\(\s*(--itsm-[a-zA-Z0-9-]+)/g)) found.add(match[1]!);
  return [...found].sort();
}

describe('the component stylesheet', () => {
  it('references only variables the token layer emits', () => {
    const missing = referenced(componentStylesheet).filter((name) => !emitted.has(name));
    // Named rather than counted: the failure should say which property is
    // wrong, because that is the whole of the fix.
    expect(missing).toEqual([]);
  });

  it('references a meaningful number of them, so the check cannot pass by finding none', () => {
    expect(referenced(componentStylesheet).length).toBeGreaterThan(40);
  });

  it('emits every variable the components reference into the rendered sheet', () => {
    const css = renderTokenStylesheet();
    for (const name of referenced(componentStylesheet)) {
      expect(css.includes(`${name}:`), name).toBe(true);
    }
  });
});
