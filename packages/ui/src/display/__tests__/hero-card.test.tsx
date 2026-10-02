// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { unknownVariables } from '../../styles/css.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { activeElement, cleanupDocument, click, focus, press, render, settle } from '../../web/__tests__/support/render.js';
import { HeroCard, type HeroCardProps, type HeroDimension } from '../HeroCard.js';
import { heroCardStyles } from '../HeroCard.styles.js';
import { HeroWhy } from '../HeroWhy.js';

/*
 * `HeroCard` and `HeroWhy` (v3 §2.13, A1 §7.3). The hero is server-safe, so
 * most of these render it the way a server component does — to static
 * markup, with no provider — and read what a screen reader and the
 * stylesheet would. "Why?" is the client island; its popover is held back
 * until a test lets it through, so a press made while it loads is tested.
 */

const gate = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { arrived, release: () => release() };
});

vi.mock('../../overlays/Popover.js', async (importOriginal) => {
  await gate.arrived;
  return importOriginal();
});

afterEach(() => {
  cleanupDocument();
  delete document.documentElement.dataset.itsmTheme;
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const dimensions: readonly HeroDimension[] = [
  { id: 'mine', label: 'My work', tone: 'warning', state: 'At risk', reason: '9 open · 1 breached · next due 40 min', href: '/inbox/mine' },
  { id: 'team', label: 'Team queue', tone: 'success', state: 'On track', reason: '6 unassigned · oldest 2 h' },
  { id: 'mi', label: 'Major incident', tone: 'danger', state: 'MI-0004 · SEV2 · Mitigating' },
];

const full: HeroCardProps = {
  kicker: 'Queue health',
  verdict: { tone: 'warning', label: 'At risk', icon: 'triangle-alert' },
  trend: { text: 'As at 14:32 · next breach in 40 min', direction: 'down' },
  chips: [
    { id: 'breached', tone: 'danger', label: '1 breached', href: '/inbox/mine?sla=breached' },
    { id: 'waiting', tone: 'hold', label: '3 waiting on others' },
  ],
  narrative: 'INC-004503 passed its resolution target yesterday at 15:10; INC-004521 is due in 40 min',
  dimensions,
  aside: {
    kicker: 'Next breach',
    tone: 'warning',
    value: '40 min',
    valueLabel: 'INC-004521',
    progress: { value: 0.66, target: 0.83, label: 'Readiness', caption: 'Target 83%' },
    href: '/tickets/INC-004521',
  },
};

function markup(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host.firstElementChild as HTMLElement;
}

/** Every rule in the hero's module whose selector list is exactly `selector`, joined. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...heroCardStyles.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join('\n');
}

/** The text a screen reader would take as an element's name, from `aria-labelledby`. */
function labelledName(element: Element): string {
  return (element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

describe('HeroCard on the server', () => {
  it('has no client directive and renders without a provider', () => {
    expect(readFileSync(join(SRC, 'display/HeroCard.tsx'), 'utf8').trimStart().startsWith("'use client'")).toBe(false);
    expect(renderToStaticMarkup(<HeroCard {...full} />)).toContain('At risk');
  });

  it('is navy by default, and the navy sets data-surface="hero" so everything inside re-themes', () => {
    const hero = markup(<HeroCard {...full} />);
    expect(hero.tagName).toBe('SECTION');
    expect(hero.dataset.variant).toBe('navy');
    expect(hero.dataset.surface).toBe('hero');
  });

  it('keeps the kicker in sentence case in the markup — the stylesheet draws the capitals', () => {
    const hero = markup(<HeroCard {...full} />);
    const kicker = hero.querySelector('.itsm-HeroCard__kicker')!;
    expect(kicker.textContent).toBe('Queue health');
    // Its words are in the heading already; hidden so they are not read twice.
    expect(kicker.getAttribute('aria-hidden')).toBe('true');
  });

  it('names the verdict heading "{kicker}: {label}", and the section by it', () => {
    document.body.appendChild(markup(<HeroCard {...full} />));
    const section = document.querySelector('section.itsm-HeroCard')!;
    const heading = section.querySelector('h2')!;
    expect(heading.textContent).toBe('Queue health: At risk');
    expect(heading.classList.contains('itsm-HeroCard__verdict')).toBe(true);
    expect(heading.dataset.tone).toBe('warning');
    expect(labelledName(section)).toBe('Queue health: At risk');
    expect(heading.querySelector('svg')?.getAttribute('data-icon')).toBe('triangle-alert');
    expect(heading.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses the tone’s own shape when no icon is given, and an h3 when asked', () => {
    const hero = markup(<HeroCard kicker="Service health" verdict={{ tone: 'success', label: 'Healthy' }} headingLevel={3} />);
    expect(hero.querySelector('h3 svg')?.getAttribute('data-icon')).toBe('circle-check');
    expect(hero.querySelector('h2')).toBeNull();
  });

  it('gives each hero on a page its own heading id, from the kicker or the id given', () => {
    const a = markup(<HeroCard kicker="Queue health" verdict={{ tone: 'success', label: 'On track' }} />);
    const b = markup(<HeroCard id="ai-status" kicker="AI triage status" verdict={{ tone: 'info', label: 'Learning' }} />);
    expect(a.getAttribute('aria-labelledby')).toBe('itsm-hero-queue-health-verdict');
    expect(b.id).toBe('ai-status');
    expect(b.getAttribute('aria-labelledby')).toBe('ai-status-verdict');
    expect(b.querySelector('#ai-status-verdict')).not.toBeNull();
  });

  it('draws the trend with its direction as decoration, and the narrative', () => {
    const hero = markup(<HeroCard {...full} />);
    const trend = hero.querySelector('.itsm-HeroCard__trend')!;
    expect(trend.textContent).toBe('As at 14:32 · next breach in 40 min');
    expect(trend.querySelector('svg')?.getAttribute('data-icon')).toBe('trending-down');
    expect(hero.querySelector('.itsm-HeroCard__narrative')?.textContent).toContain('INC-004503');
  });

  it('lists the chips, linking the ones with a destination', () => {
    const hero = markup(<HeroCard {...full} />);
    const chips = [...hero.querySelectorAll('.itsm-HeroCard__chips > li')];
    expect(chips.map((chip) => chip.textContent)).toEqual(['1 breached', '3 waiting on others']);
    expect(chips[0]!.querySelector('a.itsm-HeroCard__chip')?.getAttribute('href')).toBe('/inbox/mine?sla=breached');
    expect(chips[1]!.querySelector('a')).toBeNull();
    expect((chips[1]!.querySelector('.itsm-HeroCard__chip') as HTMLElement).dataset.tone).toBe('hold');
    expect(chips[1]!.querySelector('svg')?.getAttribute('data-icon')).toBe('pause');
  });

  it('announces the dimensions as a named list whose rows read as sentences', () => {
    const hero = markup(<HeroCard {...full} />);
    const list = hero.querySelector('ul.itsm-HeroCard__dimensions')!;
    expect(list.getAttribute('aria-label')).toBe('Queue health in detail');
    const rows = [...list.querySelectorAll(':scope > li')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'My work: At risk. 9 open · 1 breached · next due 40 min',
      'Team queue: On track. 6 unassigned · oldest 2 h',
      'Major incident: MI-0004 · SEV2 · Mitigating',
    ]);
    expect(rows[0]!.querySelector('a.itsm-HeroCard__dimension')?.getAttribute('href')).toBe('/inbox/mine');
    expect(rows[1]!.querySelector('a')).toBeNull();
    expect(markup(<HeroCard {...full} dimensionsLabel="Service health by dimension" />).querySelector('.itsm-HeroCard__dimensions')?.getAttribute('aria-label')).toBe(
      'Service health by dimension',
    );
  });

  it('renders the aside’s progress as a meter named by what it measures, with the reading in words', () => {
    const hero = markup(<HeroCard {...full} />);
    const meter = hero.querySelector('[role="meter"]')!;
    const spoken = `${meter.getAttribute('aria-label')} ${meter.getAttribute('aria-valuetext')}`;
    expect(spoken).toBe('Readiness 66%, target 83%');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('1');
    expect(meter.getAttribute('aria-valuenow')).toBe('0.66');
    // The bar is for the eye; its geometry is inline and logical, so it mirrors in RTL.
    expect(meter.querySelector('.itsm-HeroCard__bulletTrack')?.getAttribute('aria-hidden')).toBe('true');
    expect((meter.querySelector('.itsm-HeroCard__bulletFill') as HTMLElement).style.inlineSize).toBe('66%');
    expect((meter.querySelector('.itsm-HeroCard__bulletShort') as HTMLElement).style.insetInlineStart).toBe('66%');
    expect((meter.querySelector('.itsm-HeroCard__bulletShort') as HTMLElement).style.inlineSize).toBe('17%');
    expect((meter.querySelector('.itsm-HeroCard__bulletTarget') as HTMLElement).style.insetInlineStart).toBe('83%');
    expect(hero.querySelector('.itsm-HeroCard__bulletCaption')?.textContent).toBe('Target 83%');
  });

  it('says a reading past the end as it is, and draws it full; no target, no tick', () => {
    const hero = markup(
      <HeroCard kicker="Next breach" verdict={{ tone: 'danger', label: 'Breaching' }} aside={{ kicker: 'Resolution', value: '105%', progress: { value: 1.05, label: 'Resolution time used' } }} />,
    );
    const meter = hero.querySelector('[role="meter"]')!;
    expect(meter.getAttribute('aria-valuetext')).toBe('105%');
    expect(meter.getAttribute('aria-valuenow')).toBe('1');
    expect((meter.querySelector('.itsm-HeroCard__bulletFill') as HTMLElement).style.inlineSize).toBe('100%');
    expect(meter.querySelector('.itsm-HeroCard__bulletTarget')).toBeNull();
    expect(meter.querySelector('.itsm-HeroCard__bulletShort')).toBeNull();
  });

  it('draws the aside’s kicker, figure and label, linking the figure', () => {
    const hero = markup(<HeroCard {...full} />);
    const aside = hero.querySelector('.itsm-HeroCard__aside')!;
    const kicker = aside.querySelector('.itsm-HeroCard__asideKicker') as HTMLElement;
    expect(kicker.textContent).toBe('Next breach');
    expect(kicker.dataset.tone).toBe('warning');
    expect(kicker.querySelector('.itsm-HeroCard__asideDot')?.getAttribute('aria-hidden')).toBe('true');
    const link = aside.querySelector('a.itsm-HeroCard__asideLink')!;
    expect(link.getAttribute('href')).toBe('/tickets/INC-004521');
    expect(link.textContent).toBe('40 min, INC-004521');
  });

  it('takes a node of the caller’s own as the aside', () => {
    const hero = markup(<HeroCard kicker="Major incident · live" verdict={{ tone: 'danger', label: 'Mitigating' }} aside={<p className="app-Countdown">Next update in 12 min</p>} />);
    expect(hero.querySelector('.itsm-HeroCard__aside .app-Countdown')?.textContent).toBe('Next update in 12 min');
    expect(hero.querySelector('[role="meter"]')).toBeNull();
  });

  it('records which columns it has, so the grid can lay them out', () => {
    const { aside, dimensions: rows, ...bare } = full;
    expect(markup(<HeroCard {...full} />).dataset.layout).toBe('full');
    expect(markup(<HeroCard {...bare} dimensions={rows} />).dataset.layout).toBe('dimensions');
    expect(markup(<HeroCard {...bare} aside={aside} />).dataset.layout).toBe('aside');
    expect(markup(<HeroCard {...bare} />).dataset.layout).toBe('single');
    expect(markup(<HeroCard {...bare} dimensions={[]} aside={null} />).dataset.layout).toBe('single');
  });

  it('places the Why? island beside the verdict', () => {
    const hero = markup(<HeroCard {...full} why={<button type="button">Why?</button>} />);
    expect(hero.querySelector('.itsm-HeroCard__verdictRow > .itsm-HeroCard__why button')?.textContent).toBe('Why?');
  });

  it('is light on the Help Portal: no hero surface, the page’s own text tokens', () => {
    const hero = markup(<HeroCard {...full} variant="light" />);
    expect(hero.dataset.variant).toBe('light');
    expect(hero.hasAttribute('data-surface')).toBe(false);
    const light = rule('.itsm-HeroCard[data-variant="light"]');
    expect(light).toContain('background: var(--itsm-hero-light-background)');
    expect(light).toContain('border-color: color-mix(in srgb, var(--itsm-colour-accent) 28%, transparent)');
    expect(light).toContain('box-shadow: none');
    expect(light).toContain('--_itsm-hero-text: var(--itsm-colour-text-primary)');
    expect(light).toContain('--_itsm-hero-kicker: var(--itsm-colour-brand-subtleText)');
    expect(light).toContain('--_itsm-hero-fill: var(--itsm-colour-accent)');
  });

  it('links through the application’s Link inside the provider', () => {
    const { container } = render(
      <TestProvider>
        <HeroCard {...full} />
      </TestProvider>,
    );
    expect([...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['/inbox/mine?sla=breached', '/inbox/mine', '/tickets/INC-004521']);
  });
});

describe('the hero’s rules', () => {
  it('paints the navy card from the hero tokens: background, hairline, radius 16, elevation, min-height 168', () => {
    const navy = rule('.itsm-HeroCard');
    expect(navy).toContain('background: var(--itsm-hero-card-background)');
    expect(navy).toContain('border: var(--itsm-border-hair) solid var(--itsm-colour-hero-line)');
    expect(navy).toContain('border-radius: var(--itsm-radius-3xl)');
    expect(navy).toContain('box-shadow: var(--itsm-elevation-hero)');
    expect(navy).toContain('min-block-size: 10.5rem');
    expect(navy).toContain('container: itsm-hero / inline-size');
  });

  it('marks tones on navy with hero.<tone>, and keeps status text in hero.text', () => {
    for (const tone of ['success', 'warning', 'danger', 'info', 'hold', 'neutral']) {
      expect(rule(`.itsm-HeroCard [data-tone="${tone}"]`)).toContain(`--_itsm-hero-mark: var(--itsm-colour-hero-${tone})`);
    }
    expect(rule('.itsm-HeroCard__verdictIcon')).toContain('color: var(--_itsm-hero-mark)');
    expect(rule('.itsm-HeroCard__verdict')).toContain('color: var(--_itsm-hero-text)');
  });

  it('sets the verdict and the aside figure in the verdict style, the figure tabular', () => {
    for (const part of ['family', 'size', 'line', 'weight', 'tracking', 'word-spacing']) {
      expect(rule('.itsm-HeroCard__verdict')).toContain(`var(--itsm-text-verdict-${part})`);
      expect(rule('.itsm-HeroCard__asideFigure')).toContain(`var(--itsm-text-verdict-${part})`);
    }
    expect(rule('.itsm-HeroCard__asideFigure')).toContain('font-variant-numeric: tabular-nums');
  });

  it('uppercases only the two kickers', () => {
    expect(rule('.itsm-HeroCard__kicker')).toContain('text-transform: uppercase');
    expect(rule('.itsm-HeroCard__asideKicker')).toContain('text-transform: uppercase');
    expect(heroCardStyles.match(/text-transform:\s*uppercase/g)).toHaveLength(2);
  });

  it('folds its columns with its own width: 5 : 4 : 3 from 60 rem, two from 45, one below, tighter under 35', () => {
    expect(heroCardStyles).toContain('@container itsm-hero (min-width: 60rem)');
    expect(heroCardStyles).toContain('grid-template-columns: minmax(0, 5fr) minmax(0, 4fr) minmax(0, 3fr)');
    expect(heroCardStyles).toContain('@container itsm-hero (min-width: 45rem)');
    expect(heroCardStyles).toContain('@container itsm-hero (width < 35rem)');
    const narrow = heroCardStyles.slice(heroCardStyles.indexOf('@container itsm-hero (width < 35rem)'));
    expect(narrow).toMatch(/font-size: 1\.625rem;\s*line-height: 1\.875rem;/);
    expect(narrow).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(rule('.itsm-HeroCard__grid')).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('re-themes the controls a navy surface holds', () => {
    expect(rule('[data-surface="hero"] .itsm-SegmentedControl')).toContain('var(--itsm-colour-hero-fill)');
    expect(heroCardStyles).toMatch(/\[data-surface="hero"\] \.itsm-SegmentedControl__thumb,[^{]*\{[^}]*var\(--itsm-colour-hero-fillStrong\)/);
    expect(rule('[data-surface="hero"] :is(.itsm-Button--ghost, .itsm-Button--secondary)')).toContain('border-color: var(--itsm-colour-hero-lineStrong)');
    expect(rule('[data-surface="hero"] :is(.itsm-Button--ghost, .itsm-Button--secondary):is(:hover, :active)')).toContain('var(--itsm-colour-hero-fill)');
    expect(rule('[data-surface="hero"] .itsm-StatusPill:not([data-emphasis="solid"])')).toContain('inset 0 0 0 var(--itsm-border-hair) var(--itsm-colour-hero-lineStrong)');
  });

  it('keeps the navy on paper and drops the Why? pill there', () => {
    expect(rule('.itsm-HeroCard')).toContain('print-color-adjust: exact');
    expect(heroCardStyles).toMatch(/@media print \{[\s\S]*\.itsm-HeroWhy \{\s*display: none;/);
  });

  it('reads only variables the tokens emit, and writes no colour literals', () => {
    expect(unknownVariables(heroCardStyles)).toEqual([]);
    expect(heroCardStyles).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
  });
});

describe('HeroWhy', () => {
  const items = [
    { label: '1 breached: INC-004503 Teams camera not detected', tone: 'danger' as const, href: '/tickets/INC-004503' },
    { label: '1 due within the hour: INC-004521', detail: 'Resolution due 15:12', tone: 'warning' as const },
    { label: 'MI-0004 is live' },
  ];
  const pill = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('.itsm-HeroWhy')!;
  const popover = (): HTMLElement | null => document.querySelector<HTMLElement>('.itsm-HeroWhy__popover');

  async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
    const started = Date.now();
    while (!condition()) {
      if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the popover module');
      await settle(10);
    }
  }

  it('renders on the server as a plain button that says it opens a dialog, with the list not yet in the page', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<HeroWhy items={items} />);
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('Why?');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain('INC-004503');
  });

  it('renders nothing when there is nothing to explain', () => {
    expect(renderToStaticMarkup(<HeroWhy items={[]} />)).toBe('');
  });

  it('remembers a press made before the popover arrived, and opens when it lands', async () => {
    render(
      <TestProvider>
        <HeroWhy items={items} title="Why queue health is at risk" />
      </TestProvider>,
    );
    focus(pill());
    click(pill());
    await settle();
    expect(popover()).toBeNull();

    gate.release();
    await until(() => popover() !== null);
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    const dialog = popover()!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.querySelector('h2')?.textContent).toBe('Why queue health is at risk');
    const rows = [...dialog.querySelectorAll('.itsm-HeroWhy__item')];
    expect(rows.map((row) => row.textContent)).toEqual([
      '1 breached: INC-004503 Teams camera not detected',
      '1 due within the hour: INC-004521Resolution due 15:12',
      'MI-0004 is live',
    ]);
    expect(rows.map((row) => (row as HTMLElement).dataset.tone)).toEqual(['danger', 'warning', 'neutral']);
    expect(rows[0]!.querySelector('a')?.getAttribute('href')).toBe('/tickets/INC-004503');
    expect(rows[1]!.querySelector('a')).toBeNull();
  });

  it('closes on Escape and puts focus back on the pill', async () => {
    render(<HeroWhy items={items} />);
    focus(pill());
    click(pill());
    await until(() => popover() !== null);
    expect(popover()!.contains(activeElement())).toBe(true);
    press(activeElement() ?? document.body, 'Escape');
    await until(() => popover() === null);
    // Radix hands focus back as the content unmounts, a tick after it leaves the page.
    for (let i = 0; i < 5; i++) await settle();
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    expect(activeElement()).toBe(pill());
  });

  it('is labelled by its button when it has no title', async () => {
    render(<HeroWhy items={items} label="What made this?" />);
    click(pill());
    await until(() => popover() !== null);
    const labelledBy = popover()!.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)?.textContent).toBe('What made this?');
  });

  it('carries no Radix in its static imports, so the root entry stays light', () => {
    const graph = new Set<string>();
    const queue = [join(SRC, 'display/HeroWhy.tsx'), join(SRC, 'display/HeroCard.tsx')];
    const offenders: string[] = [];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (graph.has(file)) continue;
      graph.add(file);
      for (const match of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
        const specifier = match[1]!;
        if (/^@radix-ui\//.test(specifier)) offenders.push(`${file} → ${specifier}`);
        if (!specifier.startsWith('.')) continue;
        const base = resolve(dirname(file), specifier.replace(/\.js$/, ''));
        const next = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((candidate) => existsSync(candidate));
        if (next) queue.push(next);
      }
    }
    expect(offenders).toEqual([]);
    expect([...graph].some((file) => file.endsWith('overlays/Popover.tsx'))).toBe(false);
  });
});

describe('HeroCard audit', () => {
  it.each([
    ['navy', 'apple'],
    ['navy', 'apple-dark'],
    ['light', 'apple'],
    ['light', 'apple-dark'],
  ] as const)('the %s hero has no violations in the %s theme', async (variant, theme) => {
    document.documentElement.dataset.itsmTheme = theme;
    render(
      <TestProvider>
        <main>
          <h1>Overview</h1>
          <HeroCard {...full} variant={variant} why={<HeroWhy items={[{ label: '1 breached', tone: 'danger', href: '/inbox' }]} />} />
          <HeroCard kicker="Service status" verdict={{ tone: 'success', label: 'All services running' }} variant={variant} headingLevel={2} />
        </main>
      </TestProvider>,
    );
    await expectNoViolations(document.body);
  });
});
