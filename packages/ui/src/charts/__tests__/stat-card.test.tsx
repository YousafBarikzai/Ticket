// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneElement, createContext, Fragment, isValidElement, useContext, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { ShellLink } from '../../shell/ShellLink.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, click, render } from '../../web/__tests__/support/render.js';
import { Button } from '../../web/Button.js';
import { InfoTipTrigger } from '../../web/InfoTipTrigger.js';
import { Metric, MetricGrid } from '../../web/Metric.js';
import { StatCard, type StatCardProps } from '../StatCard.js';
import { statCardStyles } from '../StatCard.styles.js';
import { StatGrid } from '../StatGrid.js';

afterEach(() => {
  cleanupDocument();
  vi.restoreAllMocks();
});

/**
 * The KPI tile (v3 §2.13, A1 §7.2), state by state. A stat card is read in
 * a glance and by a screen reader in one breath, so every case checks both
 * what is shown and what is heard. It is server-safe (RV2), so it is also
 * rendered here the way a React server component renders it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..');

function card(props: Partial<StatCardProps> = {}) {
  const { container } = render(
    <TestProvider>
      <StatCard label="Open tickets" value={1284} {...props} />
    </TestProvider>,
  );
  return container.querySelector('.itsm-StatCard') as HTMLElement;
}

const text = (element: Element | null): string => element?.textContent ?? '';
/** The declarations of every rule whose selector list includes exactly `selector`, joined; `within` narrows to one at-rule's block. */
function rule(selector: string, within?: string): string {
  let sheet = statCardStyles.replace(/\/\*[\s\S]*?\*\//g, '');
  if (within) {
    const start = sheet.indexOf(within);
    expect(start, within).toBeGreaterThan(-1);
    sheet = sheet.slice(start, sheet.indexOf('\n}\n', start));
  }
  const found: string[] = [];
  for (const match of sheet.matchAll(/(?:^|\n)\s*([^{}@]+?)\s*\{([^}]*)\}/g)) {
    const selectors = match[1]!.split(',').map((part) => part.trim());
    if (selectors.includes(selector)) found.push(match[2]!);
  }
  return found.join('\n');
}

describe('the value', () => {
  it('is written in the reader’s locale, as the only large thing', () => {
    const root = card();
    expect(text(root.querySelector('.itsm-StatCard__label'))).toBe('Open tickets');
    expect(text(root.querySelector('.itsm-StatCard__number'))).toBe('1,284');
  });

  it('shows a dash when there is no value, and says "Not available"', () => {
    const root = card({ value: null });
    const number = root.querySelector('.itsm-StatCard__number')!;
    expect(number.textContent).toBe('—');
    expect(number.getAttribute('aria-hidden')).toBe('true');
    expect(text(root.querySelector('.itsm-StatCard__value'))).toContain('Not available');
  });

  it('marks a lower bound as one: "50+", heard as "at least 50"', () => {
    const root = card({ value: 50, approx: 'atLeast' });
    expect(text(root.querySelector('.itsm-StatCard__number'))).toBe('50+');
    expect(text(root.querySelector('.itsm-StatCard__value .itsm-visually-hidden'))).toBe('at least 50');
  });

  it('shortens when asked (in the locale’s own abbreviation), and carries a unit and a qualifier', () => {
    const root = card({ value: 12_900, format: { compact: true }, unit: 'tickets', secondary: '· 3 breached' });
    expect(text(root.querySelector('.itsm-StatCard__number'))).toMatch(/^12\.9[kK]$/);
    expect(text(root.querySelector('.itsm-StatCard__unit'))).toBe('tickets');
    expect(text(root.querySelector('.itsm-StatCard__secondary'))).toBe('· 3 breached');
  });

  it('formats percentages as percentages', () => {
    expect(text(card({ value: 0.942, format: { style: 'percent', maximumFractionDigits: 1 } }).querySelector('.itsm-StatCard__number'))).toBe('94.2%');
  });

  it('writes minutes as a duration, and says the units in full', () => {
    const root = card({ value: 72, format: { duration: 'minutes' } });
    expect(text(root.querySelector('.itsm-StatCard__number'))).toBe('1 h 12 min');
    expect(root.querySelector('.itsm-StatCard__number')?.getAttribute('aria-hidden')).toBe('true');
    expect(text(root.querySelector('.itsm-StatCard__value .itsm-visually-hidden'))).toBe('1 hour 12 minutes');
    // Two parts at most: a long wait reads in days and hours.
    expect(text(card({ value: 3 * 24 * 60 + 5 * 60 + 7, format: { duration: 'minutes' } }).querySelector('.itsm-StatCard__number'))).toBe('3 d 5 h');
  });

  it('takes its locale as a prop, never from the provider', () => {
    const { container } = render(
      <TestProvider locale="de-DE">
        <StatCard label="Offen" value={1284} />
        <StatCard label="Offen" value={1284} locale="de-DE" />
      </TestProvider>,
    );
    const [first, second] = [...container.querySelectorAll('.itsm-StatCard__number')];
    expect(first!.textContent).toBe('1,284');
    expect(second!.textContent).toBe('1.284');
  });
});

