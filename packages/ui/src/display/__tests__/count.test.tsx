// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRef, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { unknownVariables } from '../../styles/css.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { Count } from '../Count.js';
import { countStyles } from '../Count.styles.js';

/*
 * `Count` (v3 §2.14): a number in a pill, drawn for the eye and spoken for
 * the ear. It is server-safe, so most of these render it the way a server
 * component does — to static markup, with no provider — and read the result.
 */

afterEach(() => cleanupDocument());

function markup(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

const pill = (host: HTMLElement): HTMLElement | null => host.querySelector<HTMLElement>('.itsm-Count');
const shown = (host: HTMLElement): string | null | undefined => host.querySelector('.itsm-Count__value')?.textContent;
const spoken = (host: HTMLElement): string | null | undefined => host.querySelector('.itsm-visually-hidden')?.textContent;

describe('Count', () => {
  it('draws the number and hides the digits from assistive technology in favour of words', () => {
    const host = markup(<Count value={7} />);
    expect(shown(host)).toBe('7');
    expect(host.querySelector('.itsm-Count__value')?.getAttribute('aria-hidden')).toBe('true');
    expect(spoken(host)).toBe(', 7');
    expect(pill(host)?.textContent).toBe('7, 7');
  });

  it('renders nothing for a count nobody has, and never draws it as 0', () => {
    expect(markup(<Count value={null} />).innerHTML).toBe('');
    expect(markup(<Count value={Number.NaN} />).innerHTML).toBe('');
    expect(markup(<Count value={Number.POSITIVE_INFINITY} />).innerHTML).toBe('');
  });

  it('draws a real zero, which is a fact', () => {
    const host = markup(<Count value={0} label="tickets" />);
    expect(shown(host)).toBe('0');
    expect(spoken(host)).toBe(', 0 tickets');
  });

  it('caps at 99+ and says what that means', () => {
    const host = markup(<Count value={100} />);
    expect(shown(host)).toBe('99+');
    expect(spoken(host)).toBe(', more than 99');
    expect(shown(markup(<Count value={99} />))).toBe('99');
    expect(shown(markup(<Count value={12_400} />))).toBe('99+');
  });

  it('marks a count its source stopped counting at', () => {
    const host = markup(<Count value={12} capped label="tickets" />);
    expect(shown(host)).toBe('12+');
    expect(spoken(host)).toBe(', 12 or more tickets');
  });

  it('speaks the noun after the number, agreeing with it when given both forms', () => {
    const noun = { one: 'ticket', other: 'tickets' };
    expect(spoken(markup(<Count value={1} label={noun} />))).toBe(', 1 ticket');
    expect(spoken(markup(<Count value={3} label={noun} />))).toBe(', 3 tickets');
    expect(spoken(markup(<Count value={0} label={noun} />))).toBe(', 0 tickets');
    expect(spoken(markup(<Count value={1} capped label={noun} />))).toBe(', 1 or more tickets');
    expect(spoken(markup(<Count value={250} label={noun} />))).toBe(', more than 99 tickets');
    expect(spoken(markup(<Count value={2} label="breached" />))).toBe(', 2 breached');
  });

  it('never shows a negative or fractional count', () => {
    expect(shown(markup(<Count value={-3} />))).toBe('0');
    expect(spoken(markup(<Count value={-3} />))).toBe(', 0');
    expect(shown(markup(<Count value={4.7} />))).toBe('4');
    expect(spoken(markup(<Count value={4.7} />))).toBe(', 4');
  });

  it('keeps its words when the locale tag is one the runtime does not know', () => {
    expect(spoken(markup(<Count value={1} label={{ one: 'ticket', other: 'tickets' }} locale="not a locale" />))).toBe(', 1 ticket');
  });

  it('carries its tone and size as attributes, neutral and md by default', () => {
    const plain = pill(markup(<Count value={3} />))!;
    expect(plain.dataset.tone).toBe('neutral');
    expect(plain.dataset.size).toBe('md');
    const danger = pill(markup(<Count value={3} tone="danger" size="sm" />))!;
    expect(danger.dataset.tone).toBe('danger');
    expect(danger.dataset.size).toBe('sm');
    expect(pill(markup(<Count value={3} tone="accent" />))!.dataset.tone).toBe('accent');
    expect(plain.hasAttribute('style')).toBe(false);
  });

  it('passes a class, data attributes and a ref through', () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(<Count value={5} className="app-Tab__count" data-testid="count" ref={ref} />);
    const element = container.querySelector<HTMLElement>('.itsm-Count')!;
    expect(element.classList.contains('app-Tab__count')).toBe(true);
    expect(element.dataset.testid).toBe('count');
    expect(ref.current).toBe(element);
  });

  it('reads as one phrase inside the control it counts', () => {
    const { container } = render(
      <a href="/inbox/due">
        Breached
        <Count value={3} tone="danger" size="sm" />
      </a>,
    );
    // The accessible name is the text a screen reader is left with once the hidden digits are gone.
    const link = container.querySelector('a')!;
    const name = [...link.childNodes]
      .map((node) => (node instanceof HTMLElement ? node.querySelector('.itsm-visually-hidden')?.textContent ?? '' : node.textContent))
      .join('');
    expect(name).toBe('Breached, 3');
  });
});

