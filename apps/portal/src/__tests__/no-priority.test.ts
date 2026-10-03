import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Priority is never shown to requesters (v2 principle, kept by v3 §7.2 and A6
 * §6.0): P1..P4 is an internal scheduling decision made from impact and
 * urgency, and showing it invites an argument with somebody who cannot change
 * it. The design system now has a priority chip and a priority map (D5), so
 * this guard reads every source file of the Help Portal and fails on any use
 * of either — an import, a re-export or a stray reference.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const self = fileURLToPath(import.meta.url);

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && path !== self) found.push(path);
  }
  return found;
}

describe('the Help Portal never shows a priority', () => {
  const files = sources(root);

  it('reads the whole source tree', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.endsWith(join('home', 'model.ts')))).toBe(true);
  });

  it('uses no PriorityChip, SignalBars or priority look anywhere under apps/portal/src', () => {
    const offending = files
      .map((file) => ({ file: relative(root, file), text: readFileSync(file, 'utf8') }))
      .filter(({ text }) => /\b(PriorityChip|SignalBars|PRIORITY_LOOK|priorityLook)\b/.test(text))
      .map(({ file }) => file);
    expect(offending).toEqual([]);
  });
});
