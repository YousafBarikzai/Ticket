import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { componentStylesheet } from '../../styles/index.js';
import { styleRegistry } from '../../styles/registry.js';
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

/**
 * The checks above read the assembled sheet, so they can only see modules the
 * registry includes. A `*.styles.ts` written beside its component and never
 * registered would pass them — its rules, typos and all, would simply never
 * reach a browser. This closes that gap from the other side: the files on disk
 * and the registry must name the same modules.
 */
describe('the style registry', () => {
  const source = fileURLToPath(new URL('../../', import.meta.url));

  function styleModulesOnDisk(directory: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) found.push(...styleModulesOnDisk(path));
      else if (entry.name.endsWith('.styles.ts')) found.push(relative(source, path).split('\\').join('/'));
    }
    return found;
  }

  it('registers every style module on disk, and nothing that is not there', () => {
    const onDisk = styleModulesOnDisk(source).sort();
    const registered = styleRegistry.map((entry) => entry.module).sort();
    expect(registered).toEqual(onDisk);
  });

  it('registers each module once', () => {
    const modules = styleRegistry.map((entry) => entry.module);
    expect(new Set(modules).size).toBe(modules.length);
  });

  it('puts every registered module into the sheet', async () => {
    for (const entry of styleRegistry) {
      const file = new URL(entry.module, new URL('../../', import.meta.url)).href;
      const exported = Object.values((await import(/* @vite-ignore */ file)) as Record<string, unknown>).filter(
        (value): value is string => typeof value === 'string',
      );
      expect(exported, entry.module).toContain(entry.css);
      if (entry.css !== '') expect(componentStylesheet.includes(entry.css), entry.module).toBe(true);
    }
  });
});