describe('Count is server-safe', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'Count.tsx'), 'utf8');

  it('has no client directive, hook or handler', () => {
    expect(source).not.toMatch(/^['"]use client['"]/m);
    expect(source).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(source).not.toMatch(/\bon[A-Z]\w*=/);
  });
});

describe('Count styles', () => {
  it('reference only variables the tokens emit', () => {
    expect(unknownVariables(countStyles)).toEqual([]);
  });

  it('give each tone an audited text-on-tint pair', () => {
    expect(countStyles).toContain('--_itsm-count-bg: var(--itsm-colour-surface-sunken);');
    expect(countStyles).toContain('--_itsm-count-text: var(--itsm-colour-text-secondary);');
    expect(countStyles).toMatch(/\[data-tone="accent"\] \{\s*--_itsm-count-bg: var\(--itsm-colour-brand-subtle\);\s*--_itsm-count-text: var\(--itsm-colour-brand-subtleText\);/);
    expect(countStyles).toMatch(/\[data-tone="danger"\] \{\s*--_itsm-count-bg: var\(--itsm-colour-danger-subtle\);\s*--_itsm-count-text: var\(--itsm-colour-danger-subtleText\);/);
  });

  it('use tabular figures, so a column of counts does not jitter', () => {
    expect(countStyles).toContain('font-variant-numeric: tabular-nums;');
  });

  it('outline the pill where more contrast is asked for, in forced colours and on a navy hero', () => {
    expect(countStyles).toContain(':root[data-itsm-theme="high-contrast"] .itsm-Count { box-shadow: inset 0 0 0 var(--itsm-hairline) var(--_itsm-count-edge); }');
    expect(countStyles).toMatch(/@media \(forced-colors: active\) \{\s*\.itsm-Count \{\s*border: var\(--itsm-hairline\) solid CanvasText;/);
    expect(countStyles).toMatch(/\[data-surface="hero"\] \.itsm-Count \{\s*--_itsm-count-bg: transparent;\s*--_itsm-count-text: var\(--itsm-colour-hero-text\);/);
  });
});

describe('Count audit', () => {
  it('passes axe in every tone and size, alone and inside the controls it counts', async () => {
    render(
      <div>
        <h2>
          Needs you <Count value={7} label={{ one: 'ticket', other: 'tickets' }} />
        </h2>
        <ul>
          {(['neutral', 'accent', 'danger'] as const).map((tone) => (
            <li key={tone}>
              <a href={`/inbox/${tone}`}>
                {tone} <Count value={tone === 'danger' ? 120 : 4} tone={tone} size="sm" />
              </a>
            </li>
          ))}
        </ul>
        <div role="tablist" aria-label="Views">
          <button type="button" role="tab" aria-selected="true">
            Breached <Count value={12} capped tone="accent" size="sm" />
          </button>
        </div>
        <Count value={null} />
      </div>,
    );
    await expectNoViolations(document.body);
  });
});