describe('the delta pill', () => {
  it('sits beside the value, says the direction with an arrow and a sign, and whether that is good, with the period, in words', () => {
    const root = card({ delta: { value: 0.12, format: { style: 'percent' }, period: 'vs last week', goodDirection: 'down' } });
    const delta = root.querySelector('.itsm-StatCard__delta')!;
    expect(delta.getAttribute('data-direction')).toBe('up');
    expect(delta.getAttribute('data-sentiment')).toBe('bad');
    const pill = delta.querySelector('.itsm-DeltaPill')!;
    expect(pill.getAttribute('data-sentiment')).toBe('bad');
    expect(text(pill.querySelector('.itsm-DeltaPill__value'))).toBe('+12%');
    expect(pill.querySelector('svg[data-icon="arrow-up"]')).not.toBeNull();
    expect(text(pill.querySelector('.itsm-visually-hidden'))).toBe('Up 12%, worse, vs last week');
    expect(root.hasAttribute('data-delta')).toBe(true);
  });

  it('starts the context line with the period, drawn for the eye: the pill has said it once already', () => {
    const root = card({ delta: { value: -4, period: 'vs yesterday', goodDirection: 'down' }, context: '3 P1/P2' });
    const line = root.querySelector('.itsm-StatCard__context')!;
    expect(text(line)).toBe('vs yesterday · 3 P1/P2');
    expect(line.querySelector('.itsm-StatCard__period')?.getAttribute('aria-hidden')).toBe('true');
    expect(line.querySelector('.itsm-StatCard__separator')?.getAttribute('aria-hidden')).toBe('true');
    expect(text(root.querySelector('.itsm-StatCard__delta .itsm-visually-hidden'))).toBe('Down 4, better, vs yesterday');
    // The period alone, when there is nothing else to say.
    cleanupDocument();
    expect(text(card({ delta: { value: 9, period: 'vs previous 30 days' } }).querySelector('.itsm-StatCard__context'))).toBe('vs previous 30 days');
  });

  it('calls a change neither good nor bad when there is no good direction', () => {
    const delta = card({ delta: { value: 3, period: 'vs yesterday', goodDirection: 'none' } }).querySelector('.itsm-StatCard__delta')!;
    expect(delta.getAttribute('data-sentiment')).toBe('neutral');
    expect(text(delta.querySelector('.itsm-visually-hidden'))).toBe('Up 3, vs yesterday');
  });

  it('carries a unit, spoken in words: "+9 pts" is heard as "Up 9 points"', () => {
    const pill = card({ delta: { value: 9, unit: 'pts', period: 'vs last week' } }).querySelector('.itsm-DeltaPill')!;
    expect(text(pill.querySelector('.itsm-DeltaPill__unit'))).toBe('pts');
    expect(text(pill.querySelector('.itsm-visually-hidden'))).toBe('Up 9 points, better, vs last week');
  });

  it('draws no pill for zero, but still says "No change" and keeps the period in the context line', () => {
    const root = card({ delta: { value: 0, period: 'vs last week' } });
    const delta = root.querySelector('.itsm-StatCard__delta')!;
    expect(delta.getAttribute('data-direction')).toBe('flat');
    expect(delta.querySelector('.itsm-DeltaPill')).toBeNull();
    expect(text(delta.querySelector('.itsm-visually-hidden'))).toBe('No change, vs last week');
    expect(text(root.querySelector('.itsm-StatCard__period'))).toBe('vs last week');
    // It takes no row of its own when a narrow tile stacks the delta under the value.
    expect(root.hasAttribute('data-delta')).toBe(false);
    expect(rule('.itsm-StatCard__delta[data-direction="flat"]')).toContain('position: absolute;');
  });

  it('is left out, period and all, when there is no value to change', () => {
    const root = card({ value: null, delta: { value: 3, period: 'vs last week' } });
    expect(root.querySelector('.itsm-StatCard__delta')).toBeNull();
    expect(root.querySelector('.itsm-StatCard__context')).toBeNull();
  });
});

