// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { unknownVariables } from '../../styles/css.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { DashboardGrid, GridItem, type GridSpan } from '../DashboardGrid.js';
import { dashboardGridStyles } from '../DashboardGrid.styles.js';

/*
 * `DashboardGrid` and `GridItem` (v3 §2.13, §2.8): twelve columns that fold
 * with the grid's own width — a container query, so a grid in a narrow pane
 * folds as a phone does — every span full width below 45 rem, gaps 12 → 16 → 20.
 */

afterEach(() => {
  cleanupDocument();
  delete document.documentElement.dataset.itsmTheme;
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const spans: readonly GridSpan[] = [3, 4, 5, 6, 7, 8, 9, 12];

function markup(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host.firstElementChild as HTMLElement;
}

/** The text of the `@container itsm-dash (min-width: …)` block. */
function containerBlock(width: string): string {
  const start = dashboardGridStyles.indexOf(`@container itsm-dash (min-width: ${width})`);
  expect(start, width).toBeGreaterThanOrEqual(0);
  const next = dashboardGridStyles.indexOf('@container', start + 1);
  return dashboardGridStyles.slice(start, next === -1 ? undefined : next);
}

describe('DashboardGrid', () => {
  it('is server-safe: no client directive, renders without a provider', () => {
    expect(readFileSync(join(SRC, 'display/DashboardGrid.tsx'), 'utf8').trimStart().startsWith("'use client'")).toBe(false);
    expect(renderToStaticMarkup(<DashboardGrid>x</DashboardGrid>)).toContain('x');
  });

  it('is a container around a grid, and passes attributes to the container', () => {
    const grid = markup(
      <DashboardGrid className="app-Overview__grid" aria-label="Pulse">
        <GridItem span={7}>Raised vs resolved</GridItem>
        <GridItem span={5}>Needs attention</GridItem>
      </DashboardGrid>,
    );
    expect(grid.classList.contains('itsm-DashboardGrid')).toBe(true);
    expect(grid.classList.contains('app-Overview__grid')).toBe(true);
    expect(grid.getAttribute('aria-label')).toBe('Pulse');
    const inner = grid.firstElementChild as HTMLElement;
    expect(inner.className).toBe('itsm-DashboardGrid__grid');
    expect([...inner.children].map((item) => (item as HTMLElement).dataset.span)).toEqual(['7', '5']);
  });

  it('spans the full row by default, renders as a section when asked, and passes attributes through', () => {
    expect(markup(<GridItem>x</GridItem>).dataset.span).toBe('12');
    const section = markup(
      <GridItem as="section" span={4} aria-labelledby="sla" id="sla-card">
        x
      </GridItem>,
    );
    expect(section.tagName).toBe('SECTION');
    expect(section.getAttribute('aria-labelledby')).toBe('sla');
    expect(section.id).toBe('sla-card');
    expect(section.dataset.span).toBe('4');
  });
});

describe('the grid’s rules', () => {
  it('is twelve equal tracks that never let a wide card push its neighbours', () => {
    expect(dashboardGridStyles).toContain('grid-template-columns: repeat(12, minmax(0, 1fr))');
    expect(dashboardGridStyles).toContain('container: itsm-dash / inline-size');
  });

  it('puts every item on its own row below 45 rem, whatever its span', () => {
    expect(dashboardGridStyles).toMatch(/\.itsm-GridItem \{\s*grid-column: 1 \/ -1;/);
    const before = dashboardGridStyles.slice(0, dashboardGridStyles.indexOf('@container'));
    expect(before).not.toMatch(/grid-column: span/);
  });

  it('honours each span from 45 rem', () => {
    const block = containerBlock('45rem');
    for (const span of spans) expect(block).toContain(`.itsm-GridItem[data-span="${span}"] { grid-column: span ${span}; }`);
  });

  it('steps the gap 12 → 16 → 20 at 45 and 60 rem', () => {
    expect(dashboardGridStyles).toMatch(/\.itsm-DashboardGrid__grid \{[^}]*gap: var\(--itsm-space-sm\)/);
    expect(containerBlock('45rem')).toContain('gap: var(--itsm-space-md)');
    expect(containerBlock('60rem')).toContain('gap: var(--itsm-space-ml)');
  });

  it('reads only variables the tokens emit', () => {
    expect(unknownVariables(dashboardGridStyles)).toEqual([]);
  });
});

describe('DashboardGrid audit', () => {
  it.each(['apple', 'apple-dark'])('has no violations in the %s theme', async (theme) => {
    document.documentElement.dataset.itsmTheme = theme;
    render(
      <DashboardGrid>
        <GridItem as="section" span={7} aria-labelledby="a">
          <h2 id="a">Raised vs resolved</h2>
        </GridItem>
        <GridItem as="section" span={5} aria-labelledby="b">
          <h2 id="b">Needs attention</h2>
        </GridItem>
        <GridItem span={4}>
          <p>SLA attainment</p>
        </GridItem>
      </DashboardGrid>,
    );
    await expectNoViolations(document.body);
  });
});
