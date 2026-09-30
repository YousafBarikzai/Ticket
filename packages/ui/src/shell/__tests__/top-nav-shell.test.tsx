// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRecentsForTesting } from '../../provider/recents.js';
import { AppShell } from '../../web/AppShell.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { resetShortcutsDialog } from '../shortcuts.js';
import { TopNavShell } from '../TopNavShell.js';
import { createLocation, setViewport, topnavProps } from './support.js';

/**
 * `TopNavShell` is `AppShell variant="topnav"` without the other variants in
 * its module graph (the portal's first load is budgeted, SPEC §3.7): the same
 * frame, drawn the same way, carrying no sidebar.
 */

vi.mock('../../web/IconButtonTooltip.js', () => ({ IconButtonTooltip: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  resetRecentsForTesting();
});

afterEach(() => {
  cleanupDocument();
  resetShortcutsDialog();
  vi.unstubAllGlobals();
});

/** The frame's markup with React's generated ids made comparable. */
function markup(node: ReactNode, path: string): string {
  const location = createLocation(path);
  const { container } = render(<location.Provider app="portal">{node}</location.Provider>);
  const html = container.innerHTML.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, 'ID');
  cleanupDocument();
  return html;
}

describe('TopNavShell', () => {
  it('draws exactly what AppShell variant="topnav" draws, at every width', () => {
    const { variant, ...props } = topnavProps();
    void variant;
    for (const width of [320, 390, 768, 1280]) {
      setViewport(width);
      const children = <h1 tabIndex={-1}>Your requests</h1>;
      const expected = markup(<AppShell {...topnavProps()}>{children}</AppShell>, '/tickets/42');
      const actual = markup(<TopNavShell {...props}>{children}</TopNavShell>, '/tickets/42');
      expect(actual, `${width} px`).toBe(expected);
      expect(actual).toContain('itsm-TabBar');
      expect(actual).not.toContain('itsm-Sidebar');
    }
  });

  it('reaches neither the sidebar nor the pre-redesign frame through its static imports', () => {
    // `import.meta.url` is not a file URL under jsdom; the directory is.
    const root = `${resolve(import.meta.dirname, '../..')}/`;
    const resolveModule = (from: string, specifier: string): string | null => {
      const base = resolve(dirname(from), specifier.replace(/\.js$/, ''));
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate;
      return null;
    };
    const seen = new Set<string>();
    const queue = [join(root, 'shell/TopNavShell.tsx')];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
        if (!match[1]!.startsWith('.')) continue;
        const next = resolveModule(file, match[1]!);
        if (next) queue.push(next);
      }
    }
    const reached = [...seen].map((file) => file.slice(root.length));
    expect(reached).toContain('shell/TopNavFrame.tsx');
    expect(reached).not.toContain('shell/Sidebar.tsx');
    expect(reached).not.toContain('web/AppShell.tsx');
  });
});
