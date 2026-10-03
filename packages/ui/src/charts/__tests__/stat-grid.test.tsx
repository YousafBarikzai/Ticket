// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { StatCard } from '../StatCard.js';
import { StatGrid } from '../StatGrid.js';
import { statGridStyles } from '../StatGrid.styles.js';

afterEach(() => cleanupDocument());

/*
 * `StatGrid` (v3 §2.13): the KPI row. These carry the two StatGrid blocks
 * that left `charts.test.tsx` (rule 10) — the markup a server renders, and
 * "two by two on a phone, never a carousel" — and add the v3 counts, three
 * and six, and the dashboard's gaps.
 */

const here = dirname(fileURLToPath(import.meta.url));
const html = (element: ReactElement): string => renderToStaticMarkup(element);

/** The declarations of the rules whose selector list includes exactly `selector`, inside `within` (an at-rule's opening) when given. */
function rule(selector: string, within?: string): string {
  let sheet = statGridStyles.replace(/\/\*[\s\S]*?\*\//g, '');
  if (within) {
    const start = sheet.indexOf(within);
    expect(start, within).toBeGreaterThan(-1);
    sheet = sheet.slice(start, sheet.indexOf('\n}\n', start));
  }
  const found: string[] = [];
  for (const match of sheet.matchAll(/(?:^|\n)\s*([^{}@]+?)\s*\{([^}]*)\}/g)) {
    if (match[1]!.split(',').map((part) => part.trim()).includes(selector)) found.push(match[2]!);
  }
  return found.join('\n');
}

const items = (columns: string): string => `.itsm-StatGrid[data-columns="${columns}"] .itsm-StatGrid__items`;
const tracks = (count: number): string => `grid-template-columns: repeat(${count}, minmax(0, 1fr));`;

describe('stat grid', () => {
  it('passes its minimum as a local property and its column rule as an attribute', () => {
    expect(html(<StatGrid min={200}>x</StatGrid>)).toBe('<div class="itsm-StatGrid" style="--_itsm-stat-min:12.5rem"><div class="itsm-StatGrid__items">x</div></div>');
    expect(html(<StatGrid columns={4}>x</StatGrid>)).toContain('data-columns="4"');
    expect(html(<StatGrid columns={6}>x</StatGrid>)).toContain('data-columns="6"');
    expect(html(<StatGrid columns={3}>x</StatGrid>)).toContain('data-columns="3"');
  });

  it('ignores a minimum that is not a positive number', () => {
    expect(html(<StatGrid min={0}>x</StatGrid>)).not.toContain('style=');
    expect(html(<StatGrid min={Number.NaN}>x</StatGrid>)).not.toContain('style=');
  });

  it('holds its cards in one grid', () => {
    const { container } = render(
      <StatGrid columns={4}>
        <StatCard label="A" value={1} />
        <StatCard label="B" value={2} />
      </StatGrid>,
    );
    expect(container.querySelectorAll('.itsm-StatGrid__items > .itsm-StatCard')).toHaveLength(2);
  });

  it('is server-safe: no client directive', () => {
    expect(readFileSync(join(here, '..', 'StatGrid.tsx'), 'utf8').trimStart().startsWith("'use client'")).toBe(false);
  });
});

describe('StatGrid on a phone', () => {
  it('is two by two, never one column and never a sideways carousel (X-94)', () => {
    // The track minimum is the lesser of `min` and half the row, so a grid
    // as narrow as a phone still makes two columns.
    expect(statGridStyles).toContain('minmax(min(var(--_itsm-stat-min), calc(50% - var(--_itsm-stat-gap) / 2)), 1fr)');
    for (const columns of ['2', '3', '4', '6']) expect(rule(items(columns)), columns).toContain(tracks(2));
    expect(statGridStyles).not.toMatch(/overflow-x|scroll-snap|nowrap/);
  });

  it('keeps v2’s four: two, then four once the grid is 48 rem wide', () => {
    expect(rule(items('4'), '@container itsm-stats (min-width: 48rem)')).toContain(tracks(4));
  });
});

describe('three and six across (v3)', () => {
  it('lays six out as two, three from 35 rem and six from 60 rem: the dashboard’s KPI row', () => {
    expect(rule(items('6'), '@container itsm-stats (min-width: 35rem)')).toContain(tracks(3));
    expect(rule(items('6'), '@container itsm-stats (min-width: 60rem)')).toContain(tracks(6));
  });

  it('lays three out as two, then three from 35 rem', () => {
    expect(rule(items('3'), '@container itsm-stats (min-width: 35rem)')).toContain(tracks(3));
    expect(rule(items('3'), '@container itsm-stats (min-width: 60rem)')).toBe('');
  });

  it('never gives two or four a third column', () => {
    for (const columns of ['2', '4']) expect(rule(items(columns), '@container itsm-stats (min-width: 35rem)'), columns).toBe('');
    expect(rule(items('2'), '@container itsm-stats (min-width: 48rem)')).toBe('');
  });

  it('shares the dashboard grid’s gutters: 12, 16 from 45 rem, 20 from 60 rem', () => {
    expect(rule('.itsm-StatGrid__items')).toContain('--_itsm-stat-gap: var(--itsm-space-sm);');
    expect(rule('.itsm-StatGrid__items', '@container itsm-stats (min-width: 45rem)')).toContain('--_itsm-stat-gap: var(--itsm-space-md);');
    expect(rule('.itsm-StatGrid__items', '@container itsm-stats (min-width: 60rem)')).toContain('--_itsm-stat-gap: var(--itsm-space-ml);');
  });

  it('answers to its own width, not the window’s', () => {
    expect(rule('.itsm-StatGrid')).toContain('container: itsm-stats / inline-size;');
    expect(statGridStyles).not.toMatch(/@media/);
  });
});

describe.each(['apple', 'apple-dark'])('axe, in %s', (theme) => {
  it('a six-up KPI row', async () => {
    const { container } = render(
      <TestProvider>
        <div data-itsm-theme={theme}>
          <StatGrid columns={6}>
            {['Open', 'Due today', 'Breached', 'Waiting on others', 'Unassigned', 'Resolved'].map((label, index) => (
              <StatCard key={label} label={label} value={index * 3} href={`/inbox/${index}`} trend={[1, 2, index]} />
            ))}
          </StatGrid>
        </div>
      </TestProvider>,
    );
    await expectNoViolations(container);
  });
});