describe('the spark row', () => {
  it('draws the trend as an accent sparkline the full width of the row, 40 tall, named by its direction', () => {
    const root = card({ trend: [980, 1100, 1284] });
    const row = root.querySelector('.itsm-StatCard__spark')!;
    expect(row.getAttribute('data-kind')).toBe('trend');
    const spark = row.querySelector('.itsm-StatCard__trend')!;
    expect(spark.getAttribute('role')).toBe('img');
    expect(spark.getAttribute('aria-label')).toBe('Trend: Rising, 980 → 1,284');
    expect(spark.getAttribute('data-tone')).toBe('accent');
    expect(spark.getAttribute('data-width')).toBe('fill');
    expect(spark.querySelector('svg')?.getAttribute('height')).toBe('40');
    expect(root.hasAttribute('data-spark')).toBe(true);
  });

  it('draws a muted trend when asked, and the inline layout’s smaller line', () => {
    expect(card({ trend: [1, 2], trendTone: 'muted' }).querySelector('.itsm-StatCard__trend')?.getAttribute('data-tone')).toBe('muted');
    cleanupDocument();
    const inline = card({ trend: [1, 2], layout: 'inline' });
    expect(inline.getAttribute('data-layout')).toBe('inline');
    expect(inline.querySelector('.itsm-StatCard__trend')?.getAttribute('width')).toBe('88');
    expect(inline.querySelector('.itsm-StatCard__trend')?.getAttribute('height')).toBe('28');
  });

  it('draws the dashed "No trend yet" rule only for a trend with fewer than two points', () => {
    const empty = card({ trend: [3] }).querySelector('.itsm-StatCard__spark .itsm-Sparkline')!;
    expect(empty.hasAttribute('data-empty')).toBe(true);
    expect(empty.getAttribute('aria-label')).toBe('No trend yet');
  });

  it('is omitted when there is neither a trend nor a visual: no placeholder', () => {
    const root = card({ delta: { value: 2, period: 'vs last week' } });
    expect(root.querySelector('.itsm-StatCard__spark')).toBeNull();
    expect(root.querySelector('.itsm-Sparkline')).toBeNull();
    expect(root.hasAttribute('data-spark')).toBe(false);
  });

  it('holds a visual instead of the sparkline, at the row’s full width', () => {
    const root = card({ trend: [1, 2, 3], visual: <span className="strip">P1 · P2</span> });
    const row = root.querySelector('.itsm-StatCard__spark')!;
    expect(row.getAttribute('data-kind')).toBe('visual');
    expect(row.querySelector('.strip')).not.toBeNull();
    expect(root.querySelector('.itsm-Sparkline')).toBeNull();
    expect(rule('.itsm-StatCard__spark[data-kind="visual"] > *')).toContain('flex: 1 1 auto;');
  });

  it('is 40 px tall, the PMO tile’s spark row', () => {
    expect(rule('.itsm-StatCard__spark')).toContain('block-size: 2.5rem;');
  });
});

