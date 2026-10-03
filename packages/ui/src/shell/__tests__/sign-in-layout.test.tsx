// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import axe from 'axe-core';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from '@itsm/contracts/areas';
import { SIGN_IN_PANEL, VENDOR, type SignInPanelCopy } from '@itsm/contracts/marketing';
import { isIconName } from '../../icons/registry.js';
import { unknownVariables } from '../../styles/css.js';
import { styleRegistry } from '../../styles/registry.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { SignInLayout } from '../SignInLayout.js';
import { signInLayoutStyles } from '../SignInLayout.styles.js';
import { SystemBar } from '../SystemBar.js';

/*
 * `SignInLayout` (v3 §6.3, A5 §6.2): the navy panel beside the light column,
 * under every sign-in surface. Server-safe and 0 B of JavaScript, so these
 * render it the way a server page does — no provider — and read the layout
 * a jsdom cannot compute (the 1024 px grid, the band and the overlapping
 * card) from its stylesheet.
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

const text = (element: Element | null | undefined): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** The CSS without comments, so a sentence about a rule is never mistaken for the rule. */
const sheet = signInLayoutStyles.replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first at-rule block that opens with `opening`, braces balanced. */
function block(css: string, opening: string): string {
  const start = css.indexOf(opening);
  expect(start, opening).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index++) {
    if (css[index] === '{') depth++;
    else if (css[index] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, index);
  }
  throw new Error(`unbalanced ${opening}`);
}

/** The declarations of the first rule whose selector is exactly `selector`, in `css`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`));
  expect(match, selector).not.toBeNull();
  return match![1]!;
}

/** Everything outside the media blocks: the phone-first base rules. */
const base = sheet.split('@media')[0]!;

const page = (
  <SignInLayout
    width="chooser"
    productHref="/"
    back={{ href: '/', label: 'IT Service Management home' }}
    systemBar={<SystemBar label="Demo environment" badge={{ label: 'Demo' }} message="Demo data resets every day at 00:00 UK time." align="center" />}
    footer={
      <>
        <a href="/privacy">Privacy</a> · <a href="/cookies">Cookies</a> · <a href="/terms">Terms</a>
      </>
    }
  >
    <h1>Explore the demo</h1>
    <p>Choose a role. You&apos;ll be signed in to a shared demo for Northwind Traders (UK), a fictional company. No sign-up.</p>
    <a href="https://desk.example.com/demo?persona=agent&amp;demo=1" rel="nofollow">
      Explore the demo as Alex Morgan
    </a>
  </SignInLayout>
);

