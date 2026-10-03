// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { unknownVariables } from '../../styles/css.js';
import { baseStyles } from '../../styles/base.styles.js';
import { componentStylesheet } from '../../styles/index.js';
import { renderTokenStylesheet } from '../../tokens/css.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { SYSTEM_BAR_BUSY_LABEL, SystemBar, SystemBarBadge } from '../SystemBar.js';
import { systemBarStyles } from '../SystemBar.styles.js';

/*
 * `SystemBar` (v3 §2.15, X-B1): the navy strip above the frame. Server-safe,
 * so these render it as a server component does — no provider — and read the
 * stylesheet for the parts a jsdom cannot lay out: the one rule that
 * publishes the frame offset, the phone's static flow and the fallback for a
 * browser without `:has()`.
 */

afterEach(() => cleanupDocument());

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function markup(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host.firstElementChild as HTMLElement;
}

const text = (element: Element | null | undefined): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** The CSS without comments, so a sentence about a rule is never mistaken for the rule. */
const sheet = systemBarStyles.replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the at-rule block that opens with `opening`, braces balanced. */
function block(css: string, opening: string, from = 0): string {
  const start = css.indexOf(opening, from);
  expect(start, opening).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index++) {
    if (css[index] === '{') depth++;
    else if (css[index] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, index);
  }
  throw new Error(`unbalanced ${opening}`);
}

/** The declarations of every top-level rule whose selector is exactly `selector`. */
function rules(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]!);
}

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(path);
      } else if (/\.tsx?$/.test(entry.name)) found.push(relative(SRC, path).split(sep).join('/'));
    }
  };
  walk(SRC);
  return found;
}

const demoBar = (
  <SystemBar
    label="Demo environment"
    badge={{ label: 'Demo', live: true }}
    status={
      <>
        Resets in <time dateTime="PT9H1M38S">09:01:38</time>
      </>
    }
    message="Demo data resets every day at 00:00 UK time."
    persona={
      <>
        You're <strong>Alex Morgan</strong> · Service Desk team lead
      </>
    }
    note="Changes are shared with other visitors until the nightly reset. Please don't enter real personal data."
    actions={
      <>
        <button type="button" className="itsm-SystemBar__action" aria-haspopup="dialog">
          <span className="itsm-SystemBar__actionLabel">Demo details</span>
        </button>
        <button type="submit" form="itsm-signout" className="itsm-SystemBar__action">
          <span className="itsm-SystemBar__actionLabel">End demo</span>
        </button>
      </>
    }
  />
);