describe('the label and its ⓘ', () => {
  it('draws an InfoTip trigger named after the label, closed, as a client island', () => {
    const button = card({ info: 'Open tickets assigned to you, waiting included' }).querySelector('.itsm-StatCard__head button')!;
    expect(button.getAttribute('aria-label')).toBe('About Open tickets');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.classList.contains('itsm-StatCard__info')).toBe(true);
  });

  it('takes a title and a source too', () => {
    const { container } = render(<StatCard label="Open" value={9} info={{ title: 'Open', body: 'Estimated from when tickets were raised.', source: 'Tickets, now' }} />);
    expect(container.querySelector('.itsm-StatCard__info')).not.toBeNull();
  });

  it('keeps the ⓘ and the retry above the stretched link', () => {
    for (const selector of ['.itsm-StatCard__info', '.itsm-StatCard__retry']) {
      expect(rule(selector), selector).toContain('position: relative;');
      expect(rule(selector), selector).toContain('z-index: 1;');
    }
  });

  it('writes the label 500 12/16 in text.muted', () => {
    const label = rule('.itsm-StatCard__label');
    expect(label).toContain('font-size: var(--itsm-text-footnote-size);');
    expect(label).toContain('font-weight: var(--itsm-font-weight-medium);');
    expect(label).toContain('color: var(--itsm-colour-text-muted);');
  });
});

describe('the context line', () => {
  it('is the footnote under its new name, which wins when both are given', () => {
    expect(text(card({ context: 'Oldest 1 day ago', footnote: 'old' }).querySelector('.itsm-StatCard__context'))).toBe('Oldest 1 day ago');
  });

  it('is clamped to two lines in footnote type, muted', () => {
    const context = rule('.itsm-StatCard__context');
    expect(context).toContain('-webkit-line-clamp: 2;');
    expect(context).toContain('font-size: var(--itsm-text-footnote-size);');
    expect(context).toContain('color: var(--itsm-colour-text-muted);');
  });
});

