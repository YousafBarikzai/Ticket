// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { componentStylesheet } from '../../styles/index.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { Skeleton, SkeletonText } from '../../web/Skeleton.js';
import { skeletonStyles } from '../../web/Skeleton.styles.js';
import {
  SkeletonAvatar,
  SkeletonCard,
  SkeletonChartCard,
  SkeletonConversation,
  SkeletonList,
  SkeletonPage,
  SkeletonStat,
  SkeletonTable,
  type SkeletonPageVariant,
} from '../Skeletons.js';
import { skeletonsStyles } from '../Skeletons.styles.js';

/*
 * The skeleton family (SPEC §4.5, §1.9; WP6 acceptance "skeleton 200 ms reveal
 * and 1 s SR status"; v3 §2.13): server-rendered shapes that say nothing to a
 * screen reader, one delayed status per page, all of the timing in CSS, and
 * — in v3 — the final heights of what they stand in for: the KPI tile at
 * 124, the chart card at the height it is given, the PMO dashboard and the
 * board.
 */

afterEach(() => {
  cleanupDocument();
  delete document.documentElement.dataset.itsmTheme;
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const variants: readonly SkeletonPageVariant[] = ['list', 'detail', 'dashboard', 'board', 'form', 'workspace', 'inbox', 'settings'];

/** Every rule in `sheet` whose selector list is exactly `selector`, joined. */
function exactRule(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...sheet.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join('\n');
}

/** Every rule in the stylesheet that mentions `selector`, as text. */
function rulesFor(selector: string): string {
  return componentStylesheet
    .split('}')
    .filter((chunk) => chunk.includes(selector))
    .join('}\n');
}

describe('server-safe', () => {
  it('has no client directive, so a loading.tsx streams it with no JavaScript', () => {
    for (const file of ['web/Skeleton.tsx', 'feedback/Skeletons.tsx', 'feedback/Spinner.tsx']) {
      const source = readFileSync(join(SRC, file), 'utf8');
      expect(source.trimStart().startsWith("'use client'"), file).toBe(false);
    }
  });

  it.each([
    ['Skeleton', <Skeleton width="40%" height={12} />],
    ['SkeletonText', <SkeletonText lines={2} />],
    ['SkeletonAvatar', <SkeletonAvatar size="lg" />],
    ['SkeletonStat', <SkeletonStat />],
    ['SkeletonCard', <SkeletonCard lines={4} />],
    ['SkeletonChartCard', <SkeletonChartCard />],
    ['SkeletonTable', <SkeletonTable rows={3} columns={5} />],
    ['SkeletonList', <SkeletonList rows={3} />],
    ['SkeletonConversation', <SkeletonConversation messages={2} />],
    ...variants.map((variant) => [`SkeletonPage ${variant}`, <SkeletonPage variant={variant} />] as const),
  ] as readonly (readonly [string, ReactElement])[])('%s renders on the server without a provider', (_name, element) => {
    expect(renderToStaticMarkup(element).length).toBeGreaterThan(0);
  });
});

describe('what a screen reader gets', () => {
  it('hides every bone', () => {
    const { container } = render(
      <div>
        {variants.map((variant) => (
          <SkeletonPage key={variant} variant={variant} />
        ))}
      </div>,
    );
    const bones = Array.from(container.querySelectorAll('.itsm-Skeleton'));
    expect(bones.length).toBeGreaterThan(50);
    for (const bone of bones) expect(bone.closest('[aria-hidden="true"]'), bone.outerHTML).not.toBeNull();
  });

  it('gives a page one status, beside — not inside — the busy shapes', () => {
    const { container } = render(<SkeletonPage variant="list" label="Loading rules…" />);
    const statuses = container.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    const status = statuses[0]!;
    expect(status.querySelector('.itsm-SkeletonStatus__loading')?.textContent).toBe('Loading rules…');
    expect(status.querySelector('.itsm-SkeletonStatus__still')?.textContent).toBe('Still loading…');
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.contains(status)).toBe(false);
    expect(status.closest('[aria-busy]')).toBeNull();
  });

  it('says "Loading…" by default, and takes other words for "Still loading…"', () => {
    const { container } = render(<SkeletonPage variant="dashboard" stillLabel="This is taking longer than usual…" />);
    expect(container.querySelector('.itsm-SkeletonStatus__loading')?.textContent).toBe('Loading…');
    expect(container.querySelector('.itsm-SkeletonStatus__still')?.textContent).toBe('This is taking longer than usual…');
  });

  it('keeps section skeletons silent unless given a label, so six loading cards say it once', () => {
    const silent = render(<SkeletonCard />);
    expect(silent.container.querySelector('[role="status"]')).toBeNull();
    expect(silent.container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    silent.unmount();

    const labelled = render(<SkeletonTable label="Loading deliveries…" />);
    expect(labelled.container.querySelector('[role="status"]')?.textContent).toContain('Loading deliveries…');
    expect(labelled.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shapes each page like the page it stands in for', () => {
    const shapes = variants.map((variant) => renderToStaticMarkup(<SkeletonPage variant={variant} />));
    expect(new Set(shapes).size).toBe(variants.length);
    expect(shapes[variants.indexOf('dashboard')]).toContain('itsm-SkeletonStat');
    expect(shapes[variants.indexOf('list')]).toContain('itsm-SkeletonTable');
    expect(shapes[variants.indexOf('inbox')]).toContain('itsm-SkeletonList');
    expect(shapes[variants.indexOf('workspace')]).toContain('itsm-SkeletonConversation');
    expect(shapes[variants.indexOf('board')]).toContain('itsm-SkeletonPage__board');
  });
});

describe('v3 shapes at their final heights', () => {
  it('stands a KPI tile in at 124 px: label, value with its delta, context', () => {
    const { container } = render(<SkeletonStat />);
    const tile = container.querySelector('.itsm-SkeletonStat')!;
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.querySelector('.itsm-SkeletonStat__value')?.children).toHaveLength(2);
    expect(tile.querySelector('.itsm-SkeletonStat__context')).not.toBeNull();
    expect(exactRule(skeletonsStyles, '.itsm-SkeletonStat')).toContain('min-block-size: 7.75rem');
  });

  it('draws a card’s text as 12 px bars: the title at 38 %, lines at 92 %, the last at 64 %', () => {
    const { container } = render(<SkeletonCard lines={3} />);
    const title = container.querySelector<HTMLElement>('.itsm-SkeletonCard__title')!;
    expect(title.style.inlineSize).toBe('38%');
    expect(title.style.blockSize).toBe('12px');
    const lines = [...container.querySelectorAll<HTMLElement>('.itsm-SkeletonCard__lines > .itsm-Skeleton')];
    expect(lines.map((line) => line.style.inlineSize)).toEqual(['92%', '92%', '64%']);
    expect(lines.every((line) => line.style.blockSize === '12px')).toBe(true);
    expect(lines.every((line) => line.dataset.radius === 'sm')).toBe(true);
  });

  it('stands a chart card in at its final height: title bar, headline bar, then the plot', () => {
    const { container } = render(<SkeletonChartCard height={336} />);
    const card = container.querySelector<HTMLElement>('.itsm-SkeletonChartCard')!;
    expect(card.classList.contains('itsm-SkeletonCard')).toBe(true);
    expect(card.style.minBlockSize).toBe('336px');
    expect(card.dataset.height).toBe('336');
    expect(card.getAttribute('aria-hidden')).toBe('true');
    expect((card.querySelector('.itsm-SkeletonCard__title') as HTMLElement).style.inlineSize).toBe('38%');
    expect((card.querySelector('.itsm-SkeletonCard__headline') as HTMLElement).style.inlineSize).toBe('64%');
    expect(card.querySelector('.itsm-SkeletonChartCard__plot')).not.toBeNull();
    expect(exactRule(skeletonsStyles, '.itsm-SkeletonChartCard__plot')).toContain('flex: 1 1 auto');
  });

  it('is 320 px with a headline by default, and leaves the headline out when asked', () => {
    const plain = render(<SkeletonChartCard />);
    expect(plain.container.querySelector<HTMLElement>('.itsm-SkeletonChartCard')!.style.minBlockSize).toBe('320px');
    expect(plain.container.querySelector('.itsm-SkeletonCard__headline')).not.toBeNull();
    plain.unmount();
    const bare = render(<SkeletonChartCard headline={false} height={-4} />);
    expect(bare.container.querySelector('.itsm-SkeletonCard__headline')).toBeNull();
    expect(bare.container.querySelector<HTMLElement>('.itsm-SkeletonChartCard')!.style.minBlockSize).toBe('320px');
  });

  it('keeps a chart card silent unless it is given a label', () => {
    const { container } = render(<SkeletonChartCard label="Loading the SLA chart…" />);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading the SLA chart…');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('draws the dashboard as the PMO page: toolbar, the hero at 168, six tiles, two chart cards at 320', () => {
    const { container } = render(<SkeletonPage variant="dashboard" />);
    expect(container.querySelector('.itsm-SkeletonPage__dashboardToolbar')).not.toBeNull();
    expect(container.querySelector('.itsm-SkeletonPage__hero')).not.toBeNull();
    expect(container.querySelectorAll('.itsm-SkeletonPage__stats > .itsm-SkeletonStat')).toHaveLength(6);
    const charts = [...container.querySelectorAll<HTMLElement>('.itsm-SkeletonPage__columns > .itsm-SkeletonChartCard')];
    expect(charts.map((chart) => chart.style.minBlockSize)).toEqual(['320px', '320px']);
    const hero = exactRule(skeletonsStyles, '.itsm-SkeletonPage__hero');
    expect(hero).toContain('min-block-size: 10.5rem');
    expect(hero).toContain('border-radius: var(--itsm-radius-3xl)');
  });

  it('draws the board as four columns of three ghost cards and two folded strips', () => {
    const { container } = render(<SkeletonPage variant="board" label="Loading the board…" />);
    const columns = [...container.querySelectorAll('.itsm-SkeletonPage__board > .itsm-SkeletonPage__column')];
    expect(columns).toHaveLength(4);
    expect(columns.map((column) => column.querySelectorAll('.itsm-SkeletonPage__ghostCard').length)).toEqual([3, 3, 3, 3]);
    expect(container.querySelectorAll('.itsm-SkeletonPage__board > .itsm-SkeletonPage__strip')).toHaveLength(2);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading the board…');
    const column = exactRule(skeletonsStyles, '.itsm-SkeletonPage__column,\n.itsm-SkeletonPage__strip');
    expect(column).toContain('background: var(--itsm-colour-surface-raisedAlt)');
    expect(column).toContain('min-block-size: 16.25rem');
  });

  it('lays the six tiles out like StatGrid columns={6}: two, three from 35 rem, six from 60 rem', () => {
    expect(exactRule(skeletonsStyles, '.itsm-SkeletonPage__stats')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(skeletonsStyles).toMatch(/@container \(min-width: 35rem\) \{\s*\.itsm-SkeletonPage__stats \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    expect(skeletonsStyles).toMatch(/@container \(min-width: 60rem\) \{\s*\.itsm-SkeletonPage__stats \{\s*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);/);
  });
});

describe('v3 look', () => {
  it('frames every placeholder card like a v3 card: the 1 px border.subtle edge, no resting shadow', () => {
    const frames = exactRule(skeletonsStyles, '.itsm-SkeletonCard,\n.itsm-SkeletonStat,\n.itsm-SkeletonPage__panel');
    expect(frames).toContain('border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle)');
    expect(frames).toContain('border-radius: var(--itsm-radius-2xl)');
    expect(frames).not.toContain('--itsm-elevation-xs');
  });

  it('draws bones in surface.sunken with the sunken → hover → sunken sweep', () => {
    expect(exactRule(skeletonStyles, '.itsm-Skeleton')).toContain('background: var(--itsm-colour-surface-sunken)');
    expect(exactRule(skeletonStyles, '.itsm-Skeleton::after')).toContain(
      'linear-gradient(90deg, var(--itsm-colour-surface-sunken) 0%, var(--itsm-colour-surface-hover) 40%, var(--itsm-colour-surface-sunken) 80%)',
    );
  });
});

describe('skeleton audit', () => {
  it.each(['apple', 'apple-dark'])('the dashboard and board skeletons have no violations in the %s theme', async (theme) => {
    document.documentElement.dataset.itsmTheme = theme;
    render(
      <main>
        <h1>Overview</h1>
        <SkeletonPage variant="dashboard" />
        <SkeletonPage variant="board" label="Loading the board…" />
        <SkeletonChartCard height={280} />
      </main>,
    );
    await expectNoViolations(document.body);
  });
});

describe('the timing, which is all CSS', () => {
  it('reveals the bones after 200 ms, so a fast response never flashes a skeleton', () => {
    expect(rulesFor('.itsm-Skeleton {')).toMatch(/animation: itsm-skeleton-reveal [^;]* 200ms both/);
    expect(rulesFor('.itsm-SkeletonCard,')).toMatch(/animation: itsm-skeleton-reveal [^;]* 200ms both/);
  });

  it('shows the screen-reader status at 1 s and "Still loading…" at 10 s, when the first one goes', () => {
    expect(rulesFor('.itsm-SkeletonStatus__loading')).toMatch(/visibility: hidden;[\s\S]*itsm-skeleton-appear 0s linear 1s forwards, itsm-skeleton-vanish 0s linear 10s forwards/);
    expect(rulesFor('.itsm-SkeletonStatus__still {')).toMatch(/itsm-skeleton-appear 0s linear 10s forwards/);
    expect(componentStylesheet).toContain('@keyframes itsm-skeleton-appear');
  });

  it('shimmers for about ten seconds and then stops', () => {
    expect(rulesFor('.itsm-Skeleton::after {')).toMatch(/itsm-skeleton-sweep 1\.6s linear 200ms 6;/);
  });

  it('holds still under reduced motion, the system’s or the product’s', () => {
    expect(componentStylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.itsm-Skeleton::after \{\s*display: none;/);
    expect(componentStylesheet).toMatch(/:root\[data-itsm-motion="reduced"\] \.itsm-Skeleton::after \{\s*display: none;/);
  });
});

describe('Skeleton', () => {
  it('keeps its old API and sizes itself inline (dynamic geometry), with the radius as data', () => {
    const markup = renderToStaticMarkup(<Skeleton width={120} height="1rem" radius="pill" />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-radius="pill"');
    expect(markup).toContain('inline-size:120px');
    expect(markup).toContain('block-size:1rem');
  });

  it('draws lines of text with a shorter last line', () => {
    const { container } = render(<SkeletonText lines={3} lastLineWidth="40%" size="footnote" />);
    const lines = Array.from(container.querySelectorAll<HTMLElement>('.itsm-SkeletonText__line'));
    expect(lines.map((line) => line.style.inlineSize)).toEqual(['100%', '100%', '40%']);
    expect(container.firstElementChild?.getAttribute('data-size')).toBe('footnote');
  });
});
