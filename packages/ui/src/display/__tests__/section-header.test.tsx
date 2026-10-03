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
import { SectionHeader } from '../SectionHeader.js';
import { sectionHeaderStyles } from '../SectionHeader.styles.js';

/*
 * `SectionHeader` (v3 §2.13, G3): the heading over a group of cards — a real
 * heading with its count read as part of it, a qualifier, a fading hairline
 * that is decoration, and the actions at the end — and the PMO's section
 * rhythm in the stylesheet.
 */

afterEach(() => {
  cleanupDocument();
  delete document.documentElement.dataset.itsmTheme;
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function markup(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host.firstElementChild as HTMLElement;
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...sectionHeaderStyles.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join('\n');
}

describe('SectionHeader', () => {
  it('is server-safe: no client directive, renders without a provider', () => {
    expect(readFileSync(join(SRC, 'display/SectionHeader.tsx'), 'utf8').trimStart().startsWith("'use client'")).toBe(false);
    expect(renderToStaticMarkup(<SectionHeader title="Common requests" />)).toContain('Common requests');
  });

  it('is an h2 by default and an h3 when asked, with the id given', () => {
    const two = markup(<SectionHeader title="Common requests" id="common" />);
    expect(two.querySelector('h2')?.textContent).toBe('Common requests');
    expect(two.querySelector('h2')?.id).toBe('common');
    expect(two.dataset.level).toBe('2');
    const three = markup(<SectionHeader title="Hardware" level={3} />);
    expect(three.querySelector('h3')?.textContent).toBe('Hardware');
    expect(three.querySelector('h2')).toBeNull();
    expect(three.querySelector('h3')?.hasAttribute('id')).toBe(false);
  });

  it('reads the count as part of the heading — "Common requests, 6" — and draws nothing for an unknown one', () => {
    const counted = markup(<SectionHeader title="Common requests" count={6} />);
    const heading = counted.querySelector('h2')!;
    expect(heading.querySelector('.itsm-Count')).not.toBeNull();
    expect(heading.querySelector('.itsm-Count')?.getAttribute('data-size')).toBe('md');
    expect(heading.querySelector('.itsm-visually-hidden')?.textContent).toBe(', 6');
    expect(markup(<SectionHeader title="Common requests" count={null} />).querySelector('.itsm-Count')).toBeNull();
    expect(markup(<SectionHeader title="Common requests" />).querySelector('.itsm-Count')).toBeNull();
  });

  it('puts the qualifier after the heading, the hairline after that as decoration, and the actions last', () => {
    const header = markup(<SectionHeader title="Service levels" sub="Northwind Traders · D−21" actions={<a href="/sla">Open SLA →</a>} />);
    expect([...header.children].map((child) => child.className)).toEqual([
      'itsm-SectionHeader__title',
      'itsm-SectionHeader__sub',
      'itsm-SectionHeader__rule',
      'itsm-SectionHeader__actions',
    ]);
    expect(header.querySelector('.itsm-SectionHeader__sub')?.textContent).toBe('Northwind Traders · D−21');
    expect(header.querySelector('.itsm-SectionHeader__rule')?.getAttribute('aria-hidden')).toBe('true');
    expect(header.querySelector('.itsm-SectionHeader__actions a')?.getAttribute('href')).toBe('/sla');
  });

  it('leaves out what it is not given', () => {
    const header = markup(<SectionHeader title="Teams" />);
    expect(header.querySelector('.itsm-SectionHeader__sub')).toBeNull();
    expect(header.querySelector('.itsm-SectionHeader__actions')).toBeNull();
    expect(header.querySelector('.itsm-SectionHeader__rule')).not.toBeNull();
  });
});

describe('the section rhythm and look', () => {
  it('sets the title in title2, with its family and word spacing', () => {
    const title = rule('.itsm-SectionHeader__title');
    for (const part of ['family', 'size', 'line', 'weight', 'tracking', 'word-spacing']) expect(title).toContain(`var(--itsm-text-title2-${part})`);
  });

  it('is 32 px above, 12 below, and 16 above the first section', () => {
    expect(rule('.itsm-SectionHeader')).toContain('margin: var(--itsm-space-xl) 0 var(--itsm-space-sm)');
    expect(rule('.itsm-SectionHeader:first-child')).toContain('margin-block-start: var(--itsm-space-md)');
  });

  it('fades the hairline from border.subtle to nothing, towards the line’s end in either direction', () => {
    expect(rule('.itsm-SectionHeader__rule')).toContain('linear-gradient(90deg, var(--itsm-colour-border-subtle), transparent)');
    expect(rule('.itsm-SectionHeader__rule:dir(rtl)')).toContain('linear-gradient(270deg, var(--itsm-colour-border-subtle), transparent)');
  });

  it('draws the qualifier 500 13/18 muted', () => {
    const sub = rule('.itsm-SectionHeader__sub');
    expect(sub).toContain('var(--itsm-colour-text-muted)');
    expect(sub).toContain('var(--itsm-text-subheadline-size)');
    expect(sub).toContain('var(--itsm-text-subheadline-weight)');
  });

  it('reads only variables the tokens emit', () => {
    expect(unknownVariables(sectionHeaderStyles)).toEqual([]);
  });
});

describe('SectionHeader audit', () => {
  it.each(['apple', 'apple-dark'])('has no violations in the %s theme', async (theme) => {
    document.documentElement.dataset.itsmTheme = theme;
    render(
      <main>
        <h1>Overview</h1>
        <section aria-labelledby="requests">
          <SectionHeader title="Common requests" id="requests" count={6} sub="This month" actions={<a href="/catalogue">Browse all services →</a>} />
          <p>Cards</p>
          <SectionHeader title="Hardware" level={3} count={12} />
        </section>
      </main>,
    );
    await expectNoViolations(document.body);
  });
});