describe('status, link and states', () => {
  it('adds an icon with a name, never colour alone', () => {
    const root = card({ status: 'critical' });
    expect(root.getAttribute('data-status')).toBe('critical');
    expect(root.querySelector('.itsm-StatCard__status')?.getAttribute('aria-label')).toBe('Critical');
  });

  it('turns the label into one link stretched over the card, through the application’s Link', () => {
    const root = card({ href: '/tickets?status=open' });
    const links = root.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/tickets?status=open');
    expect(links[0]!.textContent).toBe('Open tickets');
    expect(root.hasAttribute('data-interactive')).toBe(true);
  });

  it('is not interactive without a link', () => {
    expect(card().hasAttribute('data-interactive')).toBe(false);
  });

  it('keeps the label while loading, says it is loading, and stands in at the tile’s final height', () => {
    const root = card({ loading: true, href: '/tickets' });
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(text(root.querySelector('.itsm-StatCard__label'))).toBe('Open tickets');
    expect(root.querySelector('a')).toBeNull();
    expect(root.querySelector('.itsm-StatCard__value')).toBeNull();
    expect(text(root.querySelector('.itsm-StatCard__loading .itsm-visually-hidden'))).toBe('Loading…');
    expect(root.querySelectorAll('.itsm-Skeleton[aria-hidden="true"]').length).toBeGreaterThan(0);
    expect(root.querySelector('.itsm-StatCard__valueBone')).not.toBeNull();
    expect(root.querySelector('.itsm-StatCard__contextBone')).not.toBeNull();
    // A spark bone only for a tile that will have a spark row.
    expect(root.querySelector('.itsm-StatCard__sparkBone')).toBeNull();
    cleanupDocument();
    expect(card({ loading: true, trend: [] }).querySelector('.itsm-StatCard__sparkBone')).not.toBeNull();
  });

  it('says why it could not load, in words, and retries on request', () => {
    const onRetry = vi.fn();
    const root = card({ problem: { status: 503 }, onRetry, trend: [1, 2] });
    expect(text(root.querySelector('.itsm-StatCard__problem'))).toContain("Couldn't load open tickets");
    expect(root.querySelector('.itsm-StatCard__value')).toBeNull();
    expect(root.querySelector('.itsm-StatCard__spark')).toBeNull();
    click(root.querySelector('.itsm-StatCard__retry')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no retry for a problem retrying cannot fix', () => {
    expect(card({ problem: { status: 403 }, onRetry: vi.fn() }).querySelector('.itsm-StatCard__retry')).toBeNull();
  });

  it('carries a footnote', () => {
    expect(text(card({ footnote: 'Counted from the first 50.' }).querySelector('.itsm-StatCard__footnote'))).toBe('Counted from the first 50.');
  });

  it('renders outside a provider, in the default locale', () => {
    const { container } = render(<StatCard label="Open" value={1284} href="/x" />);
    expect(container.querySelector('.itsm-StatCard__number')?.textContent).toBe('1,284');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/x');
  });
});

describe('the deprecated Metric', () => {
  it('draws a stat card with its old props, the note coloured by tone and the value never', () => {
    const { container } = render(
      <MetricGrid>
        <Metric label="Open tickets" value={128} note="12 more than yesterday" tone="bad" href="/tickets" />
        <Metric label="Cost" value="£3.20" />
      </MetricGrid>,
    );
    expect(container.querySelector('.itsm-StatGrid.itsm-MetricGrid')).not.toBeNull();
    const [first, second] = [...container.querySelectorAll('.itsm-StatCard.itsm-Metric')];
    expect(first!.querySelector('.itsm-StatCard__number')?.textContent).toBe('128');
    expect(first!.querySelector('.itsm-StatCard__footnote')?.getAttribute('data-tone')).toBe('bad');
    expect(first!.querySelector('a')?.getAttribute('href')).toBe('/tickets');
    expect(second!.querySelector('.itsm-StatCard__number')?.textContent).toBe('£3.20');
    expect(second!.querySelector('.itsm-StatCard__footnote')).toBeNull();
  });
});

/*
 * A React server component is called as a plain function with no hooks
 * dispatcher: `useContext` (and so `useOptionalItsm`) throws, and a module
 * marked `'use client'` is not called at all — it is sent to the browser as a
 * reference with its props, which must therefore be plain data. This renders
 * a tree by exactly those rules, then lets `react-dom/server` draw the
 * islands the way Next's server render does.
 */
const CLIENT_ISLANDS = new Map<unknown, { readonly name: string; readonly file: string }>([
  [Button, { name: 'Button', file: 'web/Button.tsx' }],
  [InfoTipTrigger, { name: 'InfoTipTrigger', file: 'web/InfoTipTrigger.tsx' }],
  [ShellLink, { name: 'ShellLink', file: 'shell/ShellLink.tsx' }],
]);

function asServerComponent(node: ReactNode, islands: string[]): ReactNode {
  if (Array.isArray(node)) return node.map((child: ReactNode) => asServerComponent(child, islands));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  const { type, props } = element;
  // Children go back as arguments, as JSX wrote them, so React does not take a static list for a keyed one.
  const rebuilt = (): ReactElement => {
    if (props.children === undefined) return element;
    const children = asServerComponent(props.children as ReactNode, islands);
    return Array.isArray(children) ? cloneElement(element, undefined, ...(children as ReactNode[])) : cloneElement(element, undefined, children);
  };
  if (typeof type === 'string' || type === Fragment) return rebuilt();
  const island = CLIENT_ISLANDS.get(type);
  if (island) {
    for (const [name, value] of Object.entries(props)) {
      if (typeof value === 'function') throw new Error(`${island.name} was handed a function (${name}): it cannot cross to the browser`);
    }
    islands.push(island.name);
    return rebuilt();
  }
  if (typeof type === 'function') return asServerComponent((type as (p: Record<string, unknown>) => ReactNode)(props), islands);
  throw new Error(`Unexpected element type in a server render: ${String(type)}`);
}

describe('as a React server component (RV2)', () => {
  it('has no client directive and reads no provider', () => {
    const source = readFileSync(join(here, '..', 'StatCard.tsx'), 'utf8');
    expect(source.trimStart().startsWith("'use client'")).toBe(false);
    expect(source).not.toMatch(/\buse(?:Optional)?Itsm\b|\buseContext\b/);
  });

  it('names as islands only modules that are client modules', () => {
    for (const { file } of CLIENT_ISLANDS.values()) {
      expect(readFileSync(join(SRC, file), 'utf8').trimStart().startsWith("'use client'"), file).toBe(true);
    }
  });

  it('fails a component that reads a context, so a pass below means something', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Context = createContext('x');
    function Reader(): ReactNode {
      return useContext(Context);
    }
    expect(() => asServerComponent(<Reader />, [])).toThrow();
  });

  it('renders without a provider, its ⓘ and its link as islands with plain props', () => {
    const islands: string[] = [];
    const tree = asServerComponent(
      <StatCard
        label="Open"
        value={1284}
        href="/inbox/mine"
        info={{ body: 'Open tickets assigned to you, waiting included', source: 'Estimated from when tickets were raised and resolved' }}
        delta={{ value: -2, period: 'vs 7 days ago', goodDirection: 'down' }}
        trend={[9, 11, 10, 12]}
        context="2 P2 · 4 P3 · 3 P4"
        status="attention"
      />,
      islands,
    );
    expect(islands.sort()).toEqual(['InfoTipTrigger', 'ShellLink']);
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(tree as ReactElement);
    expect(host.querySelector('.itsm-StatCard__number')?.textContent).toBe('1,284');
    expect(host.querySelector('a.itsm-StatCard__link')?.getAttribute('href')).toBe('/inbox/mine');
    expect(host.querySelector('.itsm-StatCard__info')?.getAttribute('aria-label')).toBe('About Open');
    expect(host.querySelector('.itsm-DeltaPill')?.getAttribute('data-sentiment')).toBe('good');
    expect(host.querySelector('.itsm-StatCard__context')?.textContent).toBe('vs 7 days ago · 2 P2 · 4 P3 · 3 P4');
  });

  it('renders every state without a provider, and a server parent’s problem offers no retry', () => {
    for (const props of [{ loading: true }, { problem: { status: 503 } }, { value: null }, { visual: <span>strip</span> }] as const) {
      const islands: string[] = [];
      const tree = asServerComponent(<StatCard label="Backlog" value={3} {...props} />, islands);
      expect(islands).toEqual([]);
      expect(() => renderToStaticMarkup(tree as ReactElement)).not.toThrow();
    }
  });
});

