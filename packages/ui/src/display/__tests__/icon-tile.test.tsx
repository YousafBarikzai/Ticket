// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { unknownVariables } from '../../styles/css.js';
import { tones } from '../../feedback/tone.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { IconTile } from '../IconTile.js';
import { iconTileStyles } from '../IconTile.styles.js';

/*
 * `IconTile` (v3 §2.13): a glyph on a tinted square. Server-safe, so these
 * render it the way a server component does, with no provider, and read the
 * markup and the rules that give it its colours and corners.
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

/** The declarations of every rule whose selector is exactly `selector`, joined. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...iconTileStyles.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join('\n');
}

describe('IconTile', () => {
  it('renders on the server with no client directive and no provider', () => {
    expect(readFileSync(join(SRC, 'display/IconTile.tsx'), 'utf8').trimStart().startsWith("'use client'")).toBe(false);
    const tile = markup(<IconTile icon="inbox" />);
    expect(tile.classList.contains('itsm-IconTile')).toBe(true);
    expect(tile.querySelector('svg')?.getAttribute('data-icon')).toBe('inbox');
  });

  it('is 28 px and accent-tinted by default, and decoration unless it is given a meaning', () => {
    const tile = markup(<IconTile icon="inbox" />);
    expect(tile.dataset).toMatchObject({ size: '28', tone: 'accent' });
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.getAttribute('role')).toBeNull();
  });

  it('names itself as an image when the glyph carries meaning nothing beside it says', () => {
    const tile = markup(<IconTile icon="circle-alert" tone="danger" label="Incident" />);
    expect(tile.getAttribute('role')).toBe('img');
    expect(tile.getAttribute('aria-label')).toBe('Incident');
    expect(tile.hasAttribute('aria-hidden')).toBe(false);
    expect(tile.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([
    [28, 16],
    [32, 18],
    [36, 18],
    [40, 20],
  ] as const)('draws a %i px tile with a %i px glyph', (size, glyph) => {
    const tile = markup(<IconTile icon="package" size={size} />);
    expect(tile.dataset.size).toBe(String(size));
    expect(tile.querySelector('svg')?.getAttribute('width')).toBe(String(glyph));
  });

  it('takes any tone, and the squircle only when asked', () => {
    for (const tone of tones) expect(markup(<IconTile icon="package" tone={tone} />).dataset.tone).toBe(tone);
    expect(markup(<IconTile icon="package" />).hasAttribute('data-squircle')).toBe(false);
    expect(markup(<IconTile icon="package" squircle />).hasAttribute('data-squircle')).toBe(true);
  });

  it('passes a class and other attributes through', () => {
    const tile = markup(<IconTile icon="package" className="app-Area__mark" data-area="desk" />);
    expect(tile.classList.contains('app-Area__mark')).toBe(true);
    expect(tile.dataset.area).toBe('desk');
  });
});

describe('the tile’s rules', () => {
  it('tints the accent tile accentHover under brand.subtleText, and every tone with its own audited pair', () => {
    expect(rule('.itsm-IconTile[data-tone="accent"]')).toContain('--_itsm-tile-fill: var(--itsm-colour-surface-accentHover)');
    expect(rule('.itsm-IconTile[data-tone="accent"]')).toContain('--_itsm-tile-ink: var(--itsm-colour-brand-subtleText)');
    expect(rule('.itsm-IconTile[data-tone="neutral"]')).toContain('--_itsm-tone-subtle: var(--itsm-colour-neutral-subtle)');
    expect(rule('.itsm-IconTile[data-tone="neutral"]')).toContain('--_itsm-tone-text: var(--itsm-colour-neutral-subtleText)');
    expect(rule('.itsm-IconTile')).toContain('background: var(--_itsm-tile-fill)');
  });

  it('rounds the small tiles at the control corner and the large ones at the item corner', () => {
    expect(rule('.itsm-IconTile')).toContain('border-radius: var(--itsm-radius-lg)');
    expect(rule('.itsm-IconTile[data-size="36"]')).toContain('border-radius: var(--itsm-radius-item)');
    expect(rule('.itsm-IconTile[data-size="40"]')).toContain('border-radius: var(--itsm-radius-item)');
    expect(rule('.itsm-IconTile[data-squircle]')).toContain('corner-shape: squircle');
  });

  it('turns to the hero’s fill, edge and accent on a navy surface', () => {
    const hero = rule('[data-surface="hero"] .itsm-IconTile');
    expect(hero).toContain('var(--itsm-colour-hero-fill)');
    expect(hero).toContain('var(--itsm-colour-hero-accent)');
    expect(hero).toContain('var(--itsm-colour-hero-line)');
  });

  it('reads only variables the tokens emit, and no colour literals', () => {
    expect(unknownVariables(iconTileStyles)).toEqual([]);
    expect(iconTileStyles).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
  });
});

describe('IconTile audit', () => {
  it.each(['apple', 'apple-dark'])('has no violations in the %s theme', async (theme) => {
    document.documentElement.dataset.itsmTheme = theme;
    render(
      <ul>
        <li>
          <IconTile icon="inbox" /> Inbox
        </li>
        <li>
          <IconTile icon="circle-alert" tone="danger" size={40} label="Incident" />
        </li>
        <li>
          <IconTile icon="package" tone="neutral" size={32} squircle />
        </li>
      </ul>,
    );
    await expectNoViolations(document.body);
  });
});
