// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument } from '../../web/__tests__/support/render.js';
import { DeltaPill, readDelta, type DeltaPillProps } from '../DeltaPill.js';
import { deltaPillStyles } from '../DeltaPill.styles.js';

/*
 * `DeltaPill` (v3 §2.13, A1 §7.2): which way a number moved and whether that
 * is good. Server-safe, so it is rendered here as a server component renders
 * it — static markup, no provider — and read for what the eye sees and what a
 * screen reader hears.
 */

afterEach(() => cleanupDocument());

const here = dirname(fileURLToPath(import.meta.url));

function pill(element: ReactElement): HTMLElement | null {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host.firstElementChild as HTMLElement | null;
}

const delta = (props: DeltaPillProps): HTMLElement => pill(<DeltaPill {...props} />)!;
const heard = (element: Element): string => element.querySelector('.itsm-visually-hidden')?.textContent ?? '';
const seen = (element: Element): string => [...element.querySelectorAll('[aria-hidden="true"]:not(svg)')].map((part) => part.textContent).join(' ');

describe('direction and judgement', () => {
  it.each([
    { value: 5, goodDirection: 'up', direction: 'up', sentiment: 'good', icon: 'arrow-up', said: 'Up 5, better' },
    { value: 5, goodDirection: 'down', direction: 'up', sentiment: 'bad', icon: 'arrow-up', said: 'Up 5, worse' },
    { value: -5, goodDirection: 'up', direction: 'down', sentiment: 'bad', icon: 'arrow-down', said: 'Down 5, worse' },
    { value: -5, goodDirection: 'down', direction: 'down', sentiment: 'good', icon: 'arrow-down', said: 'Down 5, better' },
    { value: 5, goodDirection: 'none', direction: 'up', sentiment: 'neutral', icon: 'arrow-up', said: 'Up 5' },
    { value: -5, goodDirection: 'none', direction: 'down', sentiment: 'neutral', icon: 'arrow-down', said: 'Down 5' },
  ] as const)('$value with good $goodDirection is $direction and $sentiment', ({ value, goodDirection, direction, sentiment, icon, said }) => {
    const root = delta({ value, goodDirection });
    expect(root.classList.contains('itsm-DeltaPill')).toBe(true);
    expect(root.getAttribute('data-direction')).toBe(direction);
    expect(root.getAttribute('data-sentiment')).toBe(sentiment);
    expect(root.querySelector(`svg[data-icon="${icon}"]`)?.getAttribute('aria-hidden')).toBe('true');
    expect(heard(root)).toBe(said);
  });

  it('counts up as good by default', () => {
    expect(delta({ value: 2 }).getAttribute('data-sentiment')).toBe('good');
  });

  it('shows the sign as well as the arrow, so neither colour nor shape is the only signal', () => {
    expect(seen(delta({ value: 0.12, format: { style: 'percent' } }))).toBe('+12%');
    expect(seen(delta({ value: -4 }))).toBe('-4');
  });
});

describe('what it says', () => {
  it('says the period it is measured against, never drawing it', () => {
    const root = delta({ value: 9, unit: 'pts', period: 'vs last week' });
    expect(heard(root)).toBe('Up 9 points, better, vs last week');
    expect(root.textContent).toContain('pts');
    expect(seen(root)).toBe('+9 pts');
  });

  it('spells out points, in the singular for one, and leaves other units as they are', () => {
    expect(heard(delta({ value: -1, unit: 'pts', goodDirection: 'down' }))).toBe('Down 1 point, better');
    expect(heard(delta({ value: 3, unit: 'min', goodDirection: 'down' }))).toBe('Up 3 min, worse');
  });

  it('writes the number in its locale', () => {
    expect(seen(delta({ value: 1234.5, locale: 'de-DE' }))).toBe('+1.234,5');
    expect(heard(delta({ value: 1234.5 }))).toBe('Up 1,234.5, better');
  });
});