describe('the stylesheet', () => {
  it('is border-first: raised, a 1 px border.subtle edge, no resting shadow, radius 12, padding 16, at least 124 tall', () => {
    const tile = rule('.itsm-StatCard');
    expect(tile).toContain('border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);');
    expect(tile).toContain('background: var(--itsm-colour-surface-raised);');
    expect(tile).toContain('border-radius: var(--itsm-radius-2xl);');
    expect(tile).toContain('padding: var(--itsm-space-md);');
    expect(tile).toContain('min-block-size: 7.75rem;');
    expect(tile).toContain('container: itsm-stat / inline-size;');
    expect(tile).not.toContain('box-shadow');
  });

  it('lays the tile out as the PMO grid, with no spark row unless there is a spark', () => {
    expect(rule('.itsm-StatCard__grid')).toMatch(/grid-template-areas:\s*"label label"\s*"value delta"\s*"context context";/);
    expect(rule('.itsm-StatCard[data-spark] > .itsm-StatCard__grid')).toMatch(/grid-template-areas:\s*"label label"\s*"value delta"\s*"spark spark"\s*"context context";/);
  });

  it('steps with its own width: the delta’s unit below 16.25 rem, 24/28 and the delta under the value below 13.75 rem, no spark below 10.625 rem', () => {
    expect(rule('.itsm-StatCard .itsm-DeltaPill__unit', '@container itsm-stat (width < 16.25rem)')).toContain('display: none;');
    const narrow = '@container itsm-stat (width < 13.75rem)';
    expect(rule('.itsm-StatCard__value', narrow)).toContain('font-size: 1.5rem;');
    expect(rule('.itsm-StatCard__value', narrow)).toContain('line-height: 1.75rem;');
    expect(rule('.itsm-StatCard[data-layout="tile"][data-delta] > .itsm-StatCard__grid', narrow)).toMatch(/"label"\s*"value"\s*"delta"\s*"context"/);
    const tiny = '@container itsm-stat (width < 10.625rem)';
    expect(rule('.itsm-StatCard__spark', tiny)).toContain('display: none;');
    expect(rule('.itsm-StatCard[data-layout="tile"][data-spark] > .itsm-StatCard__grid', tiny)).not.toContain('spark');
  });

  it('marks a status with its edge, kept on hover', () => {
    expect(rule('.itsm-StatCard[data-status="attention"]')).toContain('border-color: var(--itsm-colour-warning-border);');
    expect(rule('.itsm-StatCard[data-status="critical"]')).toContain('border-color: var(--itsm-colour-danger-border);');
    expect(statCardStyles).toMatch(/\.itsm-StatCard\[data-interactive\]:hover\[data-status="default"\] \{\s*border-color: var\(--itsm-colour-border-soft\);/);
  });

  it('answers hover and focus with the soft edge and elevation sm, and never lifts', () => {
    expect(statCardStyles).toMatch(/\.itsm-StatCard\[data-interactive\]:hover \{\s*box-shadow: var\(--itsm-elevation-sm\);/);
    expect(statCardStyles).toMatch(/:has\(\.itsm-StatCard__link:focus-visible\) \{\s*box-shadow: var\(--itsm-elevation-sm\);/);
    expect(statCardStyles).not.toMatch(/transform|translate/);
    expect(rule('.itsm-StatCard__link::after')).toContain('position: absolute;');
  });

  it('writes the value in statValue, the unit at 0.62 em in text.muted', () => {
    expect(rule('.itsm-StatCard__value')).toContain('font-size: var(--itsm-text-statValue-size);');
    expect(rule('.itsm-StatCard__value')).toContain('font-family: var(--itsm-text-statValue-family);');
    expect(rule('.itsm-StatCard__unit')).toContain('font-size: 0.62em;');
    expect(rule('.itsm-StatCard__unit')).toContain('color: var(--itsm-colour-text-muted);');
  });
});

/*
 * The stat cards' accessibility audit, moved here from `charts.audit.test.tsx`
 * (rule 10): every state in a grid, read by axe in a light and a dark
 * container.
 */
describe.each(['apple', 'apple-dark'])('axe, in %s', (theme) => {
  it('stat cards in every state, in a grid', async () => {
    const { container } = render(
      <TestProvider>
        <div data-itsm-theme={theme}>
          <StatGrid columns={6}>
            <StatCard label="Open" value={1284} href="/tickets" icon="ticket" trend={[1, 3, 2, 5]} delta={{ value: 0.12, format: { style: 'percent' }, period: 'vs last week', goodDirection: 'down' }} />
            <StatCard label="Unassigned" value={50} approx="atLeast" status="attention" footnote="Counted from the first 50." />
            <StatCard label="SLA met" value={null} secondary="· 3 breached" status="critical" />
            <StatCard label="First reply" value={null} loading trend={[]} />
            <StatCard label="Backlog" value={null} problem={{ status: 503 }} onRetry={() => undefined} surface="sunken" />
            <StatCard
              label="Due today"
              value={4}
              href="/inbox/mine?due=today"
              info={{ title: 'Due today', body: 'Open tickets due before midnight', source: 'Tickets, now' }}
              visual={<span>1 P1 · 3 P2</span>}
              context="1 within the hour"
            />
          </StatGrid>
          <StatGrid columns={3}>
            <StatCard label="Resolved" value={41} delta={{ value: 0, period: 'vs previous 30 days' }} trend={[7]} />
            <StatCard label="SLA met" value={0.85} format={{ style: 'percent' }} delta={{ value: 3, unit: 'pts', period: 'vs last month' }} layout="inline" trend={[0.8, 0.82, 0.85]} />
            <StatCard label="Waiting" value={6} info="Waiting on the requester, a supplier or an approval" context="Longest 2 days" />
          </StatGrid>
        </div>
      </TestProvider>,
    );
    await expectNoViolations(container);
  });
});
