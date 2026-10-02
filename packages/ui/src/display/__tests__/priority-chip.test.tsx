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
import { PriorityChip, SignalBars } from '../PriorityChip.js';
import { priorityChipStyles } from '../PriorityChip.styles.js';

/*
 * `PriorityChip` and `SignalBars` (v3 §2.14, A1 §7.8): bars per level
 * (3/3/2/1), the tones, the words, an unknown priority, the spoken phrase,
 * server-safe markup and axe.
 */

afterEach(() => cleanupDocument());

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function chip(element: ReactElement): HTMLElement {
  const { container } = render(element);
  return container.querySelector<HTMLElement>('.itsm-PriorityChip')!;
}

function filledBars(element: HTMLElement): number {
  return element.querySelectorAll('.itsm-SignalBars__bar[data-on]').length;
}

describe('PriorityChip', () => {
  it.each([
    ['P1', 'danger', 3, 'Priority 1, critical'],
    ['P2', 'high', 3, 'Priority 2, high'],
    ['P3', 'neutral', 2, 'Priority 3, medium'],
    ['P4', 'neutral', 1, 'Priority 4, low'],
  ] as const)('%s is %s with %i bars, spoken "%s"', (priority, tone, bars, spoken) => {
    const element = chip(<PriorityChip priority={priority} />);
    expect(element.dataset.tone).toBe(tone);
    expect(element.dataset.priority).toBe(priority);
    expect(filledBars(element)).toBe(bars);
    expect(element.querySelectorAll('.itsm-SignalBars__bar')).toHaveLength(3);
    expect(element.querySelector('.itsm-visually-hidden')!.textContent).toBe(spoken);
    const shown = element.querySelector('.itsm-PriorityChip__label')!;
    expect(shown.textContent).toBe(priority);
    expect(shown.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks only P4 as quiet', () => {
    expect(chip(<PriorityChip priority="P4" />).hasAttribute('data-quiet')).toBe(true);
    cleanupDocument();
    expect(chip(<PriorityChip priority="P3" />).hasAttribute('data-quiet')).toBe(false);
  });

  it('adds the word when asked, and keeps the spoken phrase whole', () => {
    const element = chip(<PriorityChip priority="P2" words size="sm" />);
    expect(element.querySelector('.itsm-PriorityChip__label')!.textContent).toBe('P2 · High');
    expect(element.dataset.size).toBe('sm');
    expect(element.querySelector('.itsm-visually-hidden')!.textContent).toBe('Priority 2, high');
  });

  it('takes its own question for a screen reader', () => {
    const element = chip(<PriorityChip priority="P1" srPrefix="Urgency" />);
    expect(element.querySelector('.itsm-visually-hidden')!.textContent).toBe('Urgency 1, critical');
  });

  it('draws an unknown priority as given, neutral and without bars', () => {
    const element = chip(<PriorityChip priority="Urgent" />);
    expect(element.dataset.tone).toBe('neutral');
    expect(element.hasAttribute('data-priority')).toBe(false);
    expect(element.querySelector('svg')).toBeNull();
    expect(element.querySelector('.itsm-PriorityChip__label')!.textContent).toBe('Urgent');
    expect(element.querySelector('.itsm-visually-hidden')!.textContent).toBe('Priority: Urgent');
  });

  it('renders on the server with no provider, no inline style and a hidden drawing', () => {
    const html = renderToStaticMarkup(<PriorityChip priority="P1" words />);
    expect(html).not.toContain('style=');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('viewBox="0 0 10 10"');
    const source = readFileSync(join(SRC, 'display/PriorityChip.tsx'), 'utf8');
    expect(source.startsWith("'use client'")).toBe(false);
  });

  it('passes data attributes and a class through', () => {
    const element = chip(<PriorityChip priority="P3" className="app-Row__priority" data-testid="priority" />);
    expect(element.classList.contains('app-Row__priority')).toBe(true);
    expect(element.dataset.testid).toBe('priority');
  });

  it('has no axe violations at every level, with and without words', async () => {
    render(
      <p>
        {(['P1', 'P2', 'P3', 'P4', 'Urgent'] as const).map((priority) => (
          <span key={priority}>
            <PriorityChip priority={priority} />
            <PriorityChip priority={priority} words size="sm" />
          </span>
        ))}
      </p>,
    );
    await expectNoViolations(document.body);
  });
});

describe('SignalBars', () => {
  it('draws three bars rising to the top of a 10-unit box, standing on one line', () => {
    const { container } = render(<SignalBars filled={2} />);
    const bars = [...container.querySelectorAll('rect')];
    expect(bars.map((bar) => bar.getAttribute('x'))).toEqual(['1', '4', '7']);
    expect(bars.map((bar) => bar.getAttribute('height'))).toEqual(['4', '6.5', '9']);
    expect(bars.map((bar) => Number(bar.getAttribute('y')) + Number(bar.getAttribute('height')))).toEqual([9.5, 9.5, 9.5]);
    expect(bars.map((bar) => bar.getAttribute('width'))).toEqual(['2', '2', '2']);
    expect(bars.map((bar) => bar.hasAttribute('data-on'))).toEqual([true, true, false]);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the chip stylesheet', () => {
  it('fades the bars a priority does not reach and quiets P4 to muted text', () => {
    expect(priorityChipStyles).toMatch(/\.itsm-SignalBars__bar \{[^}]*fill: currentColor;[^}]*opacity: 0\.28;/);
    expect(priorityChipStyles).toMatch(/\.itsm-PriorityChip\[data-quiet\] \{[^}]*color: var\(--itsm-colour-text-muted\);/);
    expect(priorityChipStyles).toMatch(/\.itsm-PriorityChip\[data-size="sm"\] \{[^}]*min-block-size: 1\.125rem;/);
    expect(priorityChipStyles).toContain('font-variant-numeric: tabular-nums;');
    expect(unknownVariables(priorityChipStyles)).toEqual([]);
  });

  it('outlines the chip under more contrast and in forced colours', () => {
    expect(priorityChipStyles).toContain('[data-itsm-theme="high-contrast"] .itsm-PriorityChip { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-tone-border); }');
    expect(priorityChipStyles).toMatch(/@media \(forced-colors: active\) \{[\s\S]*\.itsm-PriorityChip \{[^}]*border: var\(--itsm-hairline\) solid CanvasText;/);
  });
});