describe('no change', () => {
  it('draws no pill for zero, and still says "No change" with the period', () => {
    const root = delta({ value: 0, period: 'vs last week' });
    expect(root.classList.contains('itsm-DeltaPill')).toBe(false);
    expect(root.classList.contains('itsm-visually-hidden')).toBe(true);
    expect(root.textContent).toBe('No change, vs last week');
  });

  it('treats a change that rounds away as none, never an up arrow on "0%"', () => {
    const root = delta({ value: 0.0004, format: { style: 'percent' } });
    expect(root.classList.contains('itsm-DeltaPill')).toBe(false);
    expect(root.textContent).toBe('No change');
    expect(readDelta({ value: 0.0004, format: { style: 'percent' } })?.direction).toBe('flat');
  });

  it('draws a neutral "0" with a level glyph when asked to show zero', () => {
    const root = delta({ value: 0, hideZero: false });
    expect(root.classList.contains('itsm-DeltaPill')).toBe(true);
    expect(root.getAttribute('data-sentiment')).toBe('neutral');
    expect(root.querySelector('svg[data-icon="minus"]')).not.toBeNull();
    expect(seen(root)).toBe('0');
  });

  it('claims nothing about a change that is not a number', () => {
    expect(pill(<DeltaPill value={Number.NaN} />)).toBeNull();
    expect(readDelta({ value: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe('the pill', () => {
  it('is 20 px by default and 18 px small', () => {
    expect(delta({ value: 1 }).getAttribute('data-size')).toBe('md');
    expect(delta({ value: 1, size: 'sm' }).getAttribute('data-size')).toBe('sm');
    expect(deltaPillStyles).toMatch(/\.itsm-DeltaPill \{[^}]*block-size: var\(--itsm-space-ml\);/);
    expect(deltaPillStyles).toMatch(/\.itsm-DeltaPill\[data-size="sm"\] \{[^}]*block-size: 1\.125rem;/);
  });

  it('is set in 600 11 px tabular figures, with a 12 px arrow', () => {
    expect(deltaPillStyles).toMatch(/\.itsm-DeltaPill \{[^}]*font-size: var\(--itsm-font-size-2xs\);[^}]*font-weight: var\(--itsm-font-weight-semibold\);[^}]*font-variant-numeric: tabular-nums;/);
    expect(delta({ value: 1 }).querySelector('svg')?.getAttribute('width')).toBe('12');
  });

  it('tints by judgement with audited text-on-tint pairs', () => {
    expect(deltaPillStyles).toMatch(/\.itsm-DeltaPill \{[^}]*--_itsm-delta-bg: var\(--itsm-colour-neutral-subtle\);[^}]*--_itsm-delta-text: var\(--itsm-colour-text-muted\);/);
    expect(deltaPillStyles).toMatch(/\[data-sentiment="good"\] \{\s*--_itsm-delta-bg: var\(--itsm-colour-success-subtle\);\s*--_itsm-delta-text: var\(--itsm-colour-success-subtleText\);/);
    expect(deltaPillStyles).toMatch(/\[data-sentiment="bad"\] \{\s*--_itsm-delta-bg: var\(--itsm-colour-danger-subtle\);\s*--_itsm-delta-text: var\(--itsm-colour-danger-subtleText\);/);
  });

  it('keeps an edge where a tint cannot be seen: more contrast and forced colours', () => {
    expect(deltaPillStyles).toContain('@media (prefers-contrast: more)');
    expect(deltaPillStyles).toMatch(/@media \(forced-colors: active\) \{\s*\.itsm-DeltaPill \{\s*border: var\(--itsm-hairline\) solid CanvasText;/);
  });

  it('is server-safe: no client directive, no provider', () => {
    const source = readFileSync(join(here, '..', 'DeltaPill.tsx'), 'utf8');
    expect(source.trimStart().startsWith("'use client'")).toBe(false);
    expect(source).not.toMatch(/\buse[A-Z]\w*\(/);
  });
});

describe.each(['apple', 'apple-dark'])('axe, in %s', (theme) => {
  it('every judgement, both sizes and a hidden zero', async () => {
    const host = document.createElement('div');
    host.setAttribute('data-itsm-theme', theme);
    host.innerHTML = renderToStaticMarkup(
      <p>
        Open 9 <DeltaPill value={-2} goodDirection="down" period="vs 7 days ago" />
        SLA met 85% <DeltaPill value={3} unit="pts" period="vs last month" size="sm" />
        Breached 4 <DeltaPill value={2} goodDirection="down" />
        Raised 41 <DeltaPill value={6} goodDirection="none" />
        Resolved 40 <DeltaPill value={0} period="vs previous 30 days" />
        Waiting 6 <DeltaPill value={0} hideZero={false} />
      </p>,
    );
    document.body.append(host);
    await expectNoViolations(host);
  });
});