describe('SystemBar', () => {
  it('renders on the server with no client directive and no provider', () => {
    expect(readFileSync(join(SRC, 'shell/SystemBar.tsx'), 'utf8').trimStart().startsWith("'use client'")).toBe(false);
    expect(() => renderToStaticMarkup(demoBar)).not.toThrow();
  });

  it('is a region named by its label, on a navy surface', () => {
    const bar = markup(demoBar);
    expect(bar.tagName).toBe('DIV');
    expect(bar.getAttribute('role')).toBe('region');
    expect(bar.getAttribute('aria-label')).toBe('Demo environment');
    expect(bar.classList.contains('itsm-SystemBar')).toBe(true);
    expect(bar.dataset.surface).toBe('hero');
    expect(bar.dataset.state).toBe('default');
  });

  it('reads in order: badge, status, message, persona, note, actions', () => {
    const bar = markup(demoBar);
    const parts = [...bar.querySelectorAll('[class^="itsm-SystemBar__"]')]
      .map((element) => element.className)
      .filter((name) => ['badge', 'status', 'message', 'persona', 'note', 'actions'].some((part) => name === `itsm-SystemBar__${part}`));
    expect(parts).toEqual([
      'itsm-SystemBar__badge',
      'itsm-SystemBar__status',
      'itsm-SystemBar__message',
      'itsm-SystemBar__persona',
      'itsm-SystemBar__note',
      'itsm-SystemBar__actions',
    ]);
    expect(text(bar.querySelector('.itsm-SystemBar__badge'))).toBe('Demo');
    expect(text(bar.querySelector('.itsm-SystemBar__status'))).toBe('Resets in 09:01:38');
    expect(text(bar.querySelector('.itsm-SystemBar__persona'))).toBe("You're Alex Morgan · Service Desk team lead");
    // The separator between the two sentences is drawn, never read.
    expect(bar.querySelector('.itsm-SystemBar__separator')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves out the slots it is not given, and the separator with them', () => {
    const bar = markup(<SystemBar label="Demo environment" message="Demo data resets every day at 00:00 UK time." />);
    for (const part of ['badge', 'status', 'persona', 'note', 'actions', 'separator']) {
      expect(bar.querySelector(`.itsm-SystemBar__${part}`), part).toBeNull();
    }
    expect(text(bar.querySelector('.itsm-SystemBar__text'))).toBe('Demo data resets every day at 00:00 UK time.');
  });

  it('pulses the badge dot only when the session is live, and hides the dot from assistive technology', () => {
    const live = markup(demoBar).querySelector('.itsm-SystemBar__badge')!;
    expect(live.hasAttribute('data-live')).toBe(true);
    expect(live.querySelector('.itsm-SystemBar__dot')?.getAttribute('aria-hidden')).toBe('true');
    const still = markup(<SystemBar label="Demo environment" badge={{ label: 'Demo' }} />).querySelector('.itsm-SystemBar__badge')!;
    expect(still.hasAttribute('data-live')).toBe(false);
    expect(markup(<SystemBarBadge label="Demo" live />).hasAttribute('data-live')).toBe(true);
  });

  it('carries its state on the root, with the busy line ready in the markup and silent', () => {
    for (const state of ['default', 'warning', 'busy'] as const) {
      const bar = markup(
        <SystemBar label="Demo environment" state={state} status={<time dateTime="PT9M">00:09:00</time>} />,
      );
      expect(bar.dataset.state).toBe(state);
      const busy = bar.querySelector('.itsm-SystemBar__busy')!;
      expect(text(busy)).toBe(SYSTEM_BAR_BUSY_LABEL);
      expect(busy.querySelector('.itsm-Spinner')).not.toBeNull();
      // Nothing before main may be a status region (§3.9); the demo bar's own live region speaks.
      expect(bar.querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    }
    expect(SYSTEM_BAR_BUSY_LABEL).toBe('Demo data is being reset');
    expect(text(markup(<SystemBar label="x" state="busy" busyLabel="Resetting now…" />).querySelector('.itsm-SystemBar__busy'))).toBe('Resetting now…');
  });

  it('draws the warning pill and the busy swap from data-state alone, so an island can flip it', () => {
    expect(sheet).toMatch(/\.itsm-SystemBar\[data-state="warning"\] \.itsm-SystemBar__status \{[^}]*background: color-mix\(in srgb, var\(--itsm-colour-hero-warning\) 20%, transparent\);[^}]*color: var\(--itsm-colour-hero-warning\);/);
    expect(rules(sheet, '.itsm-SystemBar__busy')[0]).toContain('display: none;');
    expect(rules(sheet, '.itsm-SystemBar[data-state="busy"] .itsm-SystemBar__busy')[0]).toContain('display: inline-flex;');
    expect(rules(sheet, '.itsm-SystemBar[data-state="busy"] .itsm-SystemBar__status')[0]).toContain('display: none;');
  });

  it('centres its content when asked, for the public bar', () => {
    expect(markup(<SystemBar label="Demo environment" align="center" />).dataset.align).toBe('center');
    expect(markup(<SystemBar label="Demo environment" />).hasAttribute('data-align')).toBe(false);
  });

  it('takes its focus ring from the navy re-theming, which it does not override', () => {
    // The base layer's rule gives every control inside the bar the hero accent ring with a navy gap…
    expect(baseStyles).toMatch(/:where\(\[data-surface="hero"\]\) \{\s*--itsm-colour-border-focus: var\(--itsm-colour-hero-accent\);\s*--itsm-colour-focusGap: var\(--itsm-colour-hero-surface\);/);
    // …and the bar keeps it: nothing here resets the focus colours or draws a ring of its own.
    expect(sheet).not.toMatch(/--itsm-colour-border-focus\s*:|--itsm-colour-focusGap\s*:|outline\s*:/);
    expect(markup(demoBar).dataset.surface).toBe('hero');
  });

  it('passes axe with its controls, above a main', async () => {
    render(
      <div>
        {demoBar}
        <main>
          <h1>Overview</h1>
        </main>
      </div>,
    );
    await expectNoViolations(document.body);
  });
});

describe('the system bar stylesheet', () => {
  it('publishes the frame offset in one rule, at 48rem and up, through :has()', () => {
    const desktop = block(sheet, '@media (min-width: 48rem)');
    expect(desktop).toMatch(/:root:has\(\.itsm-SystemBar\) \{\s*--itsm-system-bar-h: var\(--itsm-system-bar-height\);\s*\}/);
    expect(sheet.match(/--itsm-system-bar-h\s*:/g)).toHaveLength(1);
  });

  it('sticks at the top above the top bar from 48rem, and is in the flow below it', () => {
    const [base] = rules(sheet, '.itsm-SystemBar');
    expect(base).toContain('position: static;');
    expect(base).toContain('min-block-size: var(--itsm-system-bar-height);');
    expect(base).toContain('grid-template-areas: "lead actions" "text text";');
    const desktop = block(sheet, '@media (min-width: 48rem)');
    expect(desktop).toMatch(/\.itsm-SystemBar \{[^}]*position: sticky;[^}]*inset-block-start: 0;[^}]*z-index: var\(--itsm-z-systemBar\);/);
    // Sticky nowhere else: a phone keeps only the top bar and the tab bar fixed.
    expect(sheet.match(/position: sticky/g)).toHaveLength(1);
  });

  it('stays in the flow where :has() is missing, after the sticky rule so it wins', () => {
    const fallback = sheet.indexOf('@supports not selector(:has(*))');
    expect(fallback).toBeGreaterThan(sheet.indexOf('position: sticky'));
    expect(block(sheet, '@supports not selector(:has(*))')).toMatch(/\.itsm-SystemBar \{\s*position: static;\s*\}/);
  });

  it('is the only place in the design system that declares the offset, beside the tokens’ 0px default', () => {
    const declaring = sourceFiles().filter((file) => /--itsm-system-bar-h\s*:/.test(readFileSync(join(SRC, file), 'utf8')));
    expect(declaring).toEqual(['shell/SystemBar.styles.ts']);
    // The token layer declares the default once, and only as zero…
    expect(renderTokenStylesheet().match(/--itsm-system-bar-h:\s*[^;]+;/g)).toEqual(['--itsm-system-bar-h: 0px;']);
    // …and the component sheet holds no declaration but this file's (once it is registered).
    for (const declaration of componentStylesheet.match(/--itsm-system-bar-h:\s*[^;]+;/g) ?? []) {
      expect(declaration).toBe('--itsm-system-bar-h: var(--itsm-system-bar-height);');
    }
  });

  it('shows the note only from 80rem and the action words only from 64rem', () => {
    expect(rules(sheet, '.itsm-SystemBar__note')[0]).toContain('display: none;');
    expect(block(sheet, '@media (min-width: 80rem)')).toMatch(/\.itsm-SystemBar__note \{\s*display: block;\s*\}/);
    expect(rules(sheet, '.itsm-SystemBar__actionLabel')[0]).toContain('clip-path: inset(50%);');
    expect(block(sheet, '@media (min-width: 64rem)')).toMatch(/\.itsm-SystemBar__actionLabel \{[^}]*position: static;[^}]*clip-path: none;/);
  });

  it('never pulses under reduced motion, the system’s or the product’s', () => {
    expect(block(sheet, '@media (prefers-reduced-motion: reduce)')).toMatch(/\.itsm-SystemBar__badge\[data-live\] \.itsm-SystemBar__dot::after \{\s*animation: none;/);
    expect(sheet).toMatch(/:root\[data-itsm-motion="reduced"\] \.itsm-SystemBar__badge\[data-live\] \.itsm-SystemBar__dot::after \{\s*animation: none;/);
  });

  it('is hidden in print and drawn in system colours when colours are forced', () => {
    expect(block(sheet, '@media print')).toMatch(/\.itsm-SystemBar \{\s*display: none;/);
    expect(block(sheet, '@media (forced-colors: active)')).toMatch(/\.itsm-SystemBar \{[^}]*background: Canvas;/);
  });

  it('paints only navy tokens: the bar composite, its edge and its text', () => {
    const [base] = rules(sheet, '.itsm-SystemBar');
    expect(base).toContain('background: var(--itsm-hero-bar-background);');
    expect(base).toContain('border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-hero-line);');
    expect(base).toContain('color: var(--itsm-colour-hero-text);');
    expect(sheet.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(sheet.match(/\b(?:rgba?|hsla?)\(/g) ?? []).toEqual([]);
    expect(unknownVariables(systemBarStyles)).toEqual([]);
  });
});