describe('SignInLayout', () => {
  it('renders on the server with no client directive and no provider', () => {
    expect(readFileSync(join(SRC, 'shell/SignInLayout.tsx'), 'utf8').trimStart().startsWith("'use client'")).toBe(false);
    expect(() => renderToStaticMarkup(page)).not.toThrow();
    expect(() => renderToStaticMarkup(<SignInLayout>x</SignInLayout>)).not.toThrow();
  });

  it('has one main, the skip link’s target, holding the column’s content', () => {
    const root = markup(page);
    const mains = root.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]!.id).toBe('main');
    expect(mains[0]!.getAttribute('tabindex')).toBe('-1');
    expect(mains[0]!.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelectorAll('h1')).toHaveLength(1);
  });

  it('names the panel as an aside about the product, on a navy surface', () => {
    const panel = markup(page).querySelector('aside')!;
    expect(panel.classList.contains('itsm-SignInLayout__panel')).toBe(true);
    expect(panel.getAttribute('aria-label')).toBe(`About ${PRODUCT_NAME}`);
    expect(panel.getAttribute('aria-label')).toBe('About IT Service Management');
    expect(panel.dataset.surface).toBe('hero');
    // The panel sits outside main, so its pitch is never mistaken for the page's content.
    expect(panel.closest('main')).toBeNull();
  });

  it('says the panel copy from @itsm/contracts/marketing by default, with the headline as a paragraph', () => {
    const panel = markup(page).querySelector('aside')!;
    expect(text(panel.querySelector('.itsm-SignInLayout__product'))).toBe(PRODUCT_NAME);
    expect(text(panel.querySelector('.itsm-SignInLayout__suffix'))).toBe(SIGN_IN_PANEL.suffix);
    const headline = panel.querySelector('.itsm-SignInLayout__headline')!;
    expect(headline.tagName).toBe('P');
    expect(text(headline)).toBe(SIGN_IN_PANEL.headline);
    expect(panel.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')).toBeNull();
    expect([...panel.querySelectorAll('.itsm-SignInLayout__point')].map(text)).toEqual(SIGN_IN_PANEL.points.map((point) => point.text));
    expect(text(panel.querySelector('.itsm-SignInLayout__poweredBy'))).toBe(VENDOR.line);
  });

  it('draws each point in a 36 px tile whose glyph the registry knows, hidden from assistive technology', () => {
    for (const point of SIGN_IN_PANEL.points) expect(isIconName(point.icon), point.icon).toBe(true);
    const tiles = [...markup(page).querySelectorAll('.itsm-SignInLayout__point .itsm-IconTile')];
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      expect(tile.getAttribute('data-size')).toBe('36');
      expect(tile.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('takes another panel when given one, and keeps a tile for a glyph name it does not know', () => {
    const custom: SignInPanelCopy = {
      suffix: 'Service Desk',
      headline: 'Sign in to work your queue',
      points: [{ icon: 'not-an-icon', text: 'Queues and SLA timers' }],
      poweredBy: VENDOR.line,
    };
    const panel = markup(<SignInLayout panel={custom}>x</SignInLayout>).querySelector('aside')!;
    expect(text(panel.querySelector('.itsm-SignInLayout__headline'))).toBe('Sign in to work your queue');
    expect(text(panel.querySelector('.itsm-SignInLayout__suffix'))).toBe('Service Desk');
    expect(panel.querySelectorAll('.itsm-SignInLayout__point .itsm-IconTile')).toHaveLength(1);
  });

  it('makes the lockup a link only when given a product href', () => {
    const plain = markup(<SignInLayout>x</SignInLayout>).querySelector('.itsm-SignInLayout__lockup')!;
    expect(plain.tagName).toBe('DIV');
    expect(plain.closest('a')).toBeNull();
    expect(markup(<SignInLayout>x</SignInLayout>).querySelector('aside a')).toBeNull();

    const linked = markup(<SignInLayout productHref="https://www.example.com">x</SignInLayout>).querySelector('.itsm-SignInLayout__lockup')!;
    expect(linked.tagName).toBe('A');
    expect(linked.getAttribute('href')).toBe('https://www.example.com');
    expect(text(linked)).toBe(`${PRODUCT_NAME} ${SIGN_IN_PANEL.suffix}`);
    // The mark beside the visible name is decoration.
    expect(linked.querySelector('.itsm-BrandMark')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('puts the back link at the top of the column, with a direction-aware arrow', () => {
    const back = markup(page).querySelector('.itsm-SignInLayout__back')!;
    expect(back.tagName).toBe('A');
    expect(back.getAttribute('href')).toBe('/');
    expect(text(back)).toBe('IT Service Management home');
    expect(back.closest('main')).not.toBeNull();
    expect(back.nextElementSibling?.classList.contains('itsm-SignInLayout__content')).toBe(true);
    expect(back.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(markup(<SignInLayout>x</SignInLayout>).querySelector('.itsm-SignInLayout__back')).toBeNull();
  });

  it('renders the system bar above the grid and the footer under the column, only when given', () => {
    const root = markup(page);
    expect(root.firstElementChild?.classList.contains('itsm-SystemBar')).toBe(true);
    expect(root.children[1]?.classList.contains('itsm-SignInLayout__grid')).toBe(true);
    const footer = root.querySelector('footer')!;
    expect(footer.classList.contains('itsm-SignInLayout__footer')).toBe(true);
    expect(footer.parentElement?.classList.contains('itsm-SignInLayout__column')).toBe(true);
    expect(footer.closest('main')).toBeNull();
    expect(text(footer)).toBe('Privacy · Cookies · Terms');

    const bare = markup(<SignInLayout>x</SignInLayout>);
    expect(bare.querySelector('.itsm-SystemBar, footer')).toBeNull();
    expect(bare.firstElementChild?.classList.contains('itsm-SignInLayout__grid')).toBe(true);
  });

  it('carries its width on the root: form by default, chooser on request', () => {
    expect(markup(<SignInLayout>x</SignInLayout>).dataset.width).toBe('form');
    expect(markup(page).dataset.width).toBe('chooser');
  });

  it.each(['apple', 'apple-dark'])('passes axe as a whole page in the %s theme', async (theme) => {
    document.documentElement.dataset.itsmTheme = theme;
    render(page);
    await expectNoViolations(document.body);
  });

  it('is a page whose every part sits in a landmark, page-level rules included', async () => {
    // A layout is a page, so here the rules a fragment cannot answer can run:
    // the system bar is a named region, the panel an aside beside the
    // column the one main and the legal line the page's contentinfo.
    document.documentElement.lang = 'en-GB';
    const host = document.createElement('div');
    host.innerHTML = `<div class="itsm-SkipLinks"><a class="itsm-SkipLinks__link" href="#main">Skip to main content</a></div>${renderToStaticMarkup(page)}`;
    document.body.appendChild(host);
    const results = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      rules: { 'color-contrast': { enabled: false }, 'color-contrast-enhanced': { enabled: false }, 'target-size': { enabled: false }, 'document-title': { enabled: false } },
      resultTypes: ['violations', 'passes'],
    });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`)).toEqual([]);
    expect(results.passes.map((passed) => passed.id)).toEqual(
      expect.arrayContaining(['region', 'bypass', 'landmark-contentinfo-is-top-level', 'landmark-main-is-top-level', 'landmark-no-duplicate-main', 'landmark-unique']),
    );
    document.documentElement.removeAttribute('lang');
  });
});

describe('the sign-in layout stylesheet', () => {
  it('is registered, reads only emitted tokens and paints no colour literal', () => {
    expect(styleRegistry.find((entry) => entry.module === 'shell/SignInLayout.styles.ts')?.css).toBe(signInLayoutStyles);
    expect(unknownVariables(signInLayoutStyles)).toEqual([]);
    expect(sheet.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(sheet.match(/\b(?:rgba?|hsla?)\(/g) ?? []).toEqual([]);
  });

  it('from 1024 px, lays the page out as a 45/55 grid as tall as the viewport under the system bar', () => {
    const desktop = block(sheet, '@media (min-width: 64rem)');
    const grid = rule(desktop, '.itsm-SignInLayout__grid');
    expect(grid).toContain('display: grid;');
    expect(grid).toContain('grid-template-columns: minmax(0, 45fr) minmax(0, 55fr);');
    expect(grid).toContain('min-block-size: calc(100dvh - var(--itsm-system-bar-h));');
    // The panel stacks lockup, pitch and vendor line; the column is the raised surface.
    expect(rule(desktop, '.itsm-SignInLayout__panel')).toContain('flex-direction: column;');
    expect(rule(desktop, '.itsm-SignInLayout__pitch')).toContain('display: grid;');
    expect(rule(desktop, '.itsm-SignInLayout__poweredBy')).toContain('display: block;');
    expect(rule(desktop, '.itsm-SignInLayout__column')).toContain('background: var(--itsm-colour-surface-raised);');
    expect(rule(desktop, '.itsm-SignInLayout__back')).toContain('position: absolute;');
  });

  it('keeps the column’s content to 420 px for a form and 560 px for a chooser', () => {
    expect(rule(base, '.itsm-SignInLayout')).toContain('--_itsm-signin-content: 26.25rem;');
    expect(rule(base, '.itsm-SignInLayout[data-width="chooser"]')).toContain('--_itsm-signin-content: 35rem;');
    expect(rule(block(sheet, '@media (min-width: 64rem)'), '.itsm-SignInLayout__content')).toContain('var(--_itsm-signin-content)');
  });

  it('paints the panel with the navy panel composite and a faint 32 px grid', () => {
    const panel = rule(base, '.itsm-SignInLayout__panel');
    expect(panel).toContain('background: var(--itsm-hero-panel-background);');
    expect(panel).toContain('color: var(--itsm-colour-hero-text);');
    const lines = rule(base, '.itsm-SignInLayout__panel::before');
    expect(lines).toContain('color-mix(in srgb, var(--itsm-colour-hero-text) 3.5%, transparent)');
    expect(lines).toContain('background-size: 2rem 2rem;');
    expect(lines).toContain('mask-image: radial-gradient(');
    expect(lines).toContain('pointer-events: none;');
  });

  it('below 1024 px, is a 120 px band with the lockup alone and a card that overlaps it', () => {
    const band = rule(base, '.itsm-SignInLayout__panel');
    expect(band).toContain('block-size: 7.5rem;');
    // The pitch is gone, not merely invisible, so nobody hears what nobody sees.
    expect(rule(base, '.itsm-SignInLayout__pitch,\n.itsm-SignInLayout__poweredBy')).toContain('display: none;');
    expect(rule(base, '.itsm-SignInLayout__mark')).toContain('max-inline-size: 2.25rem;');
    const card = rule(base, '.itsm-SignInLayout__main');
    expect(card).toContain('margin: calc(-1 * var(--itsm-space-lg)) auto var(--itsm-space-xl);');
    expect(card).toContain('border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);');
    expect(card).toContain('border-radius: var(--itsm-radius-3xl);');
    expect(card).toContain('background: var(--itsm-colour-surface-raised);');
    // Positioned, or the positioned band would paint over the card's top edge.
    expect(card).toContain('position: relative;');
  });

  it('below 480 px, shortens the band to 96 px and drops the card frame', () => {
    const phone = block(sheet, '@media (max-width: 29.9375rem)');
    expect(rule(phone, '.itsm-SignInLayout__panel')).toContain('block-size: 6rem;');
    const column = rule(phone, '.itsm-SignInLayout__main');
    expect(column).toContain('border: 0;');
    expect(column).toContain('margin: 0;');
    expect(column).toContain('background: transparent;');
  });

  it('gives the back link a 44 px target on a touch screen', () => {
    expect(rule(block(sheet, '@media (pointer: coarse)'), '.itsm-SignInLayout__back')).toContain('min-block-size: 2.75rem;');
  });

  it('turns the panel into a plain Canvas block with an edge in forced colours, and drops it in print', () => {
    const forced = block(sheet, '@media (forced-colors: active)');
    expect(rule(forced, '.itsm-SignInLayout__panel')).toContain('background: Canvas;');
    expect(rule(forced, '.itsm-SignInLayout__panel::before')).toContain('display: none;');
    expect(sheet).toMatch(/border-inline-end: var\(--itsm-border-hair\) solid CanvasText;/);
    expect(rule(block(sheet, '@media print'), '.itsm-SignInLayout__panel')).toContain('display: none;');
  });

  it('leaves the frame offset to the system bar', () => {
    expect(sheet).not.toMatch(/--itsm-system-bar-h\s*:/);
  });
});
